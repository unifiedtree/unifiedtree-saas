import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, Sparkles } from 'lucide-react'
import { useModulePlans, type ModulePlan } from '@/core/api/modulePlans'

const MODULE_LABELS: Record<string, string> = {
  hrms: 'HRMS', crm: 'CRM', accounts: 'Accounts', payroll: 'Payroll',
  inventory: 'Inventory', procurement: 'Procurement', projects: 'Projects',
  helpdesk: 'Helpdesk', analytics: 'Analytics',
}

// Price line comes from the sellable-plan catalog (GET /v1/public/module-plans),
// the same source /plan bills from: ₹ per user per month for PER_SEAT plans.
// The plan that unlocks a module lists its key in includedModules.
function priceLine(plan: ModulePlan | undefined): string | null {
  if (!plan) return null
  if (plan.status === 'LAUNCHING_SOON') return 'Launching soon — not yet available to purchase'
  if (plan.status !== 'AVAILABLE' || !(plan.priceInr > 0)) return null
  const price = '₹' + Number(plan.priceInr).toLocaleString('en-IN')
  return plan.priceModel === 'PER_SEAT'
    ? `${plan.displayName} · ${price} per user / month`
    : `${plan.displayName} · ${price} / month`
}

interface Props { moduleKey: string }

export const ModuleNotActivated: React.FC<Props> = ({ moduleKey }) => {
  const navigate = useNavigate()
  const { data: plans } = useModulePlans()
  const plan = plans?.find((p) => p.includedModules?.includes(moduleKey) || p.key === moduleKey)
  const label = MODULE_LABELS[moduleKey] ?? plan?.displayName ?? moduleKey
  // Nothing is shown while loading or when no plan covers the module — no
  // placeholder price.
  const price = priceLine(plan)

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      <div className="w-20 h-20 bg-emerald-50 border border-emerald-200/80 dark:bg-emerald-950/60 dark:border-emerald-800/40 rounded-3xl flex items-center justify-center mb-6">
        <Lock size={32} className="text-emerald-700 dark:text-emerald-300" />
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] mb-2">{label} Not Activated</h2>
      <p className="text-[var(--text-secondary)] max-w-md mb-1 leading-relaxed text-sm">
        The {label} module is not included in your current plan. Activate it to unlock all features.
      </p>
      {price ? (
        <p className="text-[var(--text-primary)] font-semibold mb-8 text-[15px]">{price}</p>
      ) : (
        <div className="mb-8" />
      )}
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
