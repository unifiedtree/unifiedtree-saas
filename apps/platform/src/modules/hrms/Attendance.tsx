import React, { useState } from 'react'
import { Clock, CheckCircle } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '@/shared/hooks/useToast'
import { usePermission, Can, P } from '@unifiedtree/sdk'
import { StatsSkeleton, Skeleton, EmptyState } from '@unifiedtree/ui-kit'
import { HrStatCard, HrStatusPill, HrPageHeader, TableCard, HrAvatar, type PillTone } from '@/shared/components/hr'
import {
  useMonthlyStats, useAttendanceHistory,
  useTeamDashboard, useMyCorrections, useCorrectionApprovals,
  useCreateCorrection, useDecideCorrection,
} from './api/useAttendance'

const TEAM_TONE: Record<string, PillTone> = {
  PRESENT: 'ok', ON_TIME: 'ok', LATE: 'warn', ABSENT: 'red', NOT_MARKED: 'gray',
  ON_LEAVE: 'info', WFH: 'teal', HALF_DAY: 'late', HOLIDAY: 'purple', WEEKEND: 'gray',
}

type Tab = 'my' | 'team' | 'corrections'

// Punching is mobile-only — the web app no longer renders a check-in/out widget
// or uses navigator.geolocation. The underlying useCheckIn/useCheckOut hooks are
// intentionally kept in ./api/useAttendance for the mobile/SDK/test clients.

// ── My Attendance Tab ─────────────────────────────────────────────────────────

function MyAttendanceTab() {
  const now = new Date()
  const [year] = useState(now.getFullYear())
  const [month] = useState(now.getMonth() + 1)
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useMonthlyStats(year, month)
  const { data: history = [], isLoading: histLoading, error: histError, refetch: refetchHist } = useAttendanceHistory(year, month)

  const STATUS_BG: Record<string, string> = {
    PRESENT: 'bg-success text-white shadow-sm', ABSENT: 'bg-danger text-white shadow-sm', LATE: 'bg-warning text-white shadow-sm',
    HALF_DAY: 'bg-orange-500 text-white shadow-sm', ON_LEAVE: 'bg-accent-default text-white shadow-sm', HOLIDAY: 'bg-purple-500 text-white shadow-sm',
    WEEKEND: 'bg-bg-base text-text-secondary border border-border-default', WFH: 'bg-cyan-500 text-white shadow-sm',
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <div className="space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-text-primary">{format(new Date(year, month - 1), 'MMMM yyyy')} Summary</h3>
          {statsLoading ? (
            <StatsSkeleton />
          ) : statsError ? (
            <EmptyState variant="error" title="Failed to load stats" primaryAction={{ label: 'Retry', onClick: () => refetchStats() }} />
          ) : stats ? (
            <div className="grid grid-cols-2 gap-3">
              <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={stats.presentDays}            label="Present" />
              <HrStatCard icon={<Clock size={16} />}       color="red"    value={stats.absentDays}             label="Absent" />
              <HrStatCard icon={<Clock size={16} />}       color="orange" value={stats.lateDays}               label="Late" />
              <HrStatCard icon={<CheckCircle size={16} />} color="blue"   value={stats.onTimeDays}             label="On Time" />
              <HrStatCard icon={<Clock size={16} />}       color="purple" value={stats.holidays}               label="Holidays" />
              <HrStatCard icon={<CheckCircle size={16} />} color="green"  value={`${stats.attendanceScore}%`}  label="Score" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="lg:col-span-2 bg-white border border-border-default shadow-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-bold text-text-primary font-heading">Daily Log</h3>
          <div className="text-sm font-medium text-text-secondary bg-bg-surface px-3 py-1.5 rounded-lg border border-border-default">
            {format(new Date(year, month - 1), 'MMMM yyyy')}
          </div>
        </div>
        
        {histLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : histError ? (
          <EmptyState variant="error" title="Failed to load history" primaryAction={{ label: 'Retry', onClick: () => refetchHist() }} />
        ) : (
          <div className="grid grid-cols-7 gap-2 sm:gap-3">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
              <div key={d} className="text-center text-xs font-bold text-text-tertiary uppercase tracking-wider mb-2">{d}</div>
            ))}
            {history.map((day, idx) => {
              // Add empty slots for the first day of the month
              const dateObj = new Date(day.date);
              const dayOfWeek = dateObj.getDay();
              const isFirstDay = idx === 0;
              
              return (
                <React.Fragment key={day.date}>
                  {isFirstDay && Array.from({ length: dayOfWeek }).map((_, i) => (
                    <div key={`empty-${i}`} className="aspect-square rounded-xl" />
                  ))}
                  <div
                    title={`${day.date} — ${day.status}`}
                    className={clsx(
                      'aspect-square rounded-xl flex items-center justify-center text-sm font-bold cursor-default transition-all hover:scale-105 hover:shadow-md',
                      STATUS_BG[day.status] ?? 'bg-bg-base text-text-secondary border border-border-default'
                    )}
                  >
                    {dateObj.getDate()}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap gap-4 mt-8 pt-6 border-t border-border-default">
          {[['PRESENT', 'bg-success'], ['ABSENT', 'bg-danger'], ['LATE', 'bg-warning'], ['ON_LEAVE', 'bg-accent-default'], ['HOLIDAY', 'bg-purple-500'], ['WEEKEND', 'bg-bg-base border border-border-default']].map(([label, bg]) => (
            <div key={label} className="flex items-center gap-2">
              <div className={clsx('w-3 h-3 rounded-full shadow-sm', bg)} />
              <span className="text-xs font-medium text-text-secondary">{label.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Team Dashboard Tab ────────────────────────────────────────────────────────

function TeamDashboardTab() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [search, setSearch] = useState('')
  const { data, isLoading, error: teamError, refetch: refetchTeam } = useTeamDashboard(date)

  const staff = (data?.staffStatuses ?? []).filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.fullName.toLowerCase().includes(q) || s.employeeCode.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      {data?.counts && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <HrStatCard icon={<CheckCircle size={18} />} color="green"  value={data.counts.present}      label="Present" />
          <HrStatCard icon={<Clock size={18} />}       color="orange" value={data.counts.late}         label="Late" />
          <HrStatCard icon={<Clock size={18} />}       color="blue"   value={data.counts.onLeave}      label="On Leave" />
          <HrStatCard icon={<Clock size={18} />}       color="teal"   value={data.counts.workFromHome} label="WFH" />
          <HrStatCard icon={<Clock size={18} />}       color="red"    value={data.counts.notMarked}    label="Not Marked" />
        </div>
      )}

      <TableCard
        search={{ value: search, onChange: setSearch, placeholder: 'Search team…' }}
        actions={
          <input
            type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-border-default bg-white px-3 py-1.5 text-sm focus:border-[#FF9D00] focus:outline-none"
          />
        }
      >
        <table className="hr-table">
          <thead>
            <tr><th>Employee</th><th>Department</th><th>Status</th><th>In</th><th>Out</th><th>Location</th></tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => <tr key={i}><td colSpan={6}><Skeleton className="h-5 w-full rounded-md" /></td></tr>)
            ) : teamError ? (
              <tr><td colSpan={6} className="py-10"><EmptyState variant="error" title="Failed to load team" primaryAction={{ label: 'Retry', onClick: () => refetchTeam() }} /></td></tr>
            ) : staff.length === 0 ? (
              <tr><td colSpan={6} className="py-12 text-center text-sm text-text-tertiary">No records found for this date</td></tr>
            ) : staff.map((s, i) => (
              <tr key={s.employeeId}>
                <td><HrAvatar name={s.fullName} sub={s.employeeCode} seed={i} /></td>
                <td className="text-text-secondary">{s.departmentName ?? '—'}</td>
                <td><HrStatusPill tone={TEAM_TONE[s.status] ?? 'gray'}>{s.status.replace('_', ' ')}</HrStatusPill></td>
                <td className="text-text-secondary">{s.checkInAt ? format(new Date(s.checkInAt), 'h:mm a') : '—'}</td>
                <td className="text-text-secondary">{s.checkOutAt ? format(new Date(s.checkOutAt), 'h:mm a') : '—'}</td>
                <td className="max-w-[140px] truncate text-text-secondary" title={s.locationName}>{s.locationName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

// ── Corrections Tab ───────────────────────────────────────────────────────────

function CorrectionsTab() {
  const { toast } = useToast()
  const isManager = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const { data: myCorr } = useMyCorrections()
  const { data: pending } = useCorrectionApprovals('PENDING')
  const createCorrection = useCreateCorrection()
  const decide = useDecideCorrection()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ requestedDate: '', requestedCheckInAt: '', requestedCheckOutAt: '', reason: '' })

  const handleCreate = async () => {
    if (!form.requestedDate || !form.reason) { toast('Date and reason required', 'error'); return }
    try {
      await createCorrection.mutateAsync({ requestedDate: form.requestedDate, requestedCheckInAt: form.requestedCheckInAt || undefined, requestedCheckOutAt: form.requestedCheckOutAt || undefined, reason: form.reason })
      toast('Correction submitted successfully', 'success')
      setOpen(false)
      setForm({ requestedDate: '', requestedCheckInAt: '', requestedCheckOutAt: '', reason: '' })
    } catch { toast('Failed to submit correction', 'error') }
  }

  const handleDecide = async (id: string, approved: boolean) => {
    try {
      await decide.mutateAsync({ id, status: approved ? 'APPROVED' : 'REJECTED' })
      toast(approved ? 'Correction Approved' : 'Correction Rejected', 'success')
    } catch { toast('Action failed', 'error') }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white border border-border-default shadow-sm rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-base font-bold text-text-primary font-heading">My Corrections</h3>
          <button onClick={() => setOpen(!open)} className="text-xs font-bold px-4 py-2 bg-bg-surface hover:bg-interactive-hover border border-border-default text-text-primary rounded-xl transition-colors shadow-sm">
            {open ? 'Close' : '+ New Request'}
          </button>
        </div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-6"
            >
              <div className="bg-bg-surface border border-border-default rounded-2xl p-5 space-y-4 shadow-inner">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Date *</label>
                    <input type="date" value={form.requestedDate} onChange={(e) => setForm(p => ({ ...p, requestedDate: e.target.value }))} className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Reason *</label>
                    <input value={form.reason} onChange={(e) => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Brief reason" className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Requested In</label>
                    <input type="time" value={form.requestedCheckInAt} onChange={(e) => setForm(p => ({ ...p, requestedCheckInAt: e.target.value }))} className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-text-tertiary mb-1.5">Requested Out</label>
                    <input type="time" value={form.requestedCheckOutAt} onChange={(e) => setForm(p => ({ ...p, requestedCheckOutAt: e.target.value }))} className="w-full bg-white border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20 shadow-sm transition-all" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => setOpen(false)} className="px-4 py-2 text-text-secondary font-semibold text-sm hover:text-text-primary transition-colors">Cancel</button>
                  <button onClick={handleCreate} disabled={createCorrection.isPending} className="px-5 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all shadow-sm shadow-primary/30">
                    {createCorrection.isPending ? 'Submitting...' : 'Submit Request'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {(myCorr?.content ?? []).length === 0 ? (
          <div className="text-center py-10">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-surface mb-3">
              <Clock size={20} className="text-text-tertiary" />
            </div>
            <p className="text-text-secondary text-sm font-medium">No correction requests</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(myCorr?.content ?? []).map((c) => (
              <div key={c.id} className="flex items-center justify-between bg-bg-base hover:bg-bg-surface border border-border-default rounded-xl px-5 py-4 transition-colors">
                <div>
                  <p className="text-text-primary text-sm font-bold">{c.requestedDate}</p>
                  <p className="text-text-secondary text-xs font-medium mt-1">{c.reason}</p>
                </div>
                <span className={clsx('text-xs font-bold px-3 py-1 rounded-lg border', c.status === 'PENDING' ? 'bg-warning/10 text-warning border-warning/20' : c.status === 'APPROVED' ? 'bg-success/10 text-success border-success/20' : 'bg-danger/10 text-danger border-danger/20')}>
                  {c.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {isManager && (
        <div className="bg-white border border-border-default shadow-sm rounded-2xl p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-base font-bold text-text-primary font-heading">Pending Approvals</h3>
            <span className="bg-warning text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
              {(pending?.content ?? []).length}
            </span>
          </div>

          {(pending?.content ?? []).length === 0 ? (
            <div className="text-center py-10">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-bg-surface mb-3">
                <CheckCircle size={20} className="text-text-tertiary" />
              </div>
              <p className="text-text-secondary text-sm font-medium">No pending corrections</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(pending?.content ?? []).map((c) => (
                <div key={c.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-bg-base border border-border-default rounded-xl p-4 gap-4">
                  <div>
                    <p className="text-text-primary text-sm font-bold">{c.requestedDate}</p>
                    <p className="text-text-secondary text-xs font-medium mt-1">{c.reason}</p>
                  </div>
                  <Can code={P.ATTENDANCE_REGULARIZATION_APPROVE}>
                    <div className="flex gap-2">
                      <button onClick={() => handleDecide(c.id, true)} className="px-4 py-2 bg-success/10 text-success hover:bg-success hover:text-white border border-success/20 hover:border-success text-xs font-bold rounded-xl transition-all shadow-sm">Approve</button>
                      <button onClick={() => handleDecide(c.id, false)} className="px-4 py-2 bg-danger/10 text-danger hover:bg-danger hover:text-white border border-danger/20 hover:border-danger text-xs font-bold rounded-xl transition-all shadow-sm">Reject</button>
                    </div>
                  </Can>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export const Attendance: React.FC = () => {
  const isManager = usePermission(P.ATTENDANCE_TEAM_READ)
  const [tab, setTab] = useState<Tab>('my')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Attendance' },
    ...(isManager ? [{ key: 'team' as Tab, label: 'Team Dashboard' }] : []),
    { key: 'corrections', label: 'Corrections' },
  ]

  return (
    <div className="max-w-7xl mx-auto space-y-8 p-4 sm:p-8">
      <HrPageHeader crumb="Attendance & Time" title="Attendance" subtitle="Track and manage attendance records." />

      {/* Modern Tabs */}
      <div className="flex items-center p-1 bg-bg-surface border border-border-default rounded-xl w-max shadow-inner">
        {tabs.map((t) => (
          <button 
            key={t.key} 
            onClick={() => setTab(t.key)} 
            className={clsx(
              'relative px-5 py-2.5 rounded-lg text-sm font-bold transition-all duration-300',
              tab === t.key ? 'text-text-primary shadow-sm bg-white' : 'text-text-secondary hover:text-text-primary hover:bg-white/50'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab Content Area */}
      <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
        {tab === 'my' && <MyAttendanceTab />}
        {tab === 'team' && <TeamDashboardTab />}
        {tab === 'corrections' && <CorrectionsTab />}
      </div>
    </div>
  )
}
