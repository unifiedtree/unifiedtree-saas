import { useEffect, useState } from 'react'
import { apiJson, currentSubdomain, type WorkspaceStatus } from '@/core/api/client'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'

/**
 * Shared tenant-branding hook — one source of truth for the workspace's own
 * logo across every page in the platform SPA.
 *
 * Backstory: the SDK's auth hydration (`/v1/canonical-auth/me` and
 * `loginWithCredentials`) does not populate `AuthTenant.logoUrl`, so the value
 * that lands in the local auth store is always undefined. The login page
 * worked because it fetches `/v1/public/workspace-status` directly for its own
 * auth flow (status/tenantId/activeModules) and pulls `logoUrl` off the same
 * payload. Every other surface — including the `/modules` launcher header —
 * fell back to the default UnifiedTree logo.
 *
 * This hook makes the exact same public workspace-status call the login page
 * uses (unauthenticated, subdomain-resolved), memoises the result per
 * subdomain for the tab's lifetime, and returns `{logoUrl, tenantName}`. If
 * the local auth store ever gets a `logoUrl` (e.g. after a future SDK update
 * that plumbs it through /me), we prefer that so we never render stale.
 *
 * Falling back is the caller's job — this hook simply reports what branding
 * the workspace has uploaded (or null).
 */

type Branding = { logoUrl: string | null; tenantName: string | null }

// Per-subdomain in-memory cache. Cheap payload, but no need to re-fetch on
// every route change.
const cache = new Map<string, Branding>()

export function useTenantBranding(): Branding {
  const subdomain = currentSubdomain()
  const storedLogoUrl = useLocalAuthStore(s => s.tenant?.logoUrl) ?? null
  const storedName    = useLocalAuthStore(s => s.tenant?.name) ?? null

  const seed: Branding = {
    logoUrl: storedLogoUrl || cache.get(subdomain)?.logoUrl || null,
    tenantName: storedName || cache.get(subdomain)?.tenantName || null,
  }
  const [branding, setBranding] = useState<Branding>(seed)

  useEffect(() => {
    // No subdomain means there is no workspace to brand (the base marketing
    // host, or a stray localhost). Keep the default.
    if (!subdomain) return
    // If the auth store already has both fields we have nothing to add, but
    // still validate against the backend on first mount per session so a fresh
    // upload in Settings shows up on the next navigation without a hard reload.
    let cancelled = false
    apiJson<WorkspaceStatus>('/v1/public/workspace-status')
      .then((res) => {
        if (cancelled) return
        const next: Branding = {
          logoUrl: res.logoUrl ?? null,
          tenantName: res.tenantName ?? storedName ?? null,
        }
        cache.set(subdomain, next)
        setBranding((prev) =>
          prev.logoUrl === next.logoUrl && prev.tenantName === next.tenantName
            ? prev
            : next,
        )
      })
      .catch(() => {
        /* Best-effort: a network blip should NOT hide the workspace's logo.
           Keep whatever seed we started with (store value or previous cache). */
      })
    return () => { cancelled = true }
  }, [subdomain, storedName])

  // A logoUrl that lands in the auth store later (SDK upgrade, Settings save
  // that writes into the store) should immediately win over the cached fetch.
  if (storedLogoUrl && storedLogoUrl !== branding.logoUrl) {
    return { logoUrl: storedLogoUrl, tenantName: storedName ?? branding.tenantName }
  }
  return branding
}
