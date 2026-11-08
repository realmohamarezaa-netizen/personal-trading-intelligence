'use client'

// ─── Strategies — strategy library + per-strategy performance (P4) ───────────

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Plus, Pencil, Trash2, Target, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react'
import {
  createStrategy,
  deleteStrategy,
  fetchStrategies,
  updateStrategy,
  type StrategyRow,
  type StrategyStatRow,
} from '@/lib/api-client'
import { fmtCompact, fmtMoney, fmtNum, fmtPF, fmtPct } from '@/lib/format'
import { fmtHour } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { CHART, Panel, SectionHeader } from '../shared/ui'
import { cn } from '@/lib/utils'

interface Draft {
  id: string | null // null = create
  name: string
  description: string
  color: string
  magicNumbers: string
}

const EMPTY: Draft = { id: null, name: '', description: '', color: '#34d399', magicNumbers: '' }

export function StrategiesSection({ accountId }: { accountId?: string }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<StrategyRow | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['strategies', accountId],
    queryFn: () => fetchStrategies(accountId || undefined),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['strategies'] })
    queryClient.invalidateQueries({ queryKey: ['journal'] })
    queryClient.invalidateQueries({ queryKey: ['analytics'] })
  }

  const save = useMutation({
    mutationFn: (d: Draft) =>
      d.id
        ? updateStrategy(d.id, {
            name: d.name,
            description: d.description,
            color: d.color,
            magicNumbers: d.magicNumbers,
          })
        : createStrategy({
            name: d.name,
            description: d.description,
            color: d.color,
            magicNumbers: d.magicNumbers,
          }),
    onSuccess: () => {
      setDraft(null)
      invalidate()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteStrategy(id),
    onSuccess: () => {
      setConfirmDelete(null)
      invalidate()
    },
  })

  const currency = data?.currency ?? 'USD'
  const stats = data?.stats ?? []

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Strategies — استراتژی‌ها"
        subtitle="کتابخانهٔ استراتژی‌ها، نگاشت Magic Number و مقایسهٔ عملکرد هر استراتژی"
      >
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => refetch()}
          aria-label="Refresh strategies"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
        </Button>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setDraft({ ...EMPTY })}>
          <Plus className="h-3.5 w-3.5" /> New Strategy
        </Button>
      </SectionHeader>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[86px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : isError || !data ? (
        <Panel>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <AlertTriangle className="h-7 w-7 text-[var(--neg)]" />
            <p className="text-sm font-semibold">Could not load strategies</p>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          {/* Comparison chart */}
          {stats.length > 0 && (
            <Panel title="Net P/L by strategy" description="مقایسهٔ سود خالص استراتژی‌ها (کل تاریخچهٔ حساب فعال)">
              <div className="h-56 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 10, fill: CHART.axis }}
                      axisLine={{ stroke: CHART.grid }}
                      tickLine={false}
                      interval={0}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: CHART.axis }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => fmtCompact(v, currency)}
                      width={64}
                    />
                    <Tooltip
                      contentStyle={CHART.tooltip.contentStyle}
                      labelStyle={CHART.tooltip.labelStyle}
                      itemStyle={CHART.tooltip.itemStyle}
                      cursor={{ fill: 'oklch(1 0 0 / 4%)' }}
                      formatter={(value: number | string) => [fmtMoney(Number(value), { currency }), 'Net P/L']}
                    />
                    <Bar dataKey="netProfit" radius={[4, 4, 0, 0]} maxBarSize={56}>
                      {stats.map((s) => (
                        <Cell key={s.strategyId ?? 'unassigned'} fill={s.color ?? (s.netProfit >= 0 ? CHART.pos : CHART.neg)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          )}

          {/* Stats table */}
          <Panel
            title={`Strategy performance (${stats.length})`}
            description="روی هر ردیف کلیک کنید تا عملکرد به‌تفکیک نماد و ساعت باز شود"
            bodyClassName="p-0"
          >
            {stats.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Target className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm font-medium">هنوز استراتژی‌ای ثبت نشده</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  یک استراتژی بسازید، Magic Number آن را وارد کنید تا معاملات MT5 به‌صورت خودکار
                  دسته‌بندی شوند — یا استراتژی معاملات را دستی از داخل ژورنال تغییر دهید.
                </p>
                <Button size="sm" className="mt-2 gap-1.5" onClick={() => setDraft({ ...EMPTY })}>
                  <Plus className="h-3.5 w-3.5" /> New Strategy
                </Button>
              </div>
            ) : (
              <div className="max-h-[480px] overflow-y-auto scroll-slim">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strategy</TableHead>
                      <TableHead className="text-center">Trades</TableHead>
                      <TableHead className="text-center">Win Rate</TableHead>
                      <TableHead className="text-center">PF</TableHead>
                      <TableHead className="text-center">Expectancy</TableHead>
                      <TableHead className="text-center">Avg R</TableHead>
                      <TableHead className="text-center">Max DD</TableHead>
                      <TableHead className="text-center">Loss Streak</TableHead>
                      <TableHead className="text-right">Net P/L</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.map((s) => (
                      <StratRow
                        key={s.strategyId ?? 'unassigned'}
                        s={s}
                        currency={currency}
                        expanded={expanded === (s.strategyId ?? 'unassigned')}
                        onToggle={() => setExpanded(expanded === (s.strategyId ?? 'unassigned') ? null : (s.strategyId ?? 'unassigned'))}
                        onEdit={() => {
                          const row = data.strategies.find((x) => x.id === s.strategyId)
                          setDraft({
                            id: s.strategyId,
                            name: row?.name ?? s.name,
                            description: row?.description ?? '',
                            color: row?.color ?? '#34d399',
                            magicNumbers: row?.magicNumbers ?? '',
                          })
                        }}
                        onDelete={() => {
                          const row = data.strategies.find((x) => x.id === s.strategyId)
                          if (row) setConfirmDelete(row)
                        }}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>

          {/* Library */}
          {data.strategies.length > 0 && (
            <Panel title="Strategy library" description="نگاشت Magic Number: معاملات MT5 با این شماره‌ها خودکار به استراتژی متصل می‌شوند">
              <div className="grid gap-2 sm:grid-cols-2">
                {data.strategies.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? 'var(--pos)' }} />
                        <span className="truncate text-sm font-semibold">{s.name}</span>
                      </div>
                      {s.description && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>
                      )}
                      <p className="num mt-1 text-[10px] text-muted-foreground/70">
                        Magic: {s.magicNumbers || '— (manual only)'}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        aria-label={`Edit ${s.name}`}
                        onClick={() =>
                          setDraft({
                            id: s.id,
                            name: s.name,
                            description: s.description ?? '',
                            color: s.color ?? '#34d399',
                            magicNumbers: s.magicNumbers,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-[var(--neg)] hover:text-[var(--neg)]"
                        aria-label={`Delete ${s.name}`}
                        onClick={() => setConfirmDelete(s)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                حذف یک استراتژی معاملات آن را حذف نمی‌کند — فقط ارتباط برقرار می‌شود (تخصیص دستی در ژورنال باقی می‌ماند).
              </p>
            </Panel>
          )}
        </>
      )}

      {/* Create / edit dialog */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{draft?.id ? 'Edit strategy' : 'New strategy'}</DialogTitle>
            <DialogDescription>
              Magic Numberها را با کاما جدا کنید؛ معاملات MT5 با آن شماره‌ها خودکار به این استراتژی متصل می‌شوند.
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="strat-name">Name</label>
                <Input
                  id="strat-name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="e.g. London Breakout"
                  maxLength={64}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium" htmlFor="strat-desc">Description</label>
                <Textarea
                  id="strat-desc"
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="قوانین ورود/خروج، تایم‌فریم، شرایط ستاپ…"
                  rows={2}
                  maxLength={256}
                />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium" htmlFor="strat-magic">Magic Numbers</label>
                  <Input
                    id="strat-magic"
                    value={draft.magicNumbers}
                    onChange={(e) => setDraft({ ...draft, magicNumbers: e.target.value })}
                    placeholder="101, 102"
                    className="num"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium" htmlFor="strat-color">Color</label>
                  <input
                    id="strat-color"
                    type="color"
                    value={draft.color}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    className="h-9 w-14 cursor-pointer rounded-md border border-border/70 bg-muted/40 p-1"
                    aria-label="Strategy color"
                  />
                </div>
              </div>
              {save.isError && (
                <p className="text-xs text-[var(--neg)]">
                  {save.error instanceof Error ? save.error.message : 'Save failed'}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" onClick={() => draft && save.mutate(draft)} disabled={!draft?.name.trim() || save.isPending}>
              {save.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {draft?.id ? 'Save changes' : 'Create strategy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{confirmDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              استراتژی حذف می‌شود ولی هیچ معامله‌ای پاک نمی‌شود؛ معاملات آن به حالت Unassigned می‌روند.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--neg)] text-white hover:bg-[var(--neg)]/85"
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              {remove.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              Delete strategy
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function StratRow({
  s,
  currency,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  s: StrategyStatRow
  currency: string
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const tone = s.netProfit > 0 ? 'text-[var(--pos)]' : s.netProfit < 0 ? 'text-[var(--neg)]' : ''
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color ?? 'var(--muted-foreground)' }} />
            <span className="font-medium">{s.name}</span>
          </div>
        </TableCell>
        <TableCell className="num text-center">{s.totalTrades}</TableCell>
        <TableCell className="num text-center">{fmtPct(s.winRate)}</TableCell>
        <TableCell className="num text-center">{fmtPF(s.profitFactor)}</TableCell>
        <TableCell className="num text-center">{s.expectancy !== null ? fmtMoney(s.expectancy, { currency, sign: true }) : '—'}</TableCell>
        <TableCell className="num text-center">{s.avgR !== null ? `${fmtNum(s.avgR)}R` : '—'}</TableCell>
        <TableCell className="num text-center">{fmtMoney(s.maxDd, { currency })}</TableCell>
        <TableCell className="num text-center">{s.maxConsecLosses}</TableCell>
        <TableCell className={`num text-right font-semibold ${tone}`}>
          {fmtMoney(s.netProfit, { currency, sign: true })}
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow>
          <TableCell colSpan={9} className="bg-muted/20">
            <div className="grid gap-4 p-2 md:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By symbol</p>
                <div className="space-y-1">
                  {s.bySymbol.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                  {s.bySymbol.map((b) => (
                    <div key={b.symbol} className="flex items-center justify-between gap-2 text-xs">
                      <span className="num">{b.symbol}</span>
                      <span className="text-muted-foreground">{b.trades} trades</span>
                      <span className={cn('num font-medium', b.pnl >= 0 ? 'text-[var(--pos)]' : 'text-[var(--neg)]')}>
                        {fmtMoney(b.pnl, { currency, sign: true })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">By entry hour</p>
                <div className="flex flex-wrap gap-1">
                  {s.byHour.length === 0 && <p className="text-xs text-muted-foreground">—</p>}
                  {s.byHour.map((h) => (
                    <span
                      key={h.hour}
                      title={`${h.trades} trades`}
                      className={cn(
                        'num rounded px-1.5 py-0.5 text-[10px]',
                        h.pnl >= 0 ? 'bg-[var(--pos)]/12 text-[var(--pos)]' : 'bg-[var(--neg)]/12 text-[var(--neg)]'
                      )}
                    >
                      {fmtHour(h.hour)} {fmtCompact(h.pnl, currency)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="md:col-span-2 flex justify-end gap-1.5">
                <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={(e) => { e.stopPropagation(); onEdit() }}>
                  <Pencil className="h-3 w-3" /> Edit
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-[var(--neg)] hover:text-[var(--neg)]"
                  onClick={(e) => { e.stopPropagation(); onDelete() }}
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
