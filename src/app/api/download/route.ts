// ─── Windows installer download — streams public/<installer> with resume support ──
// GET /api/download?info=1 → JSON metadata (size, sha256, availability)
// GET /api/download        → the installer binary as an attachment (Range supported)

import { createReadStream, type Stats } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { APP_VERSION, GITHUB_RELEASES_URL, INSTALLER_EXE_FILE_NAME, INSTALLER_FILE_NAME } from '@/lib/app-info'

export const dynamic = 'force-dynamic'

/**
 * The dashboard (dev/preview) ships the ZIP package; an installed copy instead
 * self-publishes its own setup .exe into public/ at install time (the NSIS
 * script CopyFiles $EXEPATH there). Serve whichever exists — ZIP preferred.
 */
function installerCandidates(): string[] {
  return [
    path.join(process.cwd(), 'public', INSTALLER_FILE_NAME),
    path.join(process.cwd(), 'public', INSTALLER_EXE_FILE_NAME),
  ]
}

async function findInstaller(): Promise<{ fileName: string; stats: Stats } | null> {
  for (const filePath of installerCandidates()) {
    try {
      const stats = await stat(filePath)
      if (stats.isFile()) return { fileName: path.basename(filePath), stats }
    } catch {
      // try the next candidate
    }
  }
  return null
}

function contentTypeFor(fileName: string): string {
  if (fileName.toLowerCase().endsWith('.zip')) return 'application/zip'
  return 'application/vnd.microsoft.portable-executable'
}

// Hashing a ~300 MB file takes a moment — compute once, then reuse while the
// file is unchanged (keyed on path + mtime + size so a rebuilt installer
// invalidates the cache automatically instead of serving a stale hash).
let sha256Cache: { key: string; hash: string } | null = null

function cacheKey(filePath: string, stats: Stats): string {
  return `${filePath}:${stats.mtimeMs}:${stats.size}`
}

async function sha256OfFile(filePath: string, stats: Stats): Promise<string> {
  const key = cacheKey(filePath, stats)
  if (sha256Cache?.key === key) return sha256Cache.hash
  const hash = await new Promise<string>((resolve, reject) => {
    const h = createHash('sha256')
    const stream = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 })
    stream.on('data', (chunk) => h.update(chunk))
    stream.on('end', () => resolve(h.digest('hex')))
    stream.on('error', reject)
  })
  sha256Cache = { key, hash }
  return hash
}

function notAvailable() {
  return {
    available: false,
    fileName: INSTALLER_FILE_NAME,
    version: APP_VERSION,
    sizeBytes: 0,
    sha256: null,
    modifiedAt: null,
    fallbackUrl: GITHUB_RELEASES_URL,
  }
}

function binaryHeaders(stats: Stats, fileName: string) {
  return {
    'Content-Type': contentTypeFor(fileName),
    'Content-Length': String(stats.size),
    'Accept-Ranges': 'bytes',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const wantsInfo = url.searchParams.get('info') != null

  const found = await findInstaller()
  if (!found) {
    if (wantsInfo) return Response.json(notAvailable())
    return Response.json(
      { error: 'فایل نصبی روی این نصب یافت نشد — از GitHub Releases دانلود کنید' },
      { status: 404 },
    )
  }
  const { fileName, stats } = found
  const filePath = path.join(process.cwd(), 'public', fileName)

  if (wantsInfo) {
    const sha256 = await sha256OfFile(filePath, stats)
    return Response.json({
      available: true,
      fileName,
      version: APP_VERSION,
      sizeBytes: stats.size,
      sha256,
      modifiedAt: stats.mtime.toISOString(),
      fallbackUrl: GITHUB_RELEASES_URL,
    })
  }

  // Range request → 206 partial content (lets browsers resume a big download)
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m) {
      const size = stats.size
      let start: number
      let end: number
      if (m[1] === '' && m[2] !== '') {
        // suffix range: last N bytes
        start = Math.max(0, size - Number(m[2]))
        end = size - 1
      } else {
        start = Number(m[1] || 0)
        end = m[2] === '' ? size - 1 : Number(m[2])
      }
      end = Math.min(end, size - 1)
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      }
      const partial = createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(partial) as ReadableStream, {
        status: 206,
        headers: {
          ...binaryHeaders(stats, fileName),
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
        },
      })
    }
  }

  const full = createReadStream(filePath)
  return new Response(Readable.toWeb(full) as ReadableStream, {
    headers: binaryHeaders(stats, fileName),
  })
}
