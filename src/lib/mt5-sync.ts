// ─── MT5 sync payload processor ──────────────────────────────────────────────
// Consumes one validated connector payload and applies it to the database in
// a SINGLE transaction: either everything lands, or nothing does. All writes
// are idempotent — replaying the same payload never creates duplicates.
//
// Identity model (v1.3.0):
//   * CLOSED legs are keyed by (accountId, dealTicket) — one row per closing
//     deal, so partial closes each carry their own realized P/L.
//   * OPEN positions are keyed by (accountId, positionTicket, status=OPEN) —
//     one ephemeral row per live position, updated every cycle.
//   * LEGACY rows (migrated from v1.2.x, dealTicket = NULL, whole position)
//     stay authoritative for everything closed up to their closeTime: legs
//     older than that are skipped, so legacy data and per-deal legs never
//     double count.
//   * When a position fully closes, its OPEN shell row is removed — its
//     realized history lives in the legs. The shell row is derived state
//     (recreated from live positions on every sync), not user data.
//   * v1.3.7 — AUTHORITATIVE OPEN-SET RECONCILIATION: when the connector
//     reports positionsRead=true, its positions_get() result is the complete
//     truth about what is open right now, so every OPEN shell row outside
//     that set is finalized immediately. Previously a shell whose closing
//     deal never reached any payload (terminal deal cache unavailable, close
//     outside the history window, legacy ticket drift) stayed in "Open
//     Positions" forever with a frozen floating P/L.
//
// Every non-trade MT5 deal arrives as a categorized cashflow (externalId =
// deal ticket) — including CREDIT, which the balance reconciliation
// deliberately excludes because the MT5 terminal reports credit separately.

import type { PrismaClient, Prisma } from '@prisma/client'
import type { ValidatedSyncBody, ValidatedSyncTrade } from './validation'

/** Marker comment identifying reversed-position stub rows created here. */
export const REVERSAL_MARKER = 'reversed — P/L booked on the reversal deal'

export interface ProcessSyncOptions {
  /** override the db handle (tests inject a transaction-scoped client) */
  db?: PrismaClient
}

export interface Reconciliation {
  initialBalance: number
  netCash: number
  closedPnl: number
  expected: number | null
  reported: number | null
  diff: number | null
}

export interface ProcessSyncResult {
  accountId: string
  inserted: number
  updated: number
  openRowsClosed: number
  cashflowsAdded: number
  skippedDeals: number
  incompleteHistory: number
  warnings: string[]
  reconciliation: Reconciliation
}

const round2 = (n: number) => Math.round(n * 100) / 100

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'unknown'
}

/** Stable account id for a real MT5 account (multi-account ready). */
function accountIdFor(server: string, login: string): string {
  return `mt5-${slug(server)}-${login}`
}

type Tx = Prisma.TransactionClient

// ─────────────────────────── account resolution ──────────────────────────────
export async function resolveAccount(
  tx: Tx,
  body: ValidatedSyncBody
): Promise<{ id: string; created: boolean }> {
  const acc = body.account
  const login = acc?.login != null ? String(acc.login) : null
  const server = acc?.server?.trim() || null

  // 1) Full identity: login + server → structured id, with legacy adoption.
  if (login && server) {
    const structuredId = accountIdFor(server, login)
    const byId = await tx.account.findUnique({ where: { id: structuredId } })
    if (byId) return { id: byId.id, created: false }

    // adopt any existing row that already carries this login+server
    const byIdentity = await tx.account.findFirst({
      where: { mt5Login: login, server },
    })
    if (byIdentity) return { id: byIdentity.id, created: false }

    // adopt the v1.2.x shell account ('mt5', created by the launch route) as
    // long as no other account already claims this login — this keeps every
    // pre-upgrade trade row attached to the same account.
    const shell = await tx.account.findUnique({ where: { id: 'mt5' } })
    if (shell && !shell.mt5Login) {
      const claimed = await tx.account.findFirst({
        where: { mt5Login: login, id: { not: 'mt5' } },
      })
      if (!claimed) return { id: shell.id, created: false }
    }

    const created = await tx.account.create({
      data: {
        id: structuredId,
        name: acc?.name ?? `MT5 ${login}`,
        broker: acc?.broker ?? 'Unknown',
        server,
        mt5Login: login,
        currency: acc?.currency ?? 'USD',
        leverage: acc?.leverage ?? 100,
        initialBalance: 0, // reconstructed after the first payload (below)
        tradeMode: acc?.tradeMode ?? 'REAL',
      },
    })
    return { id: created.id, created: true }
  }

  // 2) Legacy payload without login/server (old connector): keep the single
  //    non-demo account behaviour.
  const shell = await tx.account.findUnique({ where: { id: 'mt5' } })
  if (shell) return { id: shell.id, created: false }
  const anyReal = await tx.account.findFirst({ where: { id: { not: 'demo' } } })
  if (anyReal) return { id: anyReal.id, created: false }
  const created = await tx.account.create({
    data: {
      id: 'mt5',
      name: acc?.name ?? 'MT5 Account',
      broker: acc?.broker ?? 'Unknown',
      server: server ?? acc?.server ?? 'Unknown',
      currency: acc?.currency ?? 'USD',
      leverage: acc?.leverage ?? 100,
      initialBalance: 0,
      tradeMode: acc?.tradeMode ?? 'REAL',
    },
  })
  return { id: created.id, created: true }
}

// ─────────────────────────── trade record mapping ────────────────────────────
interface TradeData {
  symbol: string
  direction: string
  volume: number
  openTime: Date
  closeTime: Date | null
  openPrice: number
  closePrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  initialStopLoss: number | null
  riskAmount: number | null
  commission: number
  swap: number
  profit: number
  netProfit: number
  pips: number | null
  rMultiple: number | null
  holdingMinutes: number | null
  status: string
  incompleteHistory: boolean
  magicNumber: bigint | null
  mt5Comment: string | null
  positionTicket: bigint | null
  dealTicket: bigint | null
}

function toTradeData(t: ValidatedSyncTrade): TradeData {
  const profit = t.profit
  const commission = t.commission
  const swap = t.swap
  return {
    symbol: t.symbol,
    direction: t.direction,
    volume: t.volume,
    openTime: t.openTime,
    closeTime: t.closeTime,
    openPrice: t.openPrice,
    closePrice: t.closePrice,
    stopLoss: t.stopLoss,
    takeProfit: t.takeProfit,
    initialStopLoss: t.initialStopLoss,
    riskAmount: t.riskAmount,
    commission,
    swap,
    profit,
    netProfit: t.netProfit ?? profit + commission + swap,
    pips: t.pips,
    rMultiple: t.rMultiple,
    holdingMinutes: t.holdingMinutes,
    status: t.status,
    incompleteHistory: t.incompleteHistory,
    magicNumber: t.magicNumber,
    mt5Comment: t.mt5Comment,
    positionTicket: t.positionTicket,
    dealTicket: t.dealTicket,
  }
}

// ─────────────────────────── main entry point ────────────────────────────────
export async function processSyncPayload(
  body: ValidatedSyncBody,
  opts: ProcessSyncOptions = {}
): Promise<ProcessSyncResult> {
  const db = opts.db
  if (!db) throw new Error('processSyncPayload requires a db/transaction handle')

  const warnings: string[] = []
  let inserted = 0
  let updated = 0
  let skippedDeals = 0
  let openRowsClosed = 0
  let cashflowsAdded = 0
  let incompleteHistory = 0

  const result = await db.$transaction(
    async (tx) => {
      // ── 1. account ───────────────────────────────────────────────────────
      const account = await resolveAccount(tx, body)
      const accountId = account.id

      if (body.account?.name || body.account?.broker || body.account?.currency || body.account?.leverage || body.account?.tradeMode) {
        await tx.account.update({
          where: { id: accountId },
          data: {
            ...(body.account.name ? { name: body.account.name } : {}),
            ...(body.account.broker ? { broker: body.account.broker } : {}),
            ...(body.account.server ? { server: body.account.server } : {}),
            ...(body.account.login != null ? { mt5Login: String(body.account.login) } : {}),
            ...(body.account.currency ? { currency: body.account.currency } : {}),
            ...(body.account.leverage ? { leverage: body.account.leverage } : {}),
            ...(body.account.tradeMode ? { tradeMode: body.account.tradeMode } : {}),
          },
        })
      } else if (account.created === false && body.account?.login != null) {
        // adopted shell account without profile fields: fill identity basics
        await tx.account.update({
          where: { id: accountId },
          data: {
            mt5Login: String(body.account.login),
            server: body.account.server ?? undefined,
            tradeMode: body.account.tradeMode ?? undefined,
          },
        })
      }

      // ── 2. legacy map: whole-position rows imported by v1.2.x ────────────
      const legacyRows = await tx.trade.findMany({
        where: { accountId, dealTicket: null, status: 'CLOSED', incompleteHistory: false },
        select: { id: true, positionTicket: true, closeTime: true, mt5Comment: true },
      })
      const legacyByPosition = new Map<string, { closeTime: Date | null; isStub: boolean }>()
      for (const r of legacyRows) {
        if (r.positionTicket === null) continue
        // keep the EARLIEST legacy representation per position (stubs lose
        // against merged rows — both are skipped uniformly below)
        const key = r.positionTicket.toString()
        const prev = legacyByPosition.get(key)
        const isStub = r.mt5Comment === REVERSAL_MARKER
        if (!prev || (!prev.isStub && isStub)) legacyByPosition.set(key, { closeTime: r.closeTime, isStub })
      }

      // ── 3. upsert every record ───────────────────────────────────────────
      const livePositionTickets = new Set<string>()
      const closedPositionTickets = new Set<string>()

      for (const rec of body.trades) {
        const data = toTradeData(rec)

        if (data.status === 'OPEN') {
          if (data.positionTicket === null) {
            skippedDeals++
            warnings.push('OPEN record without positionTicket skipped')
            continue
          }
          const pidKey = data.positionTicket.toString()
          livePositionTickets.add(pidKey)
          if (data.incompleteHistory) incompleteHistory++
          const existing = await tx.trade.findFirst({
            where: { accountId, status: 'OPEN', dealTicket: null, positionTicket: data.positionTicket },
          })
          if (existing) {
            await tx.trade.update({ where: { id: existing.id }, data })
            updated++
          } else {
            await tx.trade.create({ data: { ...data, accountId } })
            inserted++
          }
          continue
        }

        // CLOSED
        if (data.dealTicket !== null) {
          // per-deal leg
          const pidKey = data.positionTicket?.toString()
          if (data.positionTicket !== null) closedPositionTickets.add(pidKey!)
          if (data.incompleteHistory) incompleteHistory++

          // never double count against a legacy whole-position row
          if (pidKey) {
            const legacy = legacyByPosition.get(pidKey)
            if (legacy && !legacy.isStub) {
              if (!legacy.closeTime || !data.closeTime || data.closeTime <= legacy.closeTime) {
                skippedDeals++
                continue // legacy merged row already contains this leg
              }
              // leg closes AFTER the legacy snapshot → it is genuinely new
              // money (e.g. the remainder of a partial close after upgrade)
            }
          }
          const existing = await tx.trade.findUnique({
            where: { accountId_dealTicket: { accountId, dealTicket: data.dealTicket } },
          })
          if (existing) {
            await tx.trade.update({ where: { id: existing.id }, data })
            updated++
          } else {
            await tx.trade.create({ data: { ...data, accountId } })
            inserted++
          }
          continue
        }

        // CLOSED without dealTicket: reversed-position stub (money-neutral)
        if (data.positionTicket === null) {
          skippedDeals++
          warnings.push('CLOSED record without dealTicket and positionTicket skipped')
          continue
        }
        const pidKey = data.positionTicket.toString()
        closedPositionTickets.add(pidKey)
        const existing = await tx.trade.findFirst({
          where: { accountId, status: 'CLOSED', dealTicket: null, positionTicket: data.positionTicket },
        })
        if (existing && existing.mt5Comment !== REVERSAL_MARKER) {
          skippedDeals++ // a legacy merged row already represents this position
          continue
        }
        if (existing) {
          await tx.trade.update({ where: { id: existing.id }, data })
          updated++
        } else {
          await tx.trade.create({ data: { ...data, accountId } })
          inserted++
        }
      }

      // ── 4. remove OPEN shell rows of fully-closed positions ──────────────
      const fullyClosed = [...closedPositionTickets].filter((pid) => !livePositionTickets.has(pid))
      if (fullyClosed.length) {
        const del = await tx.trade.deleteMany({
          where: {
            accountId,
            status: 'OPEN',
            dealTicket: null,
            positionTicket: { in: fullyClosed.map((pid) => BigInt(pid)) },
          },
        })
        openRowsClosed += del.count
      }

      // ── 4b. authoritative open-set reconciliation (v1.3.7) ──────────────
      // positionsRead=true means positions_get() SUCCEEDED, so the payload's
      // live set is complete: every OPEN shell row not in it belongs to a
      // position that is no longer open — even when its closing deal never
      // reached us (broken terminal deal cache, close outside the history
      // window, legacy id drift). Such rows used to linger in the Open
      // Positions panel with a frozen floating P/L. Shells are derived state
      // (rebuilt from live positions on the next cycle), so finalizing them
      // here can never lose user data.
      if (body.positionsRead === true) {
        if (livePositionTickets.size === 0) {
          // no open positions at all — finalize every OPEN shell of the account
          const del = await tx.trade.deleteMany({
            where: { accountId, status: 'OPEN', dealTicket: null },
          })
          openRowsClosed += del.count
        } else {
          const live = [...livePositionTickets].map((pid) => BigInt(pid))
          const stale = await tx.trade.deleteMany({
            where: {
              accountId,
              status: 'OPEN',
              dealTicket: null,
              positionTicket: { notIn: live },
            },
          })
          openRowsClosed += stale.count
          // SQL NULL semantics: NOT IN never matches NULL tickets, so any
          // unusable NULL-ticket OPEN row (never produced by the current
          // connector) is finalized separately.
          const nullTicket = await tx.trade.deleteMany({
            where: { accountId, status: 'OPEN', dealTicket: null, positionTicket: null },
          })
          openRowsClosed += nullTicket.count
        }
      }

      // ── 5. cashflows (idempotent by external deal ticket) ────────────────
      for (const c of body.cashflows ?? []) {
        if (c.externalId !== null) {
          const existing = await tx.cashFlow.findUnique({
            where: { accountId_externalId: { accountId, externalId: c.externalId } },
          })
          if (existing) continue
          await tx.cashFlow.create({
            data: {
              accountId,
              ts: c.ts,
              type: c.type,
              amount: c.amount,
              category: c.category,
              externalId: c.externalId,
              comment: c.comment,
            },
          })
          cashflowsAdded++
        } else {
          // legacy payload without tickets — fall back to content matching
          const exists = await tx.cashFlow.findFirst({
            where: { accountId, ts: c.ts, type: c.type, amount: c.amount },
          })
          if (exists) continue
          await tx.cashFlow.create({
            data: {
              accountId,
              ts: c.ts,
              type: c.type,
              amount: c.amount,
              category: c.category,
              comment: c.comment,
            },
          })
          cashflowsAdded++
        }
      }

      // ── 6. snapshot ──────────────────────────────────────────────────────
      if (body.snapshot) {
        const now = new Date()
        await tx.equitySnapshot.upsert({
          where: { accountId_ts: { accountId, ts: now } },
          create: { accountId, ts: now, balance: body.snapshot.balance ?? 0, equity: body.snapshot.equity ?? 0 },
          update: { balance: body.snapshot.balance ?? 0, equity: body.snapshot.equity ?? 0 },
        })
      }

      // ── 7. first-sync initial balance + balance reconciliation ───────────
      const accountRow = await tx.account.findUniqueOrThrow({ where: { id: accountId } })
      const closedAgg = await tx.trade.aggregate({
        where: { accountId, status: 'CLOSED' },
        _sum: { netProfit: true },
      })
      const cashAgg = await tx.cashFlow.groupBy({
        by: ['type'],
        where: { accountId, NOT: { category: 'CREDIT' } }, // credit is NOT part of the MT5 balance
        _sum: { amount: true },
      })
      const deposits = cashAgg.find((g) => g.type === 'DEPOSIT')?._sum.amount ?? 0
      const withdrawals = cashAgg.find((g) => g.type === 'WITHDRAWAL')?._sum.amount ?? 0
      const netCash = deposits - withdrawals
      const closedPnl = closedAgg._sum.netProfit ?? 0

      if (accountRow.initialBalance === 0 && body.snapshot?.balance != null) {
        // Reconstruct the true initial balance so the identity
        //   balance = initial + deposits − withdrawals + closed P/L
        // closes exactly on the reported MT5 balance (pre-window flows fold
        // into "initial"). CREDIT deals are excluded — the terminal reports
        // them outside the balance.
        const initial = round2(body.snapshot.balance - netCash - closedPnl)
        await tx.account.update({ where: { id: accountId }, data: { initialBalance: initial } })
      }

      const reported = body.snapshot?.balance ?? null
      const expected = round2(accountRow.initialBalance + netCash + closedPnl)
      const diff = reported === null ? null : round2(reported - expected)

      return {
        accountId,
        inserted,
        updated,
        openRowsClosed,
        cashflowsAdded,
        skippedDeals,
        incompleteHistory,
        warnings,
        reconciliation: {
          initialBalance: accountRow.initialBalance,
          netCash: round2(netCash),
          closedPnl: round2(closedPnl),
          expected,
          reported: reported === null ? null : round2(reported),
          diff,
        } satisfies Reconciliation,
      }
    },
    { timeout: 120_000, maxWait: 15_000 }
  )

  return result
}
