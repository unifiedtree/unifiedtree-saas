import React, { createContext, useContext, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
  resolvedTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const STORAGE_KEY = 'ut.theme'

// ── v1 pilot: dark theme is DISABLED (deferred to a post-pilot token migration). ──
// Dark mode is only ~half-implemented — ~1,700 hardcoded colors across ~98 files mean most
// surfaces stay light while design tokens flip dark, producing invisible light-on-light text
// (see audit-screenshots/dark/DECISION.md). There is no theme toggle and the default is
// 'system', so a pilot user on a dark-mode OS would otherwise be served the broken theme.
// Force light regardless of saved/OS preference until the token migration lands.
// Re-enable theme switching post-pilot by flipping this to false.
const FORCE_LIGHT = true

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = FORCE_LIGHT ? 'light' : theme === 'system' ? getSystemTheme() : theme
  document.documentElement.setAttribute('data-theme', resolved)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? 'system'
  )

  const resolvedTheme: 'light' | 'dark' =
    FORCE_LIGHT ? 'light' : theme === 'system' ? getSystemTheme() : theme

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  // Track system preference changes when theme === 'system' (disabled while FORCE_LIGHT).
  useEffect(() => {
    if (FORCE_LIGHT || theme !== 'system') return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme('system')
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
    applyTheme(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}
