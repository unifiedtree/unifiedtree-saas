import React from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore } from '@/core/auth/authStore'
import { ModuleNotActivated } from '@/pages/ModuleNotActivated'

interface ModuleGateProps {
  moduleKey: string
  children: React.ReactNode
}

export const ModuleGate: React.FC<ModuleGateProps> = ({ moduleKey, children }) => {
  // Wait for the SDK to finish resolving the session before deciding. On a
  // hard reload the local zustand mirror hydrates one tick after the SDK,
  // and the pre-hydration read of `tenant.activeModules` returned an empty
  // list — which flashed the "HRMS Not Activated $49/mo" upsell for a real
  // active tenant. Rendering `null` while status is 'idle' or 'loading'
  // keeps the ground blank rather than lying about a locked module.
  const sdkStatus = useSdkStore((s) => s.status)
  // Subscribe to the reactive activeModules list (not the stable `hasModule` function
  // reference). On a direct page load/reload, the auth store is populated by an effect
  // that runs *after* the first render; selecting the function alone pins the gate to its
  // initial (pre-hydration) result and wrongly shows "Not Activated" until a client-side
  // nav remounts it. Deriving a boolean from `tenant.activeModules` makes the gate
  // re-evaluate as soon as hydration lands.
  const isActive = useAuthStore((s) => s.tenant?.activeModules.includes(moduleKey) ?? false)
  if (sdkStatus !== 'authenticated') return null
  if (!isActive) return <ModuleNotActivated moduleKey={moduleKey} />
  return <>{children}</>
}
