import React from 'react'

/**
 * Catches render-phase errors so ONE broken page cannot take down the whole app.
 *
 * 2026-09-10: the Attendance Analytics page threw inside render (HrAvatar
 * dereferenced a null employee_name — Postgres `x || NULL` is NULL, so an
 * employee with no last_name produced a null display name). With no boundary
 * anywhere in the tree, React unmounted the ENTIRE application: the page went
 * blank, and it stayed blank through browser back and forward, because the
 * root was gone. The only recovery was a hard reload, and the user had no way
 * to know that.
 *
 * That is the part worth fixing permanently. Data bugs will happen again; a
 * single one should cost the user one page, not the whole product — and it
 * should say so instead of showing a white screen.
 *
 * Keyed by route path in App.tsx so navigating away from a broken page
 * automatically remounts a fresh boundary and clears the error.
 */
interface Props {
  children: React.ReactNode
  /** Shown in the fallback so a bug report can name the screen. */
  routeLabel?: string
}

interface State {
  error: Error | null
}

export class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Keep the real stack in the console for whoever is debugging — the
    // fallback deliberately does not show it to the end user.
    // eslint-disable-next-line no-console
    console.error('[RouteErrorBoundary] render failed', this.props.routeLabel, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div className="mx-auto max-w-2xl p-6 sm:p-10">
        <div className="ut-card p-8 text-center">
          <h1 className="text-lg font-bold text-text-primary">This page hit an error</h1>
          <p className="mt-2 text-sm text-text-secondary">
            Something on this screen failed to load. The rest of the app is still working —
            use the menu to go somewhere else, or try again.
          </p>
          <p className="mt-3 text-xs text-text-tertiary">
            {this.props.routeLabel ? `Screen: ${this.props.routeLabel}. ` : ''}
            If it keeps happening, send this screen name to support.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#047857]"
            >
              Try again
            </button>
            <button
              onClick={() => { window.location.href = '/dashboard' }}
              className="rounded-xl border border-border-default px-4 py-2.5 text-sm font-semibold text-text-secondary hover:bg-bg-base"
            >
              Back to dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }
}
