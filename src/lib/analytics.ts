// ─── Personal Trading Intelligence — Analytics Engine ────────────────────────
// Pure computation layer, fully decoupled from UI and database.
// All time bucketing uses Asia/Tehran (UTC+3:30, no DST since 2022).

import type {
  AlertItem,
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

// ─── Tehran time helpers ─────────────────────────────────────────────────────

const hourFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  hour12: false,
  hour: '2-digit',
})
const dayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})
const weekdayFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran',
  weekday: 'short',
})

export const TEHRAN_DAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']
export const TEHRAN_DAYS_LONG = [
  'Saturday',
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
]

/** Tehran local hour 0-23 */
export function tehranHour(d: Date): number {
  return parseInt(hourFmt.format(d), 10) % 24
}
/** YYYY-MM-DD in Tehran */
export function tehranDateKey(d: Date): string {
  return dayFmt.format(d)
}
/** 0 = Saturday ... 6 = Friday (Tehran week) */
export function tehranWeekday(d: Date): number {
  const w = weekdayFmt.format(d).slice(0, 3)
  const idx = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'].indexOf(w)
  return idx >= 0 ? idx : 6
}

// Approximate trading sessions in Tehran local hours
const SESSIONS: { name: string; hours: number[]; label: string }[] = [
  { name: 'Sydney', hours: [23, 0, 1, 2, 3, 4, 5], label: '23:00 – 06:00' },
  { name: 'Tokyo', hours: [3, 4, 5, 6, 7, 8, 9], label: '03:00 – 10:00' },
  { name: 'London', hours: [9, 10, 11, 12, 13, 14, 15, 16, 17], label: '09:00 – 18:00' },
  { name: 'New York', hours: [16, 17, 18, 19, 20, 21, 22], label: '16:00 – 23:00' },
]

// ─── Engine input types (plain rows) ─────────────────────────────────────────

export interface EngineTrade {
  id: string
  positionId: number
  symbol: string
  direction: 'BUY' | 'SELL'
  volume: number
  openTime: Date
  closeTime: Date | null
  openPrice: number
  closePrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  commission: number
  swap: number
  profit: number
  netProfit: number
  pips: number | null
  rMultiple: number | null
  holdingMinutes: number | null
  status: string
  mistakes: string[]
  emotion: string | null
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
  }
  trades: EngineTrade[]
  cashflows: { ts: Date; type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number }[]
  lastSyncAt: Date | null
  demoMode: boolean
}

export interface EngineOptions {
  range: RangeKey
  symbol?: string
}

// ─── Small utils ─────────────────────────────────────────────────────────────

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0)

function profitFactor(gp: number, gl: number): number {
  if (gl <= 0.0001) return gp > 0 ? 99.99 : 0
  return gp / gl
}

function safeDiv(a: number, b: number): number | null {
  return b === 0 ? null : a / b
}

const RANGE_MS: Record<Exclude<RangeKey, 'all'>, number> = {
  '7d': 7 * 864e5,
  '30d': 30 * 864e5,
  '90d': 90 * 864e5,
  '180d': 180 * 864e5,
}

function inRange(t: Date, from: Date | null): boolean {
  return !from || t.getTime() >= from.getTime()
}

// ─── Core engine ─────────────────────────────────────────────────────────────

export function computeAnalytics(
  input: EngineInput,
  opts: EngineOptions
): AnalyticsData {
  const now = new Date()
  const from: Date | null =
    opts.range === 'all' ? null : new Date(now.getTime() - RANGE_MS[opts.range])

  const allClosed = input.trades
    .filter((t) => t.status === 'CLOSED' && t.closeTime)
    .sort((a, b) => a.closeTime!.getTime() - b.closeTime!.getTime())
  const allOpen = input.trades.filter((t) => t.status === 'OPEN')

  const matches = (t: EngineTrade): boolean =>
    !opts.symbol || t.symbol === opts.symbol

  const closed = allClosed.filter(
    (t) => matches(t) && inRange(t.closeTime!, from)
  )
  const open = allOpen.filter(matches)

  // ── Account-level money (unfiltered) ──
  const deposits = sum(input.cashflows.filter((c) => c.type === 'DEPOSIT').map((c) => c.amount))
  const withdrawals = sum(input.cashflows.filter((c) => c.type === 'WITHDRAWAL').map((c) => c.amount))
  const totalNetProfitAll = sum(allClosed.map((t) => t.netProfit))
  const balance = input.account.initialBalance + deposits - withdrawals + totalNetProfitAll
  const floatingPnl = sum(open.map((t) => t.profit + t.swap))
  const equity = balance + floatingPnl

  const todayKey = tehranDateKey(now)
  const todayTradesAll = allClosed.filter((t) => tehranDateKey(t.closeTime!) === todayKey)
  const todayPnl = sum(todayTradesAll.map((t) => t.netProfit))

  // ── Equity curve & drawdown (account-level, range-scoped) ──
  interface Ev { ts: number; delta: number }
  const events: Ev[] = [
    ...allClosed.map((t) => ({ ts: t.closeTime!.getTime(), delta: t.netProfit })),
    ...input.cashflows.map((c) => ({
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

  const equityCurve: EquityPoint[] = []
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
    equityCurve.push({
      t: new Date(t).toISOString(),
      balance: round2(bal),
      equity: round2(bal),
      ddAbs: round2(ddAbs),
      ddPct: round2(ddPct),
    })
  }

  pushPoint(startT, running)
  for (let i = startIndex; i < events.length; i++) {
    running += events[i].delta
    pushPoint(events[i].ts, running)
  }

  const underwater: UnderwaterPoint[] = equityCurve
    .filter((_, i) => equityCurve.length <= 700 || i % Math.ceil(equityCurve.length / 700) === 0)
    .map((p) => ({ t: p.t, pct: -p.ddPct }))

  // Drawdown periods
  const ddPeriods: DDPeriod[] = []
  let cur: { startT: number; depthPct: number; depthAbs: number; troughT: number } | null = null
  for (const p of equityCurve) {
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
      days: round1((now.getTime() - cur.startT) / 864e5),
      recovered: false,
    })
  }
  const longestDdDays = ddPeriods.length ? Math.max(...ddPeriods.map((p) => p.days)) : 0
  const longestRecoveryDays =
    ddPeriods.filter((p) => p.recovered).length
      ? Math.max(...ddPeriods.filter((p) => p.recovered).map((p) => p.days))
      : null
  const currentDdPct = equityCurve.length ? equityCurve[equityCurve.length - 1].ddPct : 0

  // Daily drawdown (account-level, all history)
  let maxDailyDdAbs = 0
  let maxDailyDdPct = 0
  {
    let dayKey = ''
    let dayStart = 0
    let dayMin = Infinity
    let bal = input.account.initialBalance
    const cfSorted = [...input.cashflows].sort((a, b) => a.ts.getTime() - b.ts.getTime())
    let ci = 0
    for (const t of allClosed) {
      while (ci < cfSorted.length && cfSorted[ci].ts.getTime() <= t.closeTime!.getTime()) {
        const c = cfSorted[ci++]
        bal += c.type === 'DEPOSIT' ? c.amount : -c.amount
      }
      const k = tehranDateKey(t.closeTime!)
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

  // ── Performance stats (filtered) ──
  const nets = closed.map((t) => t.netProfit)
  const winsArr = closed.filter((t) => t.netProfit > 0.0001)
  const lossesArr = closed.filter((t) => t.netProfit < -0.0001)
  const beArr = closed.filter((t) => Math.abs(t.netProfit) <= 0.0001)
  const grossProfit = sum(winsArr.map((t) => t.netProfit))
  const grossLoss = Math.abs(sum(lossesArr.map((t) => t.netProfit)))
  const winRate = winsArr.length + lossesArr.length ? (winsArr.length / (winsArr.length + lossesArr.length)) * 100 : 0
  const avgWin = winsArr.length ? grossProfit / winsArr.length : 0
  const avgLoss = lossesArr.length ? grossLoss / lossesArr.length : 0
  const lossRate = winsArr.length + lossesArr.length ? lossesArr.length / (winsArr.length + lossesArr.length) : 0
  const expectancy = winRate / 100 * avgWin - lossRate * avgLoss
  const rVals = closed.map((t) => t.rMultiple).filter((r): r is number => r !== null && isFinite(r))
  const expectancyR = rVals.length ? mean(rVals) : null
  const holdVals = closed.map((t) => t.holdingMinutes).filter((v): v is number => v !== null)
  const avgHoldMinutes = holdVals.length ? mean(holdVals) : 0
  const pipsVals = closed.map((t) => t.pips).filter((v): v is number => v !== null)
  const pf = profitFactor(grossProfit, grossLoss)
  const maxDdForRecovery = maxDdAbs || 1
  const recoveryFactor = closed.length ? totalNetProfitAll / maxDdForRecovery : null

  const streak = computeStreaks(closed)

  const rHistogram = buildRHistogram(closed)
  const holdingBuckets = buildHoldingBuckets(closed)

  const performance: PerformanceStats = {
    totalTrades: closed.length,
    wins: winsArr.length,
    losses: lossesArr.length,
    breakEven: beArr.length,
    winRate: round1(winRate),
    avgWin: round2(avgWin),
    avgLoss: round2(avgLoss),
    largestWin: winsArr.length ? round2(Math.max(...winsArr.map((t) => t.netProfit))) : 0,
    largestLoss: lossesArr.length ? round2(Math.min(...lossesArr.map((t) => t.netProfit))) : 0,
    expectancy: round2(expectancy),
    expectancyR: expectancyR !== null ? round2(expectancyR) : null,
    profitFactor: round2(pf),
    recoveryFactor: recoveryFactor !== null ? round2(recoveryFactor) : null,
    avgHoldMinutes: Math.round(avgHoldMinutes),
    maxConsecWins: streak.maxW,
    maxConsecLosses: streak.maxL,
    avgR: rVals.length ? round2(mean(rVals)) : null,
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
    const k = tehranDateKey(t.closeTime!)
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
    const k = tehranDateKey(t.closeTime!).slice(0, 7)
    const e = monthlyMap.get(k) ?? { pnl: 0, trades: 0 }
    e.pnl += t.netProfit
    e.trades += 1
    monthlyMap.set(k, e)
  }
  const monthlyPnl = [...monthlyMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, e]) => ({ month, pnl: round2(e.pnl), trades: e.trades }))

  // ── Time analysis (filtered, openTime-based) ──
  type HourAcc = HourStat & { wins: number }
  const hourly: HourAcc[] = Array.from({ length: 24 }, (_, h) => ({ hour: h, pnl: 0, trades: 0, winRate: 0, wins: 0 }))
  const dayAgg: { pnl: number; trades: number; wins: number }[] = Array.from({ length: 7 }, () => ({ pnl: 0, trades: 0, wins: 0 }))
  const matrix: MatrixCell[] = []
  const matrixMap = new Map<string, { pnl: number; trades: number }>()
  const sessionAgg = SESSIONS.map(() => ({ pnl: 0, trades: number0(), wins: 0 }))

  for (const t of closed) {
    const h = tehranHour(t.openTime)
    const wd = tehranWeekday(t.openTime)
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
      if (SESSIONS[si].hours.includes(h)) {
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
  const meaningfulHours = hourStats.filter((h) => h.trades >= 3)
  const bestHour = meaningfulHours.length ? meaningfulHours.reduce((a, b) => (b.pnl > a.pnl ? b : a)) : null
  const worstHour = meaningfulHours.length ? meaningfulHours.reduce((a, b) => (b.pnl < a.pnl ? b : a)) : null

  const dayStats: DayStat[] = dayAgg.map((d, i) => ({
    day: i,
    name: TEHRAN_DAYS_LONG[i],
    pnl: round2(d.pnl),
    trades: d.trades,
    winRate: d.trades ? round1((d.wins / d.trades) * 100) : 0,
  }))
  const meaningfulDays = dayStats.filter((d) => d.trades >= 3)
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
      const w = ts.filter((t) => t.netProfit > 0.0001)
      const l = ts.filter((t) => t.netProfit < -0.0001)
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
        profitFactor: round2(profitFactor(gp, gl)),
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
    const w = ts.filter((t) => t.netProfit > 0.0001)
    const l = ts.filter((t) => t.netProfit < -0.0001)
    const gp = sum(w.map((t) => t.netProfit))
    const gl = Math.abs(sum(l.map((t) => t.netProfit)))
    const rv = ts.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    return {
      direction: dir,
      trades: ts.length,
      winRate: w.length + l.length ? round1((w.length / (w.length + l.length)) * 100) : 0,
      netPnl: round2(sum(ts.map((t) => t.netProfit))),
      profitFactor: round2(profitFactor(gp, gl)),
      avgWin: w.length ? round2(gp / w.length) : 0,
      avgLoss: l.length ? round2(gl / l.length) : 0,
      avgR: rv.length ? round2(mean(rv)) : null,
    }
  })

  // ── Risk analysis ──
  const risk: RiskAnalysis = {
    maxDdAbs: round2(maxDdAbs),
    maxDdPct: round2(maxDdPct),
    maxDailyDdAbs: round2(maxDailyDdAbs),
    maxDailyDdPct: round2(maxDailyDdPct),
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

  // ── Alerts (always recent / account-level) ──
  const last14 = allClosed.filter((t) => now.getTime() - t.closeTime!.getTime() <= 14 * 864e5)
  const last7 = allClosed.filter((t) => now.getTime() - t.closeTime!.getTime() <= 7 * 864e5)
  const alerts = buildAlerts({
    input,
    allClosed,
    last14,
    last7,
    dailyPnl: dailyPnl,
    worstHourFull: pickWorstHour(allClosed),
    sellStat: directions.find((d) => d.direction === 'SELL')!,
    currentDdPct,
    curL: streak.curL,
    curW: streak.curW,
    lastSyncAt: input.lastSyncAt,
    now,
  })

  // ── Overview ──
  const totalReturnPct = input.account.initialBalance
    ? (totalNetProfitAll / input.account.initialBalance) * 100
    : 0

  return {
    account: input.account,
    range: {
      key: opts.range,
      from: from ? from.toISOString() : null,
      to: now.toISOString(),
    },
    overview: {
      balance: round2(balance),
      equity: round2(equity),
      floatingPnl: round2(floatingPnl),
      todayPnl: round2(todayPnl),
      totalNetProfit: round2(totalNetProfitAll),
      totalReturnPct: round1(totalReturnPct),
      winRate: round1(winRate),
      profitFactor: round2(pf),
      maxDrawdownPct: round2(maxDdPct),
      totalTrades: closed.length,
      openPositionsCount: open.length,
      deposits: round2(deposits),
      withdrawals: round2(withdrawals),
      todayTrades: todayTradesAll.length,
    },
    equityCurve,
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
    alerts,
    meta: {
      generatedAt: now.toISOString(),
      lastSyncAt: input.lastSyncAt ? input.lastSyncAt.toISOString() : null,
      demoMode: input.demoMode,
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function number0(): number {
  return 0
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
    if (t.netProfit > 0.0001) {
      curW++
      curL = 0
      maxW = Math.max(maxW, curW)
    } else if (t.netProfit < -0.0001) {
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
  const withR = closed.filter((t) => t.rMultiple !== null)
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

function pickWorstHour(all: EngineTrade[]): HourStat | null {
  const agg = new Map<number, { pnl: number; trades: number; wins: number }>()
  for (const t of all) {
    const h = tehranHour(t.openTime)
    const e = agg.get(h) ?? { pnl: 0, trades: 0, wins: 0 }
    e.pnl += t.netProfit
    e.trades++
    if (t.netProfit > 0) e.wins++
    agg.set(h, e)
  }
  const candidates = [...agg.entries()]
    .filter(([, e]) => e.trades >= 15)
    .map(([hour, e]) => ({ hour, pnl: round2(e.pnl), trades: e.trades, winRate: round1((e.wins / e.trades) * 100) }))
  if (!candidates.length) return null
  return candidates.reduce((a, b) => (b.pnl < a.pnl ? b : a))
}

function buildAlerts(ctx: {
  input: EngineInput
  allClosed: EngineTrade[]
  last14: EngineTrade[]
  last7: EngineTrade[]
  dailyPnl: DailyPnl[]
  worstHourFull: HourStat | null
  sellStat: DirectionStat
  currentDdPct: number
  curL: number
  curW: number
  lastSyncAt: Date | null
  now: Date
}): AlertItem[] {
  const alerts: AlertItem[] = []
  const { input, allClosed, last14, last7, sellStat, currentDdPct, curL, curW, lastSyncAt, now } = ctx
  let seq = 0
  const add = (a: Omit<AlertItem, 'id'>) => alerts.push({ id: `alert-${++seq}`, ...a })

  if (input.demoMode) {
    add({
      severity: 'info',
      title: 'Demo data mode',
      message: 'Dashboard is running on generated sample data. Run the MT5 connector on your Windows machine to sync your real account.',
    })
  }

  if (curL >= 3) {
    add({
      severity: curL >= 5 ? 'critical' : 'warning',
      title: `${curL} consecutive losing trades`,
      message: 'You are in a losing streak. Consider reducing size or pausing until your edge re-confirms.',
      metric: `${curL} losses in a row`,
    })
  }
  if (curW >= 5) {
    add({
      severity: 'success',
      title: `${curW} consecutive wins`,
      message: 'Strong current momentum. Stay disciplined — do not oversize while confident.',
      metric: `${curW} wins in a row`,
    })
  }

  if (currentDdPct >= 4) {
    add({
      severity: currentDdPct >= 8 ? 'critical' : 'warning',
      title: 'Equity drawdown threshold breached',
      message: `Account is ${currentDdPct.toFixed(1)}% below its equity peak. Review open risk exposure.`,
      metric: `-${currentDdPct.toFixed(1)}% DD`,
    })
  }

  const revenge = last14.filter((t) => t.mistakes.includes('Chased Price') || t.mistakes.includes('Held Past SL mentally'))
  if (revenge.length >= 2) {
    const cost = sum(revenge.map((t) => t.netProfit))
    add({
      severity: 'warning',
      title: 'Revenge / FOMO pattern detected',
      message: `${revenge.length} emotionally-driven trades in the last 14 days with a combined P/L of ${cost >= 0 ? '+' : ''}${cost.toFixed(0)} USD.`,
      metric: `${revenge.length} trades`,
    })
  }

  const violations = last14.filter((t) => t.mistakes.includes('Ignored Setup Rules'))
  if (violations.length >= 2) {
    add({
      severity: 'warning',
      title: 'Rule violations increasing',
      message: `${violations.length} rule violations recorded in the last 14 days. Your discipline score is dropping.`,
      metric: `${violations.length} violations`,
    })
  }

  if (ctx.worstHourFull && ctx.worstHourFull.pnl < 0) {
    add({
      severity: 'info',
      title: 'Weak trading hour identified',
      message: `Your trades opened around ${String(ctx.worstHourFull.hour).padStart(2, '0')}:00 Tehran time lost ${Math.abs(ctx.worstHourFull.pnl).toFixed(0)} USD over ${ctx.worstHourFull.trades} trades — statistically your worst hour.`,
      metric: `${String(ctx.worstHourFull.hour).padStart(2, '0')}:00 · ${ctx.worstHourFull.pnl.toFixed(0)} USD`,
    })
  }

  if (sellStat.trades >= 20 && sellStat.profitFactor < 0.9) {
    add({
      severity: 'info',
      title: 'Sell-side underperformance',
      message: `Short trades show a profit factor of ${sellStat.profitFactor.toFixed(2)} across ${sellStat.trades} trades. Consider reviewing your short setups.`,
      metric: `PF ${sellStat.profitFactor.toFixed(2)}`,
    })
  }

  // Overtrading check
  const last7Trades = last7.length
  const priorAvgDaily = (() => {
    const prior = allClosed.filter(
      (t) => now.getTime() - t.closeTime!.getTime() > 7 * 864e5 && now.getTime() - t.closeTime!.getTime() <= 37 * 864e5
    )
    return prior.length / 30
  })()
  if (priorAvgDaily > 0.5 && last7Trades / 7 > priorAvgDaily * 1.6 && last7Trades >= 15) {
    add({
      severity: 'warning',
      title: 'Possible overtrading',
      message: `Your last-7-day trade frequency is ${((last7Trades / 7 / priorAvgDaily) * 100 - 100).toFixed(0)}% above your 30-day baseline.`,
      metric: `${last7Trades} trades / 7d`,
    })
  }

  const bigLossDay = ctx.dailyPnl.find(
    (d) => d.pnl < -0.02 * input.account.initialBalance
  )
  if (bigLossDay) {
    add({
      severity: 'info',
      title: 'Large daily loss on record',
      message: `On ${bigLossDay.date} the account lost ${Math.abs(bigLossDay.pnl).toFixed(0)} USD (${bigLossDay.trades} trades) — more than 2% of initial balance in a single day.`,
      metric: `${bigLossDay.pnl.toFixed(0)} USD`,
    })
  }

  if (lastSyncAt && now.getTime() - lastSyncAt.getTime() > 30 * 60000) {
    add({
      severity: 'warning',
      title: 'MT5 sync is stale',
      message: `Last successful sync was ${Math.round((now.getTime() - lastSyncAt.getTime()) / 60000)} minutes ago. Check the connector on your machine.`,
    })
  }

  const order = { critical: 0, warning: 1, info: 2, success: 3 } as const
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 10)
}
