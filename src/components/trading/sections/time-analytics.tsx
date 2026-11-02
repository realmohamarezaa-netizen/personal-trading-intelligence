'use client'

// ─── Time Analytics — hourly / weekday / session performance (Tehran time) ───

import { Fragment } from 'react'
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
  CalendarCheck,
  CalendarX,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import type { AnalyticsData, MatrixCell } from '@/lib/types'
import { fmtHour, fmtMoney, fmtSigned, heatColor } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/card'
import {
  CHART,
  Panel,
  PnlValue,
  SectionHeader,
  StatCard,
} from '@/components/trading/shared/ui'

/** Tehran week order — row index matches analytics matrix day (0 = Saturday) */
const DAY_SHORT = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** Compact axis money: $1.2k / -$840 */
function compactMoney(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1000) return `${v < 0 ? '-' : ''}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `${v < 0 ? '-' : ''}$${Math.round(abs)}`
}

const CURSOR = { fill: 'oklch(1 0 0 / 4%)' }

export function TimeSection({ data }: { data: AnalyticsData }) {
  const time = data.time

  // ── Heatmap lookups (cells exist only where trades occurred) ──
  const matrixMap = new Map<string, MatrixCell>()
  let maxAbs = 0
  for (const c of time.matrix) {
    matrixMap.set(`${c.day}-${c.hour}`, c)
    maxAbs = Math.max(maxAbs, Math.abs(c.pnl))
  }

  const activeHours = time.hourly.filter((h) => h.trades > 0)
  const hourTicks = activeHours.filter((h) => h.hour % 3 === 0).map((h) => h.hour)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="space-y-4"
    >
      <SectionHeader
        title="Time Analytics"
        subtitle="در چه ساعتی و چه روزی بهترین عملکرد را داری؟ (به وقت تهران)"
      />

      {/* ── Best / worst hour & day ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Best Hour"
          value={time.bestHour ? fmtHour(time.bestHour.hour) : '—'}
          sub={
            time.bestHour
              ? `${fmtSigned(time.bestHour.pnl)} · ${time.bestHour.trades} trades`
              : 'no data yet'
          }
          tone={time.bestHour ? 'pos' : 'neutral'}
          icon={<TrendingUp className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Worst Hour"
          value={time.worstHour ? fmtHour(time.worstHour.hour) : '—'}
          sub={
            time.worstHour
              ? `${fmtSigned(time.worstHour.pnl)} · ${time.worstHour.trades} trades`
              : 'no data yet'
          }
          tone={time.worstHour ? 'neg' : 'neutral'}
          icon={<TrendingDown className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Best Day"
          value={time.bestDay ? time.bestDay.name : '—'}
          sub={time.bestDay ? fmtSigned(time.bestDay.pnl) : 'no data yet'}
          tone={time.bestDay ? 'pos' : 'neutral'}
          icon={<CalendarCheck className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Worst Day"
          value={time.worstDay ? time.worstDay.name : '—'}
          sub={time.worstDay ? fmtSigned(time.worstDay.pnl) : 'no data yet'}
          tone={time.worstDay ? 'neg' : 'neutral'}
          icon={<CalendarX className="h-4 w-4" aria-hidden />}
        />
      </div>

      {/* ── Weekly × hourly heatmap (flagship) ── */}
      <Panel
        title="Weekly Heatmap"
        description="سود/زیان هر ساعت در هفته — ستون‌ها به وقت تهران"
        bodyClassName="px-4 pb-4 pt-3"
      >
        <div className="scroll-slim overflow-x-auto pb-1">
          <div
            className="grid min-w-[860px] gap-x-1 gap-y-1"
            style={{ gridTemplateColumns: '3.5rem repeat(24, minmax(0, 1fr))' }}
            role="img"
            aria-label="Weekly P/L heatmap: 7 Tehran weekdays (rows) by 24 hours (columns)"
          >
            {/* header row — every 2nd hour label to avoid clutter */}
            <div className="sticky left-0 z-10 bg-card" />
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={`hdr-${h}`}
                className="num text-center text-[9px] leading-4 text-muted-foreground"
              >
                {h % 2 === 0 ? fmtHour(h) : ''}
              </div>
            ))}

            {/* one row per Tehran weekday: 0 = Sat … 6 = Fri */}
            {DAY_SHORT.map((dayName, d) => (
              <Fragment key={dayName}>
                <div className="sticky left-0 z-10 flex h-7 items-center bg-card pr-2 text-xs text-muted-foreground">
                  {dayName}
                </div>
                {Array.from({ length: 24 }, (_, h) => {
                  const cell = matrixMap.get(`${d}-${h}`)
                  return (
                    <div
                      key={`${d}-${h}`}
                      title={
                        cell
                          ? `${dayName} ${fmtHour(h)} · ${fmtMoney(cell.pnl, { sign: true })} · ${cell.trades} trades`
                          : `${dayName} ${fmtHour(h)} · no trades`
                      }
                      className={
                        cell
                          ? 'h-7 rounded-sm transition-[filter] hover:brightness-125'
                          : 'h-7 rounded-sm bg-muted/30'
                      }
                      style={cell ? { background: heatColor(cell.pnl, maxAbs) } : undefined}
                    />
                  )
                })}
              </Fragment>
            ))}
          </div>
        </div>

        {/* legend: neg → muted → pos */}
        <div className="mt-3 flex items-center gap-2">
          <span className="num text-[10px] text-muted-foreground">
            {fmtMoney(-maxAbs, { sign: true })}
          </span>
          <div
            className="h-1.5 flex-1 rounded-full"
            style={{
              background: 'linear-gradient(90deg, var(--neg), var(--muted-foreground), var(--pos))',
            }}
            aria-hidden
          />
          <span className="num text-[10px] text-muted-foreground">
            {fmtMoney(maxAbs, { sign: true })}
          </span>
        </div>
      </Panel>

      {/* ── Hourly cumulative P/L ── */}
      <Panel title="Hourly Performance" description="سود و زیان تجمعی هر ساعت">
        {activeHours.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
            No trades in this range yet
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={activeHours} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="hour"
                ticks={hourTicks}
                tickFormatter={(h) => fmtHour(Number(h))}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={compactMoney}
                width={48}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                {...CHART.tooltip}
                cursor={CURSOR}
                formatter={(v) => fmtMoney(Number(v))}
                labelFormatter={(h) => `${fmtHour(Number(h))} Tehran`}
              />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={22}>
                {activeHours.map((h) => (
                  <Cell key={h.hour} fill={h.pnl >= 0 ? CHART.pos : CHART.neg} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* ── Trading sessions (approximate, Tehran hours) ── */}
      <Panel title="Trading Sessions" description="سشن‌های معاملاتی (تقریبی به وقت تهران)">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {time.sessions.map((s) => (
            <Card key={s.name} className="border-border/70 bg-card/80">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{s.name}</span>
                  <Activity className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden />
                </div>
                <div className="num mt-0.5 text-[10px] text-muted-foreground">{s.hoursLabel}</div>
                <PnlValue value={s.pnl} className="mt-1.5 block text-sm font-semibold" />
                <div className="num mt-0.5 text-[10px] text-muted-foreground">
                  {s.trades} trades · WR {s.winRate}%
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Panel>

      {/* ── Day of week ── */}
      <Panel title="Day of Week" description="عملکرد روزهای هفته">
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={time.dayStats} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART.grid} vertical={false} />
            <XAxis
              dataKey="name"
              tickFormatter={(n) => String(n).slice(0, 3)}
              interval={0}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tickFormatter={compactMoney}
              width={48}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              {...CHART.tooltip}
              cursor={CURSOR}
              formatter={(v) => fmtMoney(Number(v))}
              labelFormatter={(n) => `${n} (Tehran week)`}
            />
            <Bar dataKey="pnl" radius={[3, 3, 0, 0]} maxBarSize={36}>
              {time.dayStats.map((d) => (
                <Cell key={d.day} fill={d.pnl >= 0 ? CHART.pos : CHART.neg} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Panel>
    </motion.div>
  )
}
