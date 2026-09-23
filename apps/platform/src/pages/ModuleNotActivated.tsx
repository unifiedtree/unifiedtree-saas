import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, Sparkles } from 'lucide-react'

const MODULE_LABELS: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts', payroll: 'Payroll',
  inventory: 'Inventory', procurement: 'Procurement', projects: 'Projects',
  helpdesk: 'Helpdesk', analytics: 'Analytics',
}

const MODULE_PRICES: Record<string, number> = {
  hrms: 49, crm: 39, accounts: 59, payroll: 45, inventory: 35,
  procurement: 35, projects: 29, helpdesk: 29, analytics: 39,
}

interface Props { moduleKey: string }

export const ModuleNotActivated: React.FC<Props> = ({ moduleKey }) => {
  const navigate = useNavigate()
  const label = MODULE_LABELS[moduleKey] ?? moduleKey
  const price = MODULE_PRICES[moduleKey] ?? 29

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-20 h-20 bg-emerald-50 border border-emerald-200/80 dark:bg-emerald-950/60 dark:border-emerald-800/40 rounded-3xl flex items-center justify-center mb-6">
        <Lock size={32} className="text-emerald-700 dark:text-emerald-300" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] mb-2">{label} Not Activated</h2>
      <p className="text-[var(--text-secondary)] max-w-md mb-1 leading-relaxed text-sm">
        The {label} module is not included in your current plan. Activate it to unlock all features.
      </p>
      <p className="text-[var(--text-primary)] font-semibold mb-8 text-[15px]">Starting at ${price}/month</p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/plan')}
          className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--interactive-primary)] px-5 text-[14.5px] font-semibold text-white shadow-[0_4px_14px_0_rgba(15,110,86,0.35)] hover:bg-[var(--interactive-primary-hover)] hover:shadow-[0_6px_20px_0_rgba(15,110,86,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)] focus-visible:ring-offset-2 transition-all duration-150"
        >
          <Sparkles size={16} />
          Activate {label}
          <ArrowRight size={16} />
        </button>
        <button
          onClick={() => navigate('/')}
          className="btn-press inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-5 text-[14.5px] font-semibold text-[var(--text-primary)] shadow-xs hover:bg-[var(--bg-subtle)] hover:border-[var(--border-strong)] transition-all duration-150"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
