// ─── Security layer tests: sync token + request validation schemas ───────────
import { afterAll, describe, expect, test } from 'bun:test'
import {
  cashflowSchema,
  journalQuerySchema,
  settingsPatchSchema,
  syncBodySchema,
  analyticsQuerySchema,
  tradePatchSchema,
} from '../src/lib/validation'

const VALID_TRADE = {
  symbol: 'EURUSD',
  direction: 'BUY' as const,
  volume: 1,
  openTime: '2024-01-01T10:00:00Z',
  openPrice: 1.1,
  status: 'CLOSED' as const,
  commission: -3,
  swap: 0,
  profit: 200,
  netProfit: 197,
}

function bodyWith(overrides: Record<string, unknown> = {}) {
  return {
    account: { login: 12345, server: 'Test-Server', currency: 'USD', leverage: 100, tradeMode: 'REAL' },
    trades: [{ ...VALID_TRADE, ...overrides }],
    snapshot: { balance: 1197, equity: 1197 },
  }
}

describe('sync payload validation (P5)', () => {
  test('valid payload passes', () => {
    const r = syncBodySchema.safeParse(bodyWith())
    expect(r.success).toBe(true)
  })

  test('replaces symbol/direction/volume type violations', () => {
    expect(syncBodySchema.safeParse(bodyWith({ symbol: '' })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ direction: 'LONG' })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ volume: '1' })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ volume: Number.NaN })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ volume: Number.POSITIVE_INFINITY })).success).toBe(false)
  })

  test('non-finite money fields are rejected', () => {
    expect(syncBodySchema.safeParse(bodyWith({ profit: Number.NaN })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ netProfit: '200' })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ openPrice: -5 })).success).toBe(false)
  })

  test('invalid dates are rejected', () => {
    expect(syncBodySchema.safeParse(bodyWith({ openTime: 'yesterday' })).success).toBe(false)
    expect(syncBodySchema.safeParse(bodyWith({ openTime: 1700000000 })).success).toBe(false)
  })

  test('oversized arrays are rejected (bounded payload)', () => {
    const trades = Array.from({ length: 50_001 }, () => ({ ...VALID_TRADE }))
    const r = syncBodySchema.safeParse({ account: undefined, trades })
    expect(r.success).toBe(false)
  })

  test('cashflow requires valid type and finite amount', () => {
    expect(cashflowSchema.safeParse({ ts: '2024-01-01T00:00:00Z', type: 'DEPOSIT', amount: 10 }).success).toBe(true)
    expect(cashflowSchema.safeParse({ ts: '2024-01-01T00:00:00Z', type: 'TRANSFER', amount: 10 }).success).toBe(false)
    expect(cashflowSchema.safeParse({ ts: 'bad', type: 'DEPOSIT', amount: 10 }).success).toBe(false)
  })

  test('64-bit tickets ride through as BigInt', () => {
    const r = syncBodySchema.parse(bodyWith({ positionTicket: '900719925474099', dealTicket: 5001 }))
    expect(r.trades[0].positionTicket).toBe(BigInt('900719925474099'))
    expect(r.trades[0].dealTicket).toBe(BigInt(5001))
  })
})

describe('journal / analytics / settings query validation', () => {
  test('range whitelist (v1.5.0 periods)', () => {
    expect(journalQuerySchema.safeParse({ range: 'month' }).success).toBe(true)
    expect(journalQuerySchema.safeParse({ range: 'today' }).success).toBe(true)
    expect(journalQuerySchema.safeParse({ range: 'week' }).success).toBe(true)
    expect(journalQuerySchema.safeParse({ range: 'all' }).success).toBe(true)
    expect(journalQuerySchema.safeParse({ range: 'custom' }).success).toBe(true)
    expect(journalQuerySchema.safeParse({ range: 'bogus' }).success).toBe(false)
    expect(journalQuerySchema.safeParse({ range: '6m' }).success).toBe(false)
    expect(analyticsQuerySchema.safeParse({ range: 'DROP TABLE' }).success).toBe(false)
  })

  test('limit beyond the cap is rejected (route caps via schema)', () => {
    expect(journalQuerySchema.safeParse({ limit: '99999' }).success).toBe(false)
    expect(journalQuerySchema.parse({ limit: '250' }).limit).toBe(250)
  })

  test('timezone must be a real IANA zone', () => {
    expect(settingsPatchSchema.safeParse({ timezone: 'Europe/London' }).success).toBe(true)
    expect(settingsPatchSchema.safeParse({ timezone: 'Mars/Olympus' }).success).toBe(false)
    expect(settingsPatchSchema.safeParse({ evil: 1 }).success).toBe(false) // strict
  })

  test('trade patch only accepts journal fields', () => {
    expect(tradePatchSchema.safeParse({ notes: 'ok', mistakes: ['FOMO'] }).success).toBe(true)
    expect(tradePatchSchema.safeParse({ netProfit: 1e9 }).success).toBe(false) // cannot rewrite money
    expect(tradePatchSchema.safeParse({ notes: 'x'.repeat(5000) }).success).toBe(false)
  })
})
