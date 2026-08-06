import { useEffect } from 'react'
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

  // Kick off workspace load exactly once when we notice a token with no
  // workspaces cached. Zustand's setAccountAuth populates workspaces at
  // login time; hard refresh on a marketing page has the token but not
  // the workspace list — that's when this fetch matters.
  useEffect(() => {
    if (accountToken && workspaces.length === 0 && !isLoading) {
      loadWorkspaces().catch(() => {
        // Swallow — the CTA falls back to TRIAL (safe default) if the
        // fetch fails; a user with a real account will not silently see
        // a trial button as long as the store's cached workspaces are
        // populated after their first successful load.
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken])

  const signedIn = !!accountToken
  const workspaceCount = workspaces.length

  // Ready = we are confident about "does this user have any workspaces?".
  //   - anon:                 always ready (mode = TRIAL)
  //   - signed in + cached:   ready
  //   - signed in + loading:  not ready (avoid flash)
  const ready = !signedIn || (!isLoading && workspaces !== null && workspaces !== undefined)

  const mode: CtaMode = !signedIn || workspaceCount === 0 ? 'trial' : 'paid'
  const href = mode === 'trial' ? '/signup?mode=trial' : '/signup?mode=paid'

  return { mode, href, ready, signedIn, workspaceCount }
}
