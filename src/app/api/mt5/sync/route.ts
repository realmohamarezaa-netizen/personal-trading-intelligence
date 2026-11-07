import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// ─── MT5 Python connector sync endpoint ──────────────────────────────────────
// The connector runs locally on the trader's Windows machine and pushes
// account info + merged position trades + current snapshot to this API.
// No order-execution capability exists anywhere in this project (read-only).

interface SyncTrade {
  positionId: number
  symbol: string
  direction: 'BUY' | 'SELL'
  volume: number
  openTime: string
  closeTime?: string | null
  openPrice: number
  closePrice?: number | null
  stopLoss?: number | null
  takeProfit?: number | null
  commission?: number
  swap?: number
  profit?: number
  netProfit?: number
  pips?: number | null
  rMultiple?: number | null
  holdingMinutes?: number | null
  status?: 'OPEN' | 'CLOSED'
}

interface SyncBody {
  account?: {
    name?: string
    broker?: string
    server?: string
    login?: string | number
    currency?: string
    leverage?: number
  }
  trades: SyncTrade[]
  cashflows?: { ts: string; type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; comment?: string }[]
  snapshot?: { balance?: number; equity?: number }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SyncBody
    if (!Array.isArray(body.trades)) {
      return NextResponse.json({ error: 'INVALID_PAYLOAD: trades[] required' }, { status: 400 })
    }

    let account = await db.account.findFirst()
    if (!account) {
      // initialBalance starts at 0 and is reconstructed at the end of this
      // sync from the snapshot (balance − cashflows − closed P/L) — that is
      // exact for any history depth, unlike assuming the first sync's balance.
      account = await db.account.create({
        data: {
          id: 'mt5',
          name: body.account?.name ?? 'MT5 Account',
          broker: body.account?.broker ?? 'Unknown',
          server: body.account?.server ?? 'Unknown',
          mt5Login: body.account?.login != null ? String(body.account.login) : null,
          currency: body.account?.currency ?? 'USD',
          leverage: body.account?.leverage ?? 100,
          initialBalance: 0,
        },
      })
    } else {
      await db.account.update({
        where: { id: account.id },
        data: {
          name: body.account?.name ?? account.name,
          broker: body.account?.broker ?? account.broker,
          server: body.account?.server ?? account.server,
          mt5Login: body.account?.login != null ? String(body.account.login) : account.mt5Login,
          currency: body.account?.currency ?? account.currency,
          leverage: body.account?.leverage ?? account.leverage,
        },
      })
    }

    let inserted = 0
    let updated = 0

    for (const t of body.trades) {
      if (!t.positionId || !t.symbol) continue
      const profit = t.profit ?? 0
      const commission = t.commission ?? 0
      const swap = t.swap ?? 0
      const net = t.netProfit ?? profit + commission + swap
      const status = t.status ?? (t.closeTime ? 'CLOSED' : 'OPEN')
      const data = {
        symbol: t.symbol,
        direction: t.direction === 'SELL' ? 'SELL' : 'BUY',
        volume: t.volume ?? 0,
        openTime: new Date(t.openTime),
        closeTime: t.closeTime ? new Date(t.closeTime) : null,
        openPrice: t.openPrice ?? 0,
        closePrice: t.closePrice ?? null,
        stopLoss: t.stopLoss ?? null,
        takeProfit: t.takeProfit ?? null,
        commission,
        swap,
        profit,
        netProfit: net,
        pips: t.pips ?? null,
        rMultiple: t.rMultiple ?? null,
        holdingMinutes: t.holdingMinutes ?? null,
        status,
      }
      const existing = await db.trade.findUnique({ where: { positionId: t.positionId } })
      if (existing) {
        await db.trade.update({ where: { positionId: t.positionId }, data })
        updated++
      } else {
        await db.trade.create({ data: { ...data, positionId: t.positionId, accountId: account.id } })
        inserted++
      }
    }

    if (body.snapshot) {
      const now = new Date()
      await db.equitySnapshot.upsert({
        where: { accountId_ts: { accountId: account.id, ts: now } },
        create: { accountId: account.id, ts: now, balance: body.snapshot.balance ?? 0, equity: body.snapshot.equity ?? 0 },
        update: { balance: body.snapshot.balance ?? 0, equity: body.snapshot.equity ?? 0 },
      })
    }

    // Deposits / withdrawals from MT5 balance deals — kept separate from trading P/L
    let cashflowsAdded = 0
    for (const c of body.cashflows ?? []) {
      if (!c.ts || typeof c.amount !== 'number') continue
      const ts = new Date(c.ts)
      const exists = await db.cashFlow.findFirst({
        where: { accountId: account.id, ts, type: c.type, amount: c.amount },
      })
      if (!exists) {
        await db.cashFlow.create({
          data: { accountId: account.id, ts, type: c.type, amount: c.amount, comment: c.comment ?? null },
        })
        cashflowsAdded++
      }
    }

    // First real sync on a fresh (shell) account: reconstruct the true
    // initial balance so that the analytics identity
    //   balance = initial + deposits − withdrawals + closed P/L
    // closes exactly on the reported snapshot balance. Works for any
    // history depth: pre-window flows simply fold into "initial".
    if (account.initialBalance === 0 && body.snapshot?.balance != null) {
      const [closedAgg, depAgg, wdAgg] = await Promise.all([
        db.trade.aggregate({
          where: { accountId: account.id, status: 'CLOSED' },
          _sum: { netProfit: true },
        }),
        db.cashFlow.aggregate({
          where: { accountId: account.id, type: 'DEPOSIT' },
          _sum: { amount: true },
        }),
        db.cashFlow.aggregate({
          where: { accountId: account.id, type: 'WITHDRAWAL' },
          _sum: { amount: true }, // stored positive; the analytics identity subtracts by type
        }),
      ])
      const netCash = (depAgg._sum.amount ?? 0) - (wdAgg._sum.amount ?? 0)
      const initial =
        body.snapshot.balance - netCash - (closedAgg._sum.netProfit ?? 0)
      await db.account.update({
        where: { id: account.id },
        data: { initialBalance: initial },
      })
    }

    await db.syncLog.create({
      data: {
        accountId: account.id,
        source: 'MT5_SYNC',
        status: 'OK',
        message: `Synced ${body.trades.length} positions (${inserted} new, ${updated} updated)${cashflowsAdded ? `, ${cashflowsAdded} cashflows` : ''}`,
        tradesInserted: inserted,
        tradesUpdated: updated,
      },
    })

    return NextResponse.json({ ok: true, inserted, updated, total: body.trades.length, cashflowsAdded })
  } catch (err) {
    console.error('[api/mt5/sync]', err)
    return NextResponse.json({ error: 'SYNC_FAILED' }, { status: 500 })
  }
}
