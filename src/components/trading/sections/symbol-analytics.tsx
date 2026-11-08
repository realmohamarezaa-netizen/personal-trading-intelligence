'use client'

// ─── Symbol Analytics — per-symbol performance, direction split ──────────────

import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { AnalyticsData, RangeKey, SymbolStat } from '@/lib/types'
import { cn } from '@/lib/utils'
import { fmtCompact, fmtDuration, fmtMoney, fmtNum, fmtPct, fmtPF } from '@/lib/format'
import {
  Card,
  CardContent,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CHART,
  DirectionBadge,
  Panel,
  PnlValue,
  SectionHeader,
} from '@/components/trading/shared/ui'
import { RangeFilter } from '@/components/trading/shared/filters'

/** Profit-factor color tone */
function pfClass(pf: number | null): string {
  if (pf === null) return 'text-muted-foreground'
  return pf >= 1.5 ? 'pnl-pos' : pf < 1 ? 'pnl-neg' : 'text-muted-foreground'
}

/** Small label/value pair used inside the direction hero cards */
function Kv({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  )
}

const CURSOR = { fill: 'oklch(1 0 0 / 4%)' }

export function SymbolSection({
  data,
  range,
  onRange,
  customFrom,
  customTo,
  onCustomChange,
}: {
  data: AnalyticsData
  range: RangeKey
  onRange: (r: RangeKey) => void
  customFrom: string
  customTo: string
  onCustomChange: (from: string, to: string) => void
}) {
  const currency = data.account.currency
  const money = (n: number | null | undefined, opts?: { sign?: boolean; decimals?: number }) =>
    fmtMoney(n, { ...opts, currency })
  const directions = data.directions
  const totalAbs = directions.reduce((a, d) => a + Math.abs(d.netPnl), 0)

  const byPnl: SymbolStat[] = [...data.symbols].sort((a, b) => b.netPnl - a.netPnl)
  const maxDd = data.symbols.reduce((m, s) => Math.max(m, s.ddPct), 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="space-y-4"
    >
      <SectionHeader
        title="Symbol Analytics"
        subtitle="هر نماد یک شخصیت است — کدام نماد برایت پول می‌سازد؟"
      >
        <RangeFilter
          value={range}
          onChange={onRange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={onCustomChange}
        />
      </SectionHeader>

      {/* ── Buy vs Sell hero ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {directions.map((d) => (
          <Card
            key={d.direction}
            className="glow-line border-border/70 bg-card/80 backdrop-blur-sm"
          >
            <CardContent className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex h-9 items-center">
                  <span className="inline-block origin-left scale-[1.6] pl-1">
                    <DirectionBadge direction={d.direction} />
                  </span>
                </div>
                <PnlValue value={d.netPnl} className="text-2xl font-bold" />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
                <Kv label="Trades" value={<span className="num">{d.trades}</span>} />
                <Kv label="Win Rate" value={<span className="num">{fmtPct(d.winRate, 1)}</span>} />
                <Kv
                  label="Profit Factor"
                  value={
                    <span className={cn('num', pfClass(d.profitFactor))}>
                      {fmtPF(d.profitFactor)}
                    </span>
                  }
                />
                <Kv label="Avg Win" value={<span className="num pnl-pos">{money(d.avgWin)}</span>} />
                <Kv label="Avg Loss" value={<span className="num pnl-neg">{money(d.avgLoss)}</span>} />
                <Kv
                  label="Avg R"
                  value={<span className="num">{d.avgR === null ? '—' : fmtNum(d.avgR, 2)}</span>}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* share-of-total-pnl comparison bar */}
      <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted/40" aria-hidden>
          {directions.map((d) => {
            const pct = totalAbs > 0 ? (Math.abs(d.netPnl) / totalAbs) * 100 : 50
            return (
              <div
                key={d.direction}
                style={{ width: `${pct}%`, background: d.netPnl >= 0 ? CHART.pos : CHART.neg }}
              />
            )
          })}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[10px]">
          {directions.map((d) => (
            <span key={d.direction} className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: d.netPnl >= 0 ? CHART.pos : CHART.neg }}
                aria-hidden
              />
              <span className="font-semibold text-foreground">{d.direction}</span>
              <span className="num">{money(d.netPnl, { sign: true })}</span>
              <span className="num">
                ({totalAbs > 0 ? ((Math.abs(d.netPnl) / totalAbs) * 100).toFixed(0) : '—'}% share)
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Symbols table ── */}
      <Panel
        title="Symbol Breakdown"
        description="جدول کامل نمادها"
        bodyClassName="p-0 pb-1"
      >
        {data.symbols.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-muted-foreground">
            No closed trades in this range
          </div>
        ) : (
          <div className="scroll-slim overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Symbol</TableHead>
                  <TableHead className="text-right">Trades</TableHead>
                  <TableHead className="text-right">Win Rate</TableHead>
                  <TableHead className="text-right">Profit Factor</TableHead>
                  <TableHead className="text-right">Net P/L</TableHead>
                  <TableHead className="text-right">DD%</TableHead>
                  <TableHead className="text-right">Avg R</TableHead>
                  <TableHead className="text-right">Buy P/L</TableHead>
                  <TableHead className="text-right">Sell P/L</TableHead>
                  <TableHead className="text-right">Volume</TableHead>
                  <TableHead className="pr-4 text-right">Avg Hold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.symbols.map((s) => (
                  <TableRow key={s.symbol} className="transition-colors hover:bg-muted/40">
                    <TableCell className="pl-4 font-semibold">{s.symbol}</TableCell>
                    <TableCell className="num text-right">{s.trades}</TableCell>
                    <TableCell className="num text-right">{fmtPct(s.winRate, 1)}</TableCell>
                    <TableCell className={cn('num text-right', pfClass(s.profitFactor))}>
                      {fmtPF(s.profitFactor)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PnlValue value={s.netPnl} />
                    </TableCell>
                    <TableCell className="num pnl-neg text-right">{fmtPct(s.ddPct, 1)}</TableCell>
                    <TableCell className="num text-right">
                      {s.avgR === null ? '—' : fmtNum(s.avgR, 2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <PnlValue value={s.buyPnl} className="text-xs" />
                    </TableCell>
                    <TableCell className="text-right">
                      <PnlValue value={s.sellPnl} className="text-xs" />
                    </TableCell>
                    <TableCell className="num text-right text-muted-foreground">
                      {fmtNum(s.volume, 2)}
                    </TableCell>
                    <TableCell className="num pr-4 text-right text-muted-foreground">
                      {fmtDuration(s.avgHoldMinutes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      {/* ── Charts row ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Net P/L by Symbol" description="سود و زیان خالص هر نماد">
          {byPnl.length === 0 ? (
            <div className="flex h-[230px] items-center justify-center text-xs text-muted-foreground">
              No data in this range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={byPnl} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="symbol"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tickFormatter={(v: number) => fmtCompact(v, data.account.currency)} width={48} axisLine={false} tickLine={false} />
                <Tooltip
                  {...CHART.tooltip}
                  cursor={CURSOR}
                  formatter={(v) => money(Number(v))}
                />
                <Bar dataKey="netPnl" radius={[3, 3, 0, 0]} maxBarSize={26}>
                  {byPnl.map((s) => (
                    <Cell key={s.symbol} fill={s.netPnl >= 0 ? CHART.pos : CHART.neg} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Buy vs Sell by Symbol" description="مقایسه خرید و فروش در هر نماد">
          {byPnl.length === 0 ? (
            <div className="flex h-[230px] items-center justify-center text-xs text-muted-foreground">
              No data in this range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={byPnl} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={CHART.grid} vertical={false} />
                <XAxis
                  dataKey="symbol"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tickFormatter={(v: number) => fmtCompact(v, data.account.currency)} width={48} axisLine={false} tickLine={false} />
                <Tooltip
                  {...CHART.tooltip}
                  cursor={CURSOR}
                  formatter={(v) => money(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="buyPnl" name="Buy P/L" stackId="a" fill={CHART.pos} maxBarSize={26} />
                <Bar
                  dataKey="sellPnl"
                  name="Sell P/L"
                  stackId="a"
                  fill={CHART.neg}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={26}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>
      </div>

      {/* ── Per-symbol mini-strip ── */}
      {data.symbols.length > 0 && (
        <Panel title="Per-Symbol Snapshot" description="مقایسه سریع ریسک و وین‌ریت نمادها">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {data.symbols.map((s) => (
              <div
                key={s.symbol}
                className="rounded-lg border border-border/60 bg-muted/20 p-3"
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-semibold">{s.symbol}</span>
                  <span className="num rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
                    {fmtPct(s.winRate, 0)} WR
                  </span>
                </div>
                <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-[var(--neg)]/70"
                    style={{ width: `${maxDd > 0 ? Math.max(4, (s.ddPct / maxDd) * 100) : 0}%` }}
                  />
                </div>
                <div className="num mt-1.5 flex items-center justify-between text-[9px] text-muted-foreground">
                  <span>DD {fmtPct(s.ddPct, 1)}</span>
                  <span>{fmtNum(s.volume, 1)} lots</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </motion.div>
  )
}
