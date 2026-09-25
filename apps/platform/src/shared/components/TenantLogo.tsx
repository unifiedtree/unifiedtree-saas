import React from 'react'
import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { MonogramTile } from '@/shared/components/WorkspaceMark'

interface TenantLogoProps {
  /** Class applied to the rendered <img>. Callers own sizing. */
  className?: string
  /** Optional wrapper class if the caller wants a chip / background. */
  wrapperClassName?: string
}

/**
 * The workspace's uploaded logo (Settings → Branding). With none, or if the
 * image fails to load, the workspace monogram: never the vendor's logo
 * (white label).
 */
export const TenantLogo: React.FC<TenantLogoProps> = ({ className, wrapperClassName }) => {
  const b = useWorkspaceBranding()
  const [failed, setFailed] = React.useState<string | null>(null)
  const src = b.logoUrl || b.markUrl
  const inner = src && failed !== src
    ? <img src={src} alt={b.workspaceName ? `${b.workspaceName} logo` : ''} className={className} onError={() => setFailed(src)} />
    : <MonogramTile letter={b.monogram} size={32} />
  return wrapperClassName ? <span className={wrapperClassName}>{inner}</span> : inner
}
