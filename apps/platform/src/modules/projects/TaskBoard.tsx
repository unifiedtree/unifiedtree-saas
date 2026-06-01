import React, { useState } from 'react'
import { Plus, MoreVertical } from 'lucide-react'
import { clsx } from 'clsx'

interface Task {
  id: string
  title: string
  description?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  assignee: string
  project: string
  dueDate?: string
}

type Column = 'TODO' | 'IN_PROGRESS' | 'REVIEW' | 'DONE'

const COLUMNS: { key: Column; label: string; color: string }[] = [
  { key: 'TODO', label: 'To Do', color: 'text-[#64748B]' },
  { key: 'IN_PROGRESS', label: 'In Progress', color: 'text-blue-400' },
  { key: 'REVIEW', label: 'In Review', color: 'text-amber-400' },
  { key: 'DONE', label: 'Done', color: 'text-emerald-400' },
]

const INITIAL_TASKS: Record<Column, Task[]> = {
  TODO: [
    { id: 't1', title: 'Design new onboarding wizard', description: 'Create 5-step wizard UI', priority: 'HIGH', assignee: 'Sophie Martin', project: 'UnifiedTree v2.0', dueDate: '2025-01-30' },
    { id: 't2', title: 'Write API documentation', description: 'OpenAPI spec for v2 endpoints', priority: 'MEDIUM', assignee: 'David Kim', project: 'UnifiedTree v2.0' },
    { id: 't3', title: 'Set up CI/CD pipeline', priority: 'HIGH', assignee: 'Liam Murphy', project: 'Mobile App', dueDate: '2025-01-25' },
  ],
  IN_PROGRESS: [
    { id: 't4', title: 'Build HRMS payroll module', description: 'Gross/Net calculation logic', priority: 'CRITICAL', assignee: 'Carlos Rivera', project: 'UnifiedTree v2.0', dueDate: '2025-01-22' },
    { id: 't5', title: 'Integrate Stripe payments', priority: 'HIGH', assignee: 'Raj Mehta', project: 'Customer Portal', dueDate: '2025-01-28' },
    { id: 't6', title: 'Mobile login screen', priority: 'MEDIUM', assignee: 'Sophie Martin', project: 'Mobile App' },
  ],
  REVIEW: [
    { id: 't7', title: 'Code review: Auth refactor', priority: 'HIGH', assignee: 'Alex Morgan', project: 'UnifiedTree v2.0' },
    { id: 't8', title: 'QA: Leave management flow', description: 'Test all edge cases', priority: 'MEDIUM', assignee: 'Sarah Chen', project: 'HRMS Self-Service' },
  ],
  DONE: [
    { id: 't9', title: 'Security audit completion', priority: 'CRITICAL', assignee: 'Alex Morgan', project: 'Security Audit', dueDate: '2025-01-10' },
    { id: 't10', title: 'Database index optimization', priority: 'HIGH', assignee: 'David Kim', project: 'UnifiedTree v2.0' },
    { id: 't11', title: 'Deploy staging environment', priority: 'MEDIUM', assignee: 'Liam Murphy', project: 'UnifiedTree v2.0' },
  ],
}

const priorityConfig: Record<Task['priority'], { color: string; bg: string }> = {
  LOW: { color: 'text-[#64748B]', bg: 'bg-[#F1F5F9]/40' },
  MEDIUM: { color: 'text-amber-400', bg: 'bg-amber-500/10' },
  HIGH: { color: 'text-orange-400', bg: 'bg-orange-500/10' },
  CRITICAL: { color: 'text-red-400', bg: 'bg-red-500/10' },
}

export const TaskBoard: React.FC = () => {
  const [tasks] = useState(INITIAL_TASKS)

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#0F172A]">Task Board</h1>
          <p className="text-[#64748B] text-sm mt-0.5">Kanban board across all active projects</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-[#0F172A] text-sm font-medium rounded-xl transition-colors">
          <Plus size={16} /> Add Task
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 min-h-[400px]">
        {COLUMNS.map((col) => {
          const colTasks = tasks[col.key]
          return (
            <div key={col.key} className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={clsx('text-xs font-semibold', col.color)}>{col.label}</span>
                  <span className="w-5 h-5 bg-white text-[#64748B] rounded-full text-[10px] flex items-center justify-center font-semibold">
                    {colTasks.length}
                  </span>
                </div>
                <button className="p-1 text-slate-600 hover:text-[#64748B] rounded-lg transition-colors">
                  <Plus size={13} />
                </button>
              </div>
              <div className="flex flex-col gap-2">
                {colTasks.map((task) => {
                  const pc = priorityConfig[task.priority]
                  return (
                    <div
                      key={task.id}
                      className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 cursor-pointer hover:border-[#E2E8F0]/60 transition-colors group"
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <p className="text-slate-200 text-xs font-medium leading-relaxed flex-1">{task.title}</p>
                        <button className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-600 hover:text-[#64748B] transition-all flex-shrink-0">
                          <MoreVertical size={12} />
                        </button>
                      </div>
                      {task.description && (
                        <p className="text-slate-600 text-[11px] mb-2 leading-relaxed">{task.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className={clsx('px-1.5 py-0.5 text-[10px] font-semibold rounded', pc.bg, pc.color)}>
                          {task.priority}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {task.dueDate && (
                            <span className="text-[10px] text-slate-600">
                              {new Date(task.dueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                            </span>
                          )}
                          <div className="w-5 h-5 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-full flex items-center justify-center text-[#0F172A] text-[8px] font-bold" title={task.assignee}>
                            {task.assignee.split(' ').map((n) => n[0]).join('')}
                          </div>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-700 mt-1.5 truncate">{task.project}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
