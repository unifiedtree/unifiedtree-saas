import React, { useEffect } from 'react'
import { useAuthStore as useSdkStore, apiEvents, setAccessToken } from '@unifiedtree/sdk'
import type { AuthUser, AuthTenant, ModuleInfo } from '@unifiedtree/sdk'
import { useAuthStore as useOldStore } from '@/core/auth/authStore'
import type { User, Tenant } from '@/types'

function toOldUser(sdkUser: AuthUser, permCodes: string[]): User {
  return {
    id: sdkUser.id,
    email: sdkUser.email,
    firstName: sdkUser.firstName,
    lastName: sdkUser.lastName,
    avatar: sdkUser.avatar,
    role: sdkUser.roles[0] ?? 'EMPLOYEE',
    permissions: permCodes,
  }
}

function toOldTenant(sdkTenant: AuthTenant, modules: ModuleInfo[]): Tenant {
  return {
    id: sdkTenant.id,
    name: sdkTenant.displayName,
    subdomain: sdkTenant.slug,
    planType: sdkTenant.planType,
    activeModules: modules.filter(m => m.enabled).map(m => m.key),
    logoUrl: sdkTenant.logoUrl,
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sdkStatus      = useSdkStore(s => s.status)
  const sdkUser        = useSdkStore(s => s.user)
  const sdkTenant      = useSdkStore(s => s.tenant)
  const sdkPermissions = useSdkStore(s => s.permissions)
  const sdkModules     = useSdkStore(s => s.modules)
  const hydrate        = useSdkStore(s => s.hydrate)

  const oldLogin  = useOldStore(s => s.login)
  const oldLogout = useOldStore(s => s.logout)

  // Hydrate on mount
  useEffect(() => { 
    // Check if we arrived via cross-domain SSO with a token in the URL
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      setAccessToken(token)
      // Clean up the URL so the token doesn't linger in history
      window.history.replaceState({}, document.title, window.location.pathname)
    }
    
    hydrate() 
  }, [hydrate])

  // Bridge SDK state → old auth store (HRMS files depend on it)
  useEffect(() => {
    if (sdkStatus === 'authenticated' && sdkUser && sdkTenant) {
      const permCodes = Array.from(sdkPermissions.keys())
      // token param is empty — token is held in-memory by SDK's tokenStorage
      oldLogin('', toOldUser(sdkUser, permCodes), toOldTenant(sdkTenant, sdkModules))
    } else if (sdkStatus === 'unauthenticated') {
      oldLogout()
    }
  }, [sdkStatus, sdkUser, sdkTenant, sdkPermissions, sdkModules, oldLogin, oldLogout])

  // Wire 403 forbidden events to a window event so Toaster can pick it up
  useEffect(() => {
    const unsub = apiEvents.onForbidden((code) => {
      window.dispatchEvent(new CustomEvent('ut:forbidden', { detail: { code } }))
    })
    return unsub
  }, [])

  // Show splash while hydrating
  if (sdkStatus === 'idle' || sdkStatus === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-base">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 rounded-2xl bg-accent-default flex items-center justify-center shadow-lg">
            <span className="text-[#0F172A] font-bold text-xl select-none">U</span>
          </div>
          <div className="h-1 w-28 rounded-full bg-border-default overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-default"
              style={{ animation: 'shimmer 1.6s ease-in-out infinite', backgroundSize: '200% 100%' }}
            />
          </div>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
