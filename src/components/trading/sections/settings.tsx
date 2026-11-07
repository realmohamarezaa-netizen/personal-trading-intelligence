'use client'

// ─── Settings — account info, data store, MT5 connector, sync log, danger zone ──

import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  CopyCheck,
  Download,
  ExternalLink,
  FileCheck2,
  FolderArchive,
  Loader2,
  MonitorDown,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  Square,
} from 'lucide-react'
import type { SettingsResponse } from '@/lib/types'
import { fetchDownloadInfo, fetchMt5Status, fetchSettings, launchMt5Connector, reseedDemoData, stopMt5Connector } from '@/lib/api-client'
import { fmtBytes, fmtDateTime, fmtMoney } from '@/lib/format'
import { APP_VERSION, INSTALLER_EXE_FILE_NAME, INSTALLER_FILE_NAME } from '@/lib/app-info'
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

// ─── Windows installer download ───────────────────────────────────────────────

function InstallerDownloadPanel() {
  const { toast } = useToast()
  const { data, isLoading } = useQuery({
    queryKey: ['download-info'],
    queryFn: fetchDownloadInfo,
    staleTime: 60_000,
  })

  // The dashboard serves the ZIP package; an installed copy serves the setup
  // .exe it published into its own public/ folder at install time.
  const isZip = (data?.fileName ?? INSTALLER_FILE_NAME).toLowerCase().endsWith('.zip')

  const copyChecksum = async () => {
    if (!data?.sha256) return
    try {
      await navigator.clipboard.writeText(data.sha256)
      toast({ title: 'Checksum copied', description: 'SHA-256 به کلیپ‌بورد کپی شد' })
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' })
    }
  }

  return (
    <Panel
      title="دانلود نسخهٔ ویندوز — Windows Installer"
      description="نصب کن، متاتریدر را باز کن، متصل شو — بدون VS Code و بدون پایتون"
    >
      {isLoading ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Skeleton className="skeleton-shimmer h-24 flex-1 rounded-xl bg-card/60" />
          <Skeleton className="skeleton-shimmer h-24 flex-1 rounded-xl bg-card/60" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          {/* Download action */}
          <div className="flex flex-col justify-center gap-3 rounded-xl border border-[var(--pos)]/25 bg-[var(--pos)]/8 p-4">
            {data?.available ? (
              <a
                // href ends with the real file name so the saved file keeps its
                // extension even when a proxy strips Content-Disposition headers
                href={`/${data.fileName}`}
                download={data.fileName}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[var(--pos)] px-5 text-sm font-bold text-emerald-950 shadow-sm transition hover:bg-[var(--pos)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--pos)]"
              >
                <Download className="h-5 w-5" aria-hidden />
                Download Installer ({isZip ? 'ZIP' : 'EXE'} · 64-bit)
              </a>
            ) : (
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  className="h-11 gap-2 opacity-60"
                  disabled
                  aria-label="Installer file not bundled in this build"
                >
                  <Download className="h-5 w-5" aria-hidden />
                  Installer not bundled here
                </Button>
                <a
                  href={data?.fallbackUrl ?? '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-semibold text-foreground transition hover:bg-muted"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  دانلود از GitHub Releases
                </a>
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] leading-relaxed text-muted-foreground">
              <MonitorDown className="h-4 w-4 shrink-0 text-[var(--pos)]" aria-hidden />
              <span className="num">
                {data?.available
                  ? `${data.fileName} · ${fmtBytes(data.sizeBytes)} · ویندوز ۱۰/۱۱ ۶۴بیتی`
                  : 'این فایل فقط در نسخهٔ ساخته‌شدهٔ ویندوز همراه برنامه است'}
              </span>
            </div>
          </div>

          {/* Meta info */}
          <div className="min-w-0">
            <KV label="Version">v{data?.version ?? APP_VERSION}</KV>
            <KV label="Size">
              <span className="num">{data?.available ? fmtBytes(data.sizeBytes) : '—'}</span>
            </KV>
            <KV label="Requirement">Windows 10 / 11 — 64-bit · MetaTrader 5</KV>
            <KV label="Built">
              <span className="num">{fmtDateTime(data?.modifiedAt)}</span>
            </KV>
            <div className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-xs last:border-0">
              <span className="shrink-0 text-muted-foreground">SHA-256</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="num truncate text-[10px] text-foreground/70" title={data?.sha256 ?? undefined}>
                  {data?.sha256 ? `${data.sha256.slice(0, 24)}…${data.sha256.slice(-8)}` : '—'}
                </span>
                {data?.sha256 ? (
                  <button
                    type="button"
                    onClick={copyChecksum}
                    className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    aria-label="Copy SHA-256 checksum"
                  >
                    <CopyCheck className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : null}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--pos)]" aria-hidden />
          <span>
            بعد از نصب: متاتریدر ۵ را باز و وارد حسابتان شوید → دکمهٔ «Algo Trading» را روشن کنید → در داشبورد
            «Connect MT5» را بزنید. همین صفحه (Settings) همیشه آخرین نسخهٔ نصاب را برای دانلود ارائه می‌دهد.
          </span>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <FolderArchive className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn)]" aria-hidden />
          <span>
            {isZip ? (
              <>
                فایل دانلودشده یک بستهٔ <Code>ZIP</Code> است ({data?.fileName ?? INSTALLER_FILE_NAME}). ابتدا آن را
                Extract کنید و سپس <Code>{INSTALLER_EXE_FILE_NAME}</Code> را اجرا کنید. ویندوز هنگام استخراج، سلامت فایل را
                با CRC خودش کنترل می‌کند.
              </>
            ) : (
              <>
                این همان فایل نصبی است که این برنامه با آن نصب شده ({data?.fileName ?? INSTALLER_EXE_FILE_NAME}) — برای
                نصب روی سیستم دیگر کافی است آن را مستقیم اجرا کنید؛ نیازی به Extract ندارد.
              </>
            )}
          </span>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--warn)]" aria-hidden />
          <span>
            برای اطمینان از سالم بودن بسته، در PowerShell اجرا کنید:{' '}
            <Code>certutil -hashfile {data?.fileName ?? INSTALLER_FILE_NAME} SHA256</Code> — خروجی باید
            همین مقدار بالا باشد.
          </span>
        </div>
      </div>
    </Panel>
  )
}

// ─── Section ──────────────────────────────────────────────────────────────────

// ─── MT5 connector diagnostics (live status + connector log tail) ───────────

function Mt5Diagnostics() {
  const { data: st, refetch, isRefetching } = useQuery({
    queryKey: ['mt5-status'],
    queryFn: fetchMt5Status,
    refetchInterval: 10_000,
  })

  // Web / dev checkout — the manual guide below is the relevant path there.
  if (!st?.bundled) return null

  const state: 'SYNCED' | 'WAITING' | 'STOPPED' = st.accountSynced
    ? 'SYNCED'
    : st.connectorRunning
      ? 'WAITING'
      : 'STOPPED'

  return (
    <div className="mt-4 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-foreground/90">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
          Connector Diagnostics — وضعیت زندهٔ کانکتور
          {state === 'SYNCED' && (
            <Badge className="border-transparent bg-[var(--pos)]/15 text-[var(--pos)]">داده در حال دریافت است</Badge>
          )}
          {state === 'WAITING' && (
            <Badge className="border-transparent bg-[var(--warn)]/15 text-[var(--warn)]">در انتظار اولین همگام‌سازی…</Badge>
          )}
          {state === 'STOPPED' && (
            <Badge variant="outline" className="border-border text-muted-foreground">متوقف</Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={cn('h-3 w-3', isRefetching && 'animate-spin')} aria-hidden />
          Refresh
        </Button>
      </div>

      {state === 'WAITING' && (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-[var(--warn)]/25 bg-[var(--warn)]/10 px-2.5 py-2 text-[11px] leading-relaxed text-[var(--warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            اتصال برقرار شده اما هنوز داده‌ای از متاتریدر نرسیده. اگر متاتریدر باز و وارد حسابتان باشد معمولاً چند ثانیه
            تا یک دقیقه دیگر داده می‌رسد؛ در غیر این صورت دلیل دقیق آن در لاگ زیر نوشته شده است.
          </span>
        </div>
      )}

      {st.logTail ? (
        <pre
          dir="ltr"
          className="num mt-2 max-h-48 overflow-y-auto scroll-slim whitespace-pre-wrap rounded-lg bg-background/60 p-2.5 text-left text-[10.5px] leading-relaxed text-foreground/80"
        >
          {st.logTail}
        </pre>
      ) : (
        <p className="mt-2 text-[11px] text-muted-foreground">
          هنوز لاگی ثبت نشده — پس از زدن «Connect MT5» چند لحظه صبر کنید؛ اگر متاتریدر در دسترس نباشد دلیلش همین‌جا
          نمایش داده می‌شود.
        </p>
      )}
    </div>
  )
}

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

      <div className="mb-4">
        <InstallerDownloadPanel />
      </div>

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
                ) : data.account.mt5Login ? (
                  <Badge className="border-transparent bg-[var(--pos)]/15 text-[var(--pos)]">MT5 SYNCED</Badge>
                ) : (
                  <Badge className="border-transparent bg-[var(--warn)]/15 text-[var(--warn)]">
                    MT5 CONNECTING — در انتظار اولین همگام‌سازی
                  </Badge>
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

            <Mt5Diagnostics />

            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground">
              <li>
                Open <span className="font-medium text-foreground">MetaTrader 5</span> and log in to your trading
                account.
              </li>
              <li>
                In the MT5 toolbar, turn <span className="font-medium text-foreground">Algo Trading</span>{' '}
                <span className="text-[var(--pos)] font-semibold">ON</span> — the green button at the top of the
                terminal. The connector needs it active to attach to the terminal.
              </li>
              <li>
                Click the green <span className="font-medium text-foreground">Connect MT5</span> button above.
              </li>
              <li>
                Done — trades, balance and equity sync automatically and stay updated every 45 seconds.
              </li>
            </ol>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground/80">
              Developer / web mode only: install Python 3.12 (64-bit) +{' '}
              <Code>pip install MetaTrader5 requests</Code>, then run{' '}
              <Code>python sync.py --api http://127.0.0.1:3000 --days 180</Code> from the{' '}
              <Code>mt5-connector/</Code> folder.
            </p>

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
