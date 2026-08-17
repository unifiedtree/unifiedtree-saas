import React, { useEffect, useRef, useState } from 'react'
import { useAuthStore as useSdkStore, apiEvents, setAccessToken } from '@unifiedtree/sdk'
import type { AuthUser, AuthTenant, ModuleInfo } from '@unifiedtree/sdk'
import { useAuthStore as useOldStore } from '@/core/auth/authStore'
import { queryClient } from '@/providers/QueryProvider'
import { useNotificationStore } from '@/core/notifications/notificationStore'
import {
  WelcomeSplash,
  peekWelcomeIntent,
  initialWelcomeIntent,
  consumeWelcomeIntent,
} from '@/core/auth/WelcomeSplash'
import type { User, Tenant } from '@/types'
import { useDisplayName } from '@/shared/hooks/useDisplayName'

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

  /**
   * Whether the one welcome animation is playing.
   *
   * Seeded during the FIRST render (not in an effect) and latched on the
   * transition into `authenticated` during render too. Effects run after the
   * browser paints, so deciding there meant one frame where the app was on
   * screen and the splash was not — the flash of dashboard before the greeting.
   */
  const [greeting, setGreeting] = useState(initialWelcomeIntent)
  const [seenStatus, setSeenStatus] = useState(sdkStatus)

  if (sdkStatus !== seenStatus) {
    setSeenStatus(sdkStatus)
    // Signing in happens inside an already-mounted app, so the initialiser
    // above cannot catch it; this does. `peek` is pure, so it is safe here.
    if (sdkStatus === 'authenticated' && !greeting && peekWelcomeIntent()) setGreeting(true)
    // Never strand the greeting over a session that turned out to be invalid.
    if (sdkStatus === 'unauthenticated' && greeting) setGreeting(false)
  }

  // Spend the flag once we have committed to showing the greeting, so the next
  // reload finds nothing. Safe in an effect: `greeting` is latched state, so
  // clearing the flag cannot retract the splash.
  useEffect(() => {
    if (greeting) consumeWelcomeIntent()
  }, [greeting])

  // Hydrate on mount
  useEffect(() => {
    // Check if we arrived via cross-domain SSO with a token in the URL
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token')
    if (token) {
      setAccessToken(token)
      // The greeting for this path was already decided by initialWelcomeIntent()
      // during the first render, which is what keeps the splash on screen from
      // frame one instead of a boot screen appearing first.
      // Clean up the URL so the token doesn't linger in history
      window.history.replaceState({}, document.title, window.location.pathname)
    }

    hydrate()
  }, [hydrate])

  // Bridge SDK state → old auth store (HRMS files depend on it).
  //
  // On the AUTH → UNAUTH transition we also wipe every react-query cache and
  // the in-memory notification store. On a shared laptop (kiosk, front desk,
  // trainer's machine) user B was briefly seeing user A's payslips / leaves
  // between "sign out" and the fresh queries firing, because tanstack-query
  // hydrates from cache before the first refetch resolves. Wiping on the
  // downward edge means every subsequent sign-in starts against an empty
  // cache and never renders the previous account's data by mistake.
  const prevStatusRef = useRef<typeof sdkStatus>(sdkStatus)
  useEffect(() => {
    if (sdkStatus === 'authenticated' && sdkUser && sdkTenant) {
      const permCodes = Array.from(sdkPermissions.keys())
      // token param is empty — token is held in-memory by SDK's tokenStorage
      oldLogin('', toOldUser(sdkUser, permCodes), toOldTenant(sdkTenant, sdkModules))
    } else if (sdkStatus === 'unauthenticated') {
      // Only clear on the actual DOWNWARD edge — the initial 'idle' →
      // 'unauthenticated' hydration on a public page must not wipe caches
      // that were never populated.
      if (prevStatusRef.current === 'authenticated') {
        try { queryClient.clear() } catch { /* best-effort */ }
        try { useNotificationStore.getState().reset() } catch { /* best-effort */ }
      }
      oldLogout()
    }
    prevStatusRef.current = sdkStatus
  }, [sdkStatus, sdkUser, sdkTenant, sdkPermissions, sdkModules, oldLogin, oldLogout])

  // Wire 403 forbidden events to a window event so Toaster can pick it up
  useEffect(() => {
    const unsub = apiEvents.onForbidden((code) => {
      window.dispatchEvent(new CustomEvent('ut:forbidden', { detail: { code } }))
    })
    return unsub
  }, [])

  // No splash while auth resolves. A reload is just a reload — the page comes
  // back, and nothing performs on the way. This is safe because RouteGuard
  // already returns null for `idle`/`loading`, so protected pages never render
  // against an unresolved session, and it only redirects once the status is
  // definitively `unauthenticated` — there is no login flash to guard against.
  //
  // Use the shared useDisplayName() hook so the splash matches the sidebar chip
  // and the greeting on the dashboard exactly. Passing raw firstName here was
  // the last place that could render "shurya.kumar063" (email local-part) on a
  // cold hydrate — the client asked for the FULL name near the splash animation
  // so we hand it fullName ("Chakri Chikkala"), not just the first word.
  const { fullName } = useDisplayName()

  return (
    <>
      {children}
      {greeting && (
        <WelcomeSplash
          ready={sdkStatus === 'authenticated'}
          name={fullName}
          workspace={sdkTenant?.displayName}
          onDone={() => setGreeting(false)}
        />
      )}
    </>
  )
}
