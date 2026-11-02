'use client'

// ─── Strategy Analytics — per-strategy edge, comparison & expectancy charts ──

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AnalyticsData, RangeKey, StrategyStat } from '@/lib/types'
import { fmtMoney, fmtNum, fmtPF } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { CHART, Panel, PnlValue, SectionHeader } from '@/components/trading/shared/ui'
import { RangeFilter } from '@/components/trading/shared/filters'

// ─── Strategy card ────────────────────────────────────────────────────────────

function pfToneClass(pf: number): string {
  if (pf >= 1.3) return 'pnl-pos'
  if (pf >= 1) return 'text-[var(--warn)]'
  return 'pnl-neg'
}

function StrategyCard({ s }: { s: StrategyStat }) {
  const edge = s.profitFactor >= 1.4 && s.trades >= 30
  const leak = s.profitFactor < 1
  const unassigned = s.id === 'unassigned'

  return (
    <Card
      className={cn(
        'border-border/70 bg-card/80 backdrop-blur-sm',
        edge && 'border-[var(--pos)]/30',
        leak && 'border-[var(--neg)]/25',
        unassigned && 'border-dashed'
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="truncate text-sm font-semibold" title={s.name}>{s.name}</h3>
          {edge && (
            <span className="shrink-0 rounded bg-[var(--pos)]/12 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--pos)]">
              EDGE
            </span>
          )}
          {leak && (
            <span className="shrink-0 rounded bg-[var(--neg)]/12 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-[var(--neg)]">
              LEAK
            </span>
          )}
        </div>

        {s.description && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
        )}

        <div className="mt-3">
          <PnlValue value={s.netPnl} className="text-2xl font-bold" />
        </div>

        <div className="mt-3 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Sample</span>
            <span className="num text-foreground">
              {s.trades} trades · WR {s.winRate.toFixed(1)}%
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Profit Factor</span>
            <span className={cn('num font-semibold', pfToneClass(s.profitFactor))}>{fmtPF(s.profitFactor)}</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Expectancy</span>
            <span className="num text-foreground">
              {fmtMoney(s.expectancy, { sign: true })}
              {s.expectancyR !== null && (
                <span className="ml-1.5 text-muted-foreground">{fmtNum(s.expectancyR)}R</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Avg R</span>
            <span className="num text-foreground">{s.avgR !== null ? `${fmtNum(s.avgR, 2)}R` : '—'}</span>
          </div>
        </div>

        {(s.bestSymbol || s.worstSymbol) && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2.5">
            {s.bestSymbol && (
              <>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Best</span>
                <span className="rounded bg-[var(--pos)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--pos)]">
                  {s.bestSymbol}
                </span>
              </>
            )}
            {s.worstSymbol && (
              <>
                <span className="ml-1 text-[10px] uppercase tracking-wider text-muted-foreground">Worst</span>
                <span className="rounded bg-[var(--neg)]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--neg)]">
                  {s.worstSymbol}
                </span>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function StrategiesSection({
  data,
  range,
  onRange,
}: {
  data: AnalyticsData
  range: RangeKey
  onRange: (r: RangeKey) => void
}) {
  const strategies = data.strategies
  const withTrades = strategies.filter((s) => s.trades > 0)

  const pnlData = strategies.map((s) => ({ name: s.name, pnl: s.netPnl }))
  const expData = strategies.map((s) => ({ name: s.name, expectancy: s.expectancy }))

  const short10 = (name: string) => (name.length > 10 ? `${name.slice(0, 10)}…` : name)
  const short12 = (name: string) => (name.length > 12 ? `${name.slice(0, 12)}…` : name)
  const moneyTick = (v: number | string) => fmtMoney(Number(v), { decimals: 0 })

  return (
    <div>
      <SectionHeader title="Strategy Analytics" subtitle="کدام استراتژی واقعاً مزیت آماری دارد؟">
        <RangeFilter value={range} onChange={onRange} />
      </SectionHeader>

      {withTrades.length === 0 ? (
        <Panel title="Strategy Analytics">
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm font-medium">No strategy trades in this range</p>
            <p className="text-xs text-muted-foreground">
              Assign strategies to journal trades or widen the time range to see statistical edge.
            </p>
          </div>
        </Panel>
      ) : (
        <>
          {/* Cards grid */}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {strategies.map((s) => (
              <StrategyCard key={s.id} s={s} />
            ))}
          </div>

          {/* Net P/L comparison */}
          <Panel title="Net P/L by Strategy" className="mt-4" bodyClassName="pb-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={pnlData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fill: CHART.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tickFormatter={short10}
                />
                <YAxis
                  tick={{ fill: CHART.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tickFormatter={moneyTick}
                />
                <Tooltip
                  contentStyle={CHART.tooltip.contentStyle}
                  labelStyle={CHART.tooltip.labelStyle}
                  itemStyle={CHART.tooltip.itemStyle}
                  cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                  formatter={(value) => [fmtMoney(Number(value), { sign: true }), 'Net P/L']}
                />
                <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={48}>
                  {pnlData.map((d) => (
                    <Cell key={d.name} fill={d.pnl >= 0 ? CHART.pos : CHART.neg} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          {/* Expectancy per trade */}
          <Panel title="Expectancy per Trade" description="میانگین سود/زیان مورد انتظار در هر معامله" className="mt-4" bodyClassName="pb-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={expData} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: CHART.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={moneyTick}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={110}
                  tick={{ fill: CHART.axis, fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={short12}
                />
                <Tooltip
                  contentStyle={CHART.tooltip.contentStyle}
                  labelStyle={CHART.tooltip.labelStyle}
                  itemStyle={CHART.tooltip.itemStyle}
                  cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                  formatter={(value) => [fmtMoney(Number(value), { sign: true }), 'Expectancy']}
                />
                <Bar dataKey="expectancy" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {expData.map((d) => (
                    <Cell key={d.name} fill={d.expectancy >= 0 ? CHART.pos : CHART.neg} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </>
      )}
    </div>
  )
}
