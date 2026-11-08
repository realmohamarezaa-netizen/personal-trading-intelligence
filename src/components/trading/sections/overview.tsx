'use client'

// ─── Overview section — account control center ───────────────────────────────

import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ArrowDownRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Inbox,
  Scale,
  Target,
  TrendingUp,
  Waves,
  Wallet,
} from 'lucide-react'
import type { AnalyticsData, CalendarDay, DailyPnl, EquityPoint, RangeKey } from '@/lib/types'
import {
  currencySymbol,
  fmtCompact,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtMoney,
  fmtMoneyPlain,
  fmtNum,
  fmtPct,
  fmtPF,
  fmtSigned,
  heatColor,
  pnlTone,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  CHART,
  DirectionBadge,
  Panel,
  PnlValue,
  SectionHeader,
  StatCard,
} from '@/components/trading/shared/ui'
import { RangeFilter } from '@/components/trading/shared/filters'

type StatTone = 'neutral' | 'pos' | 'neg' | 'warn' | 'info'

interface Kpi {
  label: string
  value: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  tone?: StatTone
}

interface CalCell {
  day: number
  entry?: CalendarDay
  fri: boolean
}

// Tehran week: Saturday first
const CAL_HEADER = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

const SHORT_DAY_FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Tehran',
  day: '2-digit',
  month: 'short',
})
const MONTH_NAME_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' })

function shortDay(iso: string): string {
  return SHORT_DAY_FMT.format(new Date(iso))
}

/** '2026-05' → 'May 2026' */
function monthLabel(ym: string): string {
  const [ys, ms] = ym.split('-')
  const y = Number(ys)
  const m = Number(ms)
  if (!y || !m) return ym
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** Tehran weekday of a calendar date: 0 = Saturday … 6 = Friday */
function tehranWeekday(y: number, m: number, d: number): number {
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7
}

export function OverviewSection({
  data,
  range,
  onRange,
}: {
  data: AnalyticsData
  range: RangeKey
  onRange: (r: RangeKey) => void
}) {
  const o = data.overview
  const currency = data.account.currency
  const money = (n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }) =>
    fmtMoney(n, { ...opts, currency })
  const floatTone = pnlTone(o.floatingPnl)

  // Merge the realized balance curve with the connector's floating equity
  // samples into one chart dataset (snapshot points may be sparse).
  const chartRows = useMemo(() => {
    const map = new Map<string, { t: string; balance?: number; snapshotEquity?: number }>()
    for (const p of data.equityCurve) map.set(p.t, { t: p.t, balance: p.balance })
    for (const p of data.equitySeries) {
      const e = map.get(p.t)
      if (e) e.snapshotEquity = p.equity
      else map.set(p.t, { t: p.t, snapshotEquity: p.equity })
    }
    return [...map.values()].sort((a, b) => a.t.localeCompare(b.t))
  }, [data.equityCurve, data.equitySeries])

  // ── KPI cards ──
  const kpis: Kpi[] = [
    {
      label: 'Balance',
      value: (
        <>
          <span className="mr-1 text-sm font-normal text-muted-foreground">{currencySymbol(currency)}</span>
          {fmtMoneyPlain(o.balance)}
        </>
      ),
      sub: <>Initial {money(data.account.initialBalance)}</>,
      icon: <Wallet className="h-4 w-4" />,
    },
    {
      label: 'Equity',
      value: (
        <>
          <span className="mr-1 text-sm font-normal text-muted-foreground">{currencySymbol(currency)}</span>
          {fmtMoneyPlain(o.equity)}
        </>
      ),
      sub: (
        <>
          <span
            className={cn(
              'num',
              floatTone === 'pos' ? 'pnl-pos' : floatTone === 'neg' ? 'pnl-neg' : 'pnl-flat'
            )}
          >
            {fmtSigned(o.floatingPnl)}
          </span>{' '}
          floating
        </>
      ),
      icon: <Gauge className="h-4 w-4" />,
    },
    {
      label: 'Floating P/L',
      value: <PnlValue value={o.floatingPnl} currency={currency} />,
      sub: <span className="num">{o.openPositionsCount} open positions</span>,
      icon: <Waves className="h-4 w-4" />,
    },
    {
      label: "Today's P/L",
      value: <PnlValue value={o.todayPnl} currency={currency} />,
      sub: <span className="num">{o.todayTrades} closed trades today</span>,
      icon: <CalendarClock className="h-4 w-4" />,
    },
    {
      label: 'Total Net Profit',
      value: <PnlValue value={o.totalNetProfit} currency={currency} />,
      sub: (
        <>
          <span className={cn('num', o.totalReturnPct >= 0 ? 'pnl-pos' : 'pnl-neg')}>
            {fmtSigned(o.totalReturnPct, 1)}%
          </span>{' '}
          all-time return
        </>
      ),
      icon: <TrendingUp className="h-4 w-4" />,
    },
    {
      label: 'Win Rate',
      value: fmtPct(o.winRate),
      sub: <span className="num">{o.totalTrades} trades in range</span>,
      icon: <Target className="h-4 w-4" />,
    },
    {
      label: 'Profit Factor',
      value: fmtPF(o.profitFactor),
      tone: (o.profitFactor ?? 1) >= 1.3 ? 'pos' : (o.profitFactor ?? 1) < 1 ? 'warn' : 'neutral',
      sub: <>gross win ÷ gross loss</>,
      icon: <Scale className="h-4 w-4" />,
    },
    {
      label: 'Max Drawdown',
      value: fmtPct(o.maxDrawdownPct),
      tone: 'neg',
      sub: <>equity peak-to-trough</>,
      icon: <ArrowDownRight className="h-4 w-4" />,
    },
  ]

  // ── Daily P/L — last 60 entries ──
  const daily = useMemo(() => data.dailyPnl.slice(-60), [data.dailyPnl])

  // ── Monthly rows ──
  const monthMaxAbs = useMemo(
    () => Math.max(1, ...data.monthlyPnl.map((m) => Math.abs(m.pnl))),
    [data.monthlyPnl]
  )

  // ── Calendar heatmap ──
  const months = useMemo(() => {
    const set = new Set<string>()
    for (const c of data.calendar) set.add(c.date.slice(0, 7))
    return Array.from(set).sort()
  }, [data.calendar])

  const [picked, setPicked] = useState<string | null>(null)
  const activeMonth =
    picked && months.includes(picked) ? picked : (months[months.length - 1] ?? null)

  const cal = useMemo(() => {
    if (!activeMonth) return null
    const [ys, ms] = activeMonth.split('-')
    const y = Number(ys)
    const m = Number(ms)
    if (!y || !m) return null
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const lead = tehranWeekday(y, m, 1)
    const byDate = new Map<string, CalendarDay>()
    for (const c of data.calendar) if (c.date.startsWith(activeMonth)) byDate.set(c.date, c)
    let maxAbs = 1
    let pnl = 0
    let trades = 0
    for (const c of byDate.values()) {
      maxAbs = Math.max(maxAbs, Math.abs(c.pnl))
      pnl += c.pnl
      trades += c.trades
    }
    const cells: CalCell[] = []
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        entry: byDate.get(`${activeMonth}-${String(d).padStart(2, '0')}`),
        fri: tehranWeekday(y, m, d) === 6,
      })
    }
    return { lead, cells, maxAbs, pnl, trades, monthName: MONTH_NAME_FMT.format(new Date(Date.UTC(y, m - 1, 1))) }
  }, [activeMonth, data.calendar])

  const mi = activeMonth ? months.indexOf(activeMonth) : -1
  const prevMonth = mi > 0 ? months[mi - 1] : null
  const nextMonth = mi >= 0 && mi < months.length - 1 ? months[mi + 1] : null

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Overview"
        subtitle="مرکز کنترل حساب — نگاه لحظه‌ای به وضعیت معاملاتی"
      >
        <RangeFilter value={range} onChange={onRange} />
      </SectionHeader>

      {/* ── KPI row ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map((k, i) => (
          <motion.div
            key={k.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28, delay: i * 0.04, ease: 'easeOut' }}
          >
            <StatCard label={k.label} value={k.value} sub={k.sub} icon={k.icon} tone={k.tone} />
          </motion.div>
        ))}
      </div>

      {/* ── Equity curve ── */}
      <Panel
        title="Equity Curve"
        description="Balance curve (realized) + floating equity sampled by the connector — snapshot points are shown when available"
      >
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartRows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART.info} stopOpacity={0.25} />
                <stop offset="100%" stopColor={CHART.info} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(t: string) => shortDay(t)}
              tick={{ fontSize: 10, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
              minTickGap={36}
            />
            <YAxis
              domain={['auto', 'auto']}
              tickFormatter={(v: number) => fmtCompact(v, currency)}
              tick={{ fontSize: 10, fill: CHART.axis }}
              tickLine={false}
              axisLine={false}
              width={54}
            />
            <Tooltip
              cursor={{ stroke: CHART.axis, strokeDasharray: '3 3' }}
              contentStyle={CHART.tooltip.contentStyle}
              labelStyle={CHART.tooltip.labelStyle}
              itemStyle={CHART.tooltip.itemStyle}
              formatter={(_value, _name, item) => {
                const p = item?.payload as (EquityPoint & { snapshotEquity?: number }) | undefined
                if (!p) return null
                return (
                  <div className="space-y-0.5 text-xs">
                    <div className="flex items-center justify-between gap-5">
                      <span className="opacity-70">Balance</span>
                      <span className="num font-semibold">{money(p.balance)}</span>
                    </div>
                    {typeof p.snapshotEquity === 'number' && (
                      <div className="flex items-center justify-between gap-5">
                        <span className="opacity-70">Equity (sampled)</span>
                        <span className="num font-semibold">{money(p.snapshotEquity)}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-5">
                      <span className="opacity-70">Drawdown</span>
                      <span className="num text-[var(--neg)]">{money(-p.ddAbs)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-5">
                      <span className="opacity-70">DD %</span>
                      <span className="num text-[var(--neg)]">{fmtPct(p.ddPct)}</span>
                    </div>
                  </div>
                )
              }}
              labelFormatter={(l) => fmtDateTime(String(l))}
            />
            <Area
              type="monotone"
              dataKey="balance"
              stroke={CHART.info}
              strokeWidth={1.8}
              fill="url(#eqFill)"
              activeDot={{ r: 3, strokeWidth: 0 }}
              isAnimationActive={false}
            />
            {data.equitySeries.length > 0 && (
              <Line
                type="monotone"
                dataKey="snapshotEquity"
                stroke={CHART.pos}
                strokeWidth={1.4}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>
      </Panel>

      {/* ── Daily P/L + Monthly performance ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Daily P/L"
          description="سود و زیان روزانه — 60 روز اخیر"
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={daily} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d: string) => d.slice(5).replace('-', '/')}
                tick={{ fontSize: 10, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                minTickGap={22}
              />
              <YAxis
                tickFormatter={(v: number) => fmtCompact(v, currency)}
                tick={{ fontSize: 10, fill: CHART.axis }}
                tickLine={false}
                axisLine={false}
                width={44}
              />
              <Tooltip
                cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                contentStyle={CHART.tooltip.contentStyle}
                labelStyle={CHART.tooltip.labelStyle}
                itemStyle={CHART.tooltip.itemStyle}
                formatter={(value, _name, item) => {
                  const d = item?.payload as DailyPnl | undefined
                  return (
                    <div className="text-xs">
                      <div className="num font-semibold">{money(Number(value), { sign: true })}</div>
                      {d && (
                        <div className="num opacity-70">
                          {d.trades} trades · {d.wins}W
                        </div>
                      )}
                    </div>
                  )
                }}
                labelFormatter={(l) => fmtDate(String(l))}
              />
              <Bar dataKey="pnl" isAnimationActive={false}>
                {daily.map((d) => (
                  <Cell key={d.date} fill={d.pnl >= 0 ? CHART.pos : CHART.neg} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel className="lg:col-span-2" title="Monthly Performance" description="عملکرد ماهانه">
          {data.monthlyPnl.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No monthly data</div>
          ) : (
            <div className="max-h-[260px] divide-y divide-border/60 overflow-y-auto scroll-slim">
              {data.monthlyPnl.map((m) => (
                <div key={m.month} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="text-xs font-medium">{monthLabel(m.month)}</span>
                      <span className="num text-[10px] text-muted-foreground">
                        {m.trades} trades
                      </span>
                    </div>
                    <PnlValue value={m.pnl} className="text-xs font-semibold" currency={currency} />
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted/40">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(Math.abs(m.pnl) / monthMaxAbs) * 100}%`,
                        background:
                          m.pnl >= 0
                            ? 'color-mix(in oklab, var(--pos) 20%, transparent)'
                            : 'color-mix(in oklab, var(--neg) 20%, transparent)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Calendar heatmap + Open positions ── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Panel
          className="lg:col-span-3"
          title="Monthly Calendar"
          description="نقشه حرارتی سود و زیان روزانه"
          actions={
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => prevMonth && setPicked(prevMonth)}
                disabled={!prevMonth}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="num min-w-[86px] text-center text-xs font-semibold">
                {activeMonth ? monthLabel(activeMonth) : '—'}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => nextMonth && setPicked(nextMonth)}
                disabled={!nextMonth}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          }
        >
          {!cal ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No daily data in this range</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">
                  <span className="num">{cal.trades}</span> trades ·{' '}
                  <span className="num">{cal.cells.filter((c) => c.entry).length}</span> active days
                </span>
                <PnlValue value={cal.pnl} className="text-sm font-semibold" currency={currency} />
              </div>
              <div className="grid grid-cols-7 gap-1">
                {CAL_HEADER.map((d) => (
                  <div
                    key={d}
                    className="pb-0.5 text-center text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
                  >
                    {d}
                  </div>
                ))}
                {Array.from({ length: cal.lead }).map((_, i) => (
                  <div key={`blank-${i}`} className="aspect-square rounded-md bg-muted/15" />
                ))}
                {cal.cells.map((c) => {
                  const title = c.entry
                    ? `${c.day} ${cal.monthName} · ${money(c.entry.pnl)} · ${c.entry.trades} trades`
                    : `${c.day} ${cal.monthName} · no trades`
                  return (
                    <div
                      key={c.day}
                      title={title}
                      className={cn(
                        'num flex aspect-square flex-col items-center justify-center gap-0.5 rounded-md border border-border/40 px-0.5',
                        !c.entry && 'text-muted-foreground/50',
                        c.fri && 'opacity-70'
                      )}
                      style={{
                        background: c.entry
                          ? heatColor(c.entry.pnl, cal.maxAbs)
                          : 'oklch(1 0 0 / 3%)',
                      }}
                    >
                      <span className="text-[10px] font-semibold leading-none">{c.day}</span>
                      {c.entry && (
                        <span className="text-[9px] leading-none">
                          {money(c.entry.pnl, { sign: true, decimals: 0 })}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </Panel>

        <Panel
          className="lg:col-span-2"
          title="Open Positions"
          description="موقعیت‌های باز و سود/زیان شناور"
        >
          {data.openPositions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground/40" />
              <p className="text-sm font-medium">No open positions</p>
              <p className="text-xs text-muted-foreground">همه موقعیت‌ها بسته شده‌اند</p>
            </div>
          ) : (
            <div className="max-h-[280px] divide-y divide-border/60 overflow-y-auto scroll-slim">
              {data.openPositions.map((p) => (
                <div key={p.id} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{p.symbol}</span>
                    <DirectionBadge direction={p.direction} />
                    <span className="num ml-auto text-xs text-muted-foreground">
                      {p.volume.toFixed(2)} lots
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-end justify-between gap-2">
                    <div className="min-w-0 text-[11px] text-muted-foreground">
                      <div className="num">{fmtDuration(p.durationMinutes)}</div>
                      <div className="num truncate">commission {money(p.commission, { sign: true })}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <PnlValue value={p.profit + p.swap} className="text-sm font-semibold" currency={currency} />
                      <div className="num text-[10px] text-muted-foreground">
                        swap {money(p.swap, { sign: true })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}
