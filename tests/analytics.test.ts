// ─── Analytics engine — hand-computed mathematical expectations ──────────────
// The canonical sequence from the mission brief: +2R, -1R, +1R, -0.5R, 0R
// (risk 100 per trade) — every number below is derived by hand.
import { describe, expect, test } from 'bun:test'
import {
  computeAnalytics,
  dateKeyIn,
  hourIn,
  type EngineInput,
  type EngineTrade,
} from '../src/lib/analytics'
import { currencySymbol, fmtMoney } from '../src/lib/format'

const RISK = 100
const T0 = Date.UTC(2024, 0, 10, 9, 0, 0) // 2024-01-10 09:00 UTC

let seq = 0
function closedTrade(opts: {
  rMultiple: number
  netProfit: number
  closeOffsetMin: number
  symbol?: string
  direction?: 'BUY' | 'SELL'
  openOffsetMin?: number
}): EngineTrade {
  seq++
  const openTime = new Date(T0 + (opts.openOffsetMin ?? 0) * 60_000)
  return {
    id: `t${seq}`,
    positionId: seq,
    positionTicket: 900_000_000_000 + seq,
    dealTicket: 500_000 + seq,
    symbol: opts.symbol ?? 'EURUSD',
    direction: opts.direction ?? 'BUY',
    volume: 1,
    openTime,
    closeTime: new Date(openTime.getTime() + opts.closeOffsetMin * 60_000),
    openPrice: 1.1,
    closePrice: 1.1,
    stopLoss: null,
    takeProfit: null,
    initialStopLoss: null,
    riskAmount: RISK, // valid initial risk → R is statistically valid
    commission: 0,
    swap: 0,
    profit: opts.netProfit,
    netProfit: opts.netProfit,
    pips: null,
    rMultiple: opts.rMultiple,
    holdingMinutes: opts.closeOffsetMin,
    status: 'CLOSED',
    incompleteHistory: false,
    magicNumber: null,
    mistakes: [],
    emotion: null,
  }
}

// +2R, -1R, +1R, -0.5R, 0R — closed in this order
const SEQ: EngineTrade[] = [
  closedTrade({ rMultiple: 2, netProfit: 200, closeOffsetMin: 60 }),
  closedTrade({ rMultiple: -1, netProfit: -100, closeOffsetMin: 90 }),
  closedTrade({ rMultiple: 1, netProfit: 100, closeOffsetMin: 45 }),
  closedTrade({ rMultiple: -0.5, netProfit: -50, closeOffsetMin: 120 }),
  closedTrade({ rMultiple: 0, netProfit: 0, closeOffsetMin: 30 }),
]

function makeInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    account: {
      id: 'acc',
      name: 'Test Account',
      broker: 'B',
      server: 'S',
      mt5Login: '1',
      currency: 'USD',
      leverage: 100,
      initialBalance: 1000,
      tradeMode: 'REAL',
      timezone: 'UTC',
    },
    trades: SEQ,
    cashflows: [],
    snapshots: [],
    lastSyncAt: null,
    demoMode: false,
    ...overrides,
  }
}

describe('canonical ±R sequence (mission P7)', () => {
  const out = computeAnalytics(makeInput(), { range: 'all' })
  const p = out.performance

  test('win/loss/BE rates exclude break-evens from the decided set', () => {
    expect(p.totalTrades).toBe(5)
    expect(p.wins).toBe(2)
    expect(p.losses).toBe(2)
    expect(p.breakEven).toBe(1)
    expect(p.winRate).toBe(50) // 2 / (2+2)
    expect(p.lossRate).toBe(50)
    expect(p.breakEvenRate).toBe(20) // 1 / 5
  })

  test('profit factor = grossProfit / grossLoss = 300 / 150 = 2', () => {
    expect(p.grossProfit).toBe(300)
    expect(p.grossLoss).toBe(150)
    expect(p.profitFactor).toBe(2)
  })

  test('expectancy = mean(net) incl. BE = 150/5 = 30; expectancyR = 0.3', () => {
    expect(p.expectancy).toBe(30)
    expect(p.expectancyR).toBe(0.3)
    expect(p.avgR).toBe(0.3)
  })

  test('R coverage is 100% — every trade had a real initial risk', () => {
    expect(p.rCoverage).toBe(100)
    expect(p.rValidCount).toBe(5)
  })

  test('R histogram buckets match hand-computed placement', () => {
    const by = Object.fromEntries(p.rHistogram.map((b) => [b.bucket, b.count]))
    expect(by['≤ -2R']).toBe(0)
    expect(by['-2R..-1R']).toBe(1) // -1R
    expect(by['-1R..0']).toBe(1) // -0.5R
    expect(by['0..+1R']).toBe(1) // 0R
    expect(by['+1R..+2R']).toBe(1) // +1R
    expect(by['+2R..+3R']).toBe(1) // +2R
    expect(by['> +3R']).toBe(0)
  })
})

describe('no-loss edge cases are statistically honest', () => {
  test('no losses → PF 99.99 (∞ in UI), no R at all → nulls, not zeros', () => {
    const t = closedTrade({ rMultiple: 0.8, netProfit: 80, closeOffsetMin: 10 })
    const out = computeAnalytics(makeInput({ trades: [t] }), { range: 'all' })
    expect(out.performance.profitFactor).toBe(99.99)
    expect(out.performance.avgLoss).toBeNull()
    // R fields absent → null, never 0
    const noR = computeAnalytics(
      makeInput({ trades: [{ ...t, rMultiple: null, riskAmount: null }] }),
      { range: 'all' }
    )
    expect(noR.performance.avgR).toBeNull()
    expect(noR.performance.expectancyR).toBeNull()
    expect(noR.performance.rCoverage).toBe(0)
  })

  test('gross loss with profit → PF positive', () => {
    const out = computeAnalytics(
      makeInput({
        trades: [
          closedTrade({ rMultiple: 1, netProfit: 120, closeOffsetMin: 10 }),
          closedTrade({ rMultiple: -1, netProfit: -60, closeOffsetMin: 20 }),
        ],
      }),
      { range: 'all' }
    )
    expect(out.performance.profitFactor).toBe(2)
  })
})

describe('drawdown math on a hand-computed balance path', () => {
  // initial 1000 → +200 (1200) → -500 (700) → +100 (800)
  const trades = [
    closedTrade({ rMultiple: 2, netProfit: 200, closeOffsetMin: 10 }),
    closedTrade({ rMultiple: -5, netProfit: -500, closeOffsetMin: 20 }),
    closedTrade({ rMultiple: 1, netProfit: 100, closeOffsetMin: 30 }),
  ]
  const out = computeAnalytics(makeInput({ trades }), { range: 'all' })

  test('max DD = 500 (41.67% from peak 1200)', () => {
    expect(out.risk.maxDdAbs).toBe(500)
    expect(out.risk.maxDdPct).toBeCloseTo(41.67, 2)
  })

  test('current DD measured from the running peak', () => {
    expect(out.risk.currentDdPct).toBeCloseTo(33.33, 2)
  })

  test('recovery factor is window-consistent (P2.4)', () => {
    // trade A (+1000) closed 60 days ago is OUTSIDE the 30d window;
    // trade B (-100) is inside. RF must be net(window)/DD(window) = -1.
    const now = Date.now()
    const old = closedTrade({ rMultiple: 10, netProfit: 1000, closeOffsetMin: 10 })
    old.closeTime = new Date(now - 60 * 864e5)
    const recent = closedTrade({ rMultiple: -1, netProfit: -100, closeOffsetMin: 10 })
    recent.closeTime = new Date(now - 2 * 864e5)
    const outMonth = computeAnalytics(makeInput({ trades: [old, recent] }), { range: 'month' })
    expect(outMonth.performance.recoveryFactor).toBeCloseTo(-1, 2)
  })
})

describe('floating (equity-snapshot) drawdown basis', () => {
  const snaps = [
    { ts: new Date('2024-01-10T01:00:00Z'), balance: 1000, equity: 1000 },
    { ts: new Date('2024-01-10T02:00:00Z'), balance: 1000, equity: 800 },
    { ts: new Date('2024-01-10T03:00:00Z'), balance: 1000, equity: 900 },
    { ts: new Date('2024-01-11T01:00:00Z'), balance: 1000, equity: 950 },
  ]
  const out = computeAnalytics(makeInput({ snapshots: snaps, trades: [] }), { range: 'all' })

  test('equity DD = 20% from snapshot series; basis switches to equity', () => {
    expect(out.risk.equityMaxDdPct).toBe(20)
    expect(out.risk.equityMaxDdAbs).toBe(200)
    expect(out.risk.ddBasis).toBe('equity')
    expect(out.risk.dailyDdBasis).toBe('equity') // snapshots span 2 days
    expect(out.risk.maxDailyDdPct).toBe(20) // day 1: 1000 → 800
    expect(out.equitySeries.length).toBe(4)
  })

  test('without snapshots the engine falls back to the balance basis', () => {
    const out2 = computeAnalytics(makeInput({ trades: [] }), { range: 'all' })
    expect(out2.risk.ddBasis).toBe('balance')
    expect(out2.risk.equityMaxDdPct).toBeNull()
  })
})

describe('timezone-aware day bucketing (P2.6/P2.8)', () => {
  test('21:30Z is the NEXT day in Tehran, same day in UTC', () => {
    const d = new Date('2024-01-01T21:30:00Z')
    expect(dateKeyIn('Asia/Tehran', d)).toBe('2024-01-02')
    expect(dateKeyIn('UTC', d)).toBe('2024-01-01')
  })

  test('hourIn respects the requested timezone', () => {
    expect(hourIn('Asia/Tehran', new Date('2024-01-01T21:30:00Z'))).toBe(1)
    expect(hourIn('UTC', new Date('2024-01-01T21:30:00Z'))).toBe(21)
  })
})

describe('trading sessions with DST (P2.8)', () => {
  const london = (iso: string) => {
    const t = closedTrade({ rMultiple: 1, netProfit: 10, closeOffsetMin: 5 })
    t.openTime = new Date(iso)
    const out = computeAnalytics(makeInput({ trades: [t] }), { range: 'all' })
    return out.time.sessions.find((s) => s.name === 'London')!
  }

  test('07:15Z is inside London ONLY in summer (BST), not in winter (GMT)', () => {
    expect(london('2024-07-15T07:15:00Z').trades).toBe(1) // 08:15 BST ∈ 08–17
    expect(london('2024-01-15T07:15:00Z').trades).toBe(0) // 07:15 GMT ∉ 08–17
  })

  test('09:30Z is inside London in winter too', () => {
    expect(london('2024-01-15T09:30:00Z').trades).toBe(1)
  })
})

describe('currency formatting uses the account currency (P2.7)', () => {
  test('currencySymbol + fmtMoney honor ISO codes', () => {
    expect(currencySymbol('EUR')).toBe('€')
    expect(fmtMoney(5, { currency: 'EUR' })).toContain('€')
    expect(fmtMoney(5, { currency: 'IRR' })).toContain('IRR')
    expect(currencySymbol(null)).toBe('$')
  })

  test('analytics output carries the account currency through', () => {
    const out = computeAnalytics(makeInput(), { range: 'all' })
    expect(out.account.currency).toBe('USD')
  })
})

describe('best/worst hours need a minimum sample (P2.8)', () => {
  test('hours with < 3 trades are never highlighted', () => {
    const t1 = closedTrade({ rMultiple: 1, netProfit: 10, closeOffsetMin: 5, openOffsetMin: 0 })
    const out = computeAnalytics(makeInput({ trades: [t1] }), { range: 'all' })
    expect(out.time.bestHour).toBeNull()
    expect(out.time.worstHour).toBeNull()
    expect(out.time.minSample).toBe(3)
  })
})
