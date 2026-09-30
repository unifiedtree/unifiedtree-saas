// Light / dark theme for the whole app. <ThemeProvider> is mounted once at the
// root (main.tsx) and <ThemeRoute /> once inside the router, so the sign-in
// pages can stay light.
//   const { theme, setTheme, toggleTheme } = useTheme()   // theme: 'light' | 'dark'
// setTheme / toggleTheme save the choice ('ut.theme' in localStorage, per
// device) and switch <html data-theme> at once; the default is light. The
// provider also keeps data-ufx="full" on <html> when no motion level is set
// (motion.css reads it). Only components that call useTheme() re-render when
// the theme changes; the rest of the app follows through the CSS variables.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { applyTheme, createThemeStore, THEME_STORAGE_KEY, type ThemeName, type ThemeStore } from './theme'

export interface ThemeContextValue {
  /** The theme on screen (always light on the sign-in pages). */
  theme: ThemeName
  setTheme: (theme: ThemeName) => void
  toggleTheme: () => void
}

const ThemeStoreContext = createContext<ThemeStore | null>(null)

// Layout effect in the browser (applied before paint), plain effect elsewhere.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [store] = useState<ThemeStore>(() => createThemeStore())

  // index.html already applied the theme before paint; this covers the case
  // where that script could not run.
  useIsoLayoutEffect(() => {
    applyTheme(store.get())
  }, [store])

  // Another tab switched the theme: follow it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === THEME_STORAGE_KEY) store.sync()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [store])

  return <ThemeStoreContext.Provider value={store}>{children}</ThemeStoreContext.Provider>
}

/** Tells the theme which page is open (the sign-in pages stay light). Render once inside the router. */
export function ThemeRoute() {
  const store = useContext(ThemeStoreContext)
  const { pathname } = useLocation()
  useIsoLayoutEffect(() => {
    store?.setPath(pathname)
  }, [store, pathname])
  return null
}

// Outside a provider (an isolated test or preview) the hook still works on a
// store of its own, so a stray component never crashes the page.
let fallbackStore: ThemeStore | null = null

export function useTheme(): ThemeContextValue {
  const store = useContext(ThemeStoreContext) ?? (fallbackStore ??= createThemeStore())
  const theme = useSyncExternalStore(store.subscribe, store.get, store.get)
  return useMemo(() => ({ theme, setTheme: store.set, toggleTheme: store.toggle }), [theme, store])
}
