import React, { useState, useRef } from 'react'
import { useOnClickOutside } from '../hooks/useOnClickOutside'

interface Workspace {
  id: string
  name: string
  subdomain: string
  color: string
  plan: string
}

const MOCK_WORKSPACES: Workspace[] = [
  { id: 'ws-1', name: 'TechCorp Inc', subdomain: 'techcorp', color: '#6366F1', plan: 'Professional' },
  { id: 'ws-2', name: 'Startup Labs', subdomain: 'startuplabs', color: '#10B981', plan: 'Starter' },
  { id: 'ws-3', name: 'Global Ventures', subdomain: 'globalventures', color: '#F59E0B', plan: 'Enterprise' },
]

interface TenantSwitcherProps {
  currentWorkspaceId?: string
  onSwitch?: (workspace: Workspace) => void
}

export function TenantSwitcher({ currentWorkspaceId = 'ws-1', onSwitch }: TenantSwitcherProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useOnClickOutside(ref as React.RefObject<HTMLDivElement>, () => setOpen(false))

  const current = MOCK_WORKSPACES.find((w) => w.id === currentWorkspaceId) ?? MOCK_WORKSPACES[0]
  const others = MOCK_WORKSPACES.filter((w) => w.id !== currentWorkspaceId)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.06] transition-all group"
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
          style={{ backgroundColor: current.color }}
        >
          {current.name[0]}
        </div>
        <div className="text-left hidden sm:block">
          <div className="text-white text-xs font-medium leading-tight">{current.name}</div>
          <div className="text-slate-500 text-[10px]">{current.plan}</div>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-2 w-60 bg-[#0D1117] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="p-2">
            <div className="px-2 py-1.5 mb-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Your Workspaces
              </span>
            </div>

            {/* Current */}
            <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20 mb-1">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: current.color }}
              >
                {current.name[0]}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white text-xs font-medium truncate">{current.name}</div>
                <div className="text-slate-400 text-[10px]">{current.subdomain}.unifiedtree.com</div>
              </div>
              <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>

            {others.map((ws) => (
              <button
                key={ws.id}
                onClick={() => {
                  onSwitch?.(ws)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors mb-0.5"
              >
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: ws.color }}
                >
                  {ws.name[0]}
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-slate-200 text-xs font-medium truncate">{ws.name}</div>
                  <div className="text-slate-500 text-[10px]">{ws.subdomain}.unifiedtree.com</div>
                </div>
              </button>
            ))}
          </div>

          <div className="border-t border-white/10 p-2">
            <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/[0.04] text-slate-400 hover:text-white text-xs transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create New Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
