import React, { useState } from 'react'
import { Search, Plus, DollarSign, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'
import type { Invoice } from '@/types'

const MOCK_INVOICES: Invoice[] = [
  { id: 'i1', invoiceNumber: 'INV-2025-001', customerName: 'TechStart Inc', amount: 48500, status: 'PAID', issueDate: '2025-01-01', dueDate: '2025-01-31', paidDate: '2025-01-10' },
  { id: 'i2', invoiceNumber: 'INV-2025-002', customerName: 'GlobalCorp', amount: 125000, status: 'SENT', issueDate: '2025-01-05', dueDate: '2025-02-04' },
  { id: 'i3', invoiceNumber: 'INV-2025-003', customerName: 'Innovate.io', amount: 32000, status: 'OVERDUE', issueDate: '2024-12-20', dueDate: '2025-01-19' },
  { id: 'i4', invoiceNumber: 'INV-2025-004', customerName: 'FutureTech India', amount: 87500, status: 'DRAFT', issueDate: '2025-01-12', dueDate: '2025-02-11' },
  { id: 'i5', invoiceNumber: 'INV-2025-005', customerName: 'Dubai Biz', amount: 210000, status: 'SENT', issueDate: '2025-01-08', dueDate: '2025-02-07' },
  { id: 'i6', invoiceNumber: 'INV-2025-006', customerName: 'MegaTech ME', amount: 75000, status: 'PAID', issueDate: '2025-01-02', dueDate: '2025-01-17', paidDate: '2025-01-15' },
  { id: 'i7', invoiceNumber: 'INV-2025-007', customerName: 'IT Consult EU', amount: 54000, status: 'OVERDUE', issueDate: '2024-12-15', dueDate: '2025-01-14' },
  { id: 'i8', invoiceNumber: 'INV-2025-008', customerName: 'JP Tech', amount: 96000, status: 'SENT', issueDate: '2025-01-10', dueDate: '2025-02-09' },
  { id: 'i9', invoiceNumber: 'INV-2025-009', customerName: 'SoftBR', amount: 28000, status: 'PAID', issueDate: '2025-01-03', dueDate: '2025-01-18', paidDate: '2025-01-17' },
  { id: 'i10', invoiceNumber: 'INV-2025-010', customerName: 'AfricaTech', amount: 42000, status: 'DRAFT', issueDate: '2025-01-14', dueDate: '2025-02-13' },
  { id: 'i11', invoiceNumber: 'INV-2025-011', customerName: 'LatinSoft', amount: 19500, status: 'CANCELLED', issueDate: '2025-01-06', dueDate: '2025-02-05' },
  { id: 'i12', invoiceNumber: 'INV-2025-012', customerName: 'BlueWave Corp', amount: 63000, status: 'SENT', issueDate: '2025-01-11', dueDate: '2025-02-10' },
  { id: 'i13', invoiceNumber: 'INV-2025-013', customerName: 'TechStart Inc', amount: 22000, status: 'PAID', issueDate: '2025-01-07', dueDate: '2025-01-22', paidDate: '2025-01-20' },
  { id: 'i14', invoiceNumber: 'INV-2025-014', customerName: 'Next Solutions', amount: 145000, status: 'OVERDUE', issueDate: '2024-12-10', dueDate: '2025-01-09' },
  { id: 'i15', invoiceNumber: 'INV-2025-015', customerName: 'StartupX', amount: 38000, status: 'DRAFT', issueDate: '2025-01-15', dueDate: '2025-02-14' },
]

const statusConfig: Record<Invoice['status'], { label: string; color: string; bg: string }> = {
  DRAFT: { label: 'Draft', color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40' },
  SENT: { label: 'Sent', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  PAID: { label: 'Paid', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  OVERDUE: { label: 'Overdue', color: 'text-red-400', bg: 'bg-red-500/10' },
  CANCELLED: { label: 'Cancelled', color: 'text-[#64748B]', bg: 'bg-white' },
}

export const Invoices: React.FC = () => {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')

  const totalDue = MOCK_INVOICES.filter((i) => i.status === 'SENT' || i.status === 'OVERDUE').reduce((s, i) => s + i.amount, 0)
  const totalPaid = MOCK_INVOICES.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amount, 0)
  const totalOverdue = MOCK_INVOICES.filter((i) => i.status === 'OVERDUE').reduce((s, i) => s + i.amount, 0)
  const draftCount = MOCK_INVOICES.filter((i) => i.status === 'DRAFT').length

  const filtered = MOCK_INVOICES.filter((i) => {
    const q = search.toLowerCase()
    return (
      (!q || i.invoiceNumber.toLowerCase().includes(q) || i.customerName.toLowerCase().includes(q)) &&
      (statusFilter === 'All' || i.status === statusFilter)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Invoices</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_INVOICES.length} total invoices</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} /> New Invoice
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Due" value={`$${(totalDue / 1000).toFixed(0)}k`} icon={Clock} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
        <StatCard title="Total Paid" value={`$${(totalPaid / 1000).toFixed(0)}k`} icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Overdue" value={`$${(totalOverdue / 1000).toFixed(0)}k`} icon={AlertTriangle} iconColor="text-red-400" iconBg="bg-red-500/10" change="Needs attention" changeType="negative" />
        <StatCard title="Draft" value={draftCount} icon={DollarSign} iconColor="text-[#64748B]" iconBg="bg-[#F1F5F9]/40" />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoices..." className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500">
          <option value="All">All Status</option>
          {['DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['Invoice #', 'Customer', 'Amount', 'Status', 'Issue Date', 'Due Date', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => {
                const sc = statusConfig[inv.status]
                return (
                  <tr key={inv.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3 text-[#0F6E56] font-mono font-medium">{inv.invoiceNumber}</td>
                    <td className="px-4 py-3 text-[#0F172A]">{inv.customerName}</td>
                    <td className="px-4 py-3 text-[#0F172A] font-semibold">${inv.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B] text-xs">{new Date(inv.issueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className={inv.status === 'OVERDUE' ? 'text-red-400 font-medium' : 'text-[#64748B]'}>
                        {new Date(inv.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 text-xs">
                        <button className="text-[#0F6E56] hover:text-[#0F6E56] transition-colors">View</button>
                        {inv.status === 'DRAFT' && <button className="text-emerald-400 hover:text-emerald-300 transition-colors">Send</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
