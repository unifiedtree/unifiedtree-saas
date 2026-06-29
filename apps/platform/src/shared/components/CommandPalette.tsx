import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Users, BarChart3, FileText, Settings, Bell, Shield, Folder,
  CreditCard, Briefcase, HelpCircle, Package, ShoppingCart, TrendingUp,
  LogOut, Plus, Home, ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import { useAuthStore } from '@/core/auth/authStore'

interface Command {
  id: string
  label: string
  description?: string
  icon: React.ReactNode
  action: () => void
  group: string
  shortcut?: string
}

interface CommandPaletteProps {
  isOpen: boolean
  onClose: () => void
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const go = (path: string) => { navigate(path); onClose() }

  const commands: Command[] = [
    { id: 'home', label: 'Dashboard', icon: <Home size={16} />, action: () => go('/'), group: 'Navigation' },
    { id: 'analytics', label: 'Analytics', icon: <BarChart3 size={16} />, action: () => go('/analytics'), group: 'Navigation' },
    { id: 'settings', label: 'Settings', icon: <Settings size={16} />, action: () => go('/settings'), group: 'Navigation' },
    { id: 'users', label: 'User Management', icon: <Users size={16} />, action: () => go('/users'), group: 'Navigation' },
    { id: 'roles', label: 'Role Management', icon: <Shield size={16} />, action: () => go('/roles'), group: 'Navigation' },
    { id: 'audit', label: 'Audit Logs', icon: <Bell size={16} />, action: () => go('/audit-logs'), group: 'Navigation' },
    { id: 'files', label: 'Files', icon: <Folder size={16} />, action: () => go('/files'), group: 'Navigation' },
    // HRMS
    { id: 'employees', label: 'Employees', icon: <Users size={16} />, action: () => go('/hrms/employees'), group: 'HRMS' },
    { id: 'leave', label: 'Leave Management', icon: <FileText size={16} />, action: () => go('/hrms/leave'), group: 'HRMS' },
    { id: 'payroll', label: 'Payroll', icon: <CreditCard size={16} />, action: () => go('/hrms/payroll'), group: 'HRMS' },
    { id: 'attendance', label: 'Attendance', icon: <TrendingUp size={16} />, action: () => go('/hrms/attendance'), group: 'HRMS' },
    // CRM
    { id: 'leads', label: 'Leads', icon: <TrendingUp size={16} />, action: () => go('/crm/leads'), group: 'CRM' },
    { id: 'customers', label: 'Customers', icon: <Users size={16} />, action: () => go('/crm/customers'), group: 'CRM' },
    { id: 'deals', label: 'Deals Pipeline', icon: <Briefcase size={16} />, action: () => go('/crm/deals'), group: 'CRM' },
    // Accounts
    { id: 'invoices', label: 'Invoices', icon: <FileText size={16} />, action: () => go('/accounts/invoices'), group: 'Finance' },
    { id: 'expenses', label: 'Expenses', icon: <ShoppingCart size={16} />, action: () => go('/accounts/expenses'), group: 'Finance' },
    // Projects
    { id: 'projects', label: 'Projects', icon: <Package size={16} />, action: () => go('/projects'), group: 'Projects' },
    // Helpdesk
    { id: 'tickets', label: 'Support Tickets', icon: <HelpCircle size={16} />, action: () => go('/helpdesk/tickets'), group: 'Helpdesk' },
    // Actions
    { id: 'new-employee', label: 'Add Employee', description: 'Create a new employee record', icon: <Plus size={16} />, action: () => go('/hrms/employees'), group: 'Quick Actions' },
    { id: 'new-lead', label: 'Create Lead', description: 'Add a new sales lead', icon: <Plus size={16} />, action: () => go('/crm/leads'), group: 'Quick Actions' },
    { id: 'new-invoice', label: 'New Invoice', description: 'Create a new invoice', icon: <Plus size={16} />, action: () => go('/accounts/invoices'), group: 'Quick Actions' },
    { id: 'logout', label: 'Sign Out', icon: <LogOut size={16} />, action: () => { logout(); navigate('/login') }, group: 'Account' },
  ]

  const filtered = query
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase()) ||
        c.description?.toLowerCase().includes(query.toLowerCase()) ||
        c.group.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  const groups = filtered.reduce<Record<string, Command[]>>((acc, cmd) => {
    if (!acc[cmd.group]) acc[cmd.group] = []
    acc[cmd.group].push(cmd)
    return acc
  }, {})

  useEffect(() => {
    if (isOpen) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(''); setSelected(0) }
  }, [isOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!isOpen) return
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
      if (e.key === 'Enter') { filtered[selected]?.action() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, filtered, selected, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-white border border-border-default rounded-2xl shadow-2xl overflow-hidden animate-slide-up">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-default">
          <Search size={16} className="text-text-tertiary flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
            placeholder="Search commands, pages, modules..."
            className="flex-1 bg-transparent text-text-primary placeholder-text-tertiary outline-none text-sm"
          />
          <kbd className="px-2 py-1 text-[10px] bg-bg-base text-text-tertiary rounded border border-border-default">ESC</kbd>
        </div>
        <div className="overflow-y-auto max-h-96 py-2">
          {Object.entries(groups).map(([group, cmds]) => (
            <div key={group}>
              <p className="px-4 py-1.5 text-[10px] font-semibold text-text-tertiary uppercase tracking-wider">{group}</p>
              {cmds.map((cmd) => {
                const globalIdx = filtered.indexOf(cmd)
                return (
                  <button
                    key={cmd.id}
                    onMouseEnter={() => setSelected(globalIdx)}
                    onClick={cmd.action}
                    className={clsx(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                      selected === globalIdx ? 'bg-[#FFF4E1] text-[#C16E00]' : 'text-text-secondary hover:bg-[#FFF8EC]'
                    )}
                  >
                    <span className={selected === globalIdx ? 'text-[#C16E00]' : 'text-text-tertiary'}>{cmd.icon}</span>
                    <span className="flex-1 text-left">{cmd.label}</span>
                    {cmd.description && <span className="text-xs text-text-tertiary">{cmd.description}</span>}
                    {selected === globalIdx && <ChevronRight size={14} className="text-[#C16E00]" />}
                  </button>
                )
              })}
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-8 text-center text-text-tertiary text-sm">No commands found for "{query}"</p>
          )}
        </div>
        <div className="px-4 py-2 border-t border-border-default flex items-center gap-4 text-xs text-text-tertiary">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
