import React from 'react'
import { HelpCircle, Clock, CheckCircle, AlertTriangle } from 'lucide-react'
import { StatCard } from '@/shared/components/StatCard'

export const HelpdeskDashboard: React.FC = () => (
  <div className="space-y-6">
    <h1 className="text-xl font-bold text-[#0F172A]">Helpdesk Overview</h1>
    <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
      <StatCard title="Open Tickets" value="5" icon={HelpCircle} iconColor="text-blue-400" iconBg="bg-blue-500/10" />
      <StatCard title="In Progress" value="3" icon={Clock} iconColor="text-amber-400" iconBg="bg-amber-500/10" />
      <StatCard title="Resolved" value="3" icon={CheckCircle} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
      <StatCard title="Critical" value="2" icon={AlertTriangle} iconColor="text-red-400" iconBg="bg-red-500/10" change="Urgent" changeType="negative" />
    </div>
  </div>
)
