import React, { useState } from 'react'
import { TrendingUp, Plus, List, LayoutGrid, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'
import type { Lead } from '@/types'

const MOCK_LEADS: Lead[] = [
  { id: 'l1', name: 'Kavya Reddy', email: 'kavya@techstart.com', phone: '+91 9876543210', company: 'TechStart Inc', source: 'Website', status: 'NEW', estimatedValue: 45000, createdAt: '2025-01-10', assignedTo: 'Mike Davis' },
  { id: 'l2', name: 'Arjun Singh', email: 'arjun@globalcorp.com', phone: '+91 9876543211', company: 'GlobalCorp', source: 'LinkedIn', status: 'CONTACTED', estimatedValue: 120000, createdAt: '2025-01-08', assignedTo: 'Tom Baker' },
  { id: 'l3', name: 'Maria Santos', email: 'maria@innovate.io', phone: '+91 9876543212', company: 'Innovate.io', source: 'Referral', status: 'QUALIFIED', estimatedValue: 85000, createdAt: '2025-01-05', assignedTo: 'Mike Davis' },
  { id: 'l4', name: 'James Lee', email: 'james@nextsolutions.com', company: 'Next Solutions', source: 'Email Campaign', status: 'PROPOSAL', estimatedValue: 200000, createdAt: '2024-12-28', assignedTo: 'Tom Baker' },
  { id: 'l5', name: 'Priyanka Nair', email: 'priyanka@futuretech.in', company: 'FutureTech India', source: 'Trade Show', status: 'CONVERTED', estimatedValue: 350000, createdAt: '2024-12-20', assignedTo: 'Mike Davis' },
  { id: 'l6', name: 'David Chen', email: 'david@bluewave.com', company: 'BlueWave Corp', source: 'Cold Call', status: 'LOST', estimatedValue: 60000, createdAt: '2024-12-15', assignedTo: 'Tom Baker' },
  { id: 'l7', name: 'Ananya Patel', email: 'ananya@startupx.com', company: 'StartupX', source: 'Website', status: 'NEW', estimatedValue: 25000, createdAt: '2025-01-12', assignedTo: 'Mike Davis' },
  { id: 'l8', name: 'Robert Kim', email: 'robert@enterprise.co', company: 'Enterprise Co', source: 'LinkedIn', status: 'CONTACTED', estimatedValue: 180000, createdAt: '2025-01-09', assignedTo: 'Tom Baker' },
  { id: 'l9', name: 'Fatima Al-Hassan', email: 'fatima@megatech.ae', company: 'MegaTech ME', source: 'Referral', status: 'QUALIFIED', estimatedValue: 420000, createdAt: '2025-01-07', assignedTo: 'Mike Davis' },
  { id: 'l10', name: 'Lucas Oliveira', email: 'lucas@softbr.com', company: 'SoftBR', source: 'Website', status: 'PROPOSAL', estimatedValue: 95000, createdAt: '2025-01-06', assignedTo: 'Tom Baker' },
  { id: 'l11', name: 'Yuki Tanaka', email: 'yuki@jptech.co.jp', company: 'JP Tech', source: 'Trade Show', status: 'NEW', estimatedValue: 280000, createdAt: '2025-01-13', assignedTo: 'Mike Davis' },
  { id: 'l12', name: 'Amara Diallo', email: 'amara@africatech.org', company: 'AfricaTech', source: 'Email Campaign', status: 'CONTACTED', estimatedValue: 55000, createdAt: '2025-01-11', assignedTo: 'Tom Baker' },
  { id: 'l13', name: 'Isabella Rossi', email: 'isabella@itconsult.eu', company: 'IT Consult EU', source: 'Referral', status: 'NEW', estimatedValue: 160000, createdAt: '2025-01-14', assignedTo: 'Mike Davis' },
  { id: 'l14', name: 'Ahmed Khalil', email: 'ahmed@dubaibiz.ae', company: 'Dubai Biz', source: 'LinkedIn', status: 'QUALIFIED', estimatedValue: 380000, createdAt: '2025-01-03', assignedTo: 'Tom Baker' },
  { id: 'l15', name: 'Sofia Herrera', email: 'sofia@latinsoft.co', company: 'LatinSoft', source: 'Cold Call', status: 'CONTACTED', estimatedValue: 70000, createdAt: '2025-01-15', assignedTo: 'Mike Davis' },
]

const statusConfig: Record<Lead['status'], { label: string; color: string; bg: string; kanbanColor: string }> = {
  NEW: { label: 'New', color: 'text-blue-400', bg: 'bg-blue-500/10', kanbanColor: 'border-blue-500/40 bg-blue-500/5' },
  CONTACTED: { label: 'Contacted', color: 'text-[#0F6E56]', bg: 'bg-[#0F6E56]/10', kanbanColor: 'border-indigo-500/40 bg-indigo-500/5' },
  QUALIFIED: { label: 'Qualified', color: 'text-amber-400', bg: 'bg-amber-500/10', kanbanColor: 'border-amber-500/40 bg-amber-500/5' },
  PROPOSAL: { label: 'Proposal', color: 'text-purple-400', bg: 'bg-purple-500/10', kanbanColor: 'border-purple-500/40 bg-purple-500/5' },
  CONVERTED: { label: 'Converted', color: 'text-emerald-400', bg: 'bg-emerald-500/10', kanbanColor: 'border-emerald-500/40 bg-emerald-500/5' },
  LOST: { label: 'Lost', color: 'text-red-400', bg: 'bg-red-500/10', kanbanColor: 'border-red-500/40 bg-red-500/5' },
}

const KANBAN_STAGES: Lead['status'][] = ['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'CONVERTED']

export const Leads: React.FC = () => {
  const [view, setView] = useState<'table' | 'kanban'>('table')
  const [search, setSearch] = useState('')

  const filtered = MOCK_LEADS.filter((l) => {
    const q = search.toLowerCase()
    return !q || l.name.toLowerCase().includes(q) || (l.company ?? '').toLowerCase().includes(q) || l.email.toLowerCase().includes(q)
  })

  const newLeads = MOCK_LEADS.filter((l) => l.status === 'NEW').length
  const contacted = MOCK_LEADS.filter((l) => l.status === 'CONTACTED').length
  const qualified = MOCK_LEADS.filter((l) => l.status === 'QUALIFIED').length
  const converted = MOCK_LEADS.filter((l) => l.status === 'CONVERTED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Leads</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_LEADS.length} total leads in pipeline</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-white border border-[#E2E8F0]/40 rounded-xl p-0.5">
            <button onClick={() => setView('table')} className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5', view === 'table' ? 'bg-[#F1F5F9] text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]')}>
              <List size={13} /> Table
            </button>
            <button onClick={() => setView('kanban')} className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5', view === 'kanban' ? 'bg-[#F1F5F9] text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]')}>
              <LayoutGrid size={13} /> Kanban
            </button>
          </div>
          <button className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
            <Plus size={15} /> Add Lead
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="New Leads" value={newLeads} icon={TrendingUp} iconColor="text-blue-400" iconBg="bg-blue-500/10" change="+3 this week" changeType="positive" />
        <StatCard title="Contacted" value={contacted} icon={TrendingUp} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
        <StatCard title="Qualified" value={qualified} icon={TrendingUp} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
        <StatCard title="Converted" value={converted} icon={TrendingUp} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" change="+2 this month" changeType="positive" />
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search leads..." className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all" />
      </div>

      {view === 'table' ? (
        <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E8F0]">
                  {['Lead', 'Company', 'Source', 'Status', 'Est. Value', 'Assigned To', 'Created'].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => {
                  const sc = statusConfig[lead.status]
                  return (
                    <tr key={lead.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer">
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-[#0F172A] font-medium">{lead.name}</p>
                          <p className="text-[#64748B] text-xs">{lead.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#64748B]">{lead.company}</td>
                      <td className="px-4 py-3 text-[#64748B]">{lead.source}</td>
                      <td className="px-4 py-3">
                        <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                      </td>
                      <td className="px-4 py-3 text-[#0F172A] font-medium whitespace-nowrap">
                        {lead.estimatedValue ? `$${lead.estimatedValue.toLocaleString()}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-[#64748B]">{lead.assignedTo}</td>
                      <td className="px-4 py-3 text-[#64748B] text-xs">{new Date(lead.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {KANBAN_STAGES.map((stage) => {
            const stageLeads = MOCK_LEADS.filter((l) => l.status === stage)
            const sc = statusConfig[stage]
            const totalValue = stageLeads.reduce((s, l) => s + (l.estimatedValue ?? 0), 0)
            return (
              <div key={stage} className="flex flex-col gap-2">
                <div className="flex items-center justify-between mb-1">
                  <span className={clsx('text-xs font-semibold', sc.color)}>{sc.label}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-slate-600">{stageLeads.length}</span>
                    <span className="text-[10px] text-slate-600">${(totalValue / 1000).toFixed(0)}k</span>
                  </div>
                </div>
                {stageLeads.map((lead) => (
                  <div key={lead.id} className={clsx('border rounded-xl p-3 cursor-pointer transition-colors hover:border-opacity-60', sc.kanbanColor)}>
                    <p className="text-[#0F172A] text-xs font-medium mb-0.5">{lead.name}</p>
                    <p className="text-[#64748B] text-[11px]">{lead.company}</p>
                    {lead.estimatedValue && (
                      <p className={clsx('text-[11px] font-semibold mt-1.5', sc.color)}>${lead.estimatedValue.toLocaleString()}</p>
                    )}
                    <p className="text-slate-600 text-[10px] mt-1">{lead.assignedTo}</p>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
