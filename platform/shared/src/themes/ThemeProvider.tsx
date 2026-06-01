import React, { createContext, useContext, useEffect, useCallback } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'

type Theme = 'dark' | 'light'

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

// CSS custom properties for both themes
const CSS_VARS: Record<Theme, Record<string, string>> = {
  dark: {
    '--color-bg': '#070B14',
    '--color-surface': '#0D1117',
    '--color-surface-2': '#131B2E',
    '--color-border': 'rgba(255,255,255,0.08)',
    '--color-text-primary': '#F8FAFC',
    '--color-text-secondary': '#94A3B8',
    '--color-text-muted': '#475569',
    '--color-primary': '#6366F1',
    '--color-primary-hover': '#4F46E5',
    '--color-accent': '#22D3EE',
    '--color-success': '#10B981',
    '--color-warning': '#F59E0B',
    '--color-error': '#EF4444',
  },
  light: {
    '--color-bg': '#F8FAFC',
    '--color-surface': '#FFFFFF',
    '--color-surface-2': '#F1F5F9',
    '--color-border': 'rgba(0,0,0,0.1)',
    '--color-text-primary': '#0F172A',
    '--color-text-secondary': '#475569',
    '--color-text-muted': '#94A3B8',
    '--color-primary': '#4F46E5',
    '--color-primary-hover': '#4338CA',
    '--color-accent': '#0891B2',
    '--color-success': '#059669',
    '--color-warning': '#D97706',
    '--color-error': '#DC2626',
  },
}

function applyThemeVars(theme: Theme) {
  const root = document.documentElement
  const vars = CSS_VARS[theme]
  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value)
  })
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultTheme?: Theme
}

export function ThemeProvider({ children, defaultTheme = 'dark' }: ThemeProviderProps) {
  const [theme, setThemeInStorage] = useLocalStorage<Theme>('erp-theme', defaultTheme)

  useEffect(() => {
    applyThemeVars(theme)
  }, [theme])

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeInStorage(newTheme)
      applyThemeVars(newTheme)
    },
    [setThemeInStorage]
  )

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useThemeContext must be used within a ThemeProvider')
  }
  return ctx
}
