import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { hasError: boolean }

/**
 * App-wide safety net. A render error anywhere below this boundary would
 * otherwise unmount the whole React tree and leave a blank white page — which
 * is unacceptable on a live checkout. Instead we show a friendly fallback with
 * a reload button, and log the real error to the console for diagnosis.
 *
 * Uses inline styles (not Tailwind classes) so the fallback still renders even
 * if styling failed to load.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[UnifiedTree] Render error:', error, info.componentStack)
  }

  private reload = () => window.location.assign('/')

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: '1rem', padding: '2rem', textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif', background: '#F8FAFC', color: '#0F172A',
      }}>
        <div style={{ fontSize: '2.5rem' }}>🌱</div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Something went wrong</h1>
        <p style={{ color: '#475569', maxWidth: '28rem', margin: 0, lineHeight: 1.5 }}>
          The page hit an unexpected error. Please reload — nothing was lost and no payment was taken.
        </p>
        <button onClick={this.reload} style={{
          marginTop: '0.5rem', background: '#0F6E56', color: '#fff', border: 'none',
          borderRadius: '0.75rem', padding: '0.75rem 1.75rem', fontSize: '1rem',
          fontWeight: 600, cursor: 'pointer',
        }}>
          Reload
        </button>
      </div>
    )
  }
}
