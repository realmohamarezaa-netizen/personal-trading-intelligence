// ─── Demo data generator — 6 months of realistic trading history ────────────
// Deterministic (seeded RNG) so re-seeding produces a stable dataset.

import { db } from './db'
import { tehranWeekday } from './analytics'

// Seeded RNG (mulberry32)
function makeRng(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T,>(rng: () => number, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]
const rand = (rng: () => number, min: number, max: number) => min + rng() * (max - min)
const randInt = (rng: () => number, min: number, max: number) => Math.floor(rand(rng, min, max + 1))
const chance = (rng: () => number, p: number) => rng() < p

const STRATEGY_DEFS = [
  { name: 'London Breakout', description: 'Breakout of the Asian range during London open', weight: 0.33, winRate: 0.62, hours: [9, 10, 11, 12], hold: [40, 260] },
  { name: 'Trend Pullback', description: 'Pullback entries in the direction of H4 trend', weight: 0.28, winRate: 0.58, hours: [10, 11, 12, 13, 14, 15, 16, 17], hold: [90, 700] },
  { name: 'NY Reversal', description: 'Reversal setups at New York open', weight: 0.23, winRate: 0.47, hours: [16, 17, 18, 19, 20], hold: [25, 160] },
  { name: 'Asian Range Fade', description: 'Fading the range during the Asian session', weight: 0.16, winRate: 0.38, hours: [2, 3, 4, 5, 6], hold: [240, 1100] },
] as const

const SYMBOLS: Record<string, { base: number; vol: number; perLotRisk: number; pipFactor: number; drift: number }> = {
  EURUSD: { base: 1.0850, vol: 0.0035, perLotRisk: 380, pipFactor: 10000, drift: -0.01 },
  GBPUSD: { base: 1.2700, vol: 0.0045, perLotRisk: 400, pipFactor: 10000, drift: 0.02 },
  USDJPY: { base: 151.50, vol: 0.70, perLotRisk: 360, pipFactor: 100, drift: 0.05 },
  XAUUSD: { base: 2320, vol: 28, perLotRisk: 900, pipFactor: 10, drift: 0.09 },
  US30: { base: 39200, vol: 320, perLotRisk: 550, pipFactor: 1, drift: 0.06 },
  BTCUSD: { base: 63500, vol: 1800, perLotRisk: 1400, pipFactor: 1, drift: 0.12 },
}

const SYMBOL_POOL: Record<string, [string, number][]> = {
  'London Breakout': [['EURUSD', 38], ['GBPUSD', 24], ['XAUUSD', 22], ['USDJPY', 16]],
  'Trend Pullback': [['XAUUSD', 30], ['US30', 24], ['EURUSD', 24], ['BTCUSD', 22]],
  'NY Reversal': [['EURUSD', 30], ['GBPUSD', 30], ['USDJPY', 20], ['XAUUSD', 20]],
  'Asian Range Fade': [['USDJPY', 35], ['EURUSD', 30], ['XAUUSD', 20], ['BTCUSD', 15]],
}

const SYMBOL_EDGE: Record<string, number> = {
  EURUSD: 0.02,
  GBPUSD: -0.07,
  USDJPY: 0,
  XAUUSD: 0.08,
  US30: 0.03,
  BTCUSD: -0.04,
}

const PERSIAN_NOTES = [
  'ستاپ کاملاً مطابق پلن بود؛ شکست سقف رنج آسیایی با تاییدیه. خروج روی تارگت دوم.',
  'ورود زودتر از تریگر انجام شد، اشتباه بود ولی خوش شانس بودم که سردرم نیامد.',
  'بعد از دو ضرر متوالی وسوسه شدم حجم را بالا ببرم که نکردم؛ پلن را رعایت کردم.',
  'خبر NFP بود، حجم را نصف کردم و فقط جهت تیکتی معامله کردم.',
  'استاپ را خیلی زود به سربه‌سر بردام و بازار دوباره به تارگت رسید. اشتباه واضح.',
  'به ستاپ پایبند بودم ولی بازار به دلیل خبر ژئوپلیتیک برعکس شد؛ ضرر قابل قبول.',
  'این معامله خارج از چک‌لیست من بود، صرفاً هیجان ورود شدم.',
  'پولبک به سفارش‌블اک هفتگی، نسبت ریسک به ریوارد ۱ به ۳. اجرای تمیز.',
  'حجم بزرگ‌تر از پلن چون از ست قبلی مطمئن بودم — نقض قانون مدیریت سرمایه.',
  'خروج زودهنگام قبل از رسیدن به تارگت؛ باید به پلن خروج پایبند می‌ماندم.',
  'شروع سشن لندن نوسان خوبی داشت، ستاپ کلاسیک خودم بود.',
  'تلاش برای جبران ضرر روز قبل؛ کاملاً احساسی معامله کردم.',
]

const WIN_TAGS = ['Perfect Setup', 'A+ Setup', 'Partial Exit', 'Scaled In']
const NEUTRAL_TAGS = ['Early Entry', 'Late Entry', 'News Trade']
const BAD_TAGS = ['FOMO', 'Revenge Trade', 'Rule Violation', 'Moved SL', 'Late Entry']

/** Tehran wall-clock → UTC Date */
function tehranToUtc(dateKey: string, hour: number, minute: number): Date {
  const [y, m, d] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hour - 3, minute - 30))
}

function dateKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pickWeighted(rng: () => number, entries: readonly [string, number][]): string {
  const total = entries.reduce((a, [, w]) => a + w, 0)
  let r = rng() * total
  for (const [k, w] of entries) {
    r -= w
    if (r <= 0) return k
  }
  return entries[entries.length - 1][0]
}

export interface ReseedResult {
  account: string
  trades: number
  open: number
  cashflows: number
  days: number
}

export async function reseedDemo(): Promise<ReseedResult> {
  const rng = makeRng(20240715)
  const now = new Date()

  await db.syncLog.deleteMany()
  await db.equitySnapshot.deleteMany()
  await db.cashFlow.deleteMany()
  await db.trade.deleteMany()
  await db.account.deleteMany()

  const account = await db.account.create({
    data: {
      id: 'demo',
      name: 'MT5 Main Account',
      broker: 'Alpari International',
      server: 'Alpari-MT5-Demo',
      mt5Login: '51234567',
      currency: 'USD',
      leverage: 100,
      initialBalance: 10000,
    },
  })

  // ── Generate history ──
  interface DraftTrade {
    positionId: number
    symbol: string
    direction: 'BUY' | 'SELL'
    volume: number
    openTime: Date
    closeTime: Date
    openPrice: number
    closePrice: number
    stopLoss: number | null
    takeProfit: number | null
    commission: number
    swap: number
    profit: number
    netProfit: number
    pips: number | null
    rMultiple: number
    holdingMinutes: number
    mistakes: string[]
    emotion: string
    notes: string | null
  }

  const drafts: DraftTrade[] = []
  let balance = 10000
  let positionId = 5000001
  let consecutiveLosses = 0

  const start = new Date(now.getTime() - 185 * 864e5)

  for (let day = 0; day <= 185; day++) {
    const dayDate = new Date(start.getTime() + day * 864e5)
    const key = dateKeyOf(dayDate)
    const wd = tehranWeekday(dayDate)
    if (wd === 6 || wd === 0) continue // Friday / Saturday weekend (Tehran)

    const nTrades = chance(rng, 0.12) ? 0 : chance(rng, 0.35) ? 1 : chance(rng, 0.6) ? 2 : chance(rng, 0.75) ? 3 : chance(rng, 0.9) ? 4 : 5

    for (let i = 0; i < nTrades; i++) {
      const strat = pickWeighted(rng, STRATEGY_DEFS.map((s) => [s.name, Math.round(s.weight * 100)] as [string, number]))
      const def = STRATEGY_DEFS.find((s) => s.name === strat)!
      const symbol = pickWeighted(rng, SYMBOL_POOL[strat])
      const meta = SYMBOLS[symbol]

      // Behavior: tilt after consecutive losses
      const tilted = consecutiveLosses >= 3 || (consecutiveLosses >= 2 && chance(rng, 0.45))
      let riskPct = tilted ? rand(rng, 1.2, 2.2) : rand(rng, 0.55, 1.1)
      const isViolation = chance(rng, 0.035)
      if (isViolation) riskPct = rand(rng, 2.2, 3.4)

      const riskAmount = (balance * riskPct) / 100
      const winProb = Math.min(0.85, Math.max(0.2, def.winRate + SYMBOL_EDGE[symbol] + (tilted ? -0.08 : 0)))
      const isWin = chance(rng, winProb)
      const isBe = !isWin && chance(rng, 0.04)

      let rMultiple: number
      if (isBe) {
        rMultiple = rand(rng, -0.05, 0.05)
      } else if (isWin) {
        rMultiple = chance(rng, 0.08) ? rand(rng, 2.4, 4.2) : 0.3 + Math.pow(rng(), 1.6) * 2.1
      } else {
        rMultiple = chance(rng, 0.16) ? rand(rng, -0.55, -0.3) : -rand(rng, 0.82, 1.18)
      }

      const profit = rMultiple * riskAmount
      const volume = Math.max(0.01, Math.round((riskAmount / meta.perLotRisk) * 100) / 100)
      const commission = -(volume * rand(rng, 5.5, 7.5))

      const holdingMinutes = randInt(rng, def.hold[0], def.hold[1])
      const hour = tilted ? pick(rng, [13, 14, 17, 18, 20, 21]) : pick(rng, def.hours)
      const minute = randInt(rng, 0, 59)
      const openTime = tehranToUtc(key, hour, minute)
      if (openTime.getTime() > now.getTime() - 3 * 864e5) continue
      const closeTime = new Date(openTime.getTime() + holdingMinutes * 60000)
      if (closeTime.getTime() > now.getTime()) continue

      const swap = holdingMinutes > 300 ? rand(rng, -4, 1.5) : rand(rng, -0.6, 0.2)
      const netProfit = profit + commission + swap

      // Prices
      const progress = day / 185
      const mid = meta.base * (1 + meta.drift * progress)
      const noise = 1 + rand(rng, -meta.vol / 4, meta.vol / 4) / meta.base * 4
      const openPrice = roundPrice(symbol, mid * noise)
      const move = (meta.vol / 3) * (rMultiple > 0 ? 1 : -1) * (0.5 + Math.abs(rMultiple) / 3)
      const closePrice = roundPrice(symbol, openPrice * (1 + (rMultiple > 0 ? Math.abs(move) : -Math.abs(move))))

      const direction: 'BUY' | 'SELL' = chance(rng, 0.56) ? 'BUY' : 'SELL'
      const slDistance = openPrice * rand(rng, 0.002, 0.006)
      const stopLoss = direction === 'BUY' ? openPrice - slDistance : openPrice + slDistance
      const takeProfit = direction === 'BUY' ? openPrice + slDistance * 2 : openPrice - slDistance * 2
      const pips = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'].includes(symbol)
        ? Math.round(((closePrice - openPrice) * meta.pipFactor * (direction === 'BUY' ? 1 : -1)) * 10) / 10
        : null

      // Mistakes / emotion (journal-only fields — trade facts come from MT5)
      const mistakes: string[] = []
      let emotion: string
      if (isWin && netProfit > 0) {
        emotion = tilted ? pick(rng, ['Relieved' as string, 'Confident']) : pick(rng, ['Calm', 'Confident', 'Focused'])
      } else if (isBe) {
        emotion = pick(rng, ['Calm', 'Focused'])
      } else {
        if (tilted) {
          mistakes.push(pick(rng, ['Chased Price', 'Ignored Setup Rules', 'Oversized Position']))
          emotion = pick(rng, ['Impatient', 'Anxious', 'Tilted'])
        } else {
          if (chance(rng, 0.18)) mistakes.push(pick(rng, ['Moved SL to BE too early', 'Closed Too Early', 'Held Past SL mentally']))
          emotion = pick(rng, ['Calm', 'Focused', 'Anxious', 'Impatient'])
        }
      }
      if (isViolation) {
        if (!mistakes.includes('Oversized Position')) mistakes.push('Oversized Position')
      }

      const notes = chance(rng, 0.28) ? pick(rng, PERSIAN_NOTES) : null

      drafts.push({
        positionId: positionId++,
        symbol,
        direction,
        volume,
        openTime,
        closeTime,
        openPrice,
        closePrice,
        stopLoss: Math.round(stopLoss * 100000) / 100000,
        takeProfit: Math.round(takeProfit * 100000) / 100000,
        commission: round2(commission),
        swap: round2(swap),
        profit: round2(profit),
        netProfit: round2(netProfit),
        pips,
        rMultiple: round2(rMultiple),
        holdingMinutes,
        mistakes,
        emotion,
        notes,
      })

      balance += netProfit
      if (netProfit < -0.0001) consecutiveLosses++
      else if (netProfit > 0.0001) consecutiveLosses = 0
    }
  }

  // ── Cashflows (kept separate from trading profit) ──
  const midT = drafts[Math.floor(drafts.length * 0.55)]?.closeTime ?? now
  const lateT = drafts[Math.floor(drafts.length * 0.82)]?.closeTime ?? now
  const cashflows = [
    { accountId: account.id, ts: new Date(start.getTime() + 2 * 864e5), type: 'DEPOSIT', amount: 10000, comment: 'Initial deposit' },
    { accountId: account.id, ts: midT, type: 'DEPOSIT', amount: 2000, comment: 'Top-up' },
    { accountId: account.id, ts: lateT, type: 'WITHDRAWAL', amount: 800, comment: 'Partial profit withdrawal' },
  ]

  // ── Open positions (live-ish) ──
  const openDefs: { symbol: string; direction: 'BUY' | 'SELL'; hoursAgo: number; profit: number }[] = [
    { symbol: 'XAUUSD', direction: 'BUY', hoursAgo: 5, profit: 142.5 },
    { symbol: 'EURUSD', direction: 'SELL', hoursAgo: 11, profit: -63.2 },
    { symbol: 'GBPUSD', direction: 'BUY', hoursAgo: 26, profit: 88.4 },
    { symbol: 'US30', direction: 'BUY', hoursAgo: 33, profit: 210.0 },
    { symbol: 'BTCUSD', direction: 'SELL', hoursAgo: 8, profit: -118.75 },
  ]
  const openTrades = openDefs.map((o, idx) => {
    const meta = SYMBOLS[o.symbol]
    const openTime = new Date(now.getTime() - o.hoursAgo * 3600e3)
    const openPrice = roundPrice(o.symbol, meta.base * (1 + rand(rng, -0.004, 0.004)))
    const slDistance = openPrice * rand(rng, 0.002, 0.005)
    const volume = Math.max(0.01, Math.round(rand(rng, 0.15, 0.9) * 100) / 100)
    const commission = -(volume * 6.5)
    return {
      positionId: positionId++,
      accountId: account.id,
      symbol: o.symbol,
      direction: o.direction,
      volume,
      openTime,
      closeTime: null as Date | null,
      openPrice,
      closePrice: null as number | null,
      stopLoss: o.direction === 'BUY' ? openPrice - slDistance : openPrice + slDistance,
      takeProfit: o.direction === 'BUY' ? openPrice + slDistance * 2.2 : openPrice - slDistance * 2.2,
      commission: round2(commission),
      swap: round2(rand(rng, -2.5, 0.5)),
      profit: o.profit,
      netProfit: o.profit,
      pips: null as number | null,
      rMultiple: null as number | null,
      holdingMinutes: null as number | null,
      status: 'OPEN',
      mistakes: JSON.stringify([]),
      emotion: idx === 4 ? 'Impatient' : 'Calm',
      notes: null as string | null,
    }
  })

  // ── Persist ──
  await db.cashFlow.createMany({ data: cashflows })
  await db.trade.createMany({
    data: drafts.map((d) => ({
      positionId: d.positionId,
      accountId: account.id,
      symbol: d.symbol,
      direction: d.direction,
      volume: d.volume,
      openTime: d.openTime,
      closeTime: d.closeTime,
      openPrice: d.openPrice,
      closePrice: d.closePrice,
      stopLoss: d.stopLoss,
      takeProfit: d.takeProfit,
      commission: d.commission,
      swap: d.swap,
      profit: d.profit,
      netProfit: d.netProfit,
      pips: d.pips,
      rMultiple: d.rMultiple,
      holdingMinutes: d.holdingMinutes,
      status: 'CLOSED',
      mistakes: JSON.stringify(d.mistakes),
      emotion: d.emotion,
      notes: d.notes,
    })),
  })
  await db.trade.createMany({ data: openTrades })

  return {
    account: account.name,
    trades: drafts.length,
    open: openTrades.length,
    cashflows: cashflows.length,
    days: 186,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function roundPrice(symbol: string, p: number): number {
  const digits = symbol === 'EURUSD' || symbol === 'GBPUSD' ? 5 : symbol === 'USDJPY' ? 3 : symbol === 'XAUUSD' ? 2 : 1
  const f = Math.pow(10, digits)
  return Math.round(p * f) / f
}
