import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { applyTheme, createThemeStore, isLightOnlyPath, readStoredTheme, resolveTheme, storeTheme, THEME_STORAGE_KEY } from './theme'
import { ThemeProvider, useTheme, type ThemeContextValue } from './ThemeProvider'

// Vitest runs these without a browser: storage and <html> are small stand-ins.
function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  }
}
const blockedStorage = {
  getItem: (): string | null => { throw new DOMException('The operation is insecure.', 'SecurityError') },
  setItem: (): void => { throw new DOMException('The operation is insecure.', 'SecurityError') },
}
function fakeRoot(attrs: Record<string, string> = {}) {
  const map = new Map(Object.entries(attrs))
  return {
    map,
    style: { colorScheme: '' },
    setAttribute: (k: string, v: string) => void map.set(k, v),
    hasAttribute: (k: string) => map.has(k),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('theme store', () => {
  it('uses the existing ut.theme key', () => {
    expect(THEME_STORAGE_KEY).toBe('ut.theme')
  })

  it('defaults to light when nothing is saved', () => {
    expect(readStoredTheme(memoryStorage())).toBe('light')
    expect(createThemeStore({ storage: memoryStorage(), root: fakeRoot(), pathname: '/dashboard' }).get()).toBe('light')
  })

  it('ignores a saved value that is not light or dark (the old "system" default included)', () => {
    expect(readStoredTheme(memoryStorage({ 'ut.theme': 'system' }))).toBe('light')
    expect(readStoredTheme(memoryStorage({ 'ut.theme': 'dark' }))).toBe('dark')
  })

  it('setting dark saves it under ut.theme and switches <html>', () => {
    const storage = memoryStorage()
    const root = fakeRoot()
    const store = createThemeStore({ storage, root, pathname: '/dashboard' })
    const seen: string[] = []
    store.subscribe(() => seen.push(store.get()))
    store.set('dark')
    expect(store.get()).toBe('dark')
    expect(storage.map.get('ut.theme')).toBe('dark')
    expect(root.map.get('data-theme')).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(seen).toEqual(['dark'])
    // The next visit starts dark.
    expect(createThemeStore({ storage, root: fakeRoot(), pathname: '/dashboard' }).get()).toBe('dark')
  })

  it('toggle flips the choice and saves it', () => {
    const storage = memoryStorage()
    const store = createThemeStore({ storage, root: fakeRoot(), pathname: '/me' })
    store.toggle()
    expect(store.get()).toBe('dark')
    expect(storage.map.get('ut.theme')).toBe('dark')
    store.toggle()
    expect(store.get()).toBe('light')
    expect(storage.map.get('ut.theme')).toBe('light')
  })

  it('still switches when storage is blocked (just not remembered)', () => {
    const root = fakeRoot()
    expect(readStoredTheme(blockedStorage)).toBe('light')
    expect(storeTheme('dark', blockedStorage)).toBe(false)
    const store = createThemeStore({ storage: blockedStorage, root, pathname: '/dashboard' })
    expect(store.get()).toBe('light')
    expect(() => store.set('dark')).not.toThrow()
    expect(store.get()).toBe('dark')
    expect(root.map.get('data-theme')).toBe('dark')
  })

  it('works with no storage at all', () => {
    const store = createThemeStore({ storage: null, root: fakeRoot(), pathname: '/dashboard' })
    store.set('dark')
    expect(store.get()).toBe('dark')
  })

  it('sets the default motion level only when none is set', () => {
    const fresh = fakeRoot()
    applyTheme('light', fresh)
    expect(fresh.map.get('data-ufx')).toBe('full')
    expect(fresh.map.get('data-theme')).toBe('light')
    const subtle = fakeRoot({ 'data-ufx': 'subtle' })
    applyTheme('dark', subtle)
    expect(subtle.map.get('data-ufx')).toBe('subtle')
  })

  it('ignores anything but light or dark', () => {
    const store = createThemeStore({ storage: memoryStorage(), root: fakeRoot(), pathname: '/' })
    store.set('sepia' as never)
    expect(store.get()).toBe('light')
  })

  it('follows a change made in another tab', () => {
    const storage = memoryStorage()
    const root = fakeRoot()
    const store = createThemeStore({ storage, root, pathname: '/dashboard' })
    storage.setItem(THEME_STORAGE_KEY, 'dark')
    store.sync()
    expect(store.get()).toBe('dark')
    expect(root.map.get('data-theme')).toBe('dark')
  })
})

describe('sign-in pages stay light', () => {
  it('knows the light-only pages', () => {
    for (const p of ['/login', '/forgot-password', '/reset-password', '/accept-invite', '/pending-approval', '/reset-password/x']) expect(isLightOnlyPath(p)).toBe(true)
    for (const p of ['/', '/dashboard', '/me', '/login-help', '/hrms/leave', '/settings']) expect(isLightOnlyPath(p)).toBe(false)
    expect(resolveTheme('dark', '/login')).toBe('light')
    expect(resolveTheme('dark', '/dashboard')).toBe('dark')
  })

  it('shows light on sign-in with dark saved, and dark again after signing in', () => {
    const storage = memoryStorage({ 'ut.theme': 'dark' })
    const root = fakeRoot()
    const store = createThemeStore({ storage, root, pathname: '/login' })
    expect(store.get()).toBe('light')
    expect(store.choice()).toBe('dark')
    store.setPath('/dashboard')
    expect(store.get()).toBe('dark')
    expect(root.map.get('data-theme')).toBe('dark')
    store.setPath('/login')
    expect(store.get()).toBe('light')
    expect(root.map.get('data-theme')).toBe('light')
    // The saved choice is untouched by the sign-in page.
    expect(storage.map.get('ut.theme')).toBe('dark')
  })
})

describe('ThemeProvider / useTheme', () => {
  const render = () => {
    let ctx: ThemeContextValue | null = null
    const Probe = () => {
      ctx = useTheme()
      return createElement('span', null, ctx.theme)
    }
    const html = renderToString(createElement(ThemeProvider, null, createElement(Probe)))
    return { html, ctx: ctx as unknown as ThemeContextValue }
  }

  it('is light by default', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage(), location: { pathname: '/dashboard' } })
    expect(render().html).toContain('>light<')
  })

  it('starts dark when dark was saved; setTheme and toggleTheme save and apply', () => {
    const storage = memoryStorage({ 'ut.theme': 'dark' })
    const root = fakeRoot()
    vi.stubGlobal('window', { localStorage: storage, location: { pathname: '/dashboard' } })
    vi.stubGlobal('document', { documentElement: root })
    const { html, ctx } = render()
    expect(html).toContain('>dark<')
    ctx.setTheme('light')
    expect(storage.map.get('ut.theme')).toBe('light')
    expect(root.map.get('data-theme')).toBe('light')
    ctx.toggleTheme()
    expect(storage.map.get('ut.theme')).toBe('dark')
    expect(root.map.get('data-theme')).toBe('dark')
  })

  it('renders light on the sign-in page even with dark saved', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage({ 'ut.theme': 'dark' }), location: { pathname: '/login' } })
    expect(render().html).toContain('>light<')
  })

  it('works when reading localStorage itself throws', () => {
    const root = fakeRoot()
    vi.stubGlobal('window', { get localStorage() { throw new DOMException('denied', 'SecurityError') }, location: { pathname: '/dashboard' } })
    vi.stubGlobal('document', { documentElement: root })
    const { html, ctx } = render()
    expect(html).toContain('>light<')
    expect(() => ctx.setTheme('dark')).not.toThrow()
    expect(root.map.get('data-theme')).toBe('dark')
  })
})
