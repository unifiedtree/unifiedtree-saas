import React, { useState } from 'react'
import { Package, Users, Calendar, Plus, TrendingUp } from 'lucide-react'
import { clsx } from 'clsx'
import type { Project } from '@/types'
import { StatCard } from '@/shared/components/StatCard'

const MOCK_PROJECTS: Project[] = [
  { id: 'pr1', name: 'UnifiedTree v2.0 Platform', description: 'Complete redesign and rebuild of the core ERP platform', status: 'ACTIVE', priority: 'HIGH', startDate: '2024-10-01', dueDate: '2025-03-31', progress: 65, teamSize: 8, tasksTotal: 124, tasksCompleted: 81 },
  { id: 'pr2', name: 'Mobile App Development', description: 'Native iOS and Android apps for field employees', status: 'ACTIVE', priority: 'HIGH', startDate: '2024-11-15', dueDate: '2025-05-15', progress: 42, teamSize: 5, tasksTotal: 87, tasksCompleted: 37 },
  { id: 'pr3', name: 'Data Warehouse Migration', description: 'Migrate from PostgreSQL to Snowflake for analytics', status: 'PLANNING', priority: 'MEDIUM', startDate: '2025-01-15', dueDate: '2025-04-30', progress: 8, teamSize: 3, tasksTotal: 52, tasksCompleted: 4 },
  { id: 'pr4', name: 'Customer Portal Redesign', description: 'New self-service portal for enterprise customers', status: 'ACTIVE', priority: 'MEDIUM', startDate: '2024-12-01', dueDate: '2025-02-28', progress: 78, teamSize: 4, tasksTotal: 63, tasksCompleted: 49 },
  { id: 'pr5', name: 'Security Audit & Hardening', description: 'SOC 2 Type II certification readiness', status: 'COMPLETED', priority: 'HIGH', startDate: '2024-09-01', dueDate: '2025-01-10', progress: 100, teamSize: 3, tasksTotal: 45, tasksCompleted: 45 },
  { id: 'pr6', name: 'AI-Powered Analytics', description: 'Machine learning insights for sales forecasting', status: 'ON_HOLD', priority: 'LOW', startDate: '2025-02-01', dueDate: '2025-06-30', progress: 0, teamSize: 2, tasksTotal: 38, tasksCompleted: 0 },
  { id: 'pr7', name: 'HR Self-Service Module', description: 'Employee self-service for leave, payslips, profile', status: 'ACTIVE', priority: 'MEDIUM', startDate: '2024-12-15', dueDate: '2025-03-15', progress: 55, teamSize: 3, tasksTotal: 71, tasksCompleted: 39 },
  { id: 'pr8', name: 'Multi-Currency Support', description: 'Expand accounts module to support 30+ currencies', status: 'PLANNING', priority: 'LOW', startDate: '2025-03-01', dueDate: '2025-05-31', progress: 0, teamSize: 2, tasksTotal: 29, tasksCompleted: 0 },
]

const statusConfig: Record<Project['status'], { label: string; color: string; bg: string; dot: string }> = {
  ACTIVE: { label: 'Active', color: 'text-emerald-400', bg: 'bg-emerald-500/10', dot: 'bg-emerald-500' },
  PLANNING: { label: 'Planning', color: 'text-blue-400', bg: 'bg-blue-500/10', dot: 'bg-blue-500' },
  ON_HOLD: { label: 'On Hold', color: 'text-amber-400', bg: 'bg-amber-500/10', dot: 'bg-amber-500' },
  COMPLETED: { label: 'Completed', color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40', dot: 'bg-slate-500' },
  CANCELLED: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-500/10', dot: 'bg-red-500' },
}

const priorityConfig: Record<Project['priority'], { label: string; color: string }> = {
  HIGH: { label: 'High', color: 'text-red-400' },
  MEDIUM: { label: 'Medium', color: 'text-amber-400' },
  LOW: { label: 'Low', color: 'text-[#64748B]' },
}

export const ProjectList: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState('All')

  const filtered = statusFilter === 'All' ? MOCK_PROJECTS : MOCK_PROJECTS.filter((p) => p.status === statusFilter)
  const active = MOCK_PROJECTS.filter((p) => p.status === 'ACTIVE').length
  const completed = MOCK_PROJECTS.filter((p) => p.status === 'COMPLETED').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Projects</h1>
          <p className="text-[#64748B] text-sm mt-0.5">{MOCK_PROJECTS.length} total projects</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} /> New Project
        </button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Active" value={active} icon={Package} iconColor="text-emerald-400" iconBg="bg-emerald-500/10" />
        <StatCard title="Completed" value={completed} icon={Package} iconColor="text-[#64748B]" iconBg="bg-[#F1F5F9]/40" />
        <StatCard title="Total Tasks" value={MOCK_PROJECTS.reduce((s, p) => s + p.tasksTotal, 0)} icon={TrendingUp} iconColor="text-[#0F6E56]" iconBg="bg-[#0F6E56]/10" />
        <StatCard title="Team Members" value={MOCK_PROJECTS.reduce((s, p) => s + p.teamSize, 0)} icon={Users} iconColor="text-purple-400" iconBg="bg-purple-500/10" />
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 bg-white border border-[#E2E8F0]/40 rounded-xl p-1 w-fit flex-wrap">
        {['All', 'ACTIVE', 'PLANNING', 'ON_HOLD', 'COMPLETED'].map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={clsx('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', statusFilter === f ? 'bg-indigo-600 text-[#0F172A]' : 'text-[#64748B] hover:text-[#334155]')}
          >
            {f === 'All' ? 'All' : statusConfig[f as Project['status']].label}
          </button>
        ))}
      </div>

      {/* Project Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map((project) => {
          const sc = statusConfig[project.status]
          const pc = priorityConfig[project.priority]
          return (
            <div key={project.id} className="bg-white border border-[#E2E8F0] rounded-2xl p-5 hover:border-[#E2E8F0]/60 transition-colors cursor-pointer">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0 mr-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={clsx('w-1.5 h-1.5 rounded-full flex-shrink-0', sc.dot)} />
                    <h3 className="text-[#0F172A] font-semibold text-sm truncate">{project.name}</h3>
                  </div>
                  {project.description && (
                    <p className="text-[#64748B] text-xs leading-relaxed line-clamp-2">{project.description}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className={clsx('px-2 py-0.5 text-[10px] font-semibold rounded-full', sc.bg, sc.color)}>{sc.label}</span>
                  <span className={clsx('text-[10px] font-medium', pc.color)}>
                    {pc.label} priority
                  </span>
                </div>
              </div>

              {/* Progress */}
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[#64748B]">Progress</span>
                  <span className="text-xs font-semibold text-[#0F172A]">{project.progress}%</span>
                </div>
                <div className="h-1.5 bg-white rounded-full overflow-hidden">
                  <div
                    className={clsx('h-full rounded-full', project.progress === 100 ? 'bg-emerald-500' : 'bg-indigo-500')}
                    style={{ width: `${project.progress}%` }}
                  />
                </div>
              </div>

              {/* Meta */}
              <div className="flex items-center justify-between text-xs text-[#64748B]">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <Users size={11} /> {project.teamSize}
                  </span>
                  <span>{project.tasksCompleted}/{project.tasksTotal} tasks</span>
                </div>
                <div className="flex items-center gap-1">
                  <Calendar size={11} />
                  {new Date(project.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
