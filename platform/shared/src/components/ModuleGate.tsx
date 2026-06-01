import React from 'react'
import { useModuleAccess } from '../hooks/useModuleAccess'

interface ModuleNotActivatedProps {
  moduleKey: string
  canActivate: boolean
}

function ModuleNotActivated({ moduleKey, canActivate }: ModuleNotActivatedProps) {
  const displayName = moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1).toUpperCase()
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-8">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>
      <h3 className="text-white font-semibold text-lg mb-2">{displayName} Module Not Activated</h3>
      <p className="text-slate-400 text-sm max-w-sm leading-relaxed mb-6">
        This module is not active on your workspace. {canActivate
          ? 'Activate it from your subscription settings to unlock access.'
          : 'Contact your workspace administrator to activate this module.'}
      </p>
      {canActivate && (
        <button className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium rounded-lg transition-colors">
          Activate {displayName}
        </button>
      )}
    </div>
  )
}

interface ModuleGateProps {
  moduleKey: string
  children: React.ReactNode
  fallback?: React.ReactNode
}

export function ModuleGate({ moduleKey, children, fallback }: ModuleGateProps) {
  const { isActive, canActivate } = useModuleAccess(moduleKey)

  if (!isActive) {
    return (
      <>
        {fallback ?? <ModuleNotActivated moduleKey={moduleKey} canActivate={canActivate} />}
      </>
    )
  }

  return <>{children}</>
}
