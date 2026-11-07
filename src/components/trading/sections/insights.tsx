'use client'

// ─── Insights & Alerts — automated alerts, behavior analysis, actionable takeaways ──

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, ArrowRight, CheckCircle2, Info, OctagonAlert } from 'lucide-react'
import type { AlertItem, AlertSeverity, AnalyticsData } from '@/lib/types'
import { fmtHour, fmtMoney, fmtPct, fmtPF } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Panel, PnlValue, SectionHeader, TagBadge } from '@/components/trading/shared/ui'

// ─── Severity configuration ──────────────────────────────────────────────────

const SEV: Record<AlertSeverity, { icon: typeof Info; color: string; bg: string }> = {
  critical: { icon: OctagonAlert, color: 'var(--neg)', bg: 'bg-[var(--neg)]/10' },
  warning: { icon: AlertTriangle, color: 'var(--warn)', bg: 'bg-[var(--warn)]/10' },
  info: { icon: Info, color: 'var(--info)', bg: 'bg-[var(--info)]/10' },
  success: { icon: CheckCircle2, color: 'var(--pos)', bg: 'bg-[var(--pos)]/10' },
}

function AlertCard({ alert, index }: { alert: AlertItem; index: number }) {
  const sev = SEV[alert.severity] ?? SEV.info
  const Icon = sev.icon
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.3), ease: 'easeOut' }}
      className="flex items-start gap-3 rounded-lg border border-border/60 bg-card/70 p-3"
      style={{ borderLeft: `2px solid ${sev.color}` }}
    >
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', sev.bg)}>
        <Icon className="h-4 w-4" style={{ color: sev.color }} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-tight">{alert.title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{alert.message}</p>
      </div>
      {alert.metric && (
        <span className="num shrink-0 rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-semibold text-foreground/80">
          {alert.metric}
        </span>
      )}
    </motion.div>
  )
}

// ─── Behavior rows ────────────────────────────────────────────────────────────

function MistakeCostPanel({ data }: { data: AnalyticsData }) {
  const stats = [...data.mistakeStats].sort((a, b) => a.cost - b.cost) // most costly first
  const maxAbs = Math.max(...stats.map((m) => Math.abs(m.cost)), 1)

  return (
    <Panel title="Cost of Mistakes" description="هزینه واقعی هر اشتباه">
      {stats.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">No mistakes recorded</p>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto scroll-slim pr-1">
          {stats.map((m) => (
            <div key={m.mistake}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium text-foreground/90">{m.mistake}</span>
                  <span className="num shrink-0 rounded bg-muted/60 px-1.5 text-[10px] text-muted-foreground">
                    {m.count}×
                  </span>
                </span>
                <PnlValue value={m.cost} className="shrink-0 text-xs font-semibold" />
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/40">
                <div
                  className={cn('h-1 rounded-full', m.cost < 0 ? 'bg-[var(--neg)]/60' : 'bg-[var(--pos)]/60')}
                  style={{ width: `${Math.max(3, (Math.abs(m.cost) / maxAbs) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

function PsychologyPanel({ data }: { data: AnalyticsData }) {
  const stats = [...data.emotionStats].sort((a, b) => b.pnl - a.pnl)
  const maxAbs = Math.max(...stats.map((e) => Math.abs(e.pnl)), 1)

  return (
    <Panel title="Psychology" description="وضعیت روانی هنگام معامله">
      {stats.length === 0 ? (
        <p className="py-4 text-xs text-muted-foreground">No emotion data recorded yet</p>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto scroll-slim pr-1">
          {stats.map((e) => (
            <div key={e.tag}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium text-foreground/90">{e.tag}</span>
                  <span className="num shrink-0 rounded bg-muted/60 px-1.5 text-[10px] text-muted-foreground">
                    {e.count}×
                  </span>
                </span>
                <PnlValue value={e.pnl} className="shrink-0 text-xs font-semibold" />
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted/40">
                <div
                  className={cn('h-1 rounded-full', e.pnl < 0 ? 'bg-[var(--neg)]/60' : 'bg-[var(--pos)]/60')}
                  style={{ width: `${Math.max(3, (Math.abs(e.pnl) / maxAbs) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

// ─── Actionable summary ───────────────────────────────────────────────────────

function buildSummary(data: AnalyticsData) {
  const lines: { key: string; content: ReactNode }[] = []

  // 1) Worst mistake cost
  const worstMistake = data.mistakeStats.filter((m) => m.cost < 0).sort((a, b) => a.cost - b.cost)[0]
  if (worstMistake) {
    lines.push({
      key: 'mistake',
      content: (
        <>
          Cutting <span className="font-semibold text-foreground">{worstMistake.mistake}</span> would have saved{' '}
          <span className="pnl-pos num font-semibold">{fmtMoney(-worstMistake.cost)}</span> across{' '}
          <span className="num">{worstMistake.count}</span> trades.
        </>
      ),
    })
  }

  // 2) Worst hour
  const worstHour = data.time.worstHour
  if (worstHour && worstHour.trades > 0) {
    lines.push({
      key: 'hour',
      content: (
        <>
          Your worst hour is <span className="num font-semibold text-foreground">{fmtHour(worstHour.hour)}</span>{' '}
          Tehran time — <PnlValue value={worstHour.pnl} className="font-semibold" /> across{' '}
          <span className="num">{worstHour.trades}</span> trades. Consider skipping it.
        </>
      ),
    })
  }

  // 3) Largest drawdown
  if (data.risk.maxDdPct > 0) {
    lines.push({
      key: 'dd',
      content: (
        <>
          Largest drawdown: <span className="pnl-neg num font-semibold">{fmtPct(data.risk.maxDdPct)}</span> (
          <span className="pnl-neg num">{fmtMoney(-Math.abs(data.risk.maxDdAbs))}</span>) — cap risk per trade to
          protect the equity curve.
        </>
      ),
    })
  }

  return lines
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function InsightsSection({ data }: { data: AnalyticsData }) {
  const summary = buildSummary(data)

  return (
    <div>
      <SectionHeader title="Insights & Alerts" subtitle="کشف الگوهای رفتاری و هشدارهای خودکار" />

      {/* Alerts feed */}
      <div className="mb-4 space-y-2">
        {data.alerts.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/70 p-4 text-xs text-muted-foreground">
            No active alerts — سیستم آرام است
          </div>
        ) : (
          data.alerts.map((a, i) => <AlertCard key={a.id} alert={a} index={i} />)
        )}
      </div>

      {/* Behavior analysis */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <MistakeCostPanel data={data} />
        <PsychologyPanel data={data} />
      </div>

      {/* Actionable summary */}
      <Panel title="Actionable Summary" description="خلاصه قابل اقدام">
        {summary.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Not enough data for actionable insights yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {summary.map((line) => (
              <li key={line.key} className="flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0">{line.content}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
