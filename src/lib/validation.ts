// ─── Request validation schemas (zod) ────────────────────────────────────────
// Every mutating endpoint validates its input through these schemas before
// anything reaches Prisma. Money fields must be finite numbers; MT5 tickets
// are accepted as ints or digit-strings and converted to BigInt so the full
// 64-bit range survives (JSON numbers are safe: MT5 tickets stay < 2^53).

import { z } from 'zod'

export const SYNC_MAX_BODY_BYTES = 32 * 1024 * 1024

const finite = (label: string) =>
  z.number({ error: `${label} must be a number` }).refine(Number.isFinite, `${label} must be finite`)

const bigTicket = z
  .union([
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    z.string().regex(/^\d{1,15}$/),
    z.null(),
  ])
  .optional()
  .transform((v) => (v === null || v === undefined ? null : BigInt(v)))

const isoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'valid ISO-8601 date required')
  .transform((s) => new Date(s))

export const cashflowSchema = z.object({
  ts: isoDate,
  type: z.enum(['DEPOSIT', 'WITHDRAWAL']),
  amount: finite('amount').min(0).max(1e15),
  category: z
    .enum(['BALANCE', 'CREDIT', 'BONUS', 'CHARGE', 'COMMISSION', 'INTEREST', 'TAX', 'CORRECTION', 'DIVIDEND', 'OTHER'])
    .default('BALANCE'),
  externalId: bigTicket,
  comment: z.string().max(256).nullish().transform((v) => v ?? null),
})

export const syncTradeSchema = z.object({
  // 64-bit identity (new); legacy 32-bit positionId is optional compat
  positionTicket: bigTicket,
  dealTicket: bigTicket,
  positionId: z.number().int().nullish().transform((v) => v ?? null),
  symbol: z.string().min(1).max(64),
  direction: z.enum(['BUY', 'SELL']),
  volume: finite('volume').min(0).max(1e9),
  openTime: isoDate,
  closeTime: isoDate.nullish().transform((v) => v ?? null),
  openPrice: finite('openPrice').min(0).max(1e12),
  closePrice: finite('closePrice').min(0).max(1e12).nullish().transform((v) => v ?? null),
  stopLoss: finite('stopLoss').min(0).max(1e12).nullish().transform((v) => v ?? null),
  takeProfit: finite('takeProfit').min(0).max(1e12).nullish().transform((v) => v ?? null),
  initialStopLoss: finite('initialStopLoss').min(0).max(1e12).nullish().transform((v) => v ?? null),
  riskAmount: finite('riskAmount').min(0).max(1e15).nullish().transform((v) => v ?? null),
  commission: finite('commission').default(0),
  swap: finite('swap').default(0),
  profit: finite('profit').default(0),
  netProfit: finite('netProfit').optional(), // recomputed when absent
  pips: finite('pips').nullish().transform((v) => v ?? null),
  rMultiple: finite('rMultiple').nullish().transform((v) => v ?? null),
  holdingMinutes: z.number().int().min(0).max(10 * 366 * 24 * 60).nullish().transform((v) => v ?? null),
  status: z.enum(['OPEN', 'CLOSED']).default('CLOSED'),
  magicNumber: bigTicket,
  mt5Comment: z.string().max(256).nullish().transform((v) => v ?? null),
  incompleteHistory: z.boolean().default(false),
})

export const syncBodySchema = z.object({
  account: z
    .object({
      name: z.string().max(128).optional(),
      broker: z.string().max(128).optional(),
      server: z.string().max(128).optional(),
      login: z.union([z.number().int().nonnegative(), z.string().regex(/^\d{1,20}$/)]).optional(),
      currency: z.string().regex(/^[A-Za-z]{2,5}$/).optional(),
      leverage: z.number().int().min(1).max(5000).optional(),
      tradeMode: z.enum(['REAL', 'DEMO', 'CONTEST']).optional(),
    })
    .optional(),
  trades: z.array(syncTradeSchema).max(50_000),
  cashflows: z.array(cashflowSchema).max(50_000).optional(),
  snapshot: z
    .object({
      balance: finite('balance').min(-1e15).max(1e15).optional(),
      equity: finite('equity').min(-1e15).max(1e15).optional(),
    })
    .optional(),
})

export type ValidatedSyncBody = z.output<typeof syncBodySchema>
export type ValidatedSyncTrade = z.output<typeof syncTradeSchema>
export type ValidatedCashflow = z.output<typeof cashflowSchema>

// ─── Trade journal mutation (manual annotations only) ────────────────────────
export const tradePatchSchema = z
  .object({
    mistakes: z.array(z.string().min(1).max(64)).max(12).optional(),
    emotion: z.string().min(1).max(32).nullable().optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict()

// ─── Settings mutation ───────────────────────────────────────────────────────
export const settingsPatchSchema = z
  .object({
    timezone: z
      .string()
      .max(64)
      .refine(
        (tz) => {
          try {
            new Intl.DateTimeFormat('en-US', { timeZone: tz })
            return true
          } catch {
            return false
          }
        },
        'unknown IANA timezone',
      )
      .optional(),
  })
  .strict()

// ─── Analytics / journal query params ────────────────────────────────────────
// MT5-style periods: Today / Last 3 days / Last week / Last month /
// Last 3 months / Last 6 months / Entire history (+ explicit custom window).
export const rangeKeys = ['today', '3d', 'week', 'month', '3m', '6m', 'all'] as const
export const analyticsQuerySchema = z.object({
  range: z.enum([...rangeKeys, 'custom']).default('all'),
  symbol: z.string().max(64).optional(),
  accountId: z.string().max(64).optional(),
  from: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'valid from date').optional(),
  to: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'valid to date').optional(),
})

export const journalQuerySchema = z.object({
  range: z.enum([...rangeKeys, 'custom']).default('all'),
  status: z.enum(['ALL', 'OPEN', 'CLOSED']).default('ALL'),
  result: z.enum(['ALL', 'WIN', 'LOSS', 'BE']).default('ALL'),
  mistake: z.string().max(64).default('ALL'),
  emotion: z.string().max(32).default('ALL'),
  symbol: z.string().max(64).default('ALL'),
  q: z.string().max(128).default(''),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  from: z.string().refine((s) => !Number.isNaN(Date.parse(s))).optional(),
  to: z.string().refine((s) => !Number.isNaN(Date.parse(s))).optional(),
  accountId: z.string().max(64).optional(),
})
