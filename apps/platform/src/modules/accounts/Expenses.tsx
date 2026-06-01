import React, { useState } from 'react'
import { Receipt, Clock, CheckCircle, XCircle, Check, X } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'

interface Expense {
  id: string
  employee: string
  dept: string
  category: string
  description: string
  amount: number
  currency: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REIMBURSED'
  submittedOn: string
  receiptUrl?: string
}

const MOCK_EXPENSES: Expense[] = [
  { id: 'ex1', employee: 'Mike Davis', dept: 'Sales', category: 'Travel', description: 'Flight to Bangalore for client meeting', amount: 12500, currency: 'INR', status: 'PENDING', submittedOn: '2025-01-15' },
  { id: 'ex2', employee: 'Sarah Chen', dept: 'HR', category: 'Training', description: 'HR Summit conference registration', amount: 8000, currency: 'INR', status: 'APPROVED', submittedOn: '2025-01-10' },
  { id: 'ex3', employee: 'Carlos Rivera', dept: 'Engineering', category: 'Software', description: 'Jira Premium annual license', amount: 24000, currency: 'INR', status: 'REIMBURSED', submittedOn: '2025-01-05' },
  { id: 'ex4', employee: 'Tom Baker', dept: 'Sales', category: 'Meals', description: 'Client lunch at Taj Hotel', amount: 4500, currency: 'INR', status: 'PENDING', submittedOn: '2025-01-14' },
  { id: 'ex5', employee: 'Priya Sharma', dept: 'Support', category: 'Office Supplies', description: 'Headset for remote support', amount: 3200, currency: 'INR', status: 'APPROVED', submittedOn: '2025-01-08' },
  { id: 'ex6', employee: 'Ravi Patel', dept: 'Finance', category: 'Travel', description: 'Cab expenses for audit visit', amount: 2800, currency: 'INR', status: 'REIMBURSED', submittedOn: '2025-01-03' },
  { id: 'ex7', employee: 'Emma Johnson', dept: 'Marketing', category: 'Advertising', description: 'Google Ads campaign top-up', amount: 15000, currency: 'INR', status: 'REJECTED', submittedOn: '2025-01-12' },
  { id: 'ex8', employee: 'David Kim', dept: 'Engineering', category: 'Software', description: 'AWS credits for dev environment', amount: 18000, currency: 'INR', status: 'PENDING', submittedOn: '2025-01-13' },
  { id: 'ex9', employee: 'Aisha Khan', dept: 'HR', category: 'Training', description: 'Online HR certification course', amount: 6500, currency: 'INR', status: 'APPROVED', submittedOn: '2025-01-09' },
  { id: 'ex10', employee: 'Liam Murphy', dept: 'Engineering', category: 'Equipment', description: 'External SSD for backup', amount: 5800, currency: 'INR', status: 'PENDING', submittedOn: '2025-01-16' },
  { id: 'ex11', employee: 'Nina Patel', dept: 'Marketing', category: 'Events', description: 'Booth setup for product expo', amount: 35000, currency: 'INR', status: 'APPROVED', submittedOn: '2025-01-07' },
  { id: 'ex12', employee: 'Omar Hassan', dept: 'Operations', category: 'Maintenance', description: 'Server room AC repair', amount: 22000, currency: 'INR', status: 'REIMBURSED', submittedOn: '2025-01-02' },
]

const statusConfig: Record<Expense['status'], { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING: { label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Clock },
  APPROVED: { label: 'Approved', color: 'text-blue-400', bg: 'bg-blue-500/10', icon: CheckCircle },
  REJECTED: { label: 'Rejected', color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  REIMBURSED: { label: 'Reimbursed', color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: CheckCircle },
}

export const Expenses: React.FC = () => {
  const [expenses, setExpenses] = useState(MOCK_EXPENSES)

  const pending = expenses.filter((e) => e.status === 'PENDING').length
  const approved = expenses.filter((e) => e.status === 'APPROVED').length
  const totalAmount = expenses.reduce((s, e) => s + e.amount, 0)
  const reimbursed = expenses.filter((e) => e.status === 'REIMBURSED').reduce((s, e) => s + e.amount, 0)

  const approve = (id: string) => setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, status: 'APPROVED' as const } : e))
  const reject = (id: string) => setExpenses((prev) => prev.map((e) => e.id === id ? { ...e, status: 'REJECTED' as const } : e))

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Expense Management</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Review and approve employee expense claims</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Total Expenses" value={`₹${(totalAmount / 1000).toFixed(1)}k`} icon={Receipt} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
        <StatCard title="Pending Review" value={pending} icon={Clock} iconColor="text-amber-400" iconBg="bg-amber-500/10" change="Needs action" changeType="negative" />
        <StatCard title="Approved" value={approved} icon={CheckCircle} iconColor="text-blue-400" iconBg="bg-blue-500/10" />
        <StatCard title="Reimbursed" value={`₹${(reimbursed / 1000).toFixed(1)}k`} icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E2E8F0]">
          <h3 className="text-[#0F172A] font-semibold text-sm">Expense Claims</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['Employee', 'Category', 'Description', 'Amount', 'Status', 'Submitted', 'Actions'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {expenses.map((exp) => {
                const sc = statusConfig[exp.status]
                const StatusIcon = sc.icon
                return (
                  <tr key={exp.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-[#0F172A] font-medium">{exp.employee}</p>
                        <p className="text-[#64748B] text-xs">{exp.dept}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 bg-white text-[#64748B] text-xs rounded-lg">{exp.category}</span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B] max-w-xs truncate">{exp.description}</td>
                    <td className="px-4 py-3 text-[#0F172A] font-semibold whitespace-nowrap">₹{exp.amount.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full w-fit', sc.bg, sc.color)}>
                        <StatusIcon size={10} />
                        {sc.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B] text-xs">{new Date(exp.submittedOn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                    <td className="px-4 py-3">
                      {exp.status === 'PENDING' && (
                        <div className="flex gap-1">
                          <button onClick={() => approve(exp.id)} className="p-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg transition-colors" title="Approve">
                            <Check size={13} />
                          </button>
                          <button onClick={() => reject(exp.id)} className="p-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors" title="Reject">
                            <X size={13} />
                          </button>
                        </div>
                      )}
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
