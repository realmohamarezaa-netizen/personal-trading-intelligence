import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─── Launch the bundled MT5 sync service (desktop build only) ────────────────
// The Windows desktop build ships an embedded Python runtime plus the
// MetaTrader5 package. The Electron main process sets PTI_PYTHON /
// PTI_SYNC_SCRIPT / PTI_LOG_DIR before starting the Next.js server.
// When those are absent (web / sandbox / plain dev), we answer with a clear
// NOT_BUNDLED error so the UI can fall back to the manual connector guide.
//
// First launch removes the generated demo dataset and creates a placeholder
// "mt5" account shell, so the dashboard switches cleanly from DEMO DATA to
// the user's real account. The shell also guarantees SyncLog rows always
// have a valid account (FK) and stops the demo auto-seed from re-generating
// sample data while the first real import is still running.
//
// Read-only: the connector can never place, modify or close any order.

interface LaunchResult {
  ok: boolean
  pid?: number
  alreadyRunning?: boolean
  wipedDemo?: boolean
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

export async function POST(_req: NextRequest) {
  try {
    const pythonExe = process.env.PTI_PYTHON
    const scriptPath = process.env.PTI_SYNC_SCRIPT
    const port = process.env.PORT ?? '3000'

    if (!pythonExe || !scriptPath || !fs.existsSync(pythonExe) || !fs.existsSync(scriptPath)) {
      return NextResponse.json(
        {
          error: 'NOT_BUNDLED',
          message:
            'The bundled MT5 connector is only available inside the Windows desktop app. ' +
            'On a local setup run: python sync.py --watch 60 (see the guide below).',
        },
        { status: 400 },
      )
    }

    if (isRunning(g.__mt5SyncPid)) {
      return NextResponse.json({
        ok: true,
        pid: g.__mt5SyncPid ?? undefined,
        alreadyRunning: true,
        message: 'Connector is already running and syncing in the background.',
      } satisfies LaunchResult)
    }

    // First real connection: drop the generated demo dataset so the dashboard
    // switches from DEMO DATA to the user's real account without leftovers,
    // then make sure an account row always exists (shell is updated by the
    // first real sync with the actual MT5 account info).
    let wipedDemo = false
    const demoAccount = await db.account.findUnique({ where: { id: 'demo' } })
    if (demoAccount) {
      await db.account.delete({ where: { id: 'demo' } }) // cascades trades, snapshots, cashflows
      wipedDemo = true
    }

    let shell = await db.account.findFirst()
    if (!shell) {
      shell = await db.account.create({
        data: {
          id: 'mt5',
          name: 'MT5 Account',
          broker: 'Connecting…',
          server: 'Connecting…',
          initialBalance: 0, // reconstructed from the first real sync (see /api/mt5/sync)
        },
      })
    }

    const logDir = process.env.PTI_LOG_DIR ?? path.join(process.cwd(), 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    const out = fs.openSync(path.join(logDir, 'mt5-sync.log'), 'a')

    let child
    try {
      child = spawn(
        pythonExe,
        [scriptPath, '--api', `http://127.0.0.1:${port}`, '--days', '365', '--interval', '45'],
        { cwd: path.dirname(scriptPath), stdio: ['ignore', out, out] },
      )
    } catch (spawnErr) {
      console.error('[api/mt5/launch] spawn failed', spawnErr)
      return NextResponse.json({ error: 'LAUNCH_FAILED' }, { status: 500 })
    }

    // A spawn error (e.g. ENOENT) is emitted async — without this handler it
    // would crash the whole Next.js server process.
    child.on('error', (err) => {
      console.error('[api/mt5/launch] connector process error', err)
      if (g.__mt5SyncPid === child.pid) g.__mt5SyncPid = null
      db.syncLog
        .create({
          data: {
            accountId: shell!.id,
            source: 'DESKTOP_LAUNCH',
            status: 'ERROR',
            message: `Connector failed to start: ${err.message}`,
            tradesInserted: 0,
            tradesUpdated: 0,
          },
        })
        .catch(() => {})
    })

    child.unref()
    g.__mt5SyncPid = child.pid ?? null

    await db.syncLog.create({
      data: {
        accountId: shell.id,
        source: 'DESKTOP_LAUNCH',
        status: 'OK',
        message: `Bundled connector started (pid ${child.pid ?? '?'}) — syncing every 45s`,
        tradesInserted: 0,
        tradesUpdated: 0,
      },
    })

    return NextResponse.json({
      ok: true,
      pid: child.pid,
      wipedDemo,
      message: wipedDemo
        ? 'Demo data removed — syncing your real MT5 account now (first import may take up to a minute).'
        : 'Connector started — your MT5 account syncs every 45 seconds.',
    } satisfies LaunchResult)
  } catch (err) {
    console.error('[api/mt5/launch]', err)
    return NextResponse.json({ error: 'LAUNCH_FAILED' }, { status: 500 })
  }
}
