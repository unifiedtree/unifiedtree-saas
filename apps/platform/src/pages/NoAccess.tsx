import React from 'react'
import { ShieldOff } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'

export const NoAccess: React.FC = () => {
  const logout = useSdkStore(s => s.logout)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--bg-subtle)] border border-[var(--border-default)]">
        <ShieldOff size={28} className="text-[var(--text-tertiary)]" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">No roles assigned</h1>
        <p className="mt-2 max-w-sm text-sm text-[var(--text-secondary)]">
          Your account has no roles assigned. Contact your administrator to get access.
        </p>
      </div>
      <button
        onClick={logout}
        className="btn-press inline-flex h-9.5 items-center justify-center gap-1.5 rounded-xl bg-[var(--interactive-primary)] px-4 text-sm font-semibold text-white shadow-[0_4px_14px_0_rgba(15,110,86,0.35)] hover:bg-[var(--interactive-primary-hover)] hover:shadow-[0_6px_20px_0_rgba(15,110,86,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 transition-all duration-150"
      >
        Sign out
      </button>
    </div>
  )
}
