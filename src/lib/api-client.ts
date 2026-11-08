// ─── Client-side API layer ───────────────────────────────────────────────────

import type {
  AnalyticsData,
  DownloadInfo,
  JournalResponse,
  RangeKey,
  SettingsResponse,
} from './types'

export interface AnalyticsFilters {
  range: RangeKey
  symbol?: string
  accountId?: string
  /** explicit window for range = 'custom' */
  from?: string
  to?: string
}

export interface JournalFilters {
  range: RangeKey
  symbol?: string
  result?: 'win' | 'loss' | 'be'
  status?: 'OPEN' | 'CLOSED'
  mistake?: string
  emotion?: string
  strategyId?: string
  q?: string
  limit?: number
  accountId?: string
  from?: string
  to?: string
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      /* ignore */
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export async function fetchAnalytics(f: AnalyticsFilters): Promise<AnalyticsData> {
  const params = new URLSearchParams({ range: f.range })
  if (f.symbol) params.set('symbol', f.symbol)
  if (f.accountId) params.set('accountId', f.accountId)
  if (f.range === 'custom') {
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
  }
  const res = await fetch(`/api/analytics?${params.toString()}`, { cache: 'no-store' })
  return handle<AnalyticsData>(res)
}

export async function fetchJournal(f: JournalFilters): Promise<JournalResponse> {
  const params = new URLSearchParams({ range: f.range })
  if (f.symbol) params.set('symbol', f.symbol)
  if (f.result) params.set('result', f.result)
  if (f.status) params.set('status', f.status)
  if (f.mistake) params.set('mistake', f.mistake)
  if (f.emotion) params.set('emotion', f.emotion)
  if (f.strategyId) params.set('strategyId', f.strategyId)
  if (f.q) params.set('q', f.q)
  if (f.limit) params.set('limit', String(f.limit))
  if (f.accountId) params.set('accountId', f.accountId)
  if (f.range === 'custom') {
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
  }
  const res = await fetch(`/api/journal?${params.toString()}`, { cache: 'no-store' })
  return handle<JournalResponse>(res)
}

export async function updateTrade(
  id: string,
  body: { mistakes?: string[]; emotion?: string | null; notes?: string | null; strategyId?: string | null }
): Promise<void> {
  const res = await fetch(`/api/trades/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<void>(res)
}

export async function fetchSettings(accountId?: string): Promise<SettingsResponse> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
  const res = await fetch(`/api/settings${qs}`, { cache: 'no-store' })
  return handle<SettingsResponse>(res)
}

export async function updateSettingsTimezone(timezone: string): Promise<{ ok: boolean; timezone: string }> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ timezone }),
  })
  return handle<{ ok: boolean; timezone: string }>(res)
}

// ─── Strategies (P4) ─────────────────────────────────────────────────────

export interface StrategyRow {
  id: string
  name: string
  description: string | null
  color: string | null
  magicNumbers: string
  createdAt: string
}

export interface StrategyStatRow {
  strategyId: string | null
  name: string
  color: string | null
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number | null
  expectancy: number | null
  avgR: number | null
  maxDd: number
  maxConsecLosses: number
  netProfit: number
  bySymbol: { symbol: string; trades: number; pnl: number }[]
  byHour: { hour: number; trades: number; pnl: number }[]
}

export interface StrategiesResponse {
  strategies: StrategyRow[]
  stats: StrategyStatRow[]
  timezone: string
  currency: string
}

export async function fetchStrategies(accountId?: string): Promise<StrategiesResponse> {
  const qs = accountId ? `?accountId=${encodeURIComponent(accountId)}` : ''
  const res = await fetch(`/api/strategies${qs}`, { cache: 'no-store' })
  return handle<StrategiesResponse>(res)
}

export async function createStrategy(body: {
  name: string
  description?: string
  color?: string
  magicNumbers?: string
}): Promise<{ ok: boolean }> {
  const res = await fetch('/api/strategies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<{ ok: boolean }>(res)
}

export async function updateStrategy(
  id: string,
  body: { name?: string; description?: string; color?: string; magicNumbers?: string }
): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/strategies/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<{ ok: boolean }>(res)
}

export async function deleteStrategy(id: string): Promise<{ ok: boolean }> {
  const res = await fetch(`/api/strategies/${id}`, { method: 'DELETE' })
  return handle<{ ok: boolean }>(res)
}

export async function fetchDownloadInfo(): Promise<DownloadInfo> {
  const res = await fetch('/api/download?info=1', { cache: 'no-store' })
  return handle<DownloadInfo>(res)
}

export async function reseedDemoData(): Promise<void> {
  const res = await fetch('/api/reseed', { method: 'POST' })
  return handle<void>(res)
}

export interface Mt5LaunchResult {
  ok: boolean
  pid?: number
  alreadyRunning?: boolean
  wipedDemo?: boolean
  message: string
}

export async function launchMt5Connector(): Promise<Mt5LaunchResult> {
  const res = await fetch('/api/mt5/launch', { method: 'POST' })
  return handle<Mt5LaunchResult>(res)
}

export async function stopMt5Connector(): Promise<{ ok: boolean; message: string }> {
  const res = await fetch('/api/mt5/stop', { method: 'POST' })
  return handle<{ ok: boolean; message: string }>(res)
}

export interface Mt5Status {
  bundled: boolean
  connectorRunning: boolean
  connectorPid: number | null
  tokenProtected: boolean
  accountSynced: boolean
  awaitingFirstSync: boolean
  tradeMode: string | null
  lastSyncLog: { ts: string; source: string; status: string; message: string } | null
  lastLaunchLog: { ts: string; source: string; status: string; message: string } | null
  logTail: string | null
  logFile: string
  data: {
    dataDir: string | null
    dbFile: string | null
    dbSizeBytes: number | null
    snapshotCount: number
  }
}

export async function fetchMt5Status(): Promise<Mt5Status> {
  const res = await fetch('/api/mt5/status', { cache: 'no-store' })
  return handle<Mt5Status>(res)
}
