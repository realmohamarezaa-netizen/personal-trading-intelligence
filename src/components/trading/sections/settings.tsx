'use client'

// ─── Settings — account info, data store, MT5 connector, sync log, danger zone ──

import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, PlugZap, RefreshCw, ShieldCheck, Square } from 'lucide-react'
import type { SettingsResponse } from '@/lib/types'
import { fetchSettings, launchMt5Connector, reseedDemoData, stopMt5Connector } from '@/lib/api-client'
import { fmtDateTime, fmtMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { Panel, SectionHeader } from '@/components/trading/shared/ui'

// ─── Local helpers ────────────────────────────────────────────────────────────

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-xs last:border-0">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground/90">{children}</span>
    </div>
  )
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-foreground/90">{children}</code>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

export function SettingsSection() {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  })

  const reseed = useMutation({
    mutationFn: reseedDemoData,
    onSuccess: () => {
      toast({ title: 'Demo data regenerated', description: 'A fresh demo dataset was generated.' })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['journal'] })
    },
    onError: (err: Error) => {
      toast({ title: 'Reseed failed', description: err.message, variant: 'destructive' })
    },
  })

  const launch = useMutation({
    mutationFn: launchMt5Connector,
    onSuccess: (res) => {
      toast({
        title: res.alreadyRunning ? 'MT5 connector already running' : 'MT5 connector started',
        description: res.message,
      })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
    },
    onError: (err: Error) => {
      toast({
        title: 'Connect failed',
        description:
          err.message.includes('NOT_BUNDLED') || err.message.includes('bundled')
            ? 'اتصال یک‌کلیکی در نسخهٔ دسکتاپ ویندوز فعال است. در حالت وب از راهنمای دستی زیر استفاده کنید.'
            : err.message,
        variant: 'destructive',
      })
    },
  })

  const stop = useMutation({
    mutationFn: stopMt5Connector,
    onSuccess: () => {
      toast({ title: 'MT5 connector stopped' })
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    onError: (err: Error) => {
      toast({ title: 'Stop failed', description: err.message, variant: 'destructive' })
    },
  })

  return (
    <div>
      <SectionHeader title="Settings" subtitle="تنظیمات حساب، اتصال MT5 و مدیریت داده" />

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl border border-border/60 bg-card/60" />
          ))}
        </div>
      ) : isError || !data ? (
        <Panel title="Settings">
          <div className="flex flex-col items-start gap-3 py-6">
            <div className="text-sm font-medium text-[var(--neg)]">Failed to load settings</div>
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
        <>
          {/* Account + Data Store */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="MT5 Account" description="مشخصات حساب متصل">
              <KV label="Name">{data.account.name}</KV>
              <KV label="Broker">{data.account.broker}</KV>
              <KV label="Server">{data.account.server}</KV>
              <KV label="Login">
                <span className="num">{data.account.mt5Login ?? '—'}</span>
              </KV>
              <KV label="Currency">{data.account.currency}</KV>
              <KV label="Leverage">
                <span className="num">1:{data.account.leverage}</span>
              </KV>
              <KV label="Initial Balance">{fmtMoney(data.account.initialBalance)}</KV>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {data.demoMode ? (
                  <Badge className="border-transparent bg-[var(--warn)]/15 text-[var(--warn)]">
                    DEMO DATA — generated sample
                  </Badge>
                ) : (
                  <Badge className="border-transparent bg-[var(--pos)]/15 text-[var(--pos)]">MT5 SYNCED</Badge>
                )}
                <span className="text-xs text-muted-foreground">
                  Last sync: <span className="num">{fmtDateTime(data.lastSyncAt)}</span>
                </span>
              </div>
            </Panel>

            <Panel title="Data Store" description="آمار پایگاه داده محلی">
              <KV label="Closed + Open Trades">
                <span className="num">{data.counts.trades.toLocaleString('en-US')}</span>
              </KV>
              <KV label="Open Positions">
                <span className="num">{data.counts.open.toLocaleString('en-US')}</span>
              </KV>
              <KV label="Snapshots">
                <span className="num">{data.counts.snapshots.toLocaleString('en-US')}</span>
              </KV>
              <KV label="Cashflows">
                <span className="num">{data.counts.cashflows.toLocaleString('en-US')}</span>
              </KV>
              <KV label="DB Path">
                <code className="rounded bg-muted/60 px-1.5 py-0.5 text-[11px] text-foreground/80">db/custom.db</code>
              </KV>
            </Panel>
          </div>

          {/* MT5 Connector */}
          <Panel
            title="MT5 Connector — اتصال واقعی"
            description="در نسخهٔ دسکتاپ با یک کلیک وصل شوید؛ بدون دستور و بدون پایتون نصب‌شده"
            className="mt-4"
          >
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--pos)]/25 bg-[var(--pos)]/8 p-3">
              <Button
                className="gap-2 bg-[var(--pos)] font-semibold text-emerald-950 hover:bg-[var(--pos)]/85"
                onClick={() => launch.mutate()}
                disabled={launch.isPending || stop.isPending}
              >
                {launch.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                Connect MT5
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => stop.mutate()}
                disabled={launch.isPending || stop.isPending}
              >
                <Square className="h-3.5 w-3.5" />
                Disconnect
              </Button>
              <span className="text-xs text-muted-foreground">
                کانکتور فقط-خواندنی است؛ هر ۴۵ ثانیه به‌صورت خودکار همگام می‌شود و با بستن برنامه، خودش متوقف می‌گردد.
              </span>
            </div>

            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                Install <span className="font-medium text-foreground">Python 3.12 (64-bit)</span> and have the
                MetaTrader 5 terminal running and logged in (no algo-trading permission needed — the connector is
                read-only).
              </li>
              <li>
                Install the connector dependencies: <Code>pip install MetaTrader5 requests</Code>
              </li>
              <li>
                Download the connector folder <Code>mt5-connector/</Code> from the project.
              </li>
              <li>
                Run the sync: <Code>python sync.py --api http://127.0.0.1:3000 --days 180</Code>
              </li>
              <li>
                Keep the dashboard open; data syncs locally — nothing leaves your machine.
              </li>
            </ol>

            <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--pos)]/25 bg-[var(--pos)]/8 px-2.5 py-2 text-xs text-[var(--pos)]">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              <span>Local-only — هیچ داده‌ای از سیستم شما خارج نمی‌شود</span>
            </div>

            <pre className="num mt-4 overflow-x-auto scroll-slim rounded-lg bg-muted/50 p-3 text-xs leading-relaxed text-foreground/85">
{`# 1) install connector dependencies
pip install MetaTrader5 requests

# 2) from the mt5-connector folder, run the sync against the local dashboard
python sync.py --api http://127.0.0.1:3000 --days 180`}
            </pre>
          </Panel>

          {/* Sync history */}
          <Panel title="Sync History" description="تاریخچه همگام‌سازی" className="mt-4">
            {data.syncLogs.length === 0 ? (
              <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--warn)]" aria-hidden />
                No sync yet — running on demo data
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto scroll-slim">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="text-xs">Time</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Message</TableHead>
                      <TableHead className="text-right text-xs">Changes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.syncLogs.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="num whitespace-nowrap text-xs text-muted-foreground">
                          {fmtDateTime(l.ts)}
                        </TableCell>
                        <TableCell>
                          {l.status === 'OK' ? (
                            <Badge className="border-transparent bg-[var(--pos)]/15 text-[var(--pos)]">OK</Badge>
                          ) : (
                            <Badge className="border-transparent bg-[var(--neg)]/15 text-[var(--neg)]">
                              {l.status}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={l.message}>
                          {l.message}
                          <span className="ml-1.5 text-[10px] text-muted-foreground/60">({l.source})</span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right">
                          <span className="num mr-1 inline-block rounded bg-[var(--pos)]/10 px-1.5 py-0.5 text-[10px] text-[var(--pos)]">
                            +{l.tradesInserted} ins
                          </span>
                          <span className="num inline-block rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            +{l.tradesUpdated} upd
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Panel>

          {/* Danger zone */}
          <Panel title="Demo Data" description="بازتولید داده نمونه" className="mt-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                برای اتصال حساب واقعی، از کانکتور MT5 استفاده کنید.
              </p>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={reseed.isPending}>
                    {reseed.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    Regenerate demo dataset
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Regenerate demo dataset?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This replaces all current data with a fresh generated demo dataset.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => reseed.mutate()}>Regenerate</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
