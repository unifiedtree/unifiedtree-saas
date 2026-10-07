// The whole-app error boundary (client report 7 Oct 2026: a click showed "a full white page and
// nothing"). Rendered as markup (no DOM test environment here), so the fallback is drawn by hand.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppCrashBoundary, CRASH_HOME, goBackOrHome } from './AppCrashBoundary'

const fallback = (error: Error) => {
  const b = new AppCrashBoundary({ children: <p>the app</p> })
  b.state = AppCrashBoundary.getDerivedStateFromError(error)
  return renderToStaticMarkup(<>{b.render()}</>)
}

describe('AppCrashBoundary', () => {
  it('shows the app while nothing has failed', () => {
    expect(renderToStaticMarkup(<AppCrashBoundary><p>the app</p></AppCrashBoundary>)).toBe('<p>the app</p>')
  })

  it('says "Something went wrong" with Back and Home after a crash, never a blank page', () => {
    const html = fallback(new TypeError("Cannot read properties of undefined (reading 'map')"))
    expect(html).toContain('role="alert"')
    expect(html).toContain('Something went wrong')
    expect(html).toContain('>Back<')
    expect(html).toContain('>Home<')
    // The error itself is for the console, not the person.
    expect(html).not.toContain('reading')
  })

  it("offers to load the new version when a page's code is from before a deploy", () => {
    const html = fallback(new TypeError('Failed to fetch dynamically imported module: https://x.unifiedtree.com/assets/Leave-abc.js'))
    expect(html).toContain('Load again')
    expect(html).toContain('>Home<')
  })

  it('Back goes back a page (and loads it), or Home when there is nothing to go back to', () => {
    const win = { history: { length: 3, back: vi.fn() }, location: { reload: vi.fn(), assign: vi.fn() }, addEventListener: vi.fn() }
    goBackOrHome(win as unknown as Window)
    expect(win.history.back).toHaveBeenCalledTimes(1)
    expect(win.addEventListener).toHaveBeenCalledWith('popstate', expect.any(Function), { once: true })
    ;(win.addEventListener.mock.calls[0][1] as () => void)()
    expect(win.location.reload).toHaveBeenCalledTimes(1)

    const fresh = { history: { length: 1, back: vi.fn() }, location: { reload: vi.fn(), assign: vi.fn() }, addEventListener: vi.fn() }
    goBackOrHome(fresh as unknown as Window)
    expect(fresh.history.back).not.toHaveBeenCalled()
    expect(fresh.location.assign).toHaveBeenCalledWith(CRASH_HOME)
  })

  it('wraps the whole app in main.tsx, above the theme, router and every provider', () => {
    const main = readFileSync(fileURLToPath(new URL('../../main.tsx', import.meta.url)), 'utf8')
    const open = main.indexOf('<AppCrashBoundary>')
    const close = main.indexOf('</AppCrashBoundary>')
    expect(open).toBeGreaterThan(-1)
    for (const inner of ['<ThemeProvider>', '<QueryProvider>', '<BrowserRouter>', '<AuthProvider>', '<NotificationProvider>', '<App />']) {
      const at = main.indexOf(inner)
      expect([inner, at > open && at < close]).toEqual([inner, true])
    }
  })
})
