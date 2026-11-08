'use client'

// ─── Loading skeletons — instant, calm placeholders while data arrives ───────
// Each block mirrors the real section layout (header → KPI cards → charts →
// list) so switching from skeleton to content feels like the page "fills in"
// instead of jumping. The shimmer sweep signals progress without a spinner.

import type { CSSProperties } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// Shimmer-only skeleton block: kills the default pulse (too busy together)
// and applies the sweeping-light pseudo-element instead.
function Sh({ className, style }: { className?: string; style?: CSSProperties }) {
  return <Skeleton className={cn('animate-none skeleton-shimmer', className)} style={style} />
}

// KPI tile placeholder — matches StatCard geometry
function KpiSkeleton({ i }: { i: number }) {
  return (
    <Card className="border-border/70 bg-card/90">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <Sh className="h-3 w-20" />
          <Sh className="h-4 w-4 rounded" />
        </div>
        <Sh className="mt-3 h-7 w-28" style={{ animationDelay: `${i * 0.12}s` }} />
        <Sh className="mt-2 h-3 w-16" style={{ animationDelay: `${i * 0.12 + 0.06}s` }} />
      </CardContent>
    </Card>
  )
}

// Bar-chart placeholder — varied-height columns with the brand accent
function BarsSkeleton() {
  const heights = [42, 68, 30, 84, 55, 74, 38, 90, 60, 46, 78, 52]
  return (
    <div className="flex h-[240px] items-end gap-2 sm:gap-3">
      {heights.map((h, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-2">
          <Sh
            className="w-full rounded-t-md bg-[var(--pos)]/12"
            style={{ height: `${h}%`, animationDelay: `${i * 0.09}s` }}
          />
          <Sh className="h-2 w-8" />
        </div>
      ))}
    </div>
  )
}

// Donut-chart placeholder — a soft ring
function DonutSkeleton() {
  return (
    <div className="flex h-[240px] items-center justify-center">
      <div
        className="skeleton-shimmer h-40 w-40 rounded-full bg-[var(--pos)]/12"
        style={{
          background:
            'radial-gradient(closest-side, oklch(0.195 0.028 258) 62%, transparent 62% 100%), conic-gradient(oklch(0.42 0.028 255 / 55%) 0 100%)',
        }}
      />
    </div>
  )
}

// List rows placeholder — matches table/list densities
function RowsSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Sh className="h-8 w-8 shrink-0 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Sh className="h-3 w-1/3" style={{ animationDelay: `${i * 0.08}s` }} />
            <Sh className="h-2.5 w-1/5" style={{ animationDelay: `${i * 0.08 + 0.05}s` }} />
          </div>
          <Sh className="h-3.5 w-16" style={{ animationDelay: `${i * 0.08 + 0.08}s` }} />
        </div>
      ))}
    </div>
  )
}

// Full-page skeleton shown while the analytics engine computes its first run
export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading analytics" className="space-y-4">
      {/* Section header */}
      <div className="mb-5 space-y-2">
        <Sh className="h-6 w-56" />
        <Sh className="h-3.5 w-80 max-w-full" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiSkeleton key={i} i={i} />
        ))}
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="border-border/70 bg-card/90 lg:col-span-3">
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <Sh className="h-4 w-36" />
              <Sh className="h-6 w-24 rounded-full" />
            </div>
            <BarsSkeleton />
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/90 lg:col-span-2">
          <CardContent className="p-4">
            <div className="mb-4">
              <Sh className="h-4 w-28" />
            </div>
            <DonutSkeleton />
          </CardContent>
        </Card>
      </div>

      {/* List / table */}
      <Card className="border-border/70 bg-card/90">
        <CardContent className="p-4">
          <div className="mb-4 flex items-center justify-between">
            <Sh className="h-4 w-24" />
            <Sh className="h-7 w-28 rounded-lg" />
          </div>
          <RowsSkeleton rows={6} />
        </CardContent>
      </Card>

      <span className="sr-only">Loading analytics…</span>
    </div>
  )
}
