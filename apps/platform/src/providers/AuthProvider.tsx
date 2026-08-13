import React, { useEffect, useState } from 'react'
import { useAuthStore as useSdkStore, apiEvents, setAccessToken } from '@unifiedtree/sdk'
import type { AuthUser, AuthTenant, ModuleInfo } from '@unifiedtree/sdk'
import { useAuthStore as useOldStore } from '@/core/auth/authStore'
import { WelcomeSplash, hasWelcomed, markWelcomed } from '@/core/auth/WelcomeSplash'
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

  // Whether the welcome has already played this session. Read once on mount so
  // a re-render never replays it mid-session.
  const [welcomed, setWelcomed] = useState(() => hasWelcomed())

  // A fresh sign-in must be greeted again, so clear the flag on sign-out.
  useEffect(() => {
    if (sdkStatus === 'unauthenticated') {
      try { sessionStorage.removeItem('ut.welcomed') } catch { /* private mode */ }
      setWelcomed(false)
    }
  }, [sdkStatus])

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

  // Hydrating — no identity yet, so the grove just breathes.
  if (sdkStatus === 'idle' || sdkStatus === 'loading') {
    return <WelcomeSplash mode="booting" />
  }

  // Authenticated and not yet greeted this session: play the welcome once, over
  // the app (which is already mounted underneath, so nothing is blocked from
  // loading while it plays).
  const greeting = sdkStatus === 'authenticated' && !welcomed
  const firstName = sdkUser?.firstName || (sdkUser?.email ? sdkUser.email.split('@')[0] : undefined)

  return (
    <>
      {children}
      {greeting && (
        <WelcomeSplash
          mode="welcome"
          name={firstName}
          workspace={sdkTenant?.displayName}
          onDone={() => { markWelcomed(); setWelcomed(true) }}
        />
      )}
    </>
  )
}
