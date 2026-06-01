import React from 'react'
import { CreditCard, CheckCircle, Clock } from 'lucide-react'
import { clsx } from 'clsx'
import { StatCard } from '@/shared/components/StatCard'

interface Payment {
  id: string
  reference: string
  customerName: string
  invoiceRef: string
  amount: number
  method: string
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED'
  date: string
}

const MOCK_PAYMENTS: Payment[] = [
  { id: 'pay1', reference: 'PAY-2025-001', customerName: 'TechStart Inc', invoiceRef: 'INV-2025-001', amount: 48500, method: 'Bank Transfer', status: 'COMPLETED', date: '2025-01-10' },
  { id: 'pay2', reference: 'PAY-2025-002', customerName: 'MegaTech ME', invoiceRef: 'INV-2025-006', amount: 75000, method: 'Wire Transfer', status: 'COMPLETED', date: '2025-01-15' },
  { id: 'pay3', reference: 'PAY-2025-003', customerName: 'SoftBR', invoiceRef: 'INV-2025-009', amount: 28000, method: 'Credit Card', status: 'COMPLETED', date: '2025-01-17' },
  { id: 'pay4', reference: 'PAY-2025-004', customerName: 'TechStart Inc', invoiceRef: 'INV-2025-013', amount: 22000, method: 'Bank Transfer', status: 'COMPLETED', date: '2025-01-20' },
  { id: 'pay5', reference: 'PAY-2025-005', customerName: 'GlobalCorp', invoiceRef: 'INV-2025-002', amount: 125000, method: 'Wire Transfer', status: 'PENDING', date: '2025-01-22' },
  { id: 'pay6', reference: 'PAY-2025-006', customerName: 'Dubai Biz', invoiceRef: 'INV-2025-005', amount: 210000, method: 'Bank Transfer', status: 'PENDING', date: '2025-01-21' },
  { id: 'pay7', reference: 'PAY-2025-007', customerName: 'JP Tech', invoiceRef: 'INV-2025-008', amount: 96000, method: 'Wire Transfer', status: 'PENDING', date: '2025-01-23' },
  { id: 'pay8', reference: 'PAY-2024-089', customerName: 'BlueWave Corp', invoiceRef: 'INV-2024-089', amount: 32000, method: 'Credit Card', status: 'FAILED', date: '2025-01-05' },
  { id: 'pay9', reference: 'PAY-2024-090', customerName: 'AfricaTech', invoiceRef: 'INV-2025-011', amount: 42000, method: 'Bank Transfer', status: 'REFUNDED', date: '2025-01-09' },
]

const statusConfig = {
  COMPLETED: { label: 'Completed', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  PENDING: { label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  FAILED: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-500/10' },
  REFUNDED: { label: 'Refunded', color: 'text-purple-400', bg: 'bg-purple-500/10' },
}

export const Payments: React.FC = () => {
  const totalReceived = MOCK_PAYMENTS.filter((p) => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0)
  const totalPending = MOCK_PAYMENTS.filter((p) => p.status === 'PENDING').reduce((s, p) => s + p.amount, 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl font-bold text-[#0F172A]">Payments</h1>
        <p className="text-[#64748B] text-sm mt-0.5">Track all incoming payments and transactions</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Received" value={`$${(totalReceived / 1000).toFixed(0)}k`} icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Pending Payments" value={`$${(totalPending / 1000).toFixed(0)}k`} icon={Clock} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
        <StatCard title="Transactions" value={MOCK_PAYMENTS.length} icon={CreditCard} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E2E8F0]">
                {['Reference', 'Customer', 'Invoice', 'Amount', 'Method', 'Status', 'Date'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_PAYMENTS.map((pay) => {
                const sc = statusConfig[pay.status]
                return (
                  <tr key={pay.id} className="border-b border-[#E2E8F0]/40 last:border-0 hover:bg-[#F8FAFC] transition-colors">
                    <td className="px-4 py-3 text-[#0F6E56] font-mono text-xs">{pay.reference}</td>
                    <td className="px-4 py-3 text-[#0F172A]">{pay.customerName}</td>
                    <td className="px-4 py-3 text-[#64748B] font-mono text-xs">{pay.invoiceRef}</td>
                    <td className="px-4 py-3 text-[#0F172A] font-semibold">${pay.amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-[#64748B]">{pay.method}</td>
                    <td className="px-4 py-3">
                      <span className={clsx('px-2 py-0.5 text-xs font-medium rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                    </td>
                    <td className="px-4 py-3 text-[#64748B] text-xs">{new Date(pay.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
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

