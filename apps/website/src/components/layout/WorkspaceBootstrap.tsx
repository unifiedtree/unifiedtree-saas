import { useEffect, useRef } from 'react'
import { useAuthStore } from '../../store/authStore'

/**
 * Fire-and-forget: on any page mount, if the user is signed in but we
 * don't have their workspaces cached yet, load them so the global CTA
 * rule can decide TRIAL vs PAID without a flash. Renders nothing.
 *
 * Mounted once inside Navbar so every marketing page benefits.
 * De-duplicates with an in-flight guard — remount / route change won't
 * fire duplicate loads.
 */
export function WorkspaceBootstrap() {
  const accountToken   = useAuthStore((s) => s.accountToken)
  const workspaces     = useAuthStore((s) => s.workspaces)
  const isLoading      = useAuthStore((s) => s.isLoading)
  const loadWorkspaces = useAuthStore((s) => s.loadWorkspaces)
  const kicked = useRef(false)

  useEffect(() => {
    if (!accountToken) { kicked.current = false; return }
    if (kicked.current) return
    if (workspaces.length > 0) { kicked.current = true; return }
    if (isLoading) return
    kicked.current = true
    loadWorkspaces().catch(() => {
      // Non-fatal — CTA fall back to TRIAL is safer than PAID for a
      // signed-in user whose workspace list we couldn't load; they
      // still can't complete a duplicate trial thanks to the
      // backend's email guard.
      kicked.current = false
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountToken])

  return null
}
