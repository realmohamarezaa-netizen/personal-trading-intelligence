'use client'

// Range filter (+ custom date window) + dimension filter controls

import type { RangeKey } from '@/lib/types'
import { RANGE_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

const RANGES: RangeKey[] = ['7d', '30d', '90d', '180d', 'all', 'custom']

export function RangeFilter({
  value,
  onChange,
  className,
  customFrom,
  customTo,
  onCustomChange,
}: {
  value: RangeKey
  onChange: (r: RangeKey) => void
  className?: string
  /** current custom window (only shown/edited when value === 'custom') */
  customFrom?: string
  customTo?: string
  onCustomChange?: (from: string, to: string) => void
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <div
        className="inline-flex items-center gap-0.5 rounded-lg border border-border/70 bg-muted/40 p-0.5"
        role="tablist"
        aria-label="Time range"
      >
        {RANGES.map((r) => (
          <button
            key={r}
            role="tab"
            aria-selected={value === r}
            onClick={() => onChange(r)}
            className={cn(
              'num rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              value === r
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      {value === 'custom' && onCustomChange && (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={customFrom ?? ''}
            max={customTo || undefined}
            onChange={(e) => onCustomChange(e.target.value, customTo ?? '')}
            className="num h-7 rounded-md border border-border/70 bg-muted/40 px-2 text-xs text-foreground [color-scheme:dark]"
            aria-label="Custom range start"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <input
            type="date"
            value={customTo ?? ''}
            min={customFrom || undefined}
            onChange={(e) => onCustomChange(customFrom ?? '', e.target.value)}
            className="num h-7 rounded-md border border-border/70 bg-muted/40 px-2 text-xs text-foreground [color-scheme:dark]"
            aria-label="Custom range end"
          />
        </div>
      )}
    </div>
  )
}

export function DimensionFilter({
  label,
  value,
  options,
  onChange,
  allLabel = 'All',
  className,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  allLabel?: string
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="hidden text-xs text-muted-foreground sm:inline">{label}</span>
      <Select value={value || '__all__'} onValueChange={(v) => onChange(v === '__all__' ? '' : v)}>
        <SelectTrigger size="sm" className="h-8 w-[130px] text-xs" aria-label={label}>
          <SelectValue placeholder={allLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">{allLabel}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
