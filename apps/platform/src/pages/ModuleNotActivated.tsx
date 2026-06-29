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
      <div className="w-20 h-20 bg-[#FFF4E1] border border-[#FFD68A] rounded-3xl flex items-center justify-center mb-6">
        <Lock size={32} className="text-[#C16E00]" />
      </div>
      <h2 className="text-2xl font-bold text-text-primary mb-2">{label} Not Activated</h2>
      <p className="text-text-secondary max-w-md mb-1 leading-relaxed">
        The {label} module is not included in your current plan. Activate it to unlock all features.
      </p>
      <p className="text-[#C16E00] font-semibold mb-8">Starting at ${price}/month</p>
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/settings?tab=billing')}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-[#C16E00] to-[#FF9D00] hover:from-[#7A4400] hover:to-[#E08A00] text-white font-semibold rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/30"
        >
          <Sparkles size={16} />
          Activate {label}
          <ArrowRight size={16} />
        </button>
        <button
          onClick={() => navigate('/')}
          className="px-6 py-3 border border-border-default text-text-secondary hover:text-[#C16E00] hover:border-[#FFD68A] rounded-xl transition-colors font-medium text-sm"
        >
          Back to Dashboard
        </button>
      </div>
    </div>
  )
}
