'use client'

// ─── Risk Analytics — drawdowns, underwater curve, open exposure ─────────────

import { motion } from 'framer-motion'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarX,
  Gauge,
  RotateCcw,
  ShieldAlert,
  Timer,
  Waves,
} from 'lucide-react'
import type { AnalyticsData } from '@/lib/types'
import { cn } from '@/lib/utils'
import { currencySymbol, fmtDate, fmtDuration, fmtMoney, fmtNum, fmtPct } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { CHART, Panel, PnlValue, SectionHeader, StatCard } from '@/components/trading/shared/ui'

const CURSOR = { stroke: CHART.axis, strokeDasharray: '3 3' }

const badgePos = 'border-transparent bg-[var(--pos)]/12 text-[var(--pos)]'
const badgeWarn = 'border-transparent bg-[var(--warn)]/12 text-[var(--warn)]'

/** "3.5" → "3.5d", "12" → "12d" */
function fmtDays(d: number): string {
  return `${Number.isInteger(d) ? d : d.toFixed(1)}d`
}

export function RiskSection({ data }: { data: AnalyticsData }) {
  const risk = data.risk
  const currency = data.account.currency
  const money = (n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }) =>
    fmtMoney(n, { ...opts, currency })
  const maxVolume = risk.openExposure.reduce((m, o) => Math.max(m, o.volume), 0)
  const inDrawdown = risk.currentDdPct > 0

  const ddBasisLabel =
    risk.ddBasis === 'equity'
      ? 'basis: floating equity snapshots (connector sampling)'
      : 'basis: realized balance curve'
  const dailyDdBasisLabel =
    risk.dailyDdBasis === 'equity'
      ? 'worst intraday equity drop per trading day (account timezone)'
      : 'worst realized balance drop per trading day — no intraday snapshots in range'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="space-y-4"
    >
      <SectionHeader
        title="Risk Analytics"
        subtitle={`ریسک را نمی‌شود حذف کرد، اما می‌شود مهار کرد — ${ddBasisLabel}`}
      />

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Max Equity DD"
          value={fmtPct(risk.maxDdPct)}
          sub={money(-risk.maxDdAbs)}
          tone="neg"
          icon={<ShieldAlert className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Max Daily DD"
          value={fmtPct(risk.maxDailyDdPct)}
          sub={money(-risk.maxDailyDdAbs)}
          tone="neg"
          icon={<CalendarX className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Current DD"
          value={fmtPct(risk.currentDdPct)}
          sub={inDrawdown ? 'in drawdown' : 'At peak'}
          tone={inDrawdown ? 'warn' : 'pos'}
          icon={<Waves className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Avg DD"
          value={fmtPct(risk.avgDdPct)}
          icon={<Gauge className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Longest DD Duration"
          value={risk.longestDdDays > 0 ? fmtDuration(risk.longestDdDays * 1440) : '—'}
          icon={<Timer className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label="Longest Recovery"
          value={risk.longestRecoveryDays !== null ? `${risk.longestRecoveryDays}d` : '—'}
          sub="peak-to-new-high"
          icon={<RotateCcw className="h-4 w-4" aria-hidden />}
        />
      </div>

      {risk.equityMaxDdPct !== null && (
        <p className="text-[11px] text-muted-foreground">
          Floating (equity-snapshot) max drawdown in this range:{' '}
          <span className="num font-semibold text-[var(--neg)]">{fmtPct(risk.equityMaxDdPct, 2)}</span>{' '}
          ({fmtMoney(-risk.equityMaxDdAbs!, { currency })}) · snapshots used:{' '}
          <span className="num">{risk.snapshotCount}</span>
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">Daily drawdown — {dailyDdBasisLabel}.</p>

      {/* ── Underwater curve ── */}
      <Panel
        title="Underwater Curve"
        description={`${risk.ddBasis === 'equity' ? 'Floating equity' : 'Realized balance'} — ${risk.ddBasis === 'equity' ? 'نمونه‌برداری کانکتور (~۴۵ ثانیه)' : 'منحنی تحقق‌یافته'}`}
      >
        {risk.underwater.length === 0 ? (
          <div className="flex h-[220px] items-center justify-center text-xs text-muted-foreground">
            No equity data in this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={risk.underwater} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="underwaterFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={CHART.neg} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={CHART.neg} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={(t) => fmtDate(String(t))}
                minTickGap={40}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `${v}%`}
                domain={['dataMin', 0]}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                {...CHART.tooltip}
                cursor={CURSOR}
                formatter={(v) => `-${Math.abs(Number(v))}%`}
                labelFormatter={(t) => fmtDate(String(t))}
              />
              <Area
                type="monotone"
                dataKey="pct"
                stroke={CHART.neg}
                strokeWidth={1.5}
                fill="url(#underwaterFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Panel>

      {/* ── DD periods + open exposure ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Drawdown Periods" description="عمیق‌ترین افت‌های سرمایه" bodyClassName="p-0 pb-1">
          {risk.ddPeriods.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-muted-foreground">
              No drawdown periods recorded — equity sits at highs.
            </div>
          ) : (
            <div className="scroll-slim max-h-72 overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-4">Start</TableHead>
                    <TableHead>End</TableHead>
                    <TableHead className="text-right">Depth %</TableHead>
                    <TableHead className="text-right">Depth {currencySymbol(currency)}</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                    <TableHead className="pr-4 text-right">Recovered</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {risk.ddPeriods.map((p, i) => (
                    <TableRow key={`${p.start}-${i}`} className="transition-colors hover:bg-muted/40">
                      <TableCell className="num pl-4 text-xs">{fmtDate(p.start)}</TableCell>
                      <TableCell className="text-xs">
                        {p.end ? (
                          <span className="num">{fmtDate(p.end)}</span>
                        ) : (
                          <Badge className={badgeWarn}>ongoing</Badge>
                        )}
                      </TableCell>
                      <TableCell className="num pnl-neg text-right text-xs">
                        {fmtPct(p.depthPct, 2)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        <PnlValue value={-p.depthAbs} className="text-xs" currency={currency} />
                      </TableCell>
                      <TableCell className="num text-right text-xs">{fmtDays(p.days)}</TableCell>
                      <TableCell className="pr-4 text-right">
                        {p.recovered ? (
                          <Badge className={badgePos}>yes</Badge>
                        ) : (
                          <Badge className={badgeWarn}>ongoing</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Open Risk Exposure" description="حجم باز در بازار">
          {risk.openExposure.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">No open exposure</div>
          ) : (
            <>
              <div className="space-y-2.5">
                {risk.openExposure.map((o) => (
                  <div key={o.symbol} className="flex items-center gap-3">
                    <span className="w-16 shrink-0 truncate text-xs font-semibold sm:w-20">
                      {o.symbol}
                    </span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                      <div
                        className="h-full rounded-full bg-[var(--info)]"
                        style={{
                          width: `${maxVolume > 0 ? Math.max(2, (o.volume / maxVolume) * 100) : 0}%`,
                        }}
                      />
                    </div>
                    <span className="num w-20 shrink-0 text-right text-xs text-muted-foreground">
                      {fmtNum(o.volume, 2)} lots
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Largest Loss
                  </div>
                  <PnlValue value={risk.largestLoss} className="text-sm font-semibold" currency={currency} />
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Largest Win
                  </div>
                  <PnlValue value={risk.largestWin} className="text-sm font-semibold" currency={currency} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Consecutive Losses
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        'num rounded-full border px-2 py-0.5 text-[10px]',
                        risk.currentConsecLosses > 0
                          ? 'border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]'
                          : 'border-border/60 bg-muted/40 text-muted-foreground'
                      )}
                    >
                      {risk.currentConsecLosses}
                    </span>
                    <span className="num rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">
                      (max {risk.maxConsecLosses})
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </Panel>
      </div>
    </motion.div>
  )
}
