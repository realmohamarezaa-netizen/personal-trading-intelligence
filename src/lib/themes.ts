'use client'

import { useCallback, useSyncExternalStore } from 'react'

// ─── v1.5.0 dark theme pack ──────────────────────────────────────────────────
// Four dark palettes; the active one is stored in localStorage ('pti.theme')
// and applied as a `data-theme` attribute on <html> (see globals.css for the
// palette definitions — 'emerald' is the default and needs no attribute).
// layout.tsx installs a tiny pre-hydration script so the stored theme is
// applied before first paint (no flash of the default palette).

export type ThemeKey = 'emerald' | 'violet' | 'crimson' | 'amber'

export interface ThemeMeta {
  key: ThemeKey
  name: string
  fa: string
  /** Preview swatch colors (plain CSS colors, approximating the palette) */
  swatch: { bg: string; primary: string; accent: string }
}

export const THEMES: ThemeMeta[] = [
  {
    key: 'emerald',
    name: 'Emerald Night',
    fa: 'زمردِ شب',
    swatch: { bg: '#0c1017', primary: '#3ea6ea', accent: '#34d399' },
  },
  {
    key: 'violet',
    name: 'Royal Violet',
    fa: 'بنفشِ سلطنتی',
    swatch: { bg: '#161025', primary: '#c084fc', accent: '#e879f9' },
  },
  {
    key: 'crimson',
    name: 'Crimson Dusk',
    fa: 'گرگ‌ومیشِ سرخ',
    swatch: { bg: '#1e1416', primary: '#fb7185', accent: '#fda4af' },
  },
  {
    key: 'amber',
    name: 'Solar Amber',
    fa: 'کهربای خورشید',
    swatch: { bg: '#1d1810', primary: '#fbbf24', accent: '#f59e0b' },
  },
]

export const DEFAULT_THEME: ThemeKey = 'emerald'

const STORAGE_KEY = 'pti.theme'

export function getStoredTheme(): ThemeKey {
  try {
    const t = localStorage.getItem(STORAGE_KEY)
    return THEMES.some((x) => x.key === t) ? (t as ThemeKey) : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(key: ThemeKey): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', key)
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    /* private mode etc. */
  }
}

/**
 * Theme state + switcher (v1.5.0). The <html data-theme> attribute is the
 * single source of truth (already applied before paint by the pre-hydration
 * script in layout.tsx); useSyncExternalStore keeps every consumer — topbar
 * quick switcher, Settings gallery — in sync without hydration mismatches.
 */
const themeListeners = new Set<() => void>()

function subscribeTheme(cb: () => void): () => void {
  themeListeners.add(cb)
  return () => themeListeners.delete(cb)
}

function getThemeSnapshot(): ThemeKey {
  const t = document.documentElement.getAttribute('data-theme')
  return THEMES.some((x) => x.key === t) ? (t as ThemeKey) : DEFAULT_THEME
}

function getThemeServerSnapshot(): ThemeKey {
  return DEFAULT_THEME
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot)

  const setTheme = useCallback((t: ThemeKey) => {
    applyTheme(t)
    for (const l of themeListeners) l()
  }, [])

  return { theme, setTheme }
}
