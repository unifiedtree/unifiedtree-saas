import React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Clock, CreditCard, Calculator, Boxes, TrendingUp,
  ShoppingCart, Tag, FolderKanban, Factory, Store, BarChart3,
  type LucideIcon,
} from 'lucide-react'

/** Canonical 12 module keys = website pricing ids. The 10 below are the
 *  sellable-but-unbuilt modules that render this placeholder when active. */
const MODULE_META: Record<string, { label: string; icon: LucideIcon }> = {
  payroll:       { label: 'Payroll',       icon: CreditCard },
  accounting:    { label: 'Accounting',    icon: Calculator },
  inventory:     { label: 'Inventory',     icon: Boxes },
  crm:           { label: 'CRM',           icon: TrendingUp },
  purchase:      { label: 'Purchase',      icon: ShoppingCart },
  sales:         { label: 'Sales',         icon: Tag },
  projects:      { label: 'Projects',      icon: FolderKanban },
  manufacturing: { label: 'Manufacturing', icon: Factory },
  pos:           { label: 'POS',           icon: Store },
  reports:       { label: 'Reports',       icon: BarChart3 },
}

interface ComingSoonProps {
  /** Canonical module key, e.g. "payroll". */
  module: string
}

/**
 * Static placeholder for sellable modules that are part of the workspace plan
 * but have no backend yet. Shown only when ModuleGate confirms the module is
 * active for the workspace.
 */
export const ComingSoon: React.FC<ComingSoonProps> = ({ module }) => {
  const meta = MODULE_META[module] ?? { label: module, icon: Clock }
  const Icon = meta.icon

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--bg-subtle)] border border-[var(--border-default)]">
        <Icon size={32} className="text-[var(--text-tertiary)]" />
      </div>

      <h2 className="mb-2 text-2xl font-bold tracking-tight text-[var(--text-primary)]">
        {meta.label} is part of your plan
      </h2>

      <p className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent-fg)] uppercase tracking-wider">
        <Clock size={14} />
        Launching soon
      </p>

      <p className="mb-8 max-w-md leading-relaxed text-[var(--text-secondary)] text-[14.5px]">
        This module is launching soon. We are putting the finishing touches in
        place &mdash; you will be able to start using {meta.label} here once it
        goes live.
      </p>

      <Link
        to="/dashboard"
        className="btn-press inline-flex h-9.5 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 text-sm font-semibold text-[var(--text-primary)] shadow-xs hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] transition-all duration-150"
      >
        <ArrowLeft size={15} />
        Back to dashboard
      </Link>
    </div>
  )
}
