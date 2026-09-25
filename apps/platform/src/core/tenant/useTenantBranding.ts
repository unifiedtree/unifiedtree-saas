import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'

/**
 * The workspace's logo and name. Kept for older callers; the source of truth
 * is `useWorkspaceBranding()` (workspaceBranding.ts), which reads
 * /v1/workspace/branding when signed in and the public by-subdomain lookup
 * when not. Returns null for the logo when the workspace has none: callers
 * draw the workspace monogram, never the vendor's logo (white label).
 */
export function useTenantBranding(): { logoUrl: string | null; tenantName: string | null } {
  const b = useWorkspaceBranding()
  return { logoUrl: b.logoUrl || b.markUrl, tenantName: b.workspaceName }
}
