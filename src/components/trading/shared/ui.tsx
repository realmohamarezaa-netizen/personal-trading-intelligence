'use client'

// ─── Shared UI primitives for the trading platform ───────────────────────────

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { fmtMoney, pnlTone } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import type { Direction } from '@/lib/types'

// Panel — section container with header
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <Card className={cn('border-border/70 bg-card/80 backdrop-blur-sm glow-line', className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold tracking-tight">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <CardContent className={cn('p-4', bodyClassName)}>{children}</CardContent>
    </Card>
  )
}

// StatCard — KPI tile
export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: 'neutral' | 'pos' | 'neg' | 'warn' | 'info'
  className?: string
}) {
  const toneClass =
    tone === 'pos'
      ? 'text-[var(--pos)]'
      : tone === 'neg'
        ? 'text-[var(--neg)]'
        : tone === 'warn'
          ? 'text-[var(--warn)]'
          : tone === 'info'
            ? 'text-[var(--info)]'
            : 'text-foreground'
  return (
    <Card className={cn('border-border/70 bg-card/80 backdrop-blur-sm', className)}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
          {icon && <span className="text-muted-foreground/70">{icon}</span>}
        </div>
        <div className={cn('num mt-2 text-xl font-semibold sm:text-2xl', toneClass)}>{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

// PnlValue — signed, colored money
export function PnlValue({
  value,
  className,
  sign = true,
  decimals = 2,
}: {
  value: number
  className?: string
  sign?: boolean
  decimals?: number
}) {
  const tone = pnlTone(value)
  return (
    <span
      className={cn(
        'num',
        tone === 'pos' ? 'pnl-pos' : tone === 'neg' ? 'pnl-neg' : 'pnl-flat',
        className
      )}
    >
      {fmtMoney(value, { sign, decimals })}
    </span>
  )
}

// SectionHeader
export function SectionHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children?: ReactNode
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

// DirectionBadge
export function DirectionBadge({ direction }: { direction: Direction | string }) {
  const buy = direction === 'BUY'
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded px-1.5 text-[10px] font-bold tracking-wide',
        buy ? 'bg-[var(--pos)]/12 text-[var(--pos)]' : 'bg-[var(--neg)]/12 text-[var(--neg)]'
      )}
    >
      {buy ? 'BUY' : 'SELL'}
    </span>
  )
}

const TAG_HUES = ['var(--pos)', 'var(--info)', 'var(--warn)', 'var(--neg)', 'oklch(0.7 0.15 300)', 'oklch(0.78 0.13 200)']

export function TagBadge({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  let hash = 0
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
  const color = TAG_HUES[hash % TAG_HUES.length]
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium"
      style={{ color, borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, background: `color-mix(in oklab, ${color} 10%, transparent)` }}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label={`Remove ${tag}`}
        >
          ×
        </button>
      )}
    </span>
  )
}

// Skeleton helpers
export function SkeletonGrid({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-[86px] animate-pulse rounded-xl border border-border/60 bg-card/60" />
      ))}
    </div>
  )
}

// Chart color constants (shared across all charts)
export const CHART = {
  pos: 'var(--pos)',
  neg: 'var(--neg)',
  warn: 'var(--warn)',
  info: 'var(--info)',
  axis: 'oklch(0.62 0.02 252)',
  grid: 'oklch(1 0 0 / 6%)',
  tooltip: {
    contentStyle: {
      background: 'oklch(0.22 0.028 258 / 96%)',
      border: '1px solid oklch(1 0 0 / 10%)',
      borderRadius: 10,
      fontSize: 12,
      boxShadow: '0 8px 30px oklch(0 0 0 / 40%)',
    },
    labelStyle: { color: 'oklch(0.70 0.02 252)', fontSize: 11, marginBottom: 4 },
    itemStyle: { color: 'oklch(0.93 0.012 250)' },
  },
} as const
