'use client'

// ─── Application Shell — sidebar, topbar, footer, section routing ────────────

import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Activity,
  LayoutDashboard,
  TrendingUp,
  Clock3,
  Layers,
  ShieldAlert,
  NotebookPen,
  Settings,
  ShieldCheck,
  RefreshCw,
  AlertTriangle,
  Loader2,
  PlugZap,
} from 'lucide-react'
import type { AnalyticsData, RangeKey } from '@/lib/types'
import { fetchAnalytics, fetchSettings, launchMt5Connector } from '@/lib/api-client'
import { currencySymbol } from '@/lib/format'
import { APP_VERSION } from '@/lib/app-info'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { Providers } from './providers'
import { DashboardSkeleton } from './shared/skeletons'
import { OverviewSection } from './sections/overview'
import { PerformanceSection } from './sections/performance'
import { TimeSection } from './sections/time-analytics'
import { SymbolSection } from './sections/symbol-analytics'
import { RiskSection } from './sections/risk-analytics'
import { JournalSection } from './sections/journal'
import { SettingsSection } from './sections/settings'

type SectionKey =
  | 'overview'
  | 'performance'
  | 'time'
  | 'symbol'
  | 'risk'
  | 'journal'
  | 'settings'

const SECTIONS: { key: SectionKey; label: string; fa: string; icon: typeof Activity }[] = [
  { key: 'overview', label: 'Overview', fa: 'مرکز کنترل حساب', icon: LayoutDashboard },
  { key: 'performance', label: 'Performance', fa: 'تحلیل عملکرد', icon: TrendingUp },
  { key: 'time', label: 'Time Analytics', fa: 'تحلیل زمان', icon: Clock3 },
  { key: 'symbol', label: 'Symbol Analytics', fa: 'تحلیل نمادها', icon: Layers },
  { key: 'risk', label: 'Risk Analytics', fa: 'تحلیل ریسک', icon: ShieldAlert },
  { key: 'journal', label: 'Trading Journal', fa: 'ژورنال معاملاتی', icon: NotebookPen },
  { key: 'settings', label: 'Settings', fa: 'تنظیمات', icon: Settings },
]

function TehranClock() {
  const [now, setNow] = useState<string>('')
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    const tick = () => setNow(fmt.format(new Date()))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="num hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
      <Clock3 className="h-3.5 w-3.5" />
      Tehran <span className="text-foreground/80">{now || '--:--:--'}</span>
    </span>
  )
}

function StatusPill({ data }: { data: AnalyticsData | undefined }) {
  const demo = data?.meta.demoMode ?? true
  // Honest states: demo account / real account waiting for its first MT5 sync
  // (connector launched but the shell account has no mt5 login yet) / synced.
  const connecting = !demo && data?.account != null && !data.account.mt5Login
  const label = demo ? 'DEMO DATA' : connecting ? 'MT5 CONNECTING…' : 'MT5 SYNCED'
  const amber = demo || connecting
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-wide',
        amber
          ? 'border-[var(--warn)]/30 bg-[var(--warn)]/10 text-[var(--warn)]'
          : 'border-[var(--pos)]/30 bg-[var(--pos)]/10 text-[var(--pos)]'
      )}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className={cn(
            'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
            amber ? 'bg-[var(--warn)]' : 'bg-[var(--pos)]'
          )}
        />
        <span
          className={cn(
            'relative inline-flex h-1.5 w-1.5 rounded-full',
            amber ? 'bg-[var(--warn)]' : 'bg-[var(--pos)]'
          )}
        />
      </span>
      {label}
    </span>
  )
}

function friendlyError(err: unknown): string {
  const code = err instanceof Error ? err.message : ''
  switch (code) {
    case 'NO_ACCOUNT':
      return 'No account data found. Demo data is prepared automatically — please retry.'
    case 'ANALYTICS_FAILED':
      return 'Analytics engine failed to compute your data. Please retry.'
    case 'JOURNAL_FAILED':
      return 'Could not load the trading journal. Please retry.'
    default:
      return code || 'Unknown error — check that the local server is running.'
  }
}

function AppInner() {
  const [section, setSection] = useState<SectionKey>('overview')
  const [range, setRange] = useState<RangeKey>('all')
  const [symbol, setSymbol] = useState('')
  const [accountId, setAccountId] = useState('')
  // Custom window (range === 'custom'); defaults cover the last 30 days
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  // keepPreviousData: while a new range/symbol is fetched the previous
  // dataset stays on screen (dimmed below) instead of the whole page
  // collapsing into a spinner — switching feels instant, data just updates.
  const { data, isLoading, isError, error, refetch, isRefetching, isPlaceholderData } = useQuery({
    queryKey: ['analytics', range, symbol, accountId, customFrom, customTo],
    queryFn: () =>
      fetchAnalytics({
        range,
        symbol: symbol || undefined,
        accountId: accountId || undefined,
        from: range === 'custom' ? customFrom : undefined,
        to: range === 'custom' ? `${customTo}T23:59:59` : undefined,
      }),
    placeholderData: keepPreviousData,
  })

  const queryClient = useQueryClient()
  const { toast } = useToast()

  // Account list for the sidebar switcher (multi-account: demo/real separate)
  const { data: accountsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  })
  const accounts = accountsData?.accounts ?? []

  // One-click MT5 connection (bundled connector inside the desktop build).
  const connectMt5 = useMutation({
    mutationFn: launchMt5Connector,
    onSuccess: (res) => {
      toast({
        title: res.alreadyRunning ? 'MT5 connector already running' : 'MT5 connector started',
        description: res.message,
      })
      // Refresh analytics as the first real sync lands.
      for (const s of [3, 8, 20, 40, 75]) {
        setTimeout(() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['journal'] })
          queryClient.invalidateQueries({ queryKey: ['settings'] })
        }, s * 1000)
      }
    },
    onError: (err: Error) => {
      toast({
        title: 'Connect failed',
        description:
          err.message.includes('NOT_BUNDLED') || err.message.includes('bundled')
            ? 'اتصال یک‌کلیکی در نسخهٔ دسکتاپ ویندوز فعال است. در حالت وب: python sync.py --watch 60'
            : err.message,
        variant: 'destructive',
      })
    },
  })

  const activeMeta = SECTIONS.find((s) => s.key === section)!

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Ambient background glows */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-[oklch(0.75_0.135_232/0.05)] blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[oklch(0.77_0.15_162/0.04)] blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-1">
        {/* ── Sidebar (desktop) ── */}
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-[238px] flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <div className="flex items-center gap-3 px-5 pb-4 pt-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div>
              <div className="text-[13px] font-bold tracking-wide">TRADE ANALYTICS</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Personal Intelligence
              </div>
            </div>
          </div>

          <div className="mx-4 mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[10px] font-semibold tracking-widest text-muted-foreground">
            <ShieldCheck className="h-3 w-3 text-[var(--pos)]" />
            LOCAL SYSTEM
          </div>

          <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2 scroll-slim" aria-label="Sections">
            {SECTIONS.map((s) => {
              const Icon = s.icon
              const active = section === s.key
              return (
                <button
                  key={s.key}
                  onClick={() => setSection(s.key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                    active
                      ? 'bg-primary/12 text-primary'
                      : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
                  )}
                >
                  <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80')} />
                  <span className="flex-1">
                    <span className="block text-[13px] font-medium leading-tight">{s.label}</span>
                    <span className="block text-[10px] text-muted-foreground/70">{s.fa}</span>
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Account mini card */}
          <div className="mx-3 mb-4 rounded-xl border border-border/60 bg-card/70 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold">{data?.account.name ?? 'Account'}</span>
              <span className="text-[10px] text-muted-foreground">{data?.account.currency ?? 'USD'}</span>
            </div>
            {accounts.length > 1 ? (
              <div className="mt-1.5">
                <Select
                  value={accountId || '__active__'}
                  onValueChange={(v) => {
                    setAccountId(v === '__active__' ? '' : v)
                    queryClient.invalidateQueries({ queryKey: ['settings'] })
                  }}
                >
                  <SelectTrigger size="sm" className="h-6 w-full text-[10px]" aria-label="Active account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__active__" className="text-[11px]">— Most recent sync —</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id} className="text-[11px]">
                        {a.name} · {a.tradeMode}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {data ? `${data.account.broker} · ${data.account.server}` : '—'}
            </div>
            <div className="num mt-2 flex items-baseline justify-between">
              <span className="text-[10px] text-muted-foreground">Equity</span>
              <span className="text-sm font-semibold">
                {data
                  ? `${currencySymbol(data.account.currency)}${data.overview.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  : '—'}
              </span>
            </div>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="flex min-w-0 flex-1 flex-col lg:pl-[238px]">
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur-md">
            <div className="mx-auto flex h-14 max-w-[1500px] items-center justify-between gap-3 px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold">{activeMeta.label}</span>
                <span className="hidden text-xs text-muted-foreground md:inline">· {activeMeta.fa}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <TehranClock />
                {data?.meta.demoMode && (
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 rounded-full bg-[var(--pos)] px-3 text-[11px] font-bold text-emerald-950 shadow-sm hover:bg-[var(--pos)]/85"
                    onClick={() => connectMt5.mutate()}
                    disabled={connectMt5.isPending}
                    aria-label="Connect MT5 and start syncing your real account"
                  >
                    {connectMt5.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PlugZap className="h-3.5 w-3.5" />
                    )}
                    Connect MT5
                  </Button>
                )}
                <StatusPill data={data} />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => refetch()}
                  aria-label="Refresh data"
                >
                  <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
                </Button>
              </div>
            </div>

            {/* Mobile nav */}
            <nav
              className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden scroll-slim"
              aria-label="Sections (mobile)"
            >
              {SECTIONS.map((s) => {
                const active = section === s.key
                return (
                  <button
                    key={s.key}
                    onClick={() => setSection(s.key)}
                    className={cn(
                      'whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary/15 text-primary'
                        : 'bg-muted/40 text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </nav>
          </header>

          {/* Content */}
          <main className="mx-auto w-full max-w-[1500px] flex-1 p-4 md:p-6">
            {isLoading ? (
              // First load (no previous data to keep): structural skeleton
              <DashboardSkeleton />
            ) : isError || !data ? (
              <div className="flex min-h-[50vh] items-center justify-center">
                <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-[var(--neg)]/25 bg-[var(--neg)]/5 p-6 text-center">
                  <AlertTriangle className="h-8 w-8 text-[var(--neg)]" />
                  <div className="text-sm font-semibold">Failed to load analytics</div>
                  <p className="text-xs text-muted-foreground">{friendlyError(error)}</p>
                  <Button size="sm" variant="outline" onClick={() => refetch()}>
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className={cn(
                  'transition-opacity duration-300',
                  isPlaceholderData && 'pointer-events-none opacity-55'
                )}
              >
              <AnimatePresence mode="wait">
                <motion.div
                  key={section}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                >
                  {section === 'overview' && (
                    <OverviewSection data={data} range={range} onRange={setRange} />
                  )}
                  {section === 'performance' && (
                    <PerformanceSection data={data} range={range} onRange={setRange} symbol={symbol} onSymbol={setSymbol} />
                  )}
                  {section === 'time' && <TimeSection data={data} />}
                  {section === 'symbol' && (
                    <SymbolSection data={data} range={range} onRange={setRange} />
                  )}
                  {section === 'risk' && <RiskSection data={data} />}
                  {section === 'journal' && <JournalSection data={data} />}
                  {section === 'settings' && <SettingsSection />}
                </motion.div>
              </AnimatePresence>
              </div>
            )}
          </main>

          {/* Sticky footer */}
          <footer className="mt-auto border-t border-border/60 bg-sidebar/60">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--pos)]" />
                <span className="font-medium text-foreground/80">Local-first system</span>
                <span className="hidden sm:inline">
                  — تمام داده‌ها فقط روی همین سیستم ذخیره می‌شوند · بدون Cloud
                </span>
              </div>
              <div className="num text-[11px] text-muted-foreground/70">
                Personal Trading Intelligence v{APP_VERSION} · 127.0.0.1
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  )
}

export default function TradingApp() {
  return (
    <Providers>
      <AppInner />
    </Providers>
  )
}
