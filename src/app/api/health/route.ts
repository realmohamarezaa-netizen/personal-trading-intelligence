import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Tiny liveness endpoint used by the bundled MT5 sync service to detect
// whether the dashboard is still running (the service self-exits when not).

export async function GET() {
  return NextResponse.json({ ok: true, ts: new Date().toISOString() })
}
