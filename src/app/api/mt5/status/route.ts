import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { resolveActiveAccount } from '@/lib/server-data'

export const dynamic = 'force-dynamic'

// ─── MT5 connector diagnostics ───────────────────────────────────────────────
// Answers "why does the dashboard show no data yet" without leaving the app:
//   - is the bundled connector configured and actually running?
//   - did any real MT5 sync arrive (account carries mt5 login)?
//   - WHICH account is the connector currently pushing (the account of the
//     most recent MT5_SYNC log) — lets the dashboard follow terminal account
//     switches and show an honest sync badge.
//   - what does the connector's own log file say (last lines)?
//
// The connector (spawned by /api/mt5/launch) writes stdout+stderr into
// <PTI_LOG_DIR>/mt5-sync.log — the same file is tailed here.

interface LogLine {
  ts: string
  source: string
  status: string
  message: string
}

const g = globalThis as unknown as { __mt5SyncPid?: number | null }

function isRunning(pid: number | null | undefined): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function tailFile(filePath: string, maxBytes = 8000): string | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    if (!stat.isFile() || stat.size === 0) return null
    const start = Math.max(0, stat.size - maxBytes)
    const fd = fs.openSync(filePath, 'r')
    const buffer = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buffer, 0, buffer.length, start)
    fs.closeSync(fd)
    return buffer.toString('utf8').trimEnd()
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const pythonExe = process.env.PTI_PYTHON
    const scriptPath = process.env.PTI_SYNC_SCRIPT
    const bundled = Boolean(pythonExe && scriptPath && fs.existsSync(pythonExe) && fs.existsSync(scriptPath))

    // The account the connector is CURRENTLY syncing = account of the latest
    // MT5_SYNC entry. When the user switches accounts inside the MetaTrader 5
    // terminal, the next cycle pushes the new identity here — the dashboard
    // compares this with what it displays and follows automatically.
    const lastSync = await db.syncLog.findFirst({
      where: { source: 'MT5_SYNC' },
      orderBy: { ts: 'desc' },
      include: { account: true },
    })
    const active =
      lastSync?.account ??
      (await resolveActiveAccount().catch(() => null))

    const accountSynced = Boolean(active && active.id !== 'demo' && active.mt5Login)
    const awaitingFirstSync = Boolean(active && active.id !== 'demo' && !active.mt5Login)

    const [lastLaunchLog, snapCount] = await Promise.all([
      db.syncLog.findFirst({ where: { source: 'DESKTOP_LAUNCH' }, orderBy: { ts: 'desc' } }),
      db.equitySnapshot.count().catch(() => 0),
    ])

    const shape = (l: { ts: Date; source: string; status: string; message: string } | null): LogLine | null =>
      l ? { ts: l.ts.toISOString(), source: l.source, status: l.status, message: l.message } : null

    const logDir = process.env.PTI_LOG_DIR ?? path.join(process.cwd(), 'logs')
    const logFile = path.join(logDir, 'mt5-sync.log')

    // Database diagnostics: where the data lives + how big it is (P5/P0).
    const dataDir = process.env.PTI_DATA_DIR ?? null
    let dbFile: string | null = null
    let dbSizeBytes: number | null = null
    try {
      const url = process.env.DATABASE_URL ?? ''
      if (url.startsWith('file:')) {
        const p = url.slice('file:'.length)
        dbFile = p
        dbSizeBytes = fs.existsSync(p) ? fs.statSync(p).size : null
      }
    } catch {}

    return NextResponse.json({
      bundled,
      connectorRunning: isRunning(g.__mt5SyncPid),
      connectorPid: g.__mt5SyncPid ?? null,
      tokenProtected: Boolean(process.env.PTI_SYNC_TOKEN || process.env.PTI_TOKEN_FILE),
      accountSynced,
      awaitingFirstSync,
      tradeMode: active?.tradeMode ?? null,
      // ── account-switch awareness (v1.3.2) ──
      activeAccount: active
        ? {
            id: active.id,
            name: active.name,
            mt5Login: active.mt5Login,
            server: active.server,
            tradeMode: active.tradeMode,
          }
        : null,
      lastSyncAt: lastSync?.ts.toISOString() ?? null,
      lastSyncStatus: lastSync?.status ?? null,
      lastSyncLog: shape(lastSync ?? null),
      lastLaunchLog: shape(lastLaunchLog),
      logTail: tailFile(logFile),
      logFile,
      data: {
        dataDir,
        dbFile,
        dbSizeBytes,
        snapshotCount: snapCount,
      },
    })
  } catch (err) {
    console.error('[api/mt5/status]', err)
    return NextResponse.json({ error: 'STATUS_FAILED' }, { status: 500 })
  }
}
