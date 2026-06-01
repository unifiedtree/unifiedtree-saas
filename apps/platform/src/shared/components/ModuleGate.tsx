import React from 'react'
import { useAuthStore } from '@/core/auth/authStore'
import { ModuleNotActivated } from '@/pages/ModuleNotActivated'

interface ModuleGateProps {
  moduleKey: string
  children: React.ReactNode
}

export const ModuleGate: React.FC<ModuleGateProps> = ({ moduleKey, children }) => {
  const hasModule = useAuthStore((s) => s.hasModule)
  if (!hasModule(moduleKey)) return <ModuleNotActivated moduleKey={moduleKey} />
  return <>{children}</>
}
