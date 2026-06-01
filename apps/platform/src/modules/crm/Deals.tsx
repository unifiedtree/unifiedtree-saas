import React from 'react'
import { Briefcase, DollarSign, TrendingUp } from 'lucide-react'
import { clsx } from 'clsx'
import type { Deal } from '@/types'

const MOCK_DEALS: Deal[] = [
  { id: 'd1', title: 'Enterprise License — TechStart', customerName: 'TechStart Inc', value: 350000, stage: 'CLOSED_WON', probability: 100, expectedCloseDate: '2025-01-10', assignedTo: 'Mike Davis' },
  { id: 'd2', title: 'Cloud Migration Project', customerName: 'GlobalCorp', value: 280000, stage: 'NEGOTIATION', probability: 75, expectedCloseDate: '2025-01-25', assignedTo: 'Tom Baker' },
  { id: 'd3', title: 'SaaS Subscription — Annual', customerName: 'Innovate.io', value: 96000, stage: 'PROPOSAL', probability: 60, expectedCloseDate: '2025-02-01', assignedTo: 'Mike Davis' },
  { id: 'd4', title: 'Hardware Procurement', customerName: 'Next Solutions', value: 145000, stage: 'QUALIFICATION', probability: 40, expectedCloseDate: '2025-02-15', assignedTo: 'Tom Baker' },
  { id: 'd5', title: 'Custom Integration Deal', customerName: 'FutureTech India', value: 180000, stage: 'PROSPECTING', probability: 20, expectedCloseDate: '2025-03-01', assignedTo: 'Mike Davis' },
  { id: 'd6', title: 'Analytics Platform License', customerName: 'Dubai Biz', value: 420000, stage: 'NEGOTIATION', probability: 80, expectedCloseDate: '2025-01-30', assignedTo: 'Tom Baker' },
  { id: 'd7', title: 'Support Contract Renewal', customerName: 'MegaTech ME', value: 75000, stage: 'CLOSED_WON', probability: 100, expectedCloseDate: '2025-01-05', assignedTo: 'Mike Davis' },
  { id: 'd8', title: 'Training Services Package', customerName: 'AfricaTech', value: 48000, stage: 'PROPOSAL', probability: 55, expectedCloseDate: '2025-02-10', assignedTo: 'Tom Baker' },
  { id: 'd9', title: 'Mobile App Development', customerName: 'JP Tech', value: 320000, stage: 'QUALIFICATION', probability: 35, expectedCloseDate: '2025-03-15', assignedTo: 'Mike Davis' },
  { id: 'd10', title: 'Data Security Audit', customerName: 'LatinSoft', value: 60000, stage: 'CLOSED_LOST', probability: 0, expectedCloseDate: '2025-01-20', assignedTo: 'Tom Baker' },
  { id: 'd11', title: 'ERP Implementation — Full', customerName: 'IT Consult EU', value: 890000, stage: 'PROSPECTING', probability: 15, expectedCloseDate: '2025-04-01', assignedTo: 'Mike Davis' },
  { id: 'd12', title: 'Website Redesign + CMS', customerName: 'BlueWave Corp', value: 42000, stage: 'NEGOTIATION', probability: 70, expectedCloseDate: '2025-01-28', assignedTo: 'Tom Baker' },
]

const stageConfig: Record<Deal['stage'], { label: string; color: string; bg: string; border: string }> = {
  PROSPECTING: { label: 'Prospecting', color: 'text-[#64748B]', bg: 'bg-white', border: 'border-[#E2E8F0]' },
  QUALIFICATION: { label: 'Qualification', color: 'text-blue-400', bg: 'bg-blue-500/8', border: 'border-blue-500/30' },
  PROPOSAL: { label: 'Proposal', color: 'text-purple-400', bg: 'bg-purple-500/8', border: 'border-purple-500/30' },
  NEGOTIATION: { label: 'Negotiation', color: 'text-amber-400', bg: 'bg-amber-500/8', border: 'border-amber-500/30' },
  CLOSED_WON: { label: 'Closed Won', color: 'text-emerald-400', bg: 'bg-emerald-500/8', border: 'border-emerald-500/30' },
  CLOSED_LOST: { label: 'Closed Lost', color: 'text-red-400', bg: 'bg-red-500/8', border: 'border-red-500/30' },
}

const STAGES_ORDER: Deal['stage'][] = ['PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'CLOSED_WON', 'CLOSED_LOST']

export const Deals: React.FC = () => {
  const totalPipeline = MOCK_DEALS.filter((d) => d.stage !== 'CLOSED_LOST').reduce((s, d) => s + d.value, 0)
  const wonDeals = MOCK_DEALS.filter((d) => d.stage === 'CLOSED_WON')
  const wonValue = wonDeals.reduce((s, d) => s + d.value, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Deals Pipeline</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_DEALS.length} active deals</p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-[#0F6E56]/10 rounded-xl flex items-center justify-center">
              <DollarSign size={18} className="text-[#0F6E56]" />
            </div>
            <span className="text-xs text-[#64748B] uppercase tracking-wider">Total Pipeline</span>
          </div>
          <p className="text-2xl font-bold text-[#0F172A]">${(totalPipeline / 1000000).toFixed(2)}M</p>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-emerald-500/10 rounded-xl flex items-center justify-center">
              <TrendingUp size={18} className="text-emerald-400" />
            </div>
            <span className="text-xs text-[#64748B] uppercase tracking-wider">Won This Month</span>
          </div>
          <p className="text-2xl font-bold text-[#0F172A]">${(wonValue / 1000).toFixed(0)}k</p>
          <p className="text-xs text-[#64748B] mt-0.5">{wonDeals.length} deals closed</p>
        </div>
        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 bg-amber-500/10 rounded-xl flex items-center justify-center">
              <Briefcase size={18} className="text-amber-400" />
            </div>
            <span className="text-xs text-[#64748B] uppercase tracking-wider">Win Rate</span>
          </div>
          <p className="text-2xl font-bold text-[#0F172A]">{Math.round((wonDeals.length / MOCK_DEALS.length) * 100)}%</p>
        </div>
      </div>

      {/* Pipeline Funnel */}
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-5">
        <h3 className="text-[#0F172A] font-semibold text-sm mb-4">Pipeline by Stage</h3>
        <div className="space-y-2">
          {STAGES_ORDER.map((stage) => {
            const stageDeals = MOCK_DEALS.filter((d) => d.stage === stage)
            const stageValue = stageDeals.reduce((s, d) => s + d.value, 0)
            const sc = stageConfig[stage]
            const maxValue = Math.max(...STAGES_ORDER.map((s) => MOCK_DEALS.filter((d) => d.stage === s).reduce((sum, d) => sum + d.value, 0)))
            const pct = maxValue > 0 ? (stageValue / maxValue) * 100 : 0

            return (
              <div key={stage} className="flex items-center gap-4">
                <div className="w-28 flex-shrink-0">
                  <span className={clsx('text-xs font-medium', sc.color)}>{sc.label}</span>
                </div>
                <div className="flex-1">
                  <div className="h-6 bg-white rounded-lg overflow-hidden">
                    <div
                      className={clsx('h-full rounded-lg flex items-center px-2 transition-all', sc.bg)}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    >
                      {stageDeals.length > 0 && (
                        <span className={clsx('text-[10px] font-semibold whitespace-nowrap', sc.color)}>
                          {stageDeals.length} deals
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="w-24 text-right flex-shrink-0">
                  <span className="text-sm font-semibold text-[#0F172A]">${(stageValue / 1000).toFixed(0)}k</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Deal Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {MOCK_DEALS.filter((d) => d.stage !== 'CLOSED_LOST').map((deal) => {
          const sc = stageConfig[deal.stage]
          return (
            <div key={deal.id} className={clsx('border rounded-2xl p-4 cursor-pointer transition-colors hover:border-opacity-60', sc.border, sc.bg)}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[#0F172A] font-semibold text-sm truncate">{deal.title}</p>
                  <p className="text-[#64748B] text-xs mt-0.5">{deal.customerName}</p>
                </div>
                <span className={clsx('ml-2 px-2 py-0.5 text-[10px] font-semibold rounded-full flex-shrink-0', sc.bg, sc.color)}>
                  {sc.label}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xl font-bold text-[#0F172A]">${(deal.value / 1000).toFixed(0)}k</p>
                  <p className="text-xs text-[#64748B]">{deal.probability}% probability</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-[#64748B]">Close date</p>
                  <p className="text-xs text-[#334155]">{new Date(deal.expectedCloseDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</p>
                </div>
              </div>
              {/* Probability bar */}
              <div className="mt-3">
                <div className="h-1 bg-white rounded-full overflow-hidden">
                  <div className={clsx('h-full rounded-full', deal.stage === 'CLOSED_WON' ? 'bg-emerald-500' : 'bg-indigo-500')} style={{ width: `${deal.probability}%` }} />
                </div>
              </div>
              <p className="text-[10px] text-slate-600 mt-2">{deal.assignedTo}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
