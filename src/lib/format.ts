// ─── Formatting helpers (client + server safe) ───────────────────────────────

export function fmtMoney(n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  const d = opts?.decimals ?? 2
  const abs = Math.abs(n)
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
  const sign = n < 0 ? '-' : opts?.sign ? '+' : ''
  return `${sign}$${formatted}`
}

export function fmtSigned(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${n < 0 ? '-' : '+'}${abs}`
}

export function fmtMoneyPlain(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function fmtPct(n: number | null | undefined, decimals = 1): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return `${n.toFixed(decimals)}%`
}

export function fmtNum(n: number | null | undefined, decimals = 2): string {
  if (n === null || n === undefined || !isFinite(n)) return '—'
  return n.toFixed(decimals)
}

export function fmtPF(pf: number | null | undefined): string {
  if (pf === null || pf === undefined || !isFinite(pf)) return '—'
  if (pf >= 99.98) return '∞'
  return pf.toFixed(2)
}

export function fmtBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || !isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(decimals)} ${units[i]}`
}

export function fmtDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !isFinite(minutes)) return '—'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 60 * 24) {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return m ? `${h}h ${m}m` : `${h}h`
  }
  const d = Math.floor(minutes / (60 * 24))
  const h = Math.round((minutes % (60 * 24)) / 60)
  return h ? `${d}d ${h}h` : `${d}d`
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso))
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

export function pnlTone(n: number): 'pos' | 'neg' | 'flat' {
  if (n > 0.0001) return 'pos'
  if (n < -0.0001) return 'neg'
  return 'flat'
}

export function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

/** Color scale for heatmap cells: negative → rose, positive → emerald */
export function heatColor(pnl: number, maxAbs: number): string {
  if (maxAbs <= 0) return 'transparent'
  const intensity = Math.min(1, Math.abs(pnl) / maxAbs)
  const alpha = 0.12 + intensity * 0.75
  return pnl >= 0 ? `rgba(52, 211, 153, ${alpha.toFixed(3)})` : `rgba(251, 113, 133, ${alpha.toFixed(3)})`
}
