// Server-side data loader shared by all API routes
import { db } from './db'
import { reseedDemo } from './seed'
import type { EngineInput, EngineTrade } from './analytics'

function parseJsonArray(s: string | null): string[] {
  if (!s) return []
  try {
    const v = JSON.parse(s)
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

// In-flight seed guard — prevents concurrent requests from seeding twice.
let seeding: Promise<void> | null = null

/**
 * Self-healing data bootstrap: this is a demo-first, local-only app.
 * If the database has no account (fresh install, db:push reset, manual wipe),
 * seed the deterministic demo dataset automatically so the UI never breaks
 * with a raw NO_ACCOUNT error. Real MT5 sync later replaces demo data.
 */
export async function ensureSeeded(): Promise<void> {
  const account = await db.account.findFirst()
  if (account) return
  if (!seeding) {
    seeding = reseedDemo()
      .then(() => undefined)
      .finally(() => {
        seeding = null
      })
  }
  await seeding
}

export async function loadEngineInput(): Promise<EngineInput | null> {
  const account = await db.account.findFirst()
  if (!account) return null

  const [trades, cashflows, lastSync] = await Promise.all([
    db.trade.findMany({ orderBy: { openTime: 'asc' } }),
    db.cashFlow.findMany({ orderBy: { ts: 'asc' } }),
    db.syncLog.findFirst({ orderBy: { ts: 'desc' } }),
  ])

  const engineTrades: EngineTrade[] = trades.map((t) => ({
    id: t.id,
    positionId: t.positionId,
    symbol: t.symbol,
    direction: t.direction === 'SELL' ? 'SELL' : 'BUY',
    volume: t.volume,
    openTime: t.openTime,
    closeTime: t.closeTime,
    openPrice: t.openPrice,
    closePrice: t.closePrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    commission: t.commission,
    swap: t.swap,
    profit: t.profit,
    netProfit: t.netProfit,
    pips: t.pips,
    rMultiple: t.rMultiple,
    holdingMinutes: t.holdingMinutes,
    status: t.status,
    mistakes: parseJsonArray(t.mistakes),
    emotion: t.emotion,
  }))

  return {
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
    trades: engineTrades,
    cashflows: cashflows.map((c) => ({ ts: c.ts, type: c.type as 'DEPOSIT' | 'WITHDRAWAL', amount: c.amount })),
    lastSyncAt: lastSync?.ts ?? null,
    // Demo is the seeded 'demo' account — NOT "no sync log yet": the connector
    // launch itself writes a log row, which must not make the pill claim
    // "MT5 SYNCED" before any real sync arrives.
    demoMode: account.id === 'demo',
  }
}
