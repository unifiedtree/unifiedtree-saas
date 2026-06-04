import React from 'react'
import { useAuthStore } from '@/core/auth/authStore'
import { ModuleNotActivated } from '@/pages/ModuleNotActivated'

interface ModuleGateProps {
  moduleKey: string
  children: React.ReactNode
}

export const ModuleGate: React.FC<ModuleGateProps> = ({ moduleKey, children }) => {
  // Subscribe to the reactive activeModules list (not the stable `hasModule` function
  // reference). On a direct page load/reload, the auth store is populated by an effect
  // that runs *after* the first render; selecting the function alone pins the gate to its
  // initial (pre-hydration) result and wrongly shows "Not Activated" until a client-side
  // nav remounts it. Deriving a boolean from `tenant.activeModules` makes the gate
  // re-evaluate as soon as hydration lands.
  const isActive = useAuthStore((s) => s.tenant?.activeModules.includes(moduleKey) ?? false)
  if (!isActive) return <ModuleNotActivated moduleKey={moduleKey} />
  return <>{children}</>
}
