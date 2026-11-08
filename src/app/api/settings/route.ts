import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ensureSeeded, resolveActiveAccount } from '@/lib/server-data'
import { settingsPatchSchema } from '@/lib/validation'
import type { SettingsResponse } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // Demo-first: auto-seed if the local DB is COMPLETELY empty (fresh install)
    await ensureSeeded()

    const accountId = req.nextUrl.searchParams.get('accountId') ?? undefined
    const account = await resolveActiveAccount(accountId)
    if (!account) {
      return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })
    }

    const [syncLogs, tradeCount, openCount, snapCount, cfCount, lastSync, accounts] =
      await Promise.all([
        db.syncLog.findMany({ where: { accountId: account.id }, orderBy: { ts: 'desc' }, take: 10 }),
        db.trade.count({ where: { accountId: account.id } }),
        db.trade.count({ where: { accountId: account.id, status: 'OPEN' } }),
        db.equitySnapshot.count({ where: { accountId: account.id } }),
        db.cashFlow.count({ where: { accountId: account.id } }),
        db.syncLog.findFirst({ where: { accountId: account.id }, orderBy: { ts: 'desc' } }),
        db.account.findMany({
          orderBy: { updatedAt: 'desc' },
          include: { syncLogs: { orderBy: { ts: 'desc' }, take: 1 }, _count: { select: { trades: true } } },
        }),
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
        tradeMode:
          account.tradeMode === 'DEMO' || account.tradeMode === 'CONTEST' ? account.tradeMode : 'REAL',
        timezone: account.timezone || 'Asia/Tehran',
      },
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        broker: a.broker,
        server: a.server,
        mt5Login: a.mt5Login,
        tradeMode:
          a.tradeMode === 'DEMO' || a.tradeMode === 'CONTEST' ? a.tradeMode : 'REAL',
        currency: a.currency,
        lastSyncAt: a.syncLogs[0]?.ts ? a.syncLogs[0].ts.toISOString() : null,
        trades: a._count.trades,
        isActive: a.id === account.id,
      })),
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
      // 'demo' = seeded sample account; a real-but-empty shell created by
      // Connect MT5 is NOT demo mode (its mt5Login is null until first sync).
      demoMode: account.id === 'demo' || account.tradeMode === 'DEMO',
    }
    return NextResponse.json(res)
  } catch (err) {
    console.error('[api/settings]', err)
    return NextResponse.json({ error: 'SETTINGS_FAILED' }, { status: 500 })
  }
}

/** Update user-manageable settings (trading-day timezone). */
export async function PATCH(req: NextRequest) {
  try {
    const body = await settingsPatchSchema.safeParse(await req.json().catch(() => ({})))
    if (!body.success) {
      return NextResponse.json({ error: 'INVALID_BODY', issues: body.error.issues.slice(0, 3) }, { status: 400 })
    }
    const accountId = req.nextUrl.searchParams.get('accountId') ?? undefined
    const account = await resolveActiveAccount(accountId)
    if (!account) return NextResponse.json({ error: 'NO_ACCOUNT' }, { status: 404 })

    const updated = await db.account.update({
      where: { id: account.id },
      data: { ...(body.data.timezone ? { timezone: body.data.timezone } : {}) },
    })
    return NextResponse.json({ ok: true, timezone: updated.timezone })
  } catch (err) {
    console.error('[api/settings PATCH]', err)
    return NextResponse.json({ error: 'SETTINGS_UPDATE_FAILED' }, { status: 500 })
  }
}
