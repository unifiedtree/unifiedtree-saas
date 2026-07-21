import React, { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'
import {
  ArrowRight, Lock, Plus, Search, Sparkles, Check, ExternalLink,
  LogOut, UserCircle2, Users, ShieldAlert, FileText, ChevronUp, CreditCard, Settings,
} from 'lucide-react'
import { APPS, ADMIN_APP, type AppDef } from '@/layouts/appConfig'

type Status = 'active' | 'coming-soon' | 'locked'

function statusOf(app: AppDef, active: string[]): Status {
  if (!active.includes(app.key)) return 'locked'
  return app.built ? 'active' : 'coming-soon'
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER']

export const Modules: React.FC = () => {
  const navigate = useNavigate()
  const activeModules = useLocalAuthStore(s => s.tenant?.activeModules ?? [])
  const subdomain     = useLocalAuthStore(s => s.tenant?.subdomain ?? '')
  const user          = useSdkStore(s => s.user)
  const permissions   = useSdkStore(s => s.permissions)
  const roles: string[] = user?.roles ?? []
  const isAdmin = roles.some(r => ADMIN_ROLES.includes(r)) || permissions.has('*')
  const isSuperAdmin = roles.includes('SUPER_ADMIN') || permissions.has('*')
  const logout = useSdkStore(s => s.logout)

  const [query, setQuery] = useState('')

  // Bottom-left settings launcher (slides up)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const onClick = (e: MouseEvent) => { if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('mousedown', onClick); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey) }
  }, [settingsOpen])

  const openEditWorkspace = (moduleKey?: string) => {
    const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'https://unifiedtree.com'
    const url =
      websiteUrl + '/edit-workspace?ws=' + encodeURIComponent(subdomain) +
      '&email=' + encodeURIComponent(user?.email ?? '') +
      (moduleKey ? '&add=' + encodeURIComponent(moduleKey) : '')
    window.open(url, '_blank', 'noopener')
  }

  // Owned apps first, then the rest; Settings (admin) surfaces for admins only.
  const apps = useMemo(() => {
    const list = [...APPS]
    if (isAdmin) list.push(ADMIN_APP as AppDef)
    const q = query.trim().toLowerCase()
    const filtered = q
      ? list.filter(a => a.label.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      : list
    return filtered.sort((a, b) => {
      const rank = (x: AppDef) => (x.key === 'admin' ? 2 : activeModules.includes(x.key) ? 0 : 1)
      return rank(a) - rank(b)
    })
  }, [isAdmin, query, activeModules])

  const greeting = (() => {
    const h = new Date().getHours()
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  })()
  const firstName = user?.firstName || (user?.email ? user.email.split('@')[0] : 'there')

  const enter = (app: AppDef, status: Status) => {
    if (app.key === 'admin') return navigate(app.home)
    if (status === 'locked') { if (isAdmin) openEditWorkspace(app.key); return }
    navigate(app.home)
  }

  return (
    <div className="min-h-full bg-[var(--bg-base)]">
      <div className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">
        {/* Header */}
        <div className="animate-fade-up mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--accent-fg)]">{greeting}, {firstName}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Choose an app</h1>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              Open a workspace app to get started. Locked apps can be added to your plan any time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search apps…"
                className="h-10 w-full rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] pl-9 pr-3 text-sm text-[var(--text-primary)] shadow-xs outline-none transition-[border-color,box-shadow] focus:border-[var(--border-focus)] focus:ring-4 focus:ring-[var(--accent-solid)]/12 sm:w-56"
              />
            </div>
            {isAdmin && (
              <button
                onClick={() => openEditWorkspace()}
                className="hidden h-10 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-[var(--bg-surface)] px-3.5 text-sm font-medium text-[var(--text-primary)] shadow-xs transition-colors hover:bg-[var(--bg-subtle)] sm:inline-flex"
              >
                Manage plan <ExternalLink size={14} />
              </button>
            )}
          </div>
        </div>

        {/* App grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {apps.map((app, i) => {
            const status = app.key === 'admin' ? 'active' : statusOf(app, activeModules)
            const locked = status === 'locked'
            const Icon = app.icon
            return (
              <button
                key={app.key}
                onClick={() => enter(app, status)}
                disabled={locked && !isAdmin}
                style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}
                className={clsx(
                  'group animate-fade-up relative flex flex-col items-start rounded-2xl border p-5 text-left transition-all duration-200',
                  locked
                    ? 'border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                    : 'border-[var(--border-default)] bg-[var(--bg-surface)] shadow-sm hover:-translate-y-1 hover:border-[var(--accent-border)] hover:shadow-lg',
                  locked && !isAdmin && 'cursor-default opacity-75',
                )}
              >
                {/* status chip */}
                <span className="absolute right-3 top-3">
                  {status === 'active' && (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--status-success-bg)] text-[var(--status-success-fg)]" title="Active">
                      <Check size={13} />
                    </span>
                  )}
                  {status === 'coming-soon' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-fg-strong)]" title="Coming soon">
                      <Sparkles size={11} /> Soon
                    </span>
                  )}
                  {locked && (
                    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-[var(--text-tertiary)]" title="Locked">
                      <Lock size={12} />
                    </span>
                  )}
                </span>

                {/* icon */}
                <span
                  className={clsx(
                    'flex h-12 w-12 items-center justify-center rounded-xl transition-colors',
                    locked
                      ? 'bg-[var(--bg-subtle)] text-[var(--text-tertiary)]'
                      : 'bg-[var(--accent-bg)] text-[var(--accent-fg)] group-hover:bg-[var(--accent-solid)] group-hover:text-white',
                  )}
                >
                  <Icon size={22} />
                </span>

                <h3 className={clsx('mt-4 text-[15px] font-semibold', locked ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
                  {app.label}
                </h3>
                <p className="mt-1 line-clamp-2 flex-1 text-xs leading-relaxed text-[var(--text-tertiary)]">
                  {app.description}
                </p>

                {/* footer affordance */}
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold">
                  {locked ? (
                    isAdmin ? (
                      <span className="inline-flex items-center gap-1 text-[var(--accent-fg-strong)]">
                        <Plus size={13} /> Add to plan
                      </span>
                    ) : (
                      <span className="text-[var(--text-tertiary)]">Not in your plan</span>
                    )
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[var(--accent-fg-strong)] opacity-0 transition-opacity group-hover:opacity-100">
                      Open <ArrowRight size={13} />
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Bottom-left Settings launcher (slides up) ───────────────────────── */}
      <div ref={settingsRef} className="fixed bottom-6 left-6 z-40">
        <AnimatePresence>
          {settingsOpen && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{ transformOrigin: 'bottom left' }}
              className="absolute bottom-full left-0 mb-3 w-64 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] shadow-xl"
            >
              <div className="border-b border-[var(--border-subtle)] px-3.5 py-3">
                <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{firstName}</p>
                <p className="truncate text-xs text-[var(--text-tertiary)]">{user?.email}</p>
              </div>
              <div className="p-1.5">
                {[
                  { label: 'My Profile',          icon: UserCircle2,  show: true,         onClick: () => navigate('/settings') },
                  { label: 'Workspace Settings',  icon: Settings,     show: isAdmin,      onClick: () => navigate('/settings') },
                  { label: 'Billing & Plan',      icon: CreditCard,   show: isAdmin,      onClick: () => navigate('/settings/billing') },
                  { label: 'Users & Access',      icon: Users,        show: isSuperAdmin, onClick: () => navigate('/users') },
                  { label: 'Roles & Permissions', icon: ShieldAlert,  show: isSuperAdmin, onClick: () => navigate('/roles') },
                  { label: 'Audit Logs',          icon: FileText,     show: isSuperAdmin, onClick: () => navigate('/audit-logs') },
                  { label: 'Manage Plan',         icon: ExternalLink, show: isAdmin,      onClick: () => openEditWorkspace() },
                ].filter(i => i.show).map(item => (
                  <button
                    key={item.label}
                    onClick={() => { item.onClick(); setSettingsOpen(false) }}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                  >
                    <item.icon size={16} className="text-[var(--text-tertiary)]" />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="border-t border-[var(--border-subtle)] p-1.5">
                <button
                  onClick={() => { setSettingsOpen(false); logout() }}
                  className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-[var(--status-error-fg)] transition-colors hover:bg-[var(--status-error-bg)]"
                >
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setSettingsOpen(v => !v)}
          className={clsx(
            'flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold shadow-lg transition-all duration-200',
            settingsOpen
              ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-fg-strong)]'
              : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--border-strong)] hover:shadow-xl',
          )}
        >
          <Settings size={17} className={clsx('transition-transform duration-300', settingsOpen && 'rotate-90')} />
          Settings
          <ChevronUp size={15} className={clsx('text-[var(--text-tertiary)] transition-transform duration-200', settingsOpen && 'rotate-180')} />
        </button>
      </div>
    </div>
  )
}
