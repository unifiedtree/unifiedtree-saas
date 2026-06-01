import React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { format } from 'date-fns'
import { Sparkles, Users, UserPlus, FileText, Settings, ArrowRight } from 'lucide-react'
import { useAuthStore } from '@/core/auth/authStore'
import { TeamAttendanceWidgets, MyAttendanceWidgets } from './dashboard/AttendanceWidgets'
import { clsx } from 'clsx'

const fadeUp = {
  hidden: { opacity: 0, y: 15 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } },
}
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }

export const Dashboard: React.FC = () => {
  const navigate = useNavigate()
  const { user, hasModule, hasPermission } = useAuthStore()

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const today = format(new Date(), 'EEEE, MMMM d, yyyy')

  return (
    <motion.div variants={stagger} initial="hidden" animate="show" className="p-8 space-y-8 max-w-7xl mx-auto w-full">
      {/* Welcome Banner - PRO MAX Glassmorphism Design */}
      <motion.div
        variants={fadeUp}
        className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#053024] via-[#0A5240] to-[#0F6E56] p-8 sm:p-12 text-white shadow-xl shadow-[#053024]/25"
      >
        <div className="absolute top-0 right-0 w-96 h-96 bg-white/10 blur-[80px] rounded-full -translate-y-1/2 translate-x-1/3" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-[#35c98a]/15 blur-[80px] rounded-full translate-y-1/3 -translate-x-1/3" />
        
        <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-md">
              <Sparkles size={14} /> Welcome back
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white mb-2">
              {greeting}, {user?.firstName ?? 'User'} 👋
            </h1>
            <p className="text-white/80 text-sm sm:text-base font-medium max-w-lg">
              {today} — Here is what is happening across your HRMS workspace today.
            </p>
          </div>
          <div className="hidden lg:flex flex-col items-end gap-2">
            <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-2.5 text-xs font-semibold text-white backdrop-blur-md">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
              All systems operational
            </span>
          </div>
        </div>
      </motion.div>

      {/* Quick Actions */}
      <motion.div variants={fadeUp} className="space-y-4">
        <h3 className="text-lg font-bold text-[#0F172A] px-1">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Add Employee', icon: UserPlus, color: 'text-[#0F6E56]', bg: 'bg-[#0F6E56]/10', hover: 'hover:bg-[#0F6E56] hover:text-white hover:border-[#0F6E56]', border: 'border-[#0F6E56]/20', path: '/hrms/employees', module: 'hrms', permission: 'hrms.employee.write' },
            { label: 'View Directory', icon: Users, color: 'text-[#35c98a]', bg: 'bg-[#35c98a]/10', hover: 'hover:bg-[#35c98a] hover:text-[#053024] hover:border-[#35c98a]', border: 'border-[#35c98a]/20', path: '/hrms/employees', module: 'hrms', permission: 'hrms.employee.read' },
            { label: 'Run Payroll', icon: FileText, color: 'text-emerald-600', bg: 'bg-emerald-50', hover: 'hover:bg-emerald-600 hover:text-white hover:border-emerald-600', border: 'border-emerald-100', path: '/hrms/payroll', module: 'payroll', permission: 'hrms.payroll.write' },
            { label: 'Settings', icon: Settings, color: 'text-[#0A5240]', bg: 'bg-[#0A5240]/10', hover: 'hover:bg-[#0A5240] hover:text-white hover:border-[#0A5240]', border: 'border-[#0A5240]/20', path: '/settings', module: 'hrms', permission: 'audit.read' },
          ].map(({ label, icon: Icon, color, bg, hover, border, path, module, permission }) => {
            if (module && !hasModule(module) && module !== 'hrms') return null // Only hide if it's a completely disabled module
            
            return (
              <motion.button
                key={label}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate(path)}
                className={clsx(
                  'flex items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all duration-300 group',
                  bg, border, hover
                )}
              >
                <div className={clsx("p-2.5 rounded-xl bg-white shadow-sm transition-colors", color, "group-hover:bg-white/20 group-hover:text-white")}>
                  <Icon size={20} />
                </div>
                <span className="text-sm font-bold text-[#0F172A] group-hover:text-white flex-1">{label}</span>
                <ArrowRight size={16} className="text-slate-400 group-hover:text-white group-hover:translate-x-1 transition-all" />
              </motion.button>
            )
          })}
        </div>
      </motion.div>

      {/* Module Dashboards (Dynamic Rendering) */}
      <div className="grid gap-6">
        {hasModule('hrms') && hasPermission('attendance.team.read') && (
          <motion.div variants={fadeUp}>
            <TeamAttendanceWidgets />
          </motion.div>
        )}

        {hasModule('hrms') && !hasPermission('attendance.team.read') && hasPermission('attendance.checkin.self') && (
          <motion.div variants={fadeUp}>
            <MyAttendanceWidgets />
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}
