import React from 'react'
import { ShieldOff } from 'lucide-react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'

export const NoAccess: React.FC = () => {
  const logout = useSdkStore(s => s.logout)

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[#F8FAFC] px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
        <ShieldOff size={28} className="text-slate-400" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">No roles assigned</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-500">
          Your account has no roles assigned. Contact your administrator to get access.
        </p>
      </div>
      <button
        onClick={logout}
        className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
      >
        Sign out
      </button>
    </div>
  )
}
