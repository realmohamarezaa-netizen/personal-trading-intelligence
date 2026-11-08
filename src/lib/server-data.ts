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
 * If the database is COMPLETELY EMPTY (fresh install — zero accounts AND
 * zero trades), seed the deterministic demo dataset automatically so the UI
 * never breaks with a raw NO_ACCOUNT error.
 *
 * DATA-SAFETY RULE: the demo seeder wipes every table before writing. It may
 * therefore ONLY ever run against a database that holds no accounts and no
 * trades whatsoever. Any existing row (a real MT5 shell account awaiting its
 * first sync, a legacy dataset mid-migration, …) skips auto-seeding forever.
 * (A race here once wiped real trading data while tables were being rebuilt —
 * see db-bootstrap; the guard below makes that class of bug impossible.)
 */
export async function ensureSeeded(): Promise<void> {
  const [accountCount, tradeCount] = await Promise.all([
    db.account.count(),
    db.trade.count(),
  ])
  if (accountCount > 0 || tradeCount > 0) return
  if (!seeding) {
    seeding = reseedDemo()
      .then(() => undefined)
      .finally(() => {
        seeding = null
      })
  }
  await seeding
}

/**
 * Active account resolution (multi-account ready):
 *   1. explicit accountId (from the UI switcher) when it exists,
 *   2. otherwise the account of the most recent sync,
 *   3. otherwise the most recently updated non-demo account.
 * Demo and real accounts are separate rows — their data never mixes.
 */
export async function resolveActiveAccount(accountId?: string) {
  if (accountId) {
    const byId = await db.account.findUnique({ where: { id: accountId } })
    if (byId) return byId
  }
  const lastSync = await db.syncLog.findFirst({
    orderBy: { ts: 'desc' },
    include: { account: true },
  })
  if (lastSync?.account) return lastSync.account
  const accounts = await db.account.findMany({ orderBy: { updatedAt: 'desc' } })
  const real = accounts.find((a) => a.id !== 'demo')
  return real ?? accounts[0] ?? null
}

/** 64-bit MT5 tickets fit comfortably in a JS number (< 2^53). */
const bigToNum = (v: bigint | null): number | null => (v === null ? null : Number(v))

export async function loadEngineInput(accountId?: string): Promise<EngineInput | null> {
  const account = await resolveActiveAccount(accountId)
  if (!account) return null

  // Snapshot downsampling: raw ~45s rows only for the last 7 days; beyond
  // that one row per day (mirrors the retention policy) so a year of usage
  // never loads hundreds of thousands of rows per analytics request.
  // NOTE: Prisma stores SQLite DateTime as integer ms — SQLite compares
  // INTEGER < TEXT as always-true, so the raw query must compare against an
  // integer cutoff in ms, never a datetime() TEXT value.
  const rawCutoff = new Date(Date.now() - 7 * 864e5)
  const rawCutoffMs = rawCutoff.getTime()
  const [trades, cashflows, lastSync, rawSnaps, dailySnaps] = await Promise.all([
    db.trade.findMany({ where: { accountId: account.id }, orderBy: { openTime: 'asc' } }),
    db.cashFlow.findMany({ where: { accountId: account.id }, orderBy: { ts: 'asc' } }),
    db.syncLog.findFirst({ where: { accountId: account.id }, orderBy: { ts: 'desc' } }),
    db.equitySnapshot.findMany({
      where: { accountId: account.id, ts: { gte: rawCutoff } },
      orderBy: { ts: 'asc' },
      select: { ts: true, balance: true, equity: true },
    }),
    db.$queryRaw<{ ts: Date; balance: number; equity: number }[]>`
      SELECT "ts", "balance", "equity" FROM "EquitySnapshot"
      WHERE "accountId" = ${account.id}
        AND (CASE WHEN typeof("ts") = 'integer' THEN "ts"
                  ELSE CAST(strftime('%s', "ts") AS INTEGER) * 1000 END) < ${rawCutoffMs}
        AND "id" IN (
          SELECT "id" FROM (
            SELECT "id", ROW_NUMBER() OVER (
              PARTITION BY CASE WHEN typeof("ts") = 'integer'
                                THEN date("ts" / 1000, 'unixepoch')
                                ELSE date("ts") END
              ORDER BY "ts" DESC
            ) AS rn
            FROM "EquitySnapshot"
            WHERE "accountId" = ${account.id}
              AND (CASE WHEN typeof("ts") = 'integer' THEN "ts"
                        ELSE CAST(strftime('%s', "ts") AS INTEGER) * 1000 END) < ${rawCutoffMs}
          ) WHERE rn = 1
        )
        ORDER BY "ts" ASC
    `,
  ])

  const engineTrades: EngineTrade[] = trades.map((t) => ({
    id: t.id,
    positionId: t.positionId,
    positionTicket: bigToNum(t.positionTicket),
    dealTicket: bigToNum(t.dealTicket),
    symbol: t.symbol,
    direction: t.direction === 'SELL' ? 'SELL' : 'BUY',
    volume: t.volume,
    openTime: t.openTime,
    closeTime: t.closeTime,
    openPrice: t.openPrice,
    closePrice: t.closePrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    initialStopLoss: t.initialStopLoss,
    riskAmount: t.riskAmount,
    commission: t.commission,
    swap: t.swap,
    profit: t.profit,
    netProfit: t.netProfit,
    pips: t.pips,
    rMultiple: t.rMultiple,
    holdingMinutes: t.holdingMinutes,
    status: t.status,
    incompleteHistory: t.incompleteHistory,
    magicNumber: bigToNum(t.magicNumber),
    mistakes: parseJsonArray(t.mistakes),
    emotion: t.emotion,
  }))

  const snapshots = [
    ...dailySnaps.map((s) => ({ ts: new Date(s.ts), balance: s.balance, equity: s.equity })),
    ...rawSnaps,
  ]

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
      tradeMode: (account.tradeMode === 'DEMO' || account.tradeMode === 'CONTEST'
        ? account.tradeMode
        : 'REAL') as EngineInput['account']['tradeMode'],
      timezone: account.timezone || 'Asia/Tehran',
    },
    trades: engineTrades,
    cashflows: cashflows.map((c) => ({
      ts: c.ts,
      type: c.type as 'DEPOSIT' | 'WITHDRAWAL',
      amount: c.amount,
      category: c.category,
    })),
    snapshots,
    lastSyncAt: lastSync?.ts ?? null,
    // demoMode means ONLY the generated sample dataset (the seeded 'demo'
    // account). A real MT5 account stays non-demo even when MT5 itself
    // reports the account type as DEMO — its data was synced live from the
    // connector, so the status pill shows MT5 SYNCED, never "demo data".
    demoMode: account.id === 'demo',
  }
}
