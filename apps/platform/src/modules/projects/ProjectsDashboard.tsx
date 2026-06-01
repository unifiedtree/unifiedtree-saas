import React from 'react'
import { Package, TrendingUp, Users, Clock } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

export const ProjectsDashboard: React.FC = () => (
  <div className="space-y-6">
    <h1 className="text-xl font-bold text-[#0F172A]">Projects Overview</h1>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard title="Active Projects" value="5" icon={Package} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
      <StatCard title="Tasks Completed" value="255" icon={TrendingUp} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" change="This month" changeType="positive" />
      <StatCard title="Team Members" value="28" icon={Users} iconColor="text-purple-400" iconBg="bg-purple-500/10" />
      <StatCard title="Overdue Tasks" value="7" icon={Clock} iconColor="text-red-400" iconBg="bg-red-500/10" />
    </div>
  </div>
)
