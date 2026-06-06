import React from 'react'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useAuthStore as useLocalAuthStore } from '@/core/auth/authStore'
import { clsx } from 'clsx'
import {
  Users, Clock, CreditCard, DollarSign, Package, TrendingUp,
  ShoppingCart, BarChart3, Briefcase, Factory, Store, FileBarChart2,
  Lock, ExternalLink, ArrowUpRight, Check, Sparkles,
} from 'lucide-react'

// ─── Canonical 12 modules (= website pricing ids) ──────────────────────────────
// BUILT = a real product surface exists in the platform today (hrms, attendance).
// Everything else is "coming-soon" once owned — the workspace can activate it, but
// the in-app screens are not built yet, so an active-but-unbuilt module renders a
// static "Coming soon" state rather than a live module.
const BUILT_MODULES = new Set(['hrms', 'attendance'])

interface ModuleDef {
  key: string
  label: string
  description: string
  icon: React.ReactNode
}

const MODULES: ModuleDef[] = [
  { key: 'hrms',          label: 'HRMS',          description: 'Employees, org structure, onboarding, letters & reports.', icon: <Users size={22} /> },
  { key: 'attendance',    label: 'Attendance',    description: 'Punch in/out, geofencing, shifts & timesheets.',          icon: <Clock size={22} /> },
  { key: 'payroll',       label: 'Payroll',       description: 'Salary structures, payruns & payslips.',                  icon: <CreditCard size={22} /> },
  { key: 'accounting',    label: 'Accounting',    description: 'Ledgers, invoices, payments & expenses.',                 icon: <DollarSign size={22} /> },
  { key: 'inventory',     label: 'Inventory',     description: 'Stock, warehouses & item movements.',                     icon: <Package size={22} /> },
  { key: 'crm',           label: 'CRM',           description: 'Leads, customers, deals & pipeline.',                     icon: <TrendingUp size={22} /> },
  { key: 'purchase',      label: 'Purchase',      description: 'Purchase orders, vendors & procurement.',                 icon: <ShoppingCart size={22} /> },
  { key: 'sales',         label: 'Sales',         description: 'Quotes, sales orders & fulfilment.',                      icon: <BarChart3 size={22} /> },
  { key: 'projects',      label: 'Projects',      description: 'Projects, tasks & team boards.',                          icon: <Briefcase size={22} /> },
  { key: 'manufacturing', label: 'Manufacturing', description: 'BOMs, work orders & production planning.',                icon: <Factory size={22} /> },
  { key: 'pos',           label: 'POS',           description: 'Point of sale, registers & receipts.',                    icon: <Store size={22} /> },
  { key: 'reports',       label: 'Reports',       description: 'Cross-module analytics & dashboards.',                    icon: <FileBarChart2 size={22} /> },
]

type Status = 'active' | 'coming-soon' | 'locked'

function statusOf(key: string, activeModules: string[]): Status {
  const owned = activeModules.includes(key)
  if (!owned) return 'locked'
  return BUILT_MODULES.has(key) ? 'active' : 'coming-soon'
}

const STATUS_META: Record<Status, { label: string; badge: string; chipIcon: React.ReactNode }> = {
  active:        { label: 'Active',      badge: 'bg-success-light text-success', chipIcon: <Check size={12} /> },
  'coming-soon': { label: 'Coming soon', badge: 'bg-primary-light text-primary', chipIcon: <Sparkles size={12} /> },
  locked:        { label: 'Locked',      badge: 'bg-bg text-text-tertiary',      chipIcon: <Lock size={12} /> },
}

export const Modules: React.FC = () => {
  // Active-module set + tenant identity come from the bridged auth store, exactly as
  // the sidebar gating uses them. (subdomain + adminEmail back the Edit-Workspace link.)
  const activeModules = useLocalAuthStore(s => s.tenant?.activeModules ?? [])
  const subdomain     = useLocalAuthStore(s => s.tenant?.subdomain ?? '')
  const adminEmail    = useSdkStore(s => s.user?.email ?? '')

  // Opens the main website's Edit-Workspace page in a new tab. Mirrors the gating
  // agent's pattern in PlatformShell — when `moduleKey` is provided we deep-link with
  // `&add=<key>` so the website pre-selects that module to add; without it we land on
  // the plain plan-management view.
  const openEditWorkspace = (moduleKey?: string) => {
    const websiteUrl = import.meta.env.VITE_WEBSITE_URL || 'https://unifiedtree.com'
    const url =
      websiteUrl + '/edit-workspace?ws=' + encodeURIComponent(subdomain) +
      '&email=' + encodeURIComponent(adminEmail) +
      (moduleKey ? '&add=' + encodeURIComponent(moduleKey) : '')
    window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="animate-fade-in p-4 sm:p-8">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-primary">Modules</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            Manage which modules are active in your workspace.
          </p>
        </div>
        <button
          onClick={() => openEditWorkspace()}
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Manage plan
          <ExternalLink size={15} />
        </button>
      </div>

      {/* Module grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map(mod => {
          const status = statusOf(mod.key, activeModules)
          const meta = STATUS_META[status]
          const locked = status === 'locked'

          return (
            <div
              key={mod.key}
              className={clsx(
                'flex flex-col rounded-2xl border bg-surface p-5 transition-all',
                locked ? 'border-default opacity-90' : 'border-default hover:shadow-card',
              )}
            >
              <div className="mb-4 flex items-start justify-between">
                <div
                  className={clsx(
                    'flex h-11 w-11 items-center justify-center rounded-xl',
                    status === 'active' && 'bg-success-light text-success',
                    status === 'coming-soon' && 'bg-primary-light text-primary',
                    locked && 'bg-bg text-text-tertiary',
                  )}
                >
                  {mod.icon}
                </div>
                <span
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold',
                    meta.badge,
                  )}
                >
                  {meta.chipIcon}
                  {meta.label}
                </span>
              </div>

              <h3 className={clsx('font-semibold', locked ? 'text-text-secondary' : 'text-text-primary')}>
                {mod.label}
              </h3>
              <p className="mt-1 flex-1 text-sm text-text-secondary">{mod.description}</p>

              {/* Locked → upsell to the website's Edit-Workspace (add this module). */}
              {locked && (
                <button
                  onClick={() => openEditWorkspace(mod.key)}
                  className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl border border-default px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:border-primary hover:text-primary"
                >
                  Manage plan / Add module
                  <ArrowUpRight size={15} />
                </button>
              )}

              {status === 'coming-soon' && (
                <p className="mt-4 rounded-xl bg-primary-light px-3 py-2 text-center text-xs font-medium text-primary">
                  Activated — in-app experience coming soon
                </p>
              )}

              {status === 'active' && (
                <p className="mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-success-light px-3 py-2 text-center text-xs font-semibold text-success">
                  <Check size={13} /> Active in your workspace
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
