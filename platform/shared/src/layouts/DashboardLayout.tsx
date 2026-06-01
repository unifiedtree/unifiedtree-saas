import React, { useState, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import { useUIStore } from '../store/uiStore'
import { useKeyPress } from '../hooks/useKeyPress'

interface DashboardLayoutProps {
  sidebar: React.ReactNode
  header: React.ReactNode
  children?: React.ReactNode
}

export function DashboardLayout({ sidebar, header, children }: DashboardLayoutProps) {
  const { sidebarCollapsed, toggleSidebar, cmdPaletteOpen, openCmdPalette, closeCmdPalette } =
    useUIStore()
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggleMobile = useCallback(() => setMobileOpen((v) => !v), [])
  const closeMobile = useCallback(() => setMobileOpen(false), [])

  // Ctrl+K or Cmd+K opens command palette
  useKeyPress('k', openCmdPalette, { ctrlKey: true })
  useKeyPress('k', openCmdPalette, { metaKey: true })
  useKeyPress('Escape', closeCmdPalette)

  return (
    <div className="flex h-screen bg-[#070B14] overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-30 flex flex-col transition-transform duration-300 ease-in-out
          lg:relative lg:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
          ${sidebarCollapsed ? 'w-[68px]' : 'w-64'}
        `}
      >
        {sidebar}
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0">
          {React.cloneElement(header as React.ReactElement<{ onMobileMenuToggle?: () => void }>, {
            onMobileMenuToggle: toggleMobile,
          })}
        </div>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">
            {children ?? <Outlet />}
          </div>
        </main>
      </div>

      {/* Command Palette placeholder (rendered by parent app) */}
      {cmdPaletteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-black/70 backdrop-blur-sm"
          onClick={closeCmdPalette}
        >
          <div
            className="w-full max-w-xl bg-[#0D1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                autoFocus
                type="text"
                placeholder="Search pages, modules, employees..."
                className="flex-1 bg-transparent text-white placeholder-slate-500 outline-none text-sm"
              />
              <kbd className="px-1.5 py-0.5 text-xs bg-white/10 text-slate-400 rounded">ESC</kbd>
            </div>
            <div className="p-3 text-center text-slate-500 text-sm py-8">
              Start typing to search across your workspace
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
