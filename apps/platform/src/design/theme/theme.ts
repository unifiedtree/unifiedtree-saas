// Light / dark theme state, without React (the provider in ThemeProvider.tsx
// wraps it). The person's choice is kept per device in localStorage under
// 'ut.theme' and shows on <html> as data-theme="light|dark" plus
// color-scheme, which the tokens in ./tokens.css read. Light is the default,
// and the sign-in pages (sign-in, forgot / reset password, accept invite,
// pending approval) always show light.
// The inline script in apps/platform/index.html applies the same rules before
// the first paint — keep the two in step.
//
// Every storage access is guarded: with storage blocked (private windows,
// blocked site data) the theme still switches, it just isn't remembered.

export type ThemeName = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'ut.theme'
export const DEFAULT_THEME: ThemeName = 'light'
/** Pages that stay light whatever the person chose (before sign-in). */
export const LIGHT_ONLY_PATHS = ['/login', '/forgot-password', '/reset-password', '/accept-invite', '/pending-approval']
/** Motion level attribute read by motion.css (full | subtle | off). */
export const MOTION_ATTRIBUTE = 'data-ufx'
export const DEFAULT_MOTION = 'full'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>
type ThemeRoot = Pick<HTMLElement, 'setAttribute' | 'hasAttribute'> & { style: { colorScheme: string } }

export const isThemeName = (v: unknown): v is ThemeName => v === 'light' || v === 'dark'

export const isLightOnlyPath = (pathname: string) => LIGHT_ONLY_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))

/** The theme a page shows: the person's choice, except on the light-only pages. */
export const resolveTheme = (choice: ThemeName, pathname: string): ThemeName => (isLightOnlyPath(pathname) ? 'light' : choice)

/** window.localStorage, or null when there is none or reading it throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

const currentPath = () => {
  try {
    return typeof window !== 'undefined' && window.location ? window.location.pathname : '/'
  } catch {
    return '/'
  }
}
const documentRoot = (): ThemeRoot | null => (typeof document !== 'undefined' && document.documentElement ? document.documentElement : null)

/** The saved choice; light when nothing valid is saved or storage is blocked. */
export function readStoredTheme(storage: ReadableStorage | null = browserStorage()): ThemeName {
  if (!storage) return DEFAULT_THEME
  try {
    const v = storage.getItem(THEME_STORAGE_KEY)
    return isThemeName(v) ? v : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** Saves the choice; false when storage is missing or refuses the write. */
export function storeTheme(theme: ThemeName, storage: WritableStorage | null = browserStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(THEME_STORAGE_KEY, theme)
    return true
  } catch {
    return false
  }
}

/** Puts the theme on <html> (data-theme + color-scheme) and a default motion level if none is set. */
export function applyTheme(theme: ThemeName, root: ThemeRoot | null = documentRoot()): void {
  if (!root) return
  root.setAttribute('data-theme', theme)
  root.style.colorScheme = theme
  if (!root.hasAttribute(MOTION_ATTRIBUTE)) root.setAttribute(MOTION_ATTRIBUTE, DEFAULT_MOTION)
}

export interface ThemeStore {
  /** The theme on screen. */
  get: () => ThemeName
  /** The person's saved choice (differs from get() only on the light-only pages). */
  choice: () => ThemeName
  set: (theme: ThemeName) => void
  toggle: () => void
  /** The page changed (router). */
  setPath: (pathname: string) => void
  subscribe: (listener: () => void) => () => void
  /** Re-reads storage (another tab changed the choice). */
  sync: () => void
}

/** The theme with subscribers: set()/toggle() save the choice, apply it and notify. */
export function createThemeStore({
  storage = browserStorage(),
  root = documentRoot(),
  pathname = currentPath(),
}: { storage?: (ReadableStorage & WritableStorage) | null; root?: ThemeRoot | null; pathname?: string } = {}): ThemeStore {
  let choice = readStoredTheme(storage)
  let path = pathname
  let shown = resolveTheme(choice, path)
  const listeners = new Set<() => void>()
  const update = () => {
    const next = resolveTheme(choice, path)
    applyTheme(next, root)
    if (next === shown) return
    shown = next
    listeners.forEach((l) => l())
  }
  const set = (next: ThemeName) => {
    if (!isThemeName(next)) return
    choice = next
    storeTheme(next, storage)
    update()
  }
  return {
    get: () => shown,
    choice: () => choice,
    set,
    toggle: () => set(choice === 'dark' ? 'light' : 'dark'),
    setPath: (p) => {
      path = p
      update()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sync: () => {
      choice = readStoredTheme(storage)
      update()
    },
  }
}
