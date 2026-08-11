import React from 'react'
import { useTenantBranding } from '@/core/tenant/useTenantBranding'

interface TenantLogoProps {
  /** Class applied to the rendered <img>. Callers own sizing. */
  className?: string
  /** Optional wrapper class if the caller wants a chip / background. */
  wrapperClassName?: string
}

/**
 * Renders the workspace's uploaded logo (Settings → Branding) with the
 * UnifiedTree default as a fallback. Shared by every "chrome" surface — the
 * launcher header, the collapsed rail, the sidebar Logo button — so every
 * spot that shows brand shows the same brand.
 *
 * Login page does NOT use this component — it has its own placeholder chip
 * for unbranded workspaces ("Your logo" repeating stripe) and needs the
 * workspaceStatus response for auth flow anyway. Both paths ultimately read
 * from the same `/v1/public/workspace-status` endpoint (see
 * `useTenantBranding`), so behaviour matches even with two rendering
 * strategies.
 */
export const TenantLogo: React.FC<TenantLogoProps> = ({ className, wrapperClassName }) => {
  const { logoUrl, tenantName } = useTenantBranding()
  const img = (
    <img
      src={logoUrl || '/UnifiedTreeLogo.png'}
      alt={tenantName || 'Unified Tree'}
      className={className}
      onError={(e) => {
        // Broken tenant logo (moved / expired R2 URL) — fall back to the
        // UnifiedTree default rather than the browser's broken-image glyph.
        const el = e.target as HTMLImageElement
        if (el.src.endsWith('/UnifiedTreeLogo.png')) return
        el.src = '/UnifiedTreeLogo.png'
      }}
    />
  )
  return wrapperClassName ? <span className={wrapperClassName}>{img}</span> : img
}
