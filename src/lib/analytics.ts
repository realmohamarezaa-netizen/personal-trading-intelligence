// ─── Personal Trading Intelligence — Analytics Engine ────────────────────────
// Pure computation layer, fully decoupled from UI and database.
//
// Mathematical definitions (v1.3.0 — every metric is documented here):
//   * Balance curve        — realized money only: initial + closed P/L ± cash
//                            flows (CREDIT excluded; MT5 reports credit
//                            outside the balance).
//   * Equity series        — as sampled by the MT5 connector (~45 s while
//                            connected). Sampling resolution is a property of
//                            the data and drawdown numbers derived from it are
//                            labelled accordingly; they are NOT tick-level.
//   * Drawdown             — trading/balance DD over the balance curve;
//                            floating/equity DD over snapshots when coverage
//                            exists (risk.ddBasis tells which one the
//                            underwater chart uses).
//   * Max daily drawdown   — worst intraday equity drop (snapshot basis when
//                            snapshots cover the day), else worst realized
//                            balance drop per trading day. Trading days are
//                            bucketed in the account's timezone.
//   * Expectancy           — average net P/L per closed trade (break-even
//                            trades included), i.e. mean(netProfit).
//   * Expectancy R         — mean R-Multiple over trades with a VALID initial
//                            risk only (never guesses).
//   * Win / Loss / BE rate — shares of all closed trades; win rate excludes
//                            break-evens from both numerator and denominator.
//   * Profit factor        — grossProfit / grossLoss; no losses & some profit
//                            → 99.99 (∞ in the UI); nothing at all → null.
//   * Recovery factor      — window-consistent: net P/L of the SELECTED range
//                            ÷ max trading drawdown inside the SAME range.
//   * R coverage           — share of closed trades whose R is valid
//                            (initial SL + symbol tick data were known).

import type {
  AnalyticsData,
  CalendarDay,
  DailyPnl,
  DayStat,
  DirectionStat,
  DDPeriod,
  EquityPoint,
  HoldingBucket,
  HourStat,
  MatrixCell,
  OpenPosition,
  PerformanceStats,
  RangeKey,
  RiskAnalysis,
  RHistogramBucket,
  SessionStat,
  SymbolStat,
  TimeAnalysis,
  UnderwaterPoint,
  MistakeStatLite,
} from './types'

// ─── Timezone-aware time helpers ─────────────────────────────────────────────

type FmtCache = Map<string, Intl.DateTimeFormat>
const hourFmts: FmtCache = new Map()
const dayFmts: FmtCache = new Map()
const weekdayFmts: FmtCache = new Map()

function fmtFor(cache: FmtCache, tz: string, options: Intl.DateTimeFormatOptions, locale = 'en-US'): Intl.DateTimeFormat {
  const key = `${locale}|${tz}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { timeZone: tz, hour12: false, ...options })
    cache.set(key, f)
  }
  return f
}

export const WEEK_START_SATURDAY = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
export const WEEKDAYS_LONG_SATURDAY = [
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]

/** Local hour 0-23 in the given IANA timezone */
export function hourIn(tz: string, d: Date): number {
  return parseInt(fmtFor(hourFmts, tz, { hour: '2-digit' }).format(d), 10) % 24
}
/** YYYY-MM-DD in the given timezone (en-CA yields the ISO-style key) */
export function dateKeyIn(tz: string, d: Date): string {
  return fmtFor(dayFmts, tz, { year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA').format(d)
}
/** 0 = Saturday … 6 = Friday (regional trading week) */
export function weekdayIn(tz: string, d: Date): number {
  const w = fmtFor(weekdayFmts, tz, { weekday: 'short' }).format(d).slice(0, 3)
  const idx = WEEK_START_SATURDAY.indexOf(w)
  return idx >= 0 ? idx : 6
}

// Legacy names kept for callers outside the engine (Tehran default).
export const TEHRAN_DAYS = WEEK_START_SATURDAY
export const TEHRAN_DAYS_LONG = WEEKDAYS_LONG_SATURDAY
export const tehranHour = (d: Date) => hourIn('Asia/Tehran', d)
export const tehranDateKey = (d: Date) => dateKeyIn('Asia/Tehran', d)
export const tehranWeekday = (d: Date) => weekdayIn('Asia/Tehran', d)

/**
 * Trading sessions defined in their OWN exchange timezones, so London/NY
 * daylight-saving shifts are handled by the Intl timezone conversion on every
 * single trade. Sessions can overlap (a trade may count in London AND NY).
 */
export const SESSIONS: { name: string; tz: string; startHour: number; endHour: number; label: string }[] = [
  { name: 'Sydney', tz: 'Australia/Sydney', startHour: 9, endHour: 18, label: '09:00 – 18:00 (Sydney)' },
  { name: 'Tokyo', tz: 'Asia/Tokyo', startHour: 9, endHour: 18, label: '09:00 – 18:00 (Tokyo)' },
  { name: 'London', tz: 'Europe/London', startHour: 8, endHour: 17, label: '08:00 – 17:00 (London)' },
  { name: 'New York', tz: 'America/New_York', startHour: 8, endHour: 17, label: '08:00 – 17:00 (New York)' },
]

function sessionHourCache(): Map<string, number> {
  // cache: `${tz}|${isoMs}` → local hour (per-process memo)
  const g = globalThis as unknown as { __ptiSessionHourCache?: Map<string, number> }
  if (!g.__ptiSessionHourCache) g.__ptiSessionHourCache = new Map()
  return g.__ptiSessionHourCache
}

function hourInSession(tz: string, d: Date): number {
  const cache = sessionHourCache()
  const key = `${tz}|${Math.floor(d.getTime() / 3_600_000)}` // hour resolution
  let h = cache.get(key)
  if (h === undefined) {
    h = hourIn(tz, d)
    if (cache.size > 50_000) cache.clear()
    cache.set(key, h)
  }
  return h
}

function inSession(sess: (typeof SESSIONS)[number], d: Date): boolean {
  const h = hourInSession(sess.tz, d)
  return h >= sess.startHour && h < sess.endHour
}

// ─── Engine input types (plain rows) ─────────────────────────────────────────

export interface EngineTrade {
  id: string
  positionId: number | null
  positionTicket: number | null
  dealTicket: number | null
  symbol: string
  direction: 'BUY' | 'SELL'
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
  magicNumber: number | null
  mistakes: string[]
  emotion: string | null
}

export interface EquitySnapshotPoint {
  ts: Date
  balance: number
  equity: number
}

export interface EngineInput {
  account: {
    id: string
    name: string
    broker: string
    server: string
    mt5Login: string | null
    currency: string
    leverage: number
    initialBalance: number
    tradeMode: string
    timezone: string
  }
  trades: EngineTrade[]
  cashflows: { ts: Date; type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; category: string }[]
  snapshots: EquitySnapshotPoint[]
  lastSyncAt: Date | null
  demoMode: boolean
}

export interface EngineOptions {
  range: RangeKey
  symbol?: string
  /** explicit window for range = 'custom' */
  from?: Date
  to?: Date
}

// ─── Small utils ─────────────────────────────────────────────────────────────

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)
const EPS = 0.0001

function profitFactor(gp: number, gl: number): number | null {
  if (gl <= EPS) return gp > EPS ? 99.99 : null // no losses & no profit → nothing to measure
  return gp / gl
}

// ─── Dashboard analytics periods ─────────────────────────────────────────
            
// v1.5.0 windows: Today / This week / This month / All time (+ explicit
// custom window). All calendar-aligned to the ACCOUNT timezone — "Today"
// starts at the account's local midnight, "This week" starts at local
// midnight of the week's first day (Saturday — Iranian trading week,
// consistent with the default Asia/Tehran account), "This month" starts on
// the 1st of the current local month.

/** Wall-clock Y/M/D of `d` in `tz`. */
function ymdIn(tz: string, d: Date): { y: number; m: number; d: number } {
  const [y, m, day] = dateKeyIn(tz, d).split('-').map(Number)
  return { y, m, d: day }
}

/** UTC instant whose wall-clock time in `tz` equals the given local date/time. */
function wallClockToUtc(tz: string, y: number, m: number, d: number, hour = 0, minute = 0): Date {
  const stamp = Date.UTC(y, m - 1, d, hour, minute)
  const f = fmtFor(
    new Map(),
    tz,
    { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
  )
  const asUtcOf = (t: number): number => {
    const parts: Record<string, number> = {}
    for (const p of f.formatToParts(new Date(t))) {
      if (p.type !== 'literal') parts[p.type] = parseInt(p.value, 10)
    }
    return Date.UTC(parts.year, parts.month - 1, parts.day, (parts.hour ?? 0) % 24, parts.minute ?? 0)
  }
  let guess = stamp
  for (let i = 0; i < 2; i++) {
    const diff = asUtcOf(guess) - stamp
    if (diff === 0) break
    guess -= diff
  }
  return new Date(guess)
}

/** Start of the local day (00:00) that contains `d`, in `tz`. */
export function startOfDayIn(tz: string, d: Date): Date {
  const { y, m, d: day } = ymdIn(tz, d)
  return wallClockToUtc(tz, y, m, day, 0, 0)
}

/**
 * Start of the analytics window for a range key, aligned to the account
 * timezone. Returns null for 'all' / 'custom' (custom supplies its own
 * explicit window via EngineOptions).
 */
export function rangeStartDate(range: RangeKey, tz: string, now: Date = new Date()): Date | null {
  switch (range) {
    case 'all':
    case 'custom':
      return null
    case 'today':
      return startOfDayIn(tz, now)
    case 'week': {
      // Start of the current calendar week: local midnight of the most
      // recent Saturday (Iranian week — Saturday→Friday), computed from the
      // wall-clock date in the account timezone. Weekday is derived from
      // that civil date itself (getUTCDay is tz-independent for a date).
      const { y, m, d } = ymdIn(tz, now)
      const dow = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() // Sun=0..Sat=6
      const daysSinceSaturday = (dow + 1) % 7 // Sun→1 … Fri→6, Sat→0
      const start = new Date(Date.UTC(y, m - 1, d - daysSinceSaturday))
      const sy = start.getUTCFullYear()
      const sm = start.getUTCMonth() + 1
      const sd = start.getUTCDate()
      return wallClockToUtc(tz, sy, sm, sd, 0, 0)
    }
    case 'month': {
      // 1st of the current local month, 00:00
      const { y, m } = ymdIn(tz, now)
      return wallClockToUtc(tz, y, m, 1, 0, 0)
    }
  }
}

// ─── Core engine ─────────────────────────────────────────────────────────────

export function computeAnalytics(
  input: EngineInput,
  opts: EngineOptions
): AnalyticsData {
  const tz = input.account.timezone || 'Asia/Tehran'
  const now = new Date()
  // MT5-style periods, calendar-aligned to the account timezone; 'custom'
  // uses the explicit window passed by the caller, 'all' has no lower bound.
  const from: Date | null =
    opts.range === 'custom' ? (opts.from ?? null) : rangeStartDate(opts.range, tz, now)
  const to: Date = opts.range === 'custom' && opts.to ? opts.to : now

  const allClosed = input.trades
    .filter((t) => t.status === 'CLOSED' && t.closeTime)
    .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime())
  // Open = status OPEN without a close time. A row carrying BOTH is corrupt
  // by definition (defense-in-depth: such a row must never inflate the
  // floating P/L or appear in the Open Positions panel).
  const allOpen = input.trades.filter((t) => t.status === 'OPEN' && !t.closeTime)

  const matches = (t: EngineTrade): boolean => !opts.symbol || t.symbol === opts.symbol

  const closed = allClosed.filter(
    (t) => matches(t) && inRange(t.closeTime!, from, to)
  )
  const open = allOpen.filter(matches)

  // ── Account-level money (NEVER affected by the symbol filter) ──
  // CREDIT deals are excluded: the MT5 terminal reports credit separately,
  // so folding it into the balance would break reconciliation.
  const cashReal = input.cashflows.filter((c) => c.category !== 'CREDIT')
  const deposits = sum(cashReal.filter((c) => c.type === 'DEPOSIT').map((c) => c.amount))
  const withdrawals = sum(cashReal.filter((c) => c.type === 'WITHDRAWAL').map((c) => c.amount))
  const totalNetProfitAll = sum(allClosed.map((t) => t.netProfit))
  const balance = input.account.initialBalance + deposits - withdrawals + totalNetProfitAll
  const floatingPnl = sum(open.map((t) => t.profit + t.swap))
  const equity = balance + floatingPnl

  const todayKey = dateKeyIn(tz, now)
  const todayTradesAll = allClosed.filter((t) => dateKeyIn(tz, t.closeTime!) === todayKey)
  const todayPnl = sum(todayTradesAll.map((t) => t.netProfit))

  // ── Balance curve & trading drawdown (account-level, range-scoped) ──
  interface Ev { ts: number; delta: number }
  const events: Ev[] = [
    ...allClosed.map((t) => ({ ts: t.closeTime!.getTime(), delta: t.netProfit })),
    ...cashReal.map((c) => ({
      ts: c.ts.getTime(),
      delta: c.type === 'DEPOSIT' ? c.amount : -c.amount,
    })),
  ].sort((a, b) => a.ts - b.ts)

  let running = input.account.initialBalance
  let startIndex = 0
  if (from) {
    while (startIndex < events.length && events[startIndex].ts < from.getTime()) {
      running += events[startIndex].delta
      startIndex++
    }
  }
  const startT = from ? from.getTime() : events.length ? events[0].ts : now.getTime()

  const balanceCurve: EquityPoint[] = []
  let peak = running
  let maxDdAbs = 0
  let maxDdPct = 0
  let ddSum = 0
  let ddCount = 0

  const pushPoint = (t: number, bal: number) => {
    if (bal > peak) peak = bal
    const ddAbs = peak - bal
    const ddPct = peak > 0 ? (ddAbs / peak) * 100 : 0
    if (ddAbs > 0.005) {
      ddSum += ddPct
      ddCount++
    }
    if (ddAbs > maxDdAbs) maxDdAbs = ddAbs
    if (ddPct > maxDdPct) maxDdPct = ddPct
    balanceCurve.push({
      t: new Date(t).toISOString(),
      balance: round2(bal),
      equity: round2(bal),
      ddAbs: round2(ddAbs),
      ddPct: round2(ddPct),
      source: 'balance',
    })
  }

  pushPoint(startT, running)
  for (let i = startIndex; i < events.length; i++) {
    running += events[i].delta
    pushPoint(events[i].ts, running)
  }

  // ── Floating (equity) drawdown from connector snapshots ──
  const snapshots = [...input.snapshots].sort((a, b) => a.ts.getTime() - b.ts.getTime())
  const inWindow = (d: Date) => (!from || d.getTime() >= from.getTime()) && d.getTime() <= to.getTime()
  const windowSnaps = snapshots.filter((s) => inWindow(s.ts))

  let equityMaxDdAbs: number | null = null
  let equityMaxDdPct: number | null = null
  let equitySeries: EquityPoint[] = []
  let underwater: UnderwaterPoint[] = []
  let ddBasis: 'equity' | 'balance' = 'balance'
  let currentDdPct = balanceCurve.length ? balanceCurve[balanceCurve.length - 1].ddPct : 0

  if (windowSnaps.length >= 2) {
    let eqPeak = windowSnaps[0].equity
    let eqMaxAbs = 0
    let eqMaxPct = 0
    equitySeries = windowSnaps.map((s) => {
      if (s.equity > eqPeak) eqPeak = s.equity
      const ddAbs = Math.max(0, eqPeak - s.equity)
      const ddPct = eqPeak > 0 ? (ddAbs / eqPeak) * 100 : 0
      if (ddAbs > eqMaxAbs) eqMaxAbs = ddAbs
      if (ddPct > eqMaxPct) eqMaxPct = ddPct
      return {
        t: s.ts.toISOString(),
        balance: round2(s.balance),
        equity: round2(s.equity),
        ddAbs: round2(ddAbs),
        ddPct: round2(ddPct),
        source: 'equity' as const,
      }
    })
    equityMaxDdAbs = round2(eqMaxAbs)
    equityMaxDdPct = round2(eqMaxPct)
    currentDdPct = equitySeries[equitySeries.length - 1].ddPct
    ddBasis = 'equity'
    underwater = equitySeries
      .filter((_, i) => equitySeries.length <= 700 || i % Math.ceil(equitySeries.length / 700) === 0)
      .map((p) => ({ t: p.t, pct: -p.ddPct }))
  } else {
    underwater = balanceCurve
      .filter((_, i) => balanceCurve.length <= 700 || i % Math.ceil(balanceCurve.length / 700) === 0)
      .map((p) => ({ t: p.t, pct: -p.ddPct }))
  }

  // Drawdown periods (trading/balance basis — always available)
  const ddPeriods: DDPeriod[] = []
  let cur: { startT: number; depthPct: number; depthAbs: number; troughT: number } | null = null
  for (const p of balanceCurve) {
    if (p.ddAbs > 0.005) {
      if (!cur) cur = { startT: new Date(p.t).getTime(), depthPct: p.ddPct, depthAbs: p.ddAbs, troughT: new Date(p.t).getTime() }
      else if (p.ddPct > cur.depthPct) {
        cur.depthPct = p.ddPct
        cur.depthAbs = p.ddAbs
        cur.troughT = new Date(p.t).getTime()
      }
    } else if (cur) {
      ddPeriods.push({
        start: new Date(cur.startT).toISOString(),
        end: p.t,
        depthPct: round2(cur.depthPct),
        depthAbs: round2(cur.depthAbs),
        days: round1((new Date(p.t).getTime() - cur.startT) / 864e5),
        recovered: true,
      })
      cur = null
    }
  }
  if (cur) {
    ddPeriods.push({
      start: new Date(cur.startT).toISOString(),
      end: null,
      depthPct: round2(cur.depthPct),
      depthAbs: round2(cur.depthAbs),
      days: round1((to.getTime() - cur.startT) / 864e5),
      recovered: false,
    })
  }
  const longestDdDays = ddPeriods.length ? Math.max(...ddPeriods.map((p) => p.days)) : 0
  const recoveredPeriods = ddPeriods.filter((p) => p.recovered)
  const longestRecoveryDays = recoveredPeriods.length
    ? Math.max(...recoveredPeriods.map((p) => p.days))
    : null

  // ── Max daily drawdown ──
  // Preferred basis: snapshot equity (true floating intraday drawdown per
  // trading day in the account timezone). Fallback (when no snapshot covers
  // the window): realized balance change per trading day — explicitly labelled.
  let maxDailyDdAbs = 0
  let maxDailyDdPct = 0
  let dailyDdBasis: 'equity' | 'balance' = 'balance'
  {
    // equity basis
    const byDay = new Map<string, EquitySnapshotPoint[]>()
    for (const s of windowSnaps) {
      const k = dateKeyIn(tz, s.ts)
      const arr = byDay.get(k) ?? []
      arr.push(s)
      byDay.set(k, arr)
    }
    for (const [, rows] of byDay) {
      const startEq = rows[0].equity
      let minEq = startEq
      for (const r of rows) if (r.equity < minEq) minEq = r.equity
      const dd = startEq - minEq
      if (dd > maxDailyDdAbs) maxDailyDdAbs = dd
      const pct = startEq > 0 ? (dd / startEq) * 100 : 0
      if (pct > maxDailyDdPct) maxDailyDdPct = pct
    }
    if (byDay.size >= 2) dailyDdBasis = 'equity'
  }
  if (dailyDdBasis === 'balance') {
    // realized basis (fallback): per trading day, worst dip of the running
    // balance after each closed trade / cashflow (no intraday information).
    let dayKey = ''
    let dayStart = 0
    let dayMin = Infinity
    let bal = input.account.initialBalance
    const cfSorted = [...cashReal].sort((a, b) => a.ts.getTime() - b.ts.getTime())
    let ci = 0
    for (const t of allClosed) {
      while (ci < cfSorted.length && cfSorted[ci].ts.getTime() <= t.closeTime!.getTime()) {
        const c = cfSorted[ci++]
        bal += c.type === 'DEPOSIT' ? c.amount : -c.amount
      }
      const k = dateKeyIn(tz, t.closeTime!)
      if (k !== dayKey) {
        if (dayKey && dayMin < Infinity && dayStart > 0) {
          const dd = dayStart - dayMin
          if (dd > maxDailyDdAbs) maxDailyDdAbs = dd
          const pct = (dd / dayStart) * 100
          if (pct > maxDailyDdPct) maxDailyDdPct = pct
        }
        dayKey = k
        dayStart = bal
        dayMin = bal
      }
      bal += t.netProfit
      if (bal < dayMin) dayMin = bal
    }
    if (dayKey && dayMin < Infinity && dayStart > 0) {
      const dd = dayStart - dayMin
      if (dd > maxDailyDdAbs) maxDailyDdAbs = dd
      const pct = (dd / dayStart) * 100
      if (pct > maxDailyDdPct) maxDailyDdPct = pct
    }
  }

  // ── Performance stats (symbol/range filtered) ──
  const nets = closed.map((t) => t.netProfit)
  const winsArr = closed.filter((t) => t.netProfit > EPS)
  const lossesArr = closed.filter((t) => t.netProfit < -EPS)
  const beArr = closed.filter((t) => Math.abs(t.netProfit) <= EPS)
  const grossProfit = sum(winsArr.map((t) => t.netProfit))
  const grossLoss = Math.abs(sum(lossesArr.map((t) => t.netProfit)))
  const decided = winsArr.length + lossesArr.length
  const winRate = decided ? (winsArr.length / decided) * 100 : 0
  const lossRate = decided ? (lossesArr.length / decided) * 100 : 0
  const breakEvenRate = closed.length ? (beArr.length / closed.length) * 100 : 0
  // Expectancy = average net result per closed trade, break-evens INCLUDED
  // (the mathematically standard definition; equals sum(nets)/count).
  const expectancy = closed.length ? mean(nets) : 0
  // R statistics only over VALID R values (initial risk was actually known)
  const rVals = closed.map((t) => t.rMultiple).filter((r): r is number => r !== null && isFinite(r))
  const closedWithValidR = closed.filter((t) => t.riskAmount !== null && t.riskAmount > 0)
  const rCoverage = closed.length ? (closedWithValidR.length / closed.length) * 100 : 0
  const expectancyR = rVals.length ? mean(rVals) : null
  const holdVals = closed.map((t) => t.holdingMinutes).filter((v): v is number => v !== null)
  const avgHoldMinutes = holdVals.length ? mean(holdVals) : 0
  const pipsVals = closed.map((t) => t.pips).filter((v): v is number => v !== null)
  const pf = profitFactor(grossProfit, grossLoss)
  // Recovery factor is window-consistent: net P/L of the SELECTED window
  // (account level, symbol filter ignored) ÷ max trading DD of the SAME window.
  const rangeNetProfit = sum(
    allClosed.filter((t) => inRange(t.closeTime!, from, to)).map((t) => t.netProfit)
  )
  const recoveryFactor = maxDdAbs > 0.005 ? rangeNetProfit / maxDdAbs : null

  const streak = computeStreaks(closed)

  const rHistogram = buildRHistogram(closed)
  const holdingBuckets = buildHoldingBuckets(closed)

  const performance: PerformanceStats = {
    totalTrades: closed.length,
    wins: winsArr.length,
    losses: lossesArr.length,
    breakEven: beArr.length,
    winRate: round1(winRate),
    lossRate: round1(lossRate),
    breakEvenRate: round1(breakEvenRate),
    avgWin: winsArr.length ? round2(grossProfit / winsArr.length) : null,
    avgLoss: lossesArr.length ? round2(grossLoss / lossesArr.length) : null,
    largestWin: winsArr.length ? round2(Math.max(...winsArr.map((t) => t.netProfit))) : 0,
    largestLoss: lossesArr.length ? round2(Math.min(...lossesArr.map((t) => t.netProfit))) : 0,
    expectancy: round2(expectancy),
    expectancyR: expectancyR !== null ? round2(expectancyR) : null,
    profitFactor: pf === null ? null : round2(pf),
    recoveryFactor: recoveryFactor !== null ? round2(recoveryFactor) : null,
    avgHoldMinutes: Math.round(avgHoldMinutes),
    maxConsecWins: streak.maxW,
    maxConsecLosses: streak.maxL,
    avgR: rVals.length ? round2(mean(rVals)) : null,
    rCoverage: round1(rCoverage),
    rValidCount: closedWithValidR.length,
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    totalVolume: round2(sum(closed.map((t) => t.volume))),
    totalCommission: round2(sum(closed.map((t) => t.commission))),
    totalSwap: round2(sum(closed.map((t) => t.swap))),
    avgPips: pipsVals.length ? round1(mean(pipsVals)) : null,
    rHistogram,
    holdingBuckets,
  }

  // ── Daily / monthly / calendar ──
  const dailyMap = new Map<string, { pnl: number; trades: number; wins: number }>()
  for (const t of closed) {
    const k = dateKeyIn(tz, t.closeTime!)
    const e = dailyMap.get(k) ?? { pnl: 0, trades: 0, wins: 0 }
    e.pnl += t.netProfit
    e.trades += 1
    if (t.netProfit > 0) e.wins += 1
    dailyMap.set(k, e)
  }
  const dailyPnl: DailyPnl[] = [...dailyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, e]) => ({ date, pnl: round2(e.pnl), trades: e.trades, wins: e.wins }))
  const calendar: CalendarDay[] = dailyPnl.map((d) => ({ date: d.date, pnl: d.pnl, trades: d.trades }))

  const monthlyMap = new Map<string, { pnl: number; trades: number }>()
  for (const t of closed) {
    const k = dateKeyIn(tz, t.closeTime!).slice(0, 7)
    const e = monthlyMap.get(k) ?? { pnl: 0, trades: 0 }
    e.pnl += t.netProfit
    e.trades += 1
    monthlyMap.set(k, e)
  }
  const monthlyPnl = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, e]) => ({ month, pnl: round2(e.pnl), trades: e.trades }))

  // ── Time analysis (filtered, openTime-based, account timezone) ──
  type HourAcc = HourStat & { wins: number }
  const hourly: HourAcc[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, pnl: 0, trades: 0, winRate: 0, wins: 0 }))
  const dayAgg: { pnl: number; trades: number; wins: number }[] = Array.from({ length: 7 }, () => ({ pnl: 0, trades: 0, wins: 0 }))
  const matrix: MatrixCell[] = []
  const matrixMap = new Map<string, { pnl: number; trades: number }>()
  const sessionAgg = SESSIONS.map(() => ({ pnl: 0, trades: 0, wins: 0 }))

  for (const t of closed) {
    const h = hourIn(tz, t.openTime)
    const wd = weekdayIn(tz, t.openTime)
    const he = hourly[h]
    he.pnl += t.netProfit
    he.trades += 1
    if (t.netProfit > 0) he.wins += 1
    const de = dayAgg[wd]
    de.pnl += t.netProfit
    de.trades += 1
    if (t.netProfit > 0) de.wins += 1
    const mk = `${wd}-${h}`
    const me = matrixMap.get(mk) ?? { pnl: 0, trades: 0 }
    me.pnl += t.netProfit
    me.trades += 1
    matrixMap.set(mk, me)
    sessionAgg.forEach((s, si) => {
      if (inSession(SESSIONS[si], t.openTime)) {
        s.pnl += t.netProfit
        s.trades += 1
        if (t.netProfit > 0) s.wins += 1
      }
    })
  }
  for (let d = 0; d < 7; d++)
    for (let h = 0; h < 24; h++) {
      const cell = matrixMap.get(`${d}-${h}`)
      if (cell) matrix.push({ day: d, hour: h, pnl: round2(cell.pnl), trades: cell.trades })
    }

  const hourStats: HourStat[] = hourly.map((h) => ({
    hour: h.hour,
    pnl: round2(h.pnl),
    trades: h.trades,
    winRate: h.trades ? round1((h.wins / h.trades) * 100) : 0,
  }))
  // Best/worst hours need a minimum statistical sample — hours with fewer
  // than MIN_SAMPLE trades are never highlighted as "best"/"worst".
  const MIN_SAMPLE = 3
  const meaningfulHours = hourStats.filter((h) => h.trades >= MIN_SAMPLE)
  const bestHour = meaningfulHours.length ? meaningfulHours.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null
  const worstHour = meaningfulHours.length ? meaningfulHours.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null

  const dayStats: DayStat[] = dayAgg.map((d, i) => ({
    day: i,
    name: WEEKDAYS_LONG_SATURDAY[i],
    pnl: round2(d.pnl),
    trades: d.trades,
    winRate: d.trades ? round1((d.wins / d.trades) * 100) : 0,
  }))
  const meaningfulDays = dayStats.filter((d) => d.trades >= MIN_SAMPLE)
  const bestDay = meaningfulDays.length ? meaningfulDays.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null
  const worstDay = meaningfulDays.length ? meaningfulDays.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null

  const sessions: SessionStat[] = SESSIONS.map((s, i) => ({
    name: s.name,
    hoursLabel: s.label,
    pnl: round2(sessionAgg[i].pnl),
    trades: sessionAgg[i].trades,
    winRate: sessionAgg[i].trades ? round1((sessionAgg[i].wins / sessionAgg[i].trades) * 100) : 0,
  }))

  const time: TimeAnalysis = {
    hourly: hourStats,
    matrix,
    sessions,
    dayStats,
    bestHour,
    worstHour,
    bestDay,
    worstDay,
    minSample: MIN_SAMPLE,
    timezone: tz,
  }

  // ── Symbol analysis (filtered) ──
  const symbolMap = new Map<string, EngineTrade[]>()
  for (const t of closed) {
    const arr = symbolMap.get(t.symbol) ?? []
    arr.push(t)
    symbolMap.set(t.symbol, arr)
  }
  const symbols: SymbolStat[] = [...symbolMap.entries()]
    .map(([sym, ts]) => {
      const w = ts.filter((t) => t.netProfit > EPS)
      const l = ts.filter((t) => t.netProfit < -EPS)
      const gp = sum(w.map((t) => t.netProfit))
      const gl = Math.abs(sum(l.map((t) => t.netProfit)))
      const rv = ts.map((t) => t.rMultiple).filter((r): r is number => r !== null)
      let cum = 0
      let pk = 0
      let mdd = 0
      for (const t of [...ts].sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime())) {
        cum += t.netProfit
        if (cum > pk) pk = cum
        if (pk - cum > mdd) mdd = pk - cum
      }
      const buys = ts.filter((t) => t.direction === 'BUY')
      const sells = ts.filter((t) => t.direction === 'SELL')
      const holds = ts.map((t) => t.holdingMinutes).filter((v): v is number => v !== null)
      return {
        symbol: sym,
        trades: ts.length,
        winRate: w.length + l.length ? round1((w.length / (w.length + l.length)) * 100) : 0,
        profitFactor: profitFactor(gp, gl) === null ? null : round2(profitFactor(gp, gl)!),
        netPnl: round2(sum(ts.map((t) => t.netProfit))),
        ddPct: round2((mdd / Math.max(input.account.initialBalance, 1)) * 100),
        avgR: rv.length ? round2(mean(rv)) : null,
        buyPnl: round2(sum(buys.map((t) => t.netProfit))),
        sellPnl: round2(sum(sells.map((t) => t.netProfit))),
        buyTrades: buys.length,
        sellTrades: sells.length,
        volume: round2(sum(ts.map((t) => t.volume))),
        avgHoldMinutes: holds.length ? Math.round(mean(holds)) : 0,
      }
    })
    .sort((a, b) => b.netPnl - a.netPnl)

  // ── Direction analysis (filtered) ──
  const directions: DirectionStat[] = (['BUY', 'SELL'] as const).map((dir) => {
    const ts = closed.filter((t) => t.direction === dir)
    const w = ts.filter((t) => t.netProfit > EPS)
    const l = ts.filter((t) => t.netProfit < -EPS)
    const gp = sum(w.map((t) => t.netProfit))
    const gl = Math.abs(sum(l.map((t) => t.netProfit)))
    const rv = ts.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    return {
      direction: dir,
      trades: ts.length,
      winRate: w.length + l.length ? round1((w.length / (w.length + l.length)) * 100) : 0,
      netPnl: round2(sum(ts.map((t) => t.netProfit))),
      profitFactor: profitFactor(gp, gl) === null ? null : round2(profitFactor(gp, gl)!),
      avgWin: w.length ? round2(gp / w.length) : null,
      avgLoss: l.length ? round2(gl / l.length) : null,
      avgR: rv.length ? round2(mean(rv)) : null,
    }
  })

  // ── Risk analysis ──
  const risk: RiskAnalysis = {
    maxDdAbs: round2(maxDdAbs),
    maxDdPct: round2(maxDdPct),
    equityMaxDdAbs,
    equityMaxDdPct,
    ddBasis,
    maxDailyDdAbs: round2(maxDailyDdAbs),
    maxDailyDdPct: round2(maxDailyDdPct),
    dailyDdBasis,
    snapshotCount: windowSnaps.length,
    avgDdPct: ddCount ? round2(ddSum / ddCount) : 0,
    currentDdPct: round2(currentDdPct),
    longestDdDays,
    longestRecoveryDays,
    underwater,
    ddPeriods: ddPeriods.sort((a, b) => b.depthPct - a.depthPct).slice(0, 10),
    currentConsecLosses: streak.curL,
    maxConsecLosses: streak.maxL,
    largestLoss: performance.largestLoss,
    largestWin: performance.largestWin,
    openExposure: [...new Set(open.map((t) => t.symbol))].map((sym) => ({
      symbol: sym,
      volume: round2(sum(open.filter((t) => t.symbol === sym).map((t) => t.volume))),
    })),
  }

  // ── Mistake / emotion analysis (filtered) ──
  const emotionStats = buildTagStats(closed, (t) => (t.emotion ? [t.emotion] : []))
  const mistakeStats: MistakeStatLite[] = buildTagStats(closed, (t) => t.mistakes).map((m) => ({
    mistake: m.tag,
    count: m.count,
    cost: m.pnl,
  }))

  // ── Open positions ──
  const openPositions: OpenPosition[] = open
    .sort((a, b) => b.openTime.getTime() - a.openTime.getTime())
    .map((t) => ({
      id: t.id,
      positionId: t.positionId,
      positionTicket: t.positionTicket !== null ? String(t.positionTicket) : null,
      symbol: t.symbol,
      direction: t.direction,
      volume: t.volume,
      openTime: t.openTime.toISOString(),
      openPrice: t.openPrice,
      stopLoss: t.stopLoss,
      takeProfit: t.takeProfit,
      profit: round2(t.profit),
      swap: round2(t.swap),
      commission: round2(t.commission),
      durationMinutes: Math.max(0, Math.round((now.getTime() - t.openTime.getTime()) / 60000)),
    }))

  // ── Overview ──
  const totalReturnPct = input.account.initialBalance
    ? (totalNetProfitAll / input.account.initialBalance) * 100
    : 0

  return {
    account: { ...input.account, tradeMode: (['REAL', 'DEMO', 'CONTEST'].includes(input.account.tradeMode) ? input.account.tradeMode : 'REAL') as AnalyticsData['account']['tradeMode'] },
    range: {
      key: opts.range,
      from: from ? from.toISOString() : null,
      to: to.toISOString(),
    },
    overview: {
      balance: round2(balance),
      equity: round2(equity),
      floatingPnl: round2(floatingPnl),
      todayPnl: round2(todayPnl),
      totalNetProfit: round2(totalNetProfitAll),
      totalReturnPct: round1(totalReturnPct),
      winRate: round1(winRate),
      profitFactor: pf === null ? null : round2(pf),
      maxDrawdownPct: round2(maxDdPct),
      totalTrades: closed.length,
      openPositionsCount: open.length,
      deposits: round2(deposits),
      withdrawals: round2(withdrawals),
      todayTrades: todayTradesAll.length,
    },
    equityCurve: balanceCurve,
    equitySeries,
    dailyPnl,
    monthlyPnl,
    calendar,
    performance,
    time,
    symbols,
    directions,
    risk,
    mistakeStats,
    emotionStats,
    openPositions,
    meta: {
      generatedAt: now.toISOString(),
      lastSyncAt: input.lastSyncAt ? input.lastSyncAt.toISOString() : null,
      demoMode: input.demoMode,
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function inRange(t: Date, from: Date | null, to: Date): boolean {
  return (!from || t.getTime() >= from.getTime()) && t.getTime() <= to.getTime()
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function computeStreaks(sorted: EngineTrade[]): { maxW: number; maxL: number; curW: number; curL: number } {
  let maxW = 0, maxL = 0, curW = 0, curL = 0
  for (const t of sorted) {
    if (t.netProfit > EPS) {
      curW++
      curL = 0
      maxW = Math.max(maxW, curW)
    } else if (t.netProfit < -EPS) {
      curL++
      curW = 0
      maxL = Math.max(maxL, curL)
    }
  }
  return { maxW, maxL, curW, curL }
}

function buildRHistogram(closed: EngineTrade[]): RHistogramBucket[] {
  const defs: { label: string; test: (r: number) => boolean }[] = [
    { label: '≤ -2R', test: (r) => r <= -2 },
    { label: '-2R..-1R', test: (r) => r > -2 && r <= -1 },
    { label: '-1R..0', test: (r) => r > -1 && r < 0 },
    { label: '0..+1R', test: (r) => r >= 0 && r < 1 },
    { label: '+1R..+2R', test: (r) => r >= 1 && r < 2 },
    { label: '+2R..+3R', test: (r) => r >= 2 && r < 3 },
    { label: '> +3R', test: (r) => r >= 3 },
  ]
  // Only trades with a VALID R (a real initial risk) enter the histogram —
  // trades without one are counted in rCoverage instead of being faked to 0R.
  const withR = closed.filter((t) => t.rMultiple !== null && isFinite(t.rMultiple))
  return defs.map((d) => {
    const ts = withR.filter((t) => d.test(t.rMultiple!))
    return { bucket: d.label, count: ts.length, pnl: round2(sum(ts.map((t) => t.netProfit))) }
  })
}

function buildHoldingBuckets(closed: EngineTrade[]): HoldingBucket[] {
  const defs: { label: string; test: (m: number) => boolean }[] = [
    { label: '< 15m', test: (m) => m < 15 },
    { label: '15–60m', test: (m) => m >= 15 && m < 60 },
    { label: '1–4h', test: (m) => m >= 60 && m < 240 },
    { label: '4–12h', test: (m) => m >= 240 && m < 720 },
    { label: '> 12h', test: (m) => m >= 720 },
  ]
  const withH = closed.filter((t) => t.holdingMinutes !== null)
  return defs.map((d) => {
    const ts = withH.filter((t) => d.test(t.holdingMinutes!))
    return { bucket: d.label, count: ts.length, pnl: round2(sum(ts.map((t) => t.netProfit))) }
  })
}

function buildTagStats(closed: EngineTrade[], pick: (t: EngineTrade) => string[]): { tag: string; count: number; pnl: number; winRate: number }[] {
  const map = new Map<string, { count: number; pnl: number; wins: number }>()
  for (const t of closed) {
    for (const tag of pick(t)) {
      const e = map.get(tag) ?? { count: 0, pnl: 0, wins: 0 }
      e.count++
      e.pnl += t.netProfit
      if (t.netProfit > 0) e.wins++
      map.set(tag, e)
    }
  }
  return [...map.entries()]
    .map(([tag, e]) => ({ tag, count: e.count, pnl: round2(e.pnl), winRate: round1((e.wins / e.count) * 100) }))
    .sort((a, b) => b.count - a.count)
}
