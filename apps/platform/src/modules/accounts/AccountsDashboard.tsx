import React from 'react'
import { DollarSign, FileText, CreditCard, Receipt } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

export const AccountsDashboard: React.FC = () => (
  <div className="space-y-6">
    <h1 className="text-xl font-bold text-[#0F172A]">Accounts Overview</h1>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard title="Revenue (Dec)" value="$548K" icon={DollarSign} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" change="+7.1%" changeType="positive" />
      <StatCard title="Invoices Due" value="$421K" icon={FileText} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
      <StatCard title="Payments In" value="$173.5K" icon={CreditCard} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
      <StatCard title="Expenses" value="$157.8K" icon={Receipt} iconColor="text-purple-400" iconBg="bg-purple-500/10" />
    </div>
  </div>
)
