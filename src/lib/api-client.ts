// ─── Client-side API layer ───────────────────────────────────────────────────

import type {
  AnalyticsData,
  JournalResponse,
  RangeKey,
  SettingsResponse,
} from './types'

export interface AnalyticsFilters {
  range: RangeKey
  symbol?: string
  strategyId?: string
}

export interface JournalFilters {
  range: RangeKey
  symbol?: string
  strategyId?: string
  result?: 'win' | 'loss' | 'be'
  status?: 'OPEN' | 'CLOSED'
  tag?: string
  mistake?: string
  q?: string
  limit?: number
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
  if (f.strategyId) params.set('strategy', f.strategyId)
  const res = await fetch(`/api/analytics?${params.toString()}`, { cache: 'no-store' })
  return handle<AnalyticsData>(res)
}

export async function fetchJournal(f: JournalFilters): Promise<JournalResponse> {
  const params = new URLSearchParams({ range: f.range })
  if (f.symbol) params.set('symbol', f.symbol)
  if (f.strategyId) params.set('strategy', f.strategyId)
  if (f.result) params.set('result', f.result)
  if (f.status) params.set('status', f.status)
  if (f.tag) params.set('tag', f.tag)
  if (f.mistake) params.set('mistake', f.mistake)
  if (f.q) params.set('q', f.q)
  if (f.limit) params.set('limit', String(f.limit))
  const res = await fetch(`/api/journal?${params.toString()}`, { cache: 'no-store' })
  return handle<JournalResponse>(res)
}

export async function updateTrade(
  id: string,
  body: { tags?: string[]; mistakes?: string[]; emotion?: string | null; strategyId?: string | null; notes?: string | null }
): Promise<void> {
  const res = await fetch(`/api/trades/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return handle<void>(res)
}

export async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/settings', { cache: 'no-store' })
  return handle<SettingsResponse>(res)
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
