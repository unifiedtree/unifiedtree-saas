import React, { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { CommandPalette } from '@/shared/components/CommandPalette'
import { NotificationPanel } from '@/shared/components/NotificationPanel'
import { useAuthStore } from '@/core/auth/authStore'

export const DashboardLayout: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setCmdOpen(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  if (!isAuthenticated) return <Navigate to="/login" replace />

  return (
    <div className="relative min-h-screen overflow-hidden bg-soft-gradient">
      {/* Ambient orbs (very subtle) */}
      <div className="orb h-[500px] w-[500px] -top-40 -right-40 bg-peach-200/30 animate-orb-drift" />
      <div className="orb h-[520px] w-[520px] -bottom-40 -left-40 bg-brand-200/30 animate-orb-drift [animation-delay:-7s]" />

      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <Header
        sidebarCollapsed={sidebarCollapsed}
        onOpenCommandPalette={() => setCmdOpen(true)}
        onOpenNotifications={() => setNotifOpen(true)}
      />
      <main
        className={`relative min-h-screen pt-16 transition-all duration-300 ${sidebarCollapsed ? 'pl-16' : 'pl-64'}`}
      >
        <div className="max-w-[1600px] p-6">
          <Outlet />
        </div>
      </main>
      <CommandPalette isOpen={cmdOpen} onClose={() => setCmdOpen(false)} />
      <NotificationPanel isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
    </div>
  )
}
