import React from 'react'
import { isStaleChunkError } from '@/shared/routing/lazyPage'

/**
 * The last line of defence: wraps the whole app in main.tsx, above the theme, the router and every
 * provider, so a crash anywhere — a provider, the shell, a page's own boundary — never leaves a
 * blank white page (client report, 7 Oct 2026: "when they clicked on the notification it showed a
 * full white page and nothing"). The pages keep their own RouteErrorBoundary; this one only shows
 * when something above them fails.
 *
 * It sits outside the router and the theme, so it uses neither: plain markup, the theme's colour
 * tokens (with their light values as fallbacks) and full page loads to leave.
 */
interface State {
  error: Error | null
}

/** Where "Home" goes: every person's way home (App.tsx /dashboard sends people without an admin home to /me). */
export const CRASH_HOME = '/dashboard'

/** Back, or Home when there is nothing to go back to. A full load, since the app above the router is broken. */
export function goBackOrHome(win: Pick<Window, 'history' | 'location' | 'addEventListener'> = window) {
  if (win.history.length > 1) {
    win.addEventListener('popstate', () => win.location.reload(), { once: true })
    win.history.back()
  } else {
    win.location.assign(CRASH_HOME)
  }
}

export class AppCrashBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[AppCrashBoundary] the app failed to render', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    // A page's code from before a deploy: loading the app again fetches the new build.
    const stale = isStaleChunkError(error)
    const button: React.CSSProperties = {
      font: 'inherit', fontSize: 14, fontWeight: 600, borderRadius: 10, padding: '10px 18px', cursor: 'pointer',
    }
    return (
      <div role="alert" data-testid="app-crash" style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, boxSizing: 'border-box',
        background: 'var(--u-bg, #F3F6F4)', color: 'var(--u-ink, #0E1B16)', fontFamily: 'var(--u-font, Inter, system-ui, sans-serif)',
      }}>
        <div style={{
          width: '100%', maxWidth: 440, textAlign: 'center', padding: '32px 24px', boxSizing: 'border-box',
          background: 'var(--u-sf, #FFFFFF)', border: '1px solid var(--u-ln, #E3E9E6)', borderRadius: 16,
        }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--u-ink2, #4A5A54)' }}>
            {stale
              ? 'A newer version of the app is available. Load it again to carry on.'
              : 'This screen could not be shown. Go back, or go to your home page.'}
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {stale ? (
              <button type="button" onClick={() => window.location.reload()}
                style={{ ...button, border: 0, background: 'var(--u-br, #0F6E56)', color: 'var(--u-onbr, #FFFFFF)' }}>
                Load again
              </button>
            ) : (
              <button type="button" onClick={() => goBackOrHome()}
                style={{ ...button, border: '1px solid var(--u-ln, #E3E9E6)', background: 'transparent', color: 'inherit' }}>
                Back
              </button>
            )}
            <button type="button" onClick={() => window.location.assign(CRASH_HOME)}
              style={{ ...button, border: 0, background: stale ? 'transparent' : 'var(--u-br, #0F6E56)', color: stale ? 'inherit' : 'var(--u-onbr, #FFFFFF)' }}>
              Home
            </button>
          </div>
        </div>
      </div>
    )
  }
}
