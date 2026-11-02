import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// ─── Stop the bundled MT5 sync service (desktop build only) ──────────────────

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

export async function POST() {
  const pid = g.__mt5SyncPid
  if (!isRunning(pid)) {
    return NextResponse.json({ ok: false, message: 'Connector is not running.' })
  }
  try {
    if (pid) process.kill(pid)
    g.__mt5SyncPid = null
    return NextResponse.json({ ok: true, message: 'Connector stopped.' })
  } catch (err) {
    console.error('[api/mt5/stop]', err)
    return NextResponse.json({ ok: false, message: 'Failed to stop connector.' }, { status: 500 })
  }
}
