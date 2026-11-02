'use client'

// ─── Performance Analytics section ───────────────────────────────────────────

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Flame,
  Inbox,
  ListOrdered,
  Repeat,
  Scale,
  Sigma,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { AnalyticsData, HoldingBucket, RHistogramBucket, RangeKey } from '@/lib/types'
import { fmtDate, fmtDuration, fmtMoney, fmtNum, fmtPct, fmtPF } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  CHART,
  Panel,
  PnlValue,
  SectionHeader,
  StatCard,
} from '@/components/trading/shared/ui'
import { DimensionFilter, RangeFilter } from '@/components/trading/shared/filters'

type StatTone = 'neutral' | 'pos' | 'neg' | 'warn' | 'info'

interface Kpi {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: StatTone
}

function CompRow({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('num text-sm font-semibold', cls)}>{value}</span>
    </div>
  )
}

export function PerformanceSection({
  data,
  range,
  onRange,
  symbol,
  onSymbol,
}: {
  data: AnalyticsData
  range: RangeKey
  onRange: (r: RangeKey) => void
  symbol: string
  onSymbol: (s: string) => void
}) {
  const perf = data.performance
  const rf = perf.recoveryFactor

  // ── Hero stat band (12 KPIs) ──
  const cards: Kpi[] = [
    {
      label: 'Total Trades',
      value: String(perf.totalTrades),
      sub: (
        <>
          <span className="pnl-pos num">{perf.wins}W</span> /{' '}
          <span className="pnl-neg num">{perf.losses}L</span> /{' '}
          <span className="num">{perf.breakEven}BE</span>
        </>
      ),
      icon: <ListOrdered className="h-4 w-4" />,
    },
    {
      label: 'Win Rate',
      value: fmtPct(perf.winRate),
      tone: perf.winRate >= 50 ? 'pos' : 'warn',
      sub: <>decided trades</>,
      icon: <Target className="h-4 w-4" />,
    },
    {
      label: 'Profit Factor',
      value: fmtPF(perf.profitFactor),
      tone: perf.profitFactor >= 1.3 ? 'pos' : perf.profitFactor < 1 ? 'warn' : 'neutral',
      sub: <>gross win ÷ gross loss</>,
      icon: <Scale className="h-4 w-4" />,
    },
    {
      label: 'Expectancy',
      value: fmtMoney(perf.expectancy, { sign: true }),
      tone: perf.expectancy > 0 ? 'pos' : perf.expectancy < 0 ? 'neg' : 'neutral',
      sub: perf.expectancyR !== null ? <span className="num">{fmtNum(perf.expectancyR)}R per trade</span> : <>—</>,
      icon: <Sigma className="h-4 w-4" />,
    },
    {
      label: 'Avg Win',
      value: fmtMoney(perf.avgWin),
      tone: 'pos',
      sub: <>per winning trade</>,
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: 'Avg Loss',
      value: fmtMoney(perf.avgLoss),
      tone: 'neg',
      sub: <>per losing trade</>,
      icon: <TrendingDown className="h-4 w-4" />,
    },
    {
      label: 'Largest Win',
      value: fmtMoney(perf.largestWin, { sign: true }),
      tone: 'pos',
      sub: <>single best</>,
      icon: <ArrowUpRight className="h-4 w-4" />,
    },
    {
      label: 'Largest Loss',
      value: fmtMoney(perf.largestLoss),
      tone: 'neg',
      sub: <>single worst</>,
      icon: <ArrowDownRight className="h-4 w-4" />,
    },
    {
      label: 'Recovery Factor',
      value: rf === null ? '—' : fmtNum(rf),
      tone: rf === null ? 'neutral' : rf > 0 ? 'pos' : rf < 0 ? 'neg' : 'neutral',
      sub: <>net profit ÷ max DD</>,
      icon: <Activity className="h-4 w-4" />,
    },
    {
      label: 'Avg Holding Time',
      value: fmtDuration(perf.avgHoldMinutes),
      sub: <>average time in trade</>,
      icon: <Clock3 className="h-4 w-4" />,
    },
    {
      label: 'Avg R',
      value: perf.avgR === null ? '—' : `${fmtNum(perf.avgR)}R`,
      tone:
        perf.avgR === null ? 'neutral' : perf.avgR > 0 ? 'pos' : perf.avgR < 0 ? 'neg' : 'neutral',
      sub: <>risk multiples</>,
      icon: <Repeat className="h-4 w-4" />,
    },
    {
      label: 'Max Consecutive',
      value: `${perf.maxConsecWins}W / ${perf.maxConsecLosses}L`,
      sub: <>longest streaks</>,
      icon: <Flame className="h-4 w-4" />,
    },
  ]

  const activity: { label: string; value: ReactNode }[] = [
    {
      label: 'Total Volume',
      value: (
        <>
          {fmtNum(perf.totalVolume, 2)} <span className="text-xs text-muted-foreground">lots</span>
        </>
      ),
    },
    { label: 'Total Trades', value: String(perf.totalTrades) },
    { label: 'Avg Pips', value: perf.avgPips !== null ? fmtNum(perf.avgPips, 1) : '—' },
    { label: 'Symbol Filter', value: symbol || 'All symbols' },
    {
      label: 'Range Window',
      value: (
        <>
          {fmtDate(data.range.from)} <span className="text-muted-foreground">→</span>{' '}
          {fmtDate(data.range.to)}
        </>
      ),
    },
  ]

  const net = perf.grossProfit - perf.grossLoss + perf.totalCommission + perf.totalSwap

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Performance Analytics"
        subtitle="آناتومی عملکرد — از سود ناخالص تا امید ریاضی هر معامله"
      >
        <RangeFilter value={range} onChange={onRange} />
        <DimensionFilter
          label="Symbol"
          value={symbol}
          options={data.symbols.map((s) => ({ value: s.symbol, label: s.symbol }))}
          onChange={onSymbol}
        />
      </SectionHeader>

      {perf.totalTrades === 0 ? (
        <Panel>
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Inbox className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-semibold">No trades in this range</p>
            <p className="text-xs text-muted-foreground">در این بازه معامله‌ای ثبت نشده</p>
          </div>
        </Panel>
      ) : (
        <>
          {/* ── Hero stat band ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {cards.map((k, i) => (
              <motion.div
                key={k.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.28, delay: i * 0.03, ease: 'easeOut' }}
              >
                <StatCard label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.tone} />
              </motion.div>
            ))}
          </div>

          {/* ── Distribution charts ── */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="R-Multiple Distribution" description="توزیع نتایج بر حسب ضریب ریسک">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={perf.rHistogram} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={CHART.grid} vertical={false} />
                  <XAxis
                    dataKey="bucket"
                    interval={0}
                    angle={-28}
                    textAnchor="end"
                    height={48}
                    tick={{ fontSize: 9.5, fill: CHART.axis }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    width={30}
                    tick={{ fontSize: 10, fill: CHART.axis }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                    contentStyle={CHART.tooltip.contentStyle}
                    labelStyle={CHART.tooltip.labelStyle}
                    itemStyle={CHART.tooltip.itemStyle}
                    formatter={(value, _name, item) => {
                      const b = item?.payload as RHistogramBucket | undefined
                      return (
                        <div className="text-xs">
                          <div className="num font-semibold">{Number(value)} trades</div>
                          {b && (
                            <div className="num opacity-70">
                              net {fmtMoney(b.pnl, { sign: true })}
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {perf.rHistogram.map((b) => (
                      <Cell key={b.bucket} fill={b.pnl >= 0 ? CHART.pos : CHART.neg} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Holding Time" description="زمان نگهداری معاملات">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart
                  data={perf.holdingBuckets}
                  layout="vertical"
                  margin={{ top: 4, right: 12, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke={CHART.grid} horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: CHART.axis }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="bucket"
                    width={76}
                    tick={{ fontSize: 10, fill: CHART.axis }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                    contentStyle={CHART.tooltip.contentStyle}
                    labelStyle={CHART.tooltip.labelStyle}
                    itemStyle={CHART.tooltip.itemStyle}
                    formatter={(value, _name, item) => {
                      const b = item?.payload as HoldingBucket | undefined
                      return (
                        <div className="text-xs">
                          <div className="num font-semibold">{Number(value)} trades</div>
                          {b && (
                            <div className="num opacity-70">
                              net {fmtMoney(b.pnl, { sign: true })}
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                    <Bar
                      dataKey="count"
                      fill={CHART.info}
                      radius={[0, 3, 3, 0]}
                      barSize={16}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </Panel>
            </div>

          {/* ── Composition / Activity / Extremes ── */}
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="P/L Composition" description="تفکیک سود و هزینه‌ها">
              <div className="space-y-2.5">
                <CompRow label="Gross Profit" value={fmtMoney(perf.grossProfit)} cls="pnl-pos" />
                <CompRow label="Gross Loss" value={fmtMoney(-perf.grossLoss)} cls="pnl-neg" />
                <CompRow
                  label="Commission"
                  value={fmtMoney(perf.totalCommission)}
                  cls="text-muted-foreground"
                />
                <CompRow
                  label="Swap"
                  value={fmtMoney(perf.totalSwap)}
                  cls="text-muted-foreground"
                />
                <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Net
                  </span>
                  <PnlValue value={net} className="text-base font-bold" />
                </div>
              </div>
            </Panel>

            <Panel title="Activity" description="حجم و فعالیت">
              <div className="space-y-2.5">
                {activity.map((r) => (
                  <div key={r.label} className="flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground">{r.label}</span>
                    <span className="num text-sm font-medium">{r.value}</span>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="Extremes" description="بهترین و بدترین لحظات">
              <div className="space-y-2.5">
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--pos)]/12 text-[var(--pos)]">
                    <ArrowUpRight className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">Best trade</div>
                    <div className="num pnl-pos text-sm font-semibold">
                      {fmtMoney(perf.largestWin, { sign: true })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/20 p-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--neg)]/12 text-[var(--neg)]">
                    <ArrowDownRight className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">Worst trade</div>
                    <div className="num pnl-neg text-sm font-semibold">
                      {fmtMoney(perf.largestLoss)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="num inline-flex h-6 items-center rounded-full border border-[var(--pos)]/30 bg-[var(--pos)]/10 px-2.5 text-[11px] font-semibold text-[var(--pos)]">
                    {perf.maxConsecWins}W streak
                  </span>
                  <span className="num inline-flex h-6 items-center rounded-full border border-[var(--neg)]/30 bg-[var(--neg)]/10 px-2.5 text-[11px] font-semibold text-[var(--neg)]">
                    {perf.maxConsecLosses}L streak
                  </span>
                </div>
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
