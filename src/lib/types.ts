// ─── Shared domain types for Personal Trading Intelligence ───────────────────

export type RangeKey = '7d' | '30d' | '90d' | '180d' | 'all'
export type Direction = 'BUY' | 'SELL'

export const RANGE_LABELS: Record<RangeKey, string> = {
  '7d': '7D',
  '30d': '30D',
  '90d': '90D',
  '180d': '6M',
  all: 'All',
}

export interface AccountInfo {
  id: string
  name: string
  broker: string
  server: string
  mt5Login: string | null
  currency: string
  leverage: number
  initialBalance: number
}

export interface OpenPosition {
  id: string
  positionId: number
  symbol: string
  direction: Direction
  volume: number
  openTime: string
  openPrice: number
  stopLoss: number | null
  takeProfit: number | null
  profit: number
  swap: number
  commission: number
  durationMinutes: number
}

export interface EquityPoint {
  t: string // ISO timestamp
  balance: number
  equity: number
  ddAbs: number
  ddPct: number
}

export interface UnderwaterPoint {
  t: string
  pct: number
}

export interface DailyPnl {
  date: string // YYYY-MM-DD (Tehran)
  pnl: number
  trades: number
  wins: number
}

export interface CalendarDay {
  date: string // YYYY-MM-DD (Tehran)
  pnl: number
  trades: number
}

export interface OverviewStats {
  balance: number
  equity: number
  floatingPnl: number
  todayPnl: number
  totalNetProfit: number
  totalReturnPct: number
  winRate: number
  profitFactor: number
  maxDrawdownPct: number
  totalTrades: number
  openPositionsCount: number
  deposits: number
  withdrawals: number
  todayTrades: number
}

export interface RHistogramBucket {
  bucket: string // e.g. "≤-2R", "-2R..-1R", ..., ">+3R"
  count: number
  pnl: number
}

export interface HoldingBucket {
  bucket: string // "<15m", "15-60m", ...
  count: number
  pnl: number
}

export interface PerformanceStats {
  totalTrades: number
  wins: number
  losses: number
  breakEven: number
  winRate: number
  avgWin: number
  avgLoss: number
  largestWin: number
  largestLoss: number
  expectancy: number
  expectancyR: number | null
  profitFactor: number
  recoveryFactor: number | null
  avgHoldMinutes: number
  maxConsecWins: number
  maxConsecLosses: number
  avgR: number | null
  grossProfit: number
  grossLoss: number
  totalVolume: number
  totalCommission: number
  totalSwap: number
  avgPips: number | null
  rHistogram: RHistogramBucket[]
  holdingBuckets: HoldingBucket[]
}

export interface HourStat {
  hour: number // Tehran local hour 0-23
  pnl: number
  trades: number
  winRate: number
}

export interface DayStat {
  day: number // 0=Saturday ... 6=Friday (Tehran week starts Saturday)
  name: string
  pnl: number
  trades: number
  winRate: number
}

export interface SessionStat {
  name: string
  hoursLabel: string
  pnl: number
  trades: number
  winRate: number
}

export interface MatrixCell {
  day: number
  hour: number
  pnl: number
  trades: number
}

export interface TimeAnalysis {
  hourly: HourStat[]
  matrix: MatrixCell[]
  sessions: SessionStat[]
  dayStats: DayStat[]
  bestHour: HourStat | null
  worstHour: HourStat | null
  bestDay: DayStat | null
  worstDay: DayStat | null
}

export interface SymbolStat {
  symbol: string
  trades: number
  winRate: number
  profitFactor: number
  netPnl: number
  ddPct: number
  avgR: number | null
  buyPnl: number
  sellPnl: number
  buyTrades: number
  sellTrades: number
  volume: number
  avgHoldMinutes: number
}

export interface DirectionStat {
  direction: Direction
  trades: number
  winRate: number
  netPnl: number
  profitFactor: number
  avgWin: number
  avgLoss: number
  avgR: number | null
}

export interface DDPeriod {
  start: string
  end: string | null
  depthPct: number
  depthAbs: number
  days: number
  recovered: boolean
}

export interface RiskAnalysis {
  maxDdAbs: number
  maxDdPct: number
  maxDailyDdAbs: number
  maxDailyDdPct: number
  avgDdPct: number
  currentDdPct: number
  longestDdDays: number
  longestRecoveryDays: number | null
  underwater: UnderwaterPoint[]
  ddPeriods: DDPeriod[]
  currentConsecLosses: number
  maxConsecLosses: number
  largestLoss: number
  largestWin: number
  openExposure: { symbol: string; volume: number }[]
}

export interface AnalyticsData {
  account: AccountInfo
  range: { key: RangeKey; from: string | null; to: string }
  overview: OverviewStats
  equityCurve: EquityPoint[]
  dailyPnl: DailyPnl[]
  monthlyPnl: { month: string; pnl: number; trades: number }[]
  calendar: CalendarDay[]
  performance: PerformanceStats
  time: TimeAnalysis
  symbols: SymbolStat[]
  directions: DirectionStat[]
  risk: RiskAnalysis
  mistakeStats: MistakeStatLite[]
  emotionStats: EmotionStat[]
  openPositions: OpenPosition[]
  meta: {
    generatedAt: string
    lastSyncAt: string | null
    demoMode: boolean
  }
}

export interface MistakeStatLite {
  mistake: string
  count: number
  cost: number
}

export interface EmotionStat {
  tag: string
  count: number
  pnl: number
  winRate: number
}

export interface JournalTrade {
  id: string
  positionId: number
  symbol: string
  direction: Direction
  volume: number
  openTime: string
  closeTime: string | null
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
  notes: string | null
}

export interface JournalResponse {
  trades: JournalTrade[]
  total: number
}

export interface SettingsResponse {
  account: AccountInfo
  syncLogs: {
    id: string
    ts: string
    source: string
    status: string
    message: string
    tradesInserted: number
    tradesUpdated: number
  }[]
  counts: { trades: number; open: number; snapshots: number; cashflows: number }
  lastSyncAt: string | null
  demoMode: boolean
}

// Windows installer download (Settings → Download section)
export interface DownloadInfo {
  available: boolean
  fileName: string
  version: string
  sizeBytes: number
  sha256: string | null
  modifiedAt: string | null
  fallbackUrl: string
}

// Taxonomy used across the journal
export const TRADE_MISTAKES = [
  'No Stop Loss',
  'Oversized Position',
  'Moved SL to BE too early',
  'Ignored Setup Rules',
  'Chased Price',
  'Closed Too Early',
  'Held Past SL mentally',
] as const

export const TRADE_EMOTIONS = [
  'Calm',
  'Confident',
  'Focused',
  'Anxious',
  'Impatient',
  'Greedy',
  'Tilted',
] as const
