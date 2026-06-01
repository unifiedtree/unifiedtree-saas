import React from 'react'
import { TrendingUp, Users, DollarSign, Briefcase } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

export const CrmDashboard: React.FC = () => (
  <div className="space-y-6">
    <h1 className="text-xl font-bold text-[#0F172A]">CRM Overview</h1>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard title="Total Leads" value="47" icon={TrendingUp} iconColor="text-blue-400" iconBg="bg-blue-500/10" change="+8 this week" changeType="positive" />
      <StatCard title="Customers" value="12" icon={Users} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
      <StatCard title="Pipeline Value" value="$2.4M" icon={DollarSign} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
      <StatCard title="Active Deals" value="10" icon={Briefcase} iconColor="text-purple-400" iconBg="bg-purple-500/10" />
    </div>
  </div>
)
