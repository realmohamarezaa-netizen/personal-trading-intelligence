'use client'

// ─── Trading Journal — filterable trade log with inline trade-file editors ───

import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Download, Loader2, RefreshCw, Search } from 'lucide-react'
import type { AnalyticsData, JournalTrade, RangeKey } from '@/lib/types'
import { TRADE_EMOTIONS, TRADE_MISTAKES, TRADE_TAGS } from '@/lib/types'
import { fetchJournal, updateTrade } from '@/lib/api-client'
import { fmtDateTime, fmtDuration, fmtNum, pnlTone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { DirectionBadge, Panel, PnlValue, SectionHeader, TagBadge } from '@/components/trading/shared/ui'
import { DimensionFilter, RangeFilter } from '@/components/trading/shared/filters'

// ─── Local helpers ────────────────────────────────────────────────────────────

const CHIP_HUES = ['var(--pos)', 'var(--info)', 'var(--warn)', 'var(--neg)', 'oklch(0.7 0.15 300)', 'oklch(0.78 0.13 200)']

function chipColor(label: string): string {
  let hash = 0
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0
  return CHIP_HUES[hash % CHIP_HUES.length]
}

/** Toggle chip for tags/mistakes editors — selected = TagBadge-like filled colors */
function ToggleChip({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  const color = chipColor(label)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-medium transition-all hover:brightness-110',
        selected
          ? 'font-semibold'
          : 'border-border/70 text-muted-foreground hover:text-foreground'
      )}
      style={
        selected
          ? {
              color,
              borderColor: `color-mix(in oklab, ${color} 45%, transparent)`,
              background: `color-mix(in oklab, ${color} 16%, transparent)`,
            }
          : undefined
      }
    >
      {label}
    </button>
  )
}

function EditorLabel({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
    </div>
  )
}

/** Key/value row used in the detail dialog */
function KV({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-0.5 border-b border-border/40 pb-1.5', className)}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-xs font-medium">{children}</span>
    </div>
  )
}

function fmtPrice(p: number | null): string {
  if (p === null || !isFinite(p)) return '—'
  return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 5 })
}

function toggle(list: string[], set: (v: string[]) => void, value: string) {
  set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value])
}

// ─── Section ──────────────────────────────────────────────────────────────────

type ResultKey = '' | 'win' | 'loss' | 'be'
type StatusKey = '' | 'OPEN' | 'CLOSED'

export function JournalSection({ data }: { data: AnalyticsData }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Local filter state
  const [range, setRange] = useState<RangeKey>('30d')
  const [symbol, setSymbol] = useState('')
  const [strategyId, setStrategyId] = useState('')
  const [result, setResult] = useState<ResultKey>('')
  const [status, setStatus] = useState<StatusKey>('CLOSED')
  const [q, setQ] = useState('')

  const filters = useMemo(
    () => ({
      range,
      symbol: symbol || undefined,
      strategyId: strategyId || undefined,
      result: (result || undefined) as 'win' | 'loss' | 'be' | undefined,
      status: (status || undefined) as 'OPEN' | 'CLOSED' | undefined,
      q: q || undefined,
    }),
    [range, symbol, strategyId, result, status, q]
  )

  const { data: journal, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['journal', filters],
    queryFn: () => fetchJournal(filters),
  })

  const trades = journal?.trades ?? []
  const netSum = useMemo(() => trades.reduce((acc, t) => acc + t.netProfit, 0), [trades])

  // Detail dialog + editor state
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editTags, setEditTags] = useState<string[]>([])
  const [editMistakes, setEditMistakes] = useState<string[]>([])
  const [editEmotion, setEditEmotion] = useState<string>('')
  const [editStrategy, setEditStrategy] = useState<string>('unassigned')
  const [editNotes, setEditNotes] = useState<string>('')

  const selectedTrade = trades.find((t) => t.id === selectedId) ?? null

  function openTrade(t: JournalTrade) {
    setSelectedId(t.id)
    setEditTags([...t.tags])
    setEditMistakes([...t.mistakes])
    setEditEmotion(t.emotion ?? '')
    setEditStrategy(t.strategyId ?? 'unassigned')
    setEditNotes(t.notes ?? '')
  }

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (vars: { id: string; body: Parameters<typeof updateTrade>[1] }) =>
      updateTrade(vars.id, vars.body),
    onSuccess: () => {
      toast({ title: 'Trade updated' })
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      setSelectedId(null)
    },
    onError: (err: Error) => {
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' })
    },
  })

  function save() {
    if (!selectedTrade) return
    saveMutation.mutate({
      id: selectedTrade.id,
      body: {
        tags: editTags,
        mistakes: editMistakes,
        emotion: editEmotion || null,
        strategyId: editStrategy === 'unassigned' ? null : editStrategy || null,
        notes: editNotes || null,
      },
    })
  }

  // CSV export (client-side, current result set)
  function exportCsv() {
    if (trades.length === 0) return
    const headers = [
      'Position ID', 'Symbol', 'Direction', 'Volume', 'Open Time', 'Close Time',
      'Open Price', 'Close Price', 'Stop Loss', 'Take Profit', 'Commission', 'Swap',
      'Profit', 'Net P/L', 'Pips', 'R Multiple', 'Duration (min)', 'Status',
      'Strategy', 'Tags', 'Mistakes', 'Emotion', 'Notes',
    ]
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v)
      return `"${s.replace(/"/g, '""')}"`
    }
    const rows = trades.map((t) =>
      [
        t.positionId, t.symbol, t.direction, t.volume, t.openTime, t.closeTime ?? '',
        t.openPrice, t.closePrice ?? '', t.stopLoss ?? '', t.takeProfit ?? '',
        t.commission, t.swap, t.profit, t.netProfit, t.pips ?? '', t.rMultiple ?? '',
        t.holdingMinutes ?? '', t.status, t.strategyName ?? '', t.tags.join('; '),
        t.mistakes.join('; '), t.emotion ?? '', t.notes ?? '',
      ]
        .map(esc)
        .join(',')
    )
    const csv = [headers.map(esc).join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'trades-export.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const strategyOptions = useMemo(() => {
    const opts = data.strategies.map((s) => ({ value: s.id, label: s.name }))
    if (!opts.some((o) => o.value === 'unassigned')) opts.push({ value: 'unassigned', label: 'Unassigned' })
    return opts
  }, [data.strategies])

  return (
    <div>
      <SectionHeader title="Trading Journal" subtitle="هر معامله یک پرونده است — ثبت تگ‌ها، اشتباهات و وضعیت روانی">
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={trades.length === 0}>
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </SectionHeader>

      {/* Filter bar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangeFilter value={range} onChange={setRange} />
        <DimensionFilter
          label="Symbol"
          value={symbol}
          options={data.symbols.map((s) => ({ value: s.symbol, label: s.symbol }))}
          onChange={setSymbol}
        />
        <DimensionFilter label="Strategy" value={strategyId} options={strategyOptions} onChange={setStrategyId} />
        <DimensionFilter
          label="Result"
          value={result}
          options={[
            { value: 'win', label: 'Win' },
            { value: 'loss', label: 'Loss' },
            { value: 'be', label: 'BE' },
          ]}
          onChange={(v) => setResult(v as ResultKey)}
        />
        <DimensionFilter
          label="Status"
          value={status}
          options={[
            { value: 'OPEN', label: 'Open' },
            { value: 'CLOSED', label: 'Closed' },
          ]}
          onChange={(v) => setStatus(v as StatusKey)}
        />
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes, symbol, emotion…"
            aria-label="Search trades"
            className="h-8 w-[180px] pl-8 text-xs"
          />
        </div>
      </div>

      {/* Summary strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 text-xs">
          <span className="text-muted-foreground">Trades</span>
          <span className="num font-semibold">{trades.length}</span>
        </span>
        <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 text-xs">
          <span className="text-muted-foreground">Net P/L (filtered)</span>
          <PnlValue value={netSum} className="text-sm font-semibold" />
        </span>
      </div>

      {/* Trades list */}
      {isLoading ? (
        <Panel title="Trades">
          <div className="max-h-[560px] overflow-y-auto scroll-slim">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {['#', 'Symbol', 'Volume', 'Open Time', 'Duration', 'Strategy', 'R', 'Tags', 'Net P/L', ''].map((h, i) => (
                    <TableHead key={i} className="text-xs">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }).map((_, r) => (
                  <TableRow key={r}>
                    <TableCell><Skeleton className="h-3.5 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-12" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-32" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-14" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-10" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-3.5 w-4" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      ) : isError ? (
        <Panel title="Trades">
          <div className="flex flex-col items-start gap-3 py-6">
            <div className="text-sm font-medium text-[var(--neg)]">Failed to load journal</div>
            <p className="text-xs text-muted-foreground">
              {error instanceof Error ? error.message : 'Unknown error'}
            </p>
            <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
              Retry
            </Button>
          </div>
        </Panel>
      ) : (
        <Panel title="Trades" description="Click a row to open the trade file">
          <div className="max-h-[560px] overflow-y-auto scroll-slim">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="text-xs">#</TableHead>
                  <TableHead className="text-xs">Symbol</TableHead>
                  <TableHead className="text-xs">Volume</TableHead>
                  <TableHead className="text-xs">Open Time</TableHead>
                  <TableHead className="text-xs">Duration</TableHead>
                  <TableHead className="text-xs">Strategy</TableHead>
                  <TableHead className="text-xs">R</TableHead>
                  <TableHead className="text-xs">Tags</TableHead>
                  <TableHead className="text-right text-xs">Net P/L</TableHead>
                  <TableHead aria-label="Open detail" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {trades.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-xs text-muted-foreground">
                      No trades match the current filters
                    </TableCell>
                  </TableRow>
                ) : (
                  trades.map((t) => {
                    const rTone = t.rMultiple !== null ? pnlTone(t.rMultiple) : 'flat'
                    return (
                      <TableRow
                        key={t.id}
                        tabIndex={0}
                        aria-label={`Open trade ${t.symbol} #${t.positionId}`}
                        onClick={() => openTrade(t)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            openTrade(t)
                          }
                        }}
                        className="cursor-pointer"
                      >
                        <TableCell className="num text-xs text-muted-foreground">{t.positionId}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold">{t.symbol}</span>
                            <DirectionBadge direction={t.direction} />
                          </div>
                        </TableCell>
                        <TableCell className="num text-xs">{fmtNum(t.volume, 2)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{fmtDateTime(t.openTime)}</TableCell>
                        <TableCell className="num text-xs">{fmtDuration(t.holdingMinutes)}</TableCell>
                        <TableCell className="max-w-[120px] truncate text-xs text-muted-foreground">
                          {t.strategyName ?? '—'}
                        </TableCell>
                        <TableCell className="num text-xs">
                          {t.rMultiple !== null ? (
                            <span className={rTone === 'pos' ? 'pnl-pos' : rTone === 'neg' ? 'pnl-neg' : 'pnl-flat'}>
                              {fmtNum(t.rMultiple, 2)}R
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {t.tags.length === 0 ? (
                            <span className="text-xs text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center gap-1">
                              {t.tags.slice(0, 2).map((tag) => (
                                <TagBadge key={tag} tag={tag} />
                              ))}
                              {t.tags.length > 2 && (
                                <span className="num text-[10px] text-muted-foreground">+{t.tags.length - 2}</span>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <PnlValue value={t.netProfit} className="text-xs font-semibold" />
                        </TableCell>
                        <TableCell>
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden />
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}

      {/* Detail dialog */}
      <Dialog
        open={selectedTrade !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto scroll-slim sm:max-w-2xl">
          {selectedTrade && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 text-base">
                  {selectedTrade.symbol}
                  <DirectionBadge direction={selectedTrade.direction} />
                  <span className="num text-sm text-muted-foreground">· #{selectedTrade.positionId}</span>
                </DialogTitle>
                <DialogDescription>Review and edit the journal record for this trade.</DialogDescription>
              </DialogHeader>

              {/* Facts grid */}
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <KV label="Open Time">{fmtDateTime(selectedTrade.openTime)}</KV>
                <KV label="Close Time">{fmtDateTime(selectedTrade.closeTime)}</KV>
                <KV label="Open Price"><span className="num">{fmtPrice(selectedTrade.openPrice)}</span></KV>
                <KV label="Close Price"><span className="num">{fmtPrice(selectedTrade.closePrice)}</span></KV>
                <KV label="Stop Loss"><span className="num">{fmtPrice(selectedTrade.stopLoss)}</span></KV>
                <KV label="Take Profit"><span className="num">{fmtPrice(selectedTrade.takeProfit)}</span></KV>
                <KV label="Volume"><span className="num">{fmtNum(selectedTrade.volume, 2)}</span></KV>
                <KV label="Duration"><span className="num">{fmtDuration(selectedTrade.holdingMinutes)}</span></KV>
                <KV label="Commission"><PnlValue value={selectedTrade.commission} sign={false} className="text-xs" /></KV>
                <KV label="Swap"><PnlValue value={selectedTrade.swap} className="text-xs" /></KV>
                <KV label="Profit"><PnlValue value={selectedTrade.profit} className="text-xs font-semibold" /></KV>
                <KV label="R Multiple">
                  <span className="num">
                    {selectedTrade.rMultiple !== null ? `${fmtNum(selectedTrade.rMultiple, 2)}R` : '—'}
                  </span>
                </KV>
                <KV label="Status">
                  {selectedTrade.status === 'OPEN' ? (
                    <Badge className="border-transparent bg-[var(--warn)]/15 text-[var(--warn)]">OPEN</Badge>
                  ) : (
                    <Badge variant="secondary">CLOSED</Badge>
                  )}
                </KV>
                <KV label="Net P/L" className="border-b-0 sm:col-span-2">
                  <PnlValue value={selectedTrade.netProfit} className="text-lg font-bold" />
                </KV>
              </div>

              {/* Editors */}
              <div className="space-y-5">
                <div>
                  <EditorLabel hint={`${editTags.length} selected`}>Tags</EditorLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {TRADE_TAGS.map((tag) => (
                      <ToggleChip
                        key={tag}
                        label={tag}
                        selected={editTags.includes(tag)}
                        onClick={() => toggle(editTags, setEditTags, tag)}
                      />
                    ))}
                  </div>
                  {editTags.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {editTags.map((tag) => (
                        <TagBadge key={tag} tag={tag} onRemove={() => toggle(editTags, setEditTags, tag)} />
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <EditorLabel hint={`${editMistakes.length} selected`}>Mistakes</EditorLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {TRADE_MISTAKES.map((m) => (
                      <ToggleChip
                        key={m}
                        label={m}
                        selected={editMistakes.includes(m)}
                        onClick={() => toggle(editMistakes, setEditMistakes, m)}
                      />
                    ))}
                  </div>
                  {editMistakes.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {editMistakes.map((m) => (
                        <TagBadge key={m} tag={m} onRemove={() => toggle(editMistakes, setEditMistakes, m)} />
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <EditorLabel>Emotion</EditorLabel>
                    <Select
                      value={editEmotion || '__none__'}
                      onValueChange={(v) => setEditEmotion(v === '__none__' ? '' : v)}
                    >
                      <SelectTrigger className="h-8 w-full text-xs" aria-label="Emotion">
                        <SelectValue placeholder="Select emotion" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">—</SelectItem>
                        {TRADE_EMOTIONS.map((e) => (
                          <SelectItem key={e} value={e}>{e}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <EditorLabel>Strategy</EditorLabel>
                    <Select value={editStrategy || 'unassigned'} onValueChange={setEditStrategy}>
                      <SelectTrigger className="h-8 w-full text-xs" aria-label="Strategy">
                        <SelectValue placeholder="Select strategy" />
                      </SelectTrigger>
                      <SelectContent>
                        {strategyOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <EditorLabel>Notes</EditorLabel>
                  <Textarea
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={4}
                    placeholder="یادداشت شخصی درباره این معامله…"
                    className="min-h-24 text-xs"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setSelectedId(null)} disabled={saveMutation.isPending}>
                  Cancel
                </Button>
                <Button size="sm" onClick={save} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
