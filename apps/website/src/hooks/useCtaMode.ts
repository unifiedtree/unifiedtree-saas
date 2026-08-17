import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore'

/**
 * Decides whether every "start free trial" / "create workspace" CTA on the
 * marketing site should render as TRIAL or PAID, per the global rule:
 *
 *   not signed in                      -> TRIAL
 *   signed in, 0 workspaces            -> TRIAL
 *   signed in, >= 1 workspace          -> PAID
 *
 * `ready` is false during the brief window when the caller is signed in
 * but their workspace list hasn't loaded yet — CTAs should render a
 * skeleton (or hide) during that window so a signed-in-with-workspaces
 * user does not see TRIAL flash for a beat before it flips to PAID.
 *
 * The hook also lazily kicks off the workspaces load on mount so any
 * page that renders a CTA gets the right variant on first paint after
 * hydration.
 */
export type CtaMode = 'trial' | 'paid'

export interface CtaModeResult {
  mode: CtaMode
  href: string           // /signup?mode=trial   OR   /signup?mode=paid
  ready: boolean         // false = still resolving; hide/skeleton
  signedIn: boolean
  workspaceCount: number
}

export function useCtaMode(): CtaModeResult {
  const accountToken   = useAuthStore((s) => s.accountToken)
  const workspaces     = useAuthStore((s) => s.workspaces)
  const isLoading      = useAuthStore((s) => s.isLoading)
  const loadWorkspaces = useAuthStore((s) => s.loadWorkspaces)

  // Tracks whether we have completed at least one workspace fetch for
  // this signed-in session. Before 2026-08-17 the hook derived "ready"
  // from `workspaces !== null`, but the zustand store initialises
  // `workspaces` to `[]`, so that check was always true — the CTA
  // resolved to TRIAL for a beat before flipping to PAID on hard-refresh
  // (audit CRIT: paid users saw "Start free trial" flash before the
  // fetch finished). This flag flips to true only after loadWorkspaces
  // has resolved OR when we can already trust the cached list
  // (setAccountAuth populated it at login time).
  const [hasFetched, setHasFetched] = useState(false)

  // Kick off workspace load exactly once when we notice a token with no
  // workspaces cached. Zustand's setAccountAuth populates workspaces at
  // login time; hard refresh on a marketing page has the token but not
  // the workspace list — that's when this fetch matters.
  useEffect(() => {
    if (!accountToken) return
    // Already have a cached list from setAccountAuth → treat as fetched.
    if (workspaces.length > 0) {
      setHasFetched(true)
      return
    }
    if (isLoading) return
    let cancelled = false
    loadWorkspaces()
      .catch(() => {
        // Swallow — the CTA falls back to TRIAL (safe default) if the
        // fetch fails; a user with a real account will not silently see
        // a trial button as long as the store's cached workspaces are
        // populated after their first successful load.
      })
      .finally(() => {
        if (!cancelled) setHasFetched(true)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken])

  const signedIn = !!accountToken
  const workspaceCount = workspaces.length

  // Ready = we are confident about "does this user have any workspaces?":
  //   - anon:                        always ready (mode = TRIAL)
  //   - signed in + cached (>0):     ready immediately (login path)
  //   - signed in + fetched:         ready after loadWorkspaces resolves
  //   - signed in + still fetching:  not ready (skeleton, no flash)
  const ready = !signedIn || (!isLoading && (workspaces.length > 0 || hasFetched))

  const mode: CtaMode = !signedIn || workspaceCount === 0 ? 'trial' : 'paid'
  const href = mode === 'trial' ? '/signup?mode=trial' : '/signup?mode=paid'

  return { mode, href, ready, signedIn, workspaceCount }
}
