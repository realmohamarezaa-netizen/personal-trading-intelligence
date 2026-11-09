'use client'

// ─── Application Shell — sidebar, topbar, footer, section routing ────────────
// v1.3.2: live MT5 awareness (status polling, honest sync badge, auto-follow
// terminal account switches), collapsible desktop sidebar + mobile drawer.
// v1.3.4: the desktop rail now appears from `md` up (was `lg`) so the app
// behaves like a desktop tool in the ~1000px windows used next to MT5, and
// the whole shell is denser at narrow widths (smaller paddings/type).

import { useCallback, useEffect, useRef, useState } from 'react'
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
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Palette,
  X,
} from 'lucide-react'
import type { AnalyticsData, RangeKey } from '@/lib/types'
import { fetchAnalytics, fetchMt5Status, fetchSettings, launchMt5Connector } from '@/lib/api-client'
import type { Mt5Status } from '@/lib/api-client'
import { currencySymbol } from '@/lib/format'
import { APP_VERSION } from '@/lib/app-info'
import { THEMES, useTheme } from '@/lib/themes'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

const SIDEBAR_W = 238
const SIDEBAR_W_COLLAPSED = 72
/** connector syncs every ~30s — a sync older than this means it stalled */
const SYNC_FRESH_MS = 180_000

function TehranClock() {
  const [now, setNow] = useState<string>('')
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // h23 (NOT hour12:false): en-GB with hour12:false renders midnight as
      // "24:xx" on several ICU builds — hourCycle forces a clean 00-23 range.
      hourCycle: 'h23',
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

/** true when the connector landed a sync within the freshness window */
function syncAge(s: Mt5Status | null | undefined, data: AnalyticsData | undefined): number | null {
  const ts = s?.lastSyncAt ?? data?.meta.lastSyncAt ?? null
  return ts ? Date.now() - Date.parse(ts) : null
}

function StatusPill({ data, status }: { data: AnalyticsData | undefined; status: Mt5Status | undefined }) {
  const demo = data?.meta.demoMode ?? true
  const connecting = !demo && data?.account != null && !data.account.mt5Login
  const age = syncAge(status, data)
  const fresh = age !== null && age < SYNC_FRESH_MS
  const running = status?.connectorRunning ?? false

  // Honest states — the pill mirrors what the connector is ACTUALLY doing:
  //   demo dataset / real shell account before its first sync / live sync
  //   arriving regularly / connector up but no fresh sync / connector down.
  const label = demo
    ? 'DEMO DATA'
    : connecting
      ? 'MT5 CONNECTING…'
      : fresh
        ? 'MT5 SYNCED'
        : running
          ? 'MT5 SYNCING…'
          : 'MT5 OFFLINE'
  const amber = label !== 'MT5 SYNCED'

  const title =
    !demo && age !== null
      ? `Last sync ${new Date(Date.now() - age).toLocaleTimeString('en-GB')}${status?.lastSyncStatus ? ` · ${status.lastSyncStatus}` : ''}`
      : demo
        ? 'Generated demo dataset — connect MT5 for real data'
        : undefined

  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold tracking-wide',
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

// ─── Sidebar body — shared between the desktop rail and the mobile drawer ────
function SidebarBody({
  collapsed,
  data,
  accounts,
  accountId,
  onAccount,
  section,
  onSection,
  onToggle,
  onClose,
}: {
  collapsed: boolean
  data: AnalyticsData | undefined
  accounts: { id: string; name: string; tradeMode: string }[]
  accountId: string
  onAccount: (v: string) => void
  section: SectionKey
  onSection: (s: SectionKey) => void
  /** desktop rail collapse toggle (absent in the mobile drawer) */
  onToggle?: () => void
  /** mobile drawer close (absent on desktop) */
  onClose?: () => void
}) {
  return (
    <>
      {/* Brand header — v1.3.3: NOT rendered while the rail is collapsed, so
          the closed toolbar starts straight with the section icons (the pulse
          logo no longer floats above them). Expansion stays available through
          the bottom PanelLeftOpen button and Ctrl+B. */}
      {!collapsed && (
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Activity className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[13px] font-bold tracking-wide">TRADE ANALYTICS</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Personal Intelligence
              </div>
            </div>
          </div>
          {onClose ? (
            <button
              onClick={onClose}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
          ) : onToggle ? (
            <button
              onClick={onToggle}
              className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground md:flex"
              aria-label="Collapse sidebar"
              title="Collapse sidebar (Ctrl+B)"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      )}

      {!collapsed && (
        <div className="mx-4 mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[10px] font-semibold tracking-widest text-muted-foreground">
          <ShieldCheck className="h-3 w-3 text-[var(--pos)]" />
          LOCAL SYSTEM
        </div>
      )}

      <nav
        className={cn(
          'flex-1 space-y-0.5 overflow-y-auto scroll-slim',
          collapsed ? 'px-2 pt-5 pb-2' : 'px-3 py-2'
        )}
        aria-label="Sections"
      >
        {SECTIONS.map((s) => {
          const Icon = s.icon
          const active = section === s.key
          return (
            <button
              key={s.key}
              onClick={() => onSection(s.key)}
              aria-current={active ? 'page' : undefined}
              title={collapsed ? `${s.label} — ${s.fa}` : undefined}
              className={cn(
                'group flex w-full items-center rounded-lg text-left transition-colors',
                collapsed ? 'justify-center py-2.5' : 'gap-3 px-3 py-2',
                active
                  ? 'bg-primary/12 text-primary'
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-foreground'
              )}
            >
              <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground/80')} />
              {!collapsed && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-tight">{s.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground/70">{s.fa}</span>
                </span>
              )}
            </button>
          )
        })}
      </nav>

      {/* Account mini card */}
      {collapsed ? (
        <div className="mx-2 mb-4 rounded-xl border border-border/60 bg-card/70 p-2 text-center">
          <div className="num truncate text-[11px] font-semibold" title="Equity">
            {data ? currencySymbol(data.account.currency) : '—'}
            {data ? data.overview.equity.toLocaleString('en-US', { maximumFractionDigits: 0 }) : ''}
          </div>
          <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Equity</div>
        </div>
      ) : (
        <div className="mx-3 mb-4 rounded-xl border border-border/60 bg-card/70 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-semibold">{data?.account.name ?? 'Account'}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{data?.account.currency ?? 'USD'}</span>
          </div>
          {accounts.length > 1 ? (
            <div className="mt-1.5">
              <Select
                value={accountId || '__active__'}
                onValueChange={onAccount}
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
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
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
      )}
    </>
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
  // v1.5.0: dark theme pack — quick switcher lives in the topbar, full
  // gallery in Settings → Appearance
  const { theme, setTheme } = useTheme()
  // v1.5.0: 'All time' is back in the selector — it is the broadest window
  // and the natural default for the first dashboard paint
  const [range, setRange] = useState<RangeKey>('all')
  const [symbol, setSymbol] = useState('')
  const [accountId, setAccountId] = useState('')
  // Custom window (range === 'custom'); defaults cover the last 30 days
  const [customFrom, setCustomFrom] = useState(() => new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))

  // Sidebar: desktop collapse (persisted) + mobile drawer
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem('pti.sidebar') === 'collapsed') setCollapsed(true)
    } catch {
      /* private mode etc. */
    }
  }, [])

  const toggleSidebar = useCallback(() => {
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem('pti.sidebar', next ? 'collapsed' : 'expanded')
      } catch {}
      return next
    })
  }, [])

  // Ctrl+B / ⌘B toggles the sidebar (desktop convention)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [toggleSidebar])

  // Escape closes the mobile drawer
  useEffect(() => {
    if (!drawerOpen) return
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [drawerOpen])

  const onCustomChange = useCallback((from: string, to: string) => {
    if (from) setCustomFrom(from)
    if (to) setCustomTo(to)
  }, [])

  const queryClient = useQueryClient()
  const { toast } = useToast()

  // ── Live MT5 connector status (5s poll) ───────────────────────────────────
  // Drives the honest sync badge, the auto-follow on terminal account
  // switches, and the "connector down → restart" affordance.
  // v1.4.0: refetchIntervalInBackground — this is a dashboard that typically
  // sits NEXT TO the MT5 terminal; when the browser tab loses focus the
  // polling must NOT pause, otherwise the badge and data freeze silently.
  const { data: mt5Status } = useQuery({
    queryKey: ['mt5-status'],
    queryFn: () => fetchMt5Status(),
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
    staleTime: 4_000,
  })

  // connector alive = process running OR a sync landed recently (covers a
  // python service started outside the dashboard, whose pid is unknown here)
  const statusAge = mt5Status?.lastSyncAt ? Date.now() - Date.parse(mt5Status.lastSyncAt) : null
  const connectorLive =
    Boolean(mt5Status?.connectorRunning) || (statusAge !== null && statusAge < SYNC_FRESH_MS)

  // ── Account list for the sidebar switcher (multi-account) ─────────────────
  const { data: accountsData } = useQuery({
    queryKey: ['settings'],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  })
  const accounts = accountsData?.accounts ?? []

  // keepPreviousData: while a new range/symbol is fetched the previous
  // dataset stays on screen (dimmed below) instead of the whole page
  // collapsing into a spinner — switching feels instant, data just updates.
  // While the connector is alive the dashboard polls every 10s (v1.4.0, was
  // 30s): floating P/L, open positions and new deals arrive with every
  // connector sync cycle (~30s), so the worst-case freshness is now ~40s
  // instead of ~75s. refetchIntervalInBackground keeps the dashboard live
  // even when the tab is in the background behind the MT5 terminal.
  // TanStack structural sharing keeps identical payloads referentially
  // stable, so charts do NOT re-animate when nothing actually changed.
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
    refetchInterval: connectorLive ? 10_000 : false,
    refetchIntervalInBackground: true,
    staleTime: 5_000,
  })

  const demoMode = data?.meta.demoMode ?? true

  // ── Auto-follow terminal account switches ─────────────────────────────────
  // When the user picks another account inside MetaTrader 5, the connector
  // pushes the new identity within one cycle; status.activeAccount changes
  // and the dashboard switches over (with a toast) instead of showing stale
  // data behind a permanently green badge.
  const followedAccountRef = useRef<string | null>(null)
  const activeAccountId = mt5Status?.activeAccount?.id ?? null
  const activeAccountName = mt5Status?.activeAccount?.name ?? null
  const activeAccountLogin = mt5Status?.activeAccount?.mt5Login ?? null
  useEffect(() => {
    if (!activeAccountId) return
    const prev = followedAccountRef.current
    followedAccountRef.current = activeAccountId
    if (prev && prev !== activeAccountId) {
      setAccountId('') // "— Most recent sync —" now resolves to the new account
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      queryClient.invalidateQueries({ queryKey: ['journal'] })
      toast({
        title: 'MT5 account switched',
        description: `Now showing ${activeAccountName ?? 'the new account'}${
          activeAccountLogin ? ` · login ${activeAccountLogin}` : ''
        } — freshly synced from the terminal.`,
      })
    }
  }, [activeAccountId, activeAccountName, activeAccountLogin, queryClient, toast])

  // One-click MT5 connection (bundled connector inside the desktop build).
  const connectMt5 = useMutation({
    mutationFn: launchMt5Connector,
    onSuccess: (res) => {
      toast({
        title: res.alreadyRunning ? 'MT5 connector already running' : 'MT5 connector started',
        description: res.message,
      })
      queryClient.invalidateQueries({ queryKey: ['mt5-status'] })
      // Refresh analytics as the first real sync lands.
      for (const s of [3, 8, 20, 40, 75]) {
        setTimeout(() => {
          refetch()
          queryClient.invalidateQueries({ queryKey: ['journal'] })
          queryClient.invalidateQueries({ queryKey: ['settings'] })
          queryClient.invalidateQueries({ queryKey: ['mt5-status'] })
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

  // Connect button: demo mode always offers it; on a real account it appears
  // whenever the bundled connector is NOT alive (app/terminal restarted).
  const statusLoaded = mt5Status !== undefined
  const showConnect = demoMode || (statusLoaded && Boolean(mt5Status?.bundled) && !connectorLive)

  const activeMeta = SECTIONS.find((s) => s.key === section)!

  const handleAccount = useCallback(
    (v: string) => {
      setAccountId(v === '__active__' ? '' : v)
      queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
    [queryClient]
  )

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Ambient background glows (theme-aware — see --glow-a/--glow-b) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-[var(--glow-a)] blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-80 w-80 rounded-full bg-[var(--glow-b)] blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-1">
        {/* ── Sidebar (desktop, collapsible) ── */}
        <motion.aside
          initial={false}
          animate={{ width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W }}
          transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-y-0 left-0 z-40 hidden flex-col overflow-hidden border-r border-sidebar-border bg-sidebar md:flex"
        >
          <div
            className="flex h-full w-full flex-col"
            style={{ width: collapsed ? SIDEBAR_W_COLLAPSED : SIDEBAR_W }}
          >
            <SidebarBody
              collapsed={collapsed}
              data={data}
              accounts={accounts}
              accountId={accountId}
              onAccount={handleAccount}
              section={section}
              onSection={setSection}
              onToggle={toggleSidebar}
            />
            {collapsed && (
              <button
                onClick={toggleSidebar}
                className="mx-auto mb-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
                aria-label="Expand sidebar"
                title="Expand sidebar (Ctrl+B)"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
            )}
          </div>
        </motion.aside>

        {/* ── Mobile drawer ── */}
        <AnimatePresence>
          {drawerOpen && (
            <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={() => setDrawerOpen(false)}
                aria-hidden
              />
              <motion.aside
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: 'tween', duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
                className="absolute inset-y-0 left-0 flex w-[280px] flex-col border-r border-sidebar-border bg-sidebar shadow-2xl"
              >
                <SidebarBody
                  collapsed={false}
                  data={data}
                  accounts={accounts}
                  accountId={accountId}
                  onAccount={handleAccount}
                  section={section}
                  onSection={(s) => {
                    setSection(s)
                    setDrawerOpen(false)
                  }}
                  onClose={() => setDrawerOpen(false)}
                />
              </motion.aside>
            </div>
          )}
        </AnimatePresence>

        {/* ── Main column ── */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col transition-[padding] duration-300 ease-in-out',
            collapsed ? 'md:pl-[72px]' : 'md:pl-[238px]'
          )}
        >
          {/* Topbar */}
          <header className="sticky top-0 z-30 border-b border-border/60 bg-background">
            <div className="mx-auto flex h-12 max-w-[1500px] items-center justify-between gap-2 px-3 sm:gap-3 lg:h-14 lg:px-6">
              <div className="flex min-w-0 items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 md:hidden"
                  onClick={() => setDrawerOpen(true)}
                  aria-label="Open navigation menu"
                >
                  <Menu className="h-4 w-4" />
                </Button>
                <span className="truncate text-sm font-semibold">{activeMeta.label}</span>
                <span className="hidden text-xs text-muted-foreground md:inline">· {activeMeta.fa}</span>
              </div>
              <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                {/* v1.5.0: quick theme switcher */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      aria-label="Change theme"
                      title="Theme / پوسته"
                    >
                      <Palette className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Theme · پوسته
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {THEMES.map((t) => (
                      <DropdownMenuItem
                        key={t.key}
                        onClick={() => setTheme(t.key)}
                        className={cn('gap-2.5 text-xs', theme === t.key && 'bg-primary/10')}
                      >
                        <span
                          aria-hidden
                          className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20"
                          style={{
                            background: `linear-gradient(135deg, ${t.swatch.primary} 0 50%, ${t.swatch.accent} 50% 100%)`,
                          }}
                        />
                        <span className="flex-1">{t.name}</span>
                        <span className="text-[10px] text-muted-foreground" dir="rtl">
                          {t.fa}
                        </span>
                        {theme === t.key && <span className="text-[10px] text-primary">●</span>}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <TehranClock />
                {showConnect && (
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
                <StatusPill data={data} status={mt5Status} />
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
          </header>

          {/* Content */}
          <main className="mx-auto w-full max-w-[1500px] flex-1 p-3 sm:p-4 lg:p-6">
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
                    <OverviewSection
                      data={data}
                      range={range}
                      onRange={setRange}
                      customFrom={customFrom}
                      customTo={customTo}
                      onCustomChange={onCustomChange}
                    />
                  )}
                  {section === 'performance' && (
                    <PerformanceSection
                      data={data}
                      range={range}
                      onRange={setRange}
                      symbol={symbol}
                      onSymbol={setSymbol}
                      customFrom={customFrom}
                      customTo={customTo}
                      onCustomChange={onCustomChange}
                    />
                  )}
                  {section === 'time' && <TimeSection data={data} />}
                  {section === 'symbol' && (
                    <SymbolSection
                      data={data}
                      range={range}
                      onRange={setRange}
                      customFrom={customFrom}
                      customTo={customTo}
                      onCustomChange={onCustomChange}
                    />
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
          <footer className="mt-auto border-t border-border/60 bg-sidebar/60 pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-6">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[var(--pos)]" />
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
