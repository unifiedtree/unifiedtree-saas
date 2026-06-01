import React, { useState } from 'react'
import { Search, Plus, HelpCircle, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'
import type { Ticket } from '@/types'
import { formatDistanceToNow } from 'date-fns'

const MOCK_TICKETS: Ticket[] = [
  { id: 'tk1', ticketNumber: 'T-1042', subject: 'Cannot access payroll module after role change', requesterName: 'James Wilson', requesterEmail: 'james@acme.com', status: 'OPEN', priority: 'CRITICAL', category: 'Access Control', assignedTo: 'Priya Sharma', createdAt: new Date(Date.now() - 2 * 3600000).toISOString() },
  { id: 'tk2', ticketNumber: 'T-1041', subject: 'Invoice export to PDF not working', requesterName: 'Linda Torres', requesterEmail: 'linda@acme.com', status: 'IN_PROGRESS', priority: 'HIGH', category: 'Accounts', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 5 * 3600000).toISOString() },
  { id: 'tk3', ticketNumber: 'T-1040', subject: 'Attendance records showing incorrect data for Oct', requesterName: 'Aisha Khan', requesterEmail: 'aisha@acme.com', status: 'OPEN', priority: 'HIGH', category: 'HRMS', assignedTo: 'Priya Sharma', createdAt: new Date(Date.now() - 8 * 3600000).toISOString() },
  { id: 'tk4', ticketNumber: 'T-1039', subject: 'CRM lead import CSV fails for special characters', requesterName: 'Tom Baker', requesterEmail: 'tom@acme.com', status: 'IN_PROGRESS', priority: 'MEDIUM', category: 'CRM', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 18 * 3600000).toISOString() },
  { id: 'tk5', ticketNumber: 'T-1038', subject: 'Email notifications not sending for ticket updates', requesterName: 'Sophie Martin', requesterEmail: 'sophie@acme.com', status: 'RESOLVED', priority: 'LOW', category: 'Notifications', assignedTo: 'Priya Sharma', createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), resolvedAt: new Date(Date.now() - 1 * 86400000).toISOString() },
  { id: 'tk6', ticketNumber: 'T-1037', subject: 'Dashboard charts not loading on Firefox', requesterName: 'David Kim', requesterEmail: 'david@acme.com', status: 'RESOLVED', priority: 'MEDIUM', category: 'UI/UX', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), resolvedAt: new Date(Date.now() - 2 * 86400000).toISOString() },
  { id: 'tk7', ticketNumber: 'T-1036', subject: 'Payroll slip download button not working', requesterName: 'Raj Mehta', requesterEmail: 'raj@acme.com', status: 'OPEN', priority: 'HIGH', category: 'Payroll', assignedTo: 'Priya Sharma', createdAt: new Date(Date.now() - 4 * 86400000).toISOString() },
  { id: 'tk8', ticketNumber: 'T-1035', subject: 'Leave balance not updating after approval', requesterName: 'Nina Patel', requesterEmail: 'nina@acme.com', status: 'CLOSED', priority: 'MEDIUM', category: 'HRMS', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 5 * 86400000).toISOString(), resolvedAt: new Date(Date.now() - 4 * 86400000).toISOString() },
  { id: 'tk9', ticketNumber: 'T-1034', subject: 'User cannot reset password via email link', requesterName: 'Omar Hassan', requesterEmail: 'omar@acme.com', status: 'OPEN', priority: 'CRITICAL', category: 'Auth', assignedTo: 'Priya Sharma', createdAt: new Date(Date.now() - 6 * 3600000).toISOString() },
  { id: 'tk10', ticketNumber: 'T-1033', subject: 'Bulk employee import shows duplicate error', requesterName: 'Sarah Chen', requesterEmail: 'sarah@acme.com', status: 'IN_PROGRESS', priority: 'HIGH', category: 'HRMS', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 12 * 3600000).toISOString() },
  { id: 'tk11', ticketNumber: 'T-1032', subject: 'Project task assignment dropdown slow to load', requesterName: 'Carlos Rivera', requesterEmail: 'carlos@acme.com', status: 'OPEN', priority: 'LOW', category: 'Projects', createdAt: new Date(Date.now() - 7 * 86400000).toISOString() },
  { id: 'tk12', ticketNumber: 'T-1031', subject: 'Analytics export not including custom date range', requesterName: 'Lily Zhang', requesterEmail: 'lily@acme.com', status: 'RESOLVED', priority: 'MEDIUM', category: 'Analytics', assignedTo: 'Zara Ali', createdAt: new Date(Date.now() - 8 * 86400000).toISOString(), resolvedAt: new Date(Date.now() - 6 * 86400000).toISOString() },
]

const statusConfig: Record<Ticket['status'], { label: string; color: string; bg: string }> = {
  OPEN: { label: 'Open', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  IN_PROGRESS: { label: 'In Progress', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  RESOLVED: { label: 'Resolved', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  CLOSED: { label: 'Closed', color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40' },
}

const priorityConfig: Record<Ticket['priority'], { color: string; bg: string }> = {
  LOW: { color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40' },
  MEDIUM: { color: 'text-amber-400', bg: 'bg-amber-500/10' },
  HIGH: { color: 'text-orange-400', bg: 'bg-orange-500/10' },
  CRITICAL: { color: 'text-red-400', bg: 'bg-red-500/10' },
}

export const Tickets: React.FC = () => {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [priorityFilter, setPriorityFilter] = useState('All')

  const open = MOCK_TICKETS.filter((t) => t.status === 'OPEN').length
  const inProgress = MOCK_TICKETS.filter((t) => t.status === 'IN_PROGRESS').length
  const resolved = MOCK_TICKETS.filter((t) => t.status === 'RESOLVED').length
  const critical = MOCK_TICKETS.filter((t) => t.priority === 'CRITICAL' && t.status !== 'CLOSED' && t.status !== 'RESOLVED').length

  const filtered = MOCK_TICKETS.filter((t) => {
    const q = search.toLowerCase()
    return (
      (!q || t.subject.toLowerCase().includes(q) || t.ticketNumber.toLowerCase().includes(q) || t.requesterName.toLowerCase().includes(q)) &&
      (statusFilter === 'All' || t.status === statusFilter) &&
      (priorityFilter === 'All' || t.priority === priorityFilter)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Support Tickets</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_TICKETS.length} total tickets</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} /> New Ticket
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Open" value={open} icon={HelpCircle} iconColor="text-blue-400" iconBg="bg-blue-500/10" />
        <StatCard title="In Progress" value={inProgress} icon={Clock} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
        <StatCard title="Resolved" value={resolved} icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Critical" value={critical} icon={AlertTriangle} iconColor="text-red-400" iconBg="bg-red-500/10" change={critical > 0 ? 'Needs immediate action' : 'All clear'} changeType={critical > 0 ? 'negative' : 'positive'} />
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#64748B]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tickets..." className="w-full bg-white border border-[#E2E8F0] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[#0F172A] placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-all" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500">
          <option value="All">All Status</option>
          {['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)} className="bg-white border border-[#E2E8F0] rounded-xl px-3 py-2.5 text-sm text-[#334155] focus:outline-none focus:border-indigo-500">
          <option value="All">All Priority</option>
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['Ticket #', 'Subject', 'Requester', 'Priority', 'Status', 'Category', 'Assigned To', 'Created'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((ticket) => {
                const sc = statusConfig[ticket.status]
                const pc = priorityConfig[ticket.priority]
                return (
                  <tr key={ticket.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors cursor-pointer">
                    <td className="px-4 py-3 text-[#0F6E56] font-mono font-medium">{ticket.ticketNumber}</td>
                    <td className="px-4 py-3">
                      <p className="text-[#0F172A] font-medium max-w-xs truncate">{ticket.subject}</p>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-[#334155] text-sm">{ticket.requesterName}</p>
                        <p className="text-slate-600 text-xs">{ticket.requesterEmail}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 text-xs font-semibold rounded-full', pc.bg, pc.color)}>{ticket.priority}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">{ticket.category}</td>
                    <td className="px-4 py-3 text-[#64748B]">{ticket.assignedTo ?? '—'}</td>
                    <td className="px-4 py-3 text-[#64748B] text-xs whitespace-nowrap">
                      {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
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
