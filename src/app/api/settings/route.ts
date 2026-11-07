import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { SettingsResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const account = await db.account.findFirst()
    if (!account) {
      return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })
    }

    const [syncLogs, tradeCount, openCount, snapCount, cfCount, lastSync] = await Promise.all([
      db.syncLog.findMany({ orderBy: { ts: 'desc' }, take: 10 }),
      db.trade.count(),
      db.trade.count({ where: { status: 'OPEN' } }),
      db.equitySnapshot.count(),
      db.cashFlow.count(),
      db.syncLog.findFirst({ orderBy: { ts: 'desc' } }),
    ])

    const res: SettingsResponse = {
      account: {
        id: account.id,
        name: account.name,
        broker: account.broker,
        server: account.server,
        mt5Login: account.mt5Login,
        currency: account.currency,
        leverage: account.leverage,
        initialBalance: account.initialBalance,
      },
      syncLogs: syncLogs.map((l) => ({
        id: l.id,
        ts: l.ts.toISOString(),
        source: l.source,
        status: l.status,
        message: l.message,
        tradesInserted: l.tradesInserted,
        tradesUpdated: l.tradesUpdated,
      })),
      counts: { trades: tradeCount, open: openCount, snapshots: snapCount, cashflows: cfCount },
      lastSyncAt: lastSync ? lastSync.ts.toISOString() : null,
      demoMode: !lastSync,
    }
    return NextResponse.json(res)
  } catch (err) {
    console.error('[api/settings]', err)
    return NextResponse.json({ error: 'SETTINGS_FAILED' }, { status: 500 })
  }
}
