import React, { useState, useEffect, useRef } from 'react'
import { Clock, CheckCircle, LogIn, LogOut, Calendar, Users, Search, ChevronRight } from 'lucide-react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { motion, AnimatePresence } from 'framer-motion'
import { useToast } from '@/shared/hooks/useToast'
import { usePermission, Can, P } from '@unifiedtree/sdk'
import { StatsSkeleton, Skeleton, TableSkeleton, EmptyState } from '@unifiedtree/ui-kit'
import {
  useTodayAttendance, useMonthlyStats, useAttendanceHistory,
  useTeamDashboard, useMyCorrections, useCorrectionApprovals,
  useCheckIn, useCheckOut, useCreateCorrection, useDecideCorrection,
} from './api/useAttendance'

type Tab = 'my' | 'team' | 'corrections'

// ── Punch Widget ──────────────────────────────────────────────────────────────

function useElapsed(startIso?: string | null) {
  const [elapsed, setElapsed] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!startIso) { setElapsed(''); return }
    const tick = () => {
      const diff = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      setElapsed(h > 0 ? `${h}h ${m}m` : `${m}m`)
    }
    tick()
    intervalRef.current = setInterval(tick, 60_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [startIso])

  return elapsed
}

async function getGeoLocation(): Promise<{ latitude?: number; longitude?: number }> {
  if (!navigator.geolocation) return {}
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve({}),
      { timeout: 5000, maximumAge: 60_000 }
    )
  })
}

function PunchWidget() {
  const { toast } = useToast()
  const { data: today } = useTodayAttendance()
  const checkIn = useCheckIn()
  const checkOut = useCheckOut()

  const isCheckedIn = !!today?.checkInTime && !today?.checkOutTime
  const isCheckedOut = !!today?.checkOutTime
  const isPending = checkIn.isPending || checkOut.isPending
  const elapsed = useElapsed(isCheckedIn ? today?.checkInTime : null)

  return (
    <div className="bg-white border border-border-default shadow-sm rounded-2xl p-6 relative overflow-hidden">
      {/* Decorative background element */}
      <div className="absolute -top-16 -right-16 w-48 h-48 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="flex items-center justify-between mb-6 relative z-10">
        <div>
          <p className="text-text-primary font-bold text-lg font-heading">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
          <p className="text-text-secondary text-sm font-medium mt-0.5">
            {isCheckedOut ? 'Completed for today' : isCheckedIn ? `Checked in${elapsed ? ` · ${elapsed}` : ''}` : 'Not checked in yet'}
          </p>
        </div>
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm', isCheckedIn ? 'bg-success/10 text-success' : 'bg-bg-surface border border-border-default text-text-tertiary')}>
          <Clock size={22} className={isCheckedIn ? 'text-success' : 'text-text-tertiary'} />
        </div>
      </div>

      <div className="flex items-center gap-8 mb-6 bg-bg-base rounded-xl p-4 border border-border-default relative z-10">
        <div className="flex-1">
          <p className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1">Check In</p>
          <p className="text-text-primary font-bold text-base">{today?.checkInTime ? format(new Date(today.checkInTime), 'h:mm a') : '—'}</p>
        </div>
        <div className="h-8 w-px bg-border-default" />
        <div className="flex-1">
          <p className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1">Check Out</p>
          <p className="text-text-primary font-bold text-base">{today?.checkOutTime ? format(new Date(today.checkOutTime), 'h:mm a') : '—'}</p>
        </div>
        {today?.workHours != null && (
          <>
            <div className="h-8 w-px bg-border-default" />
            <div className="flex-1">
              <p className="text-xs text-text-tertiary font-semibold uppercase tracking-wider mb-1">Hours</p>
              <p className="text-text-primary font-bold text-base">{today.workHours.toFixed(1)}h</p>
            </div>
          </>
        )}
      </div>

      {isCheckedOut ? (
        <div className="flex items-center justify-center gap-2 py-3 bg-success/10 border border-success/20 rounded-xl px-4 relative z-10">
          <CheckCircle size={18} className="text-success" />
          <span className="text-sm text-success font-bold">Attendance marked for today</span>
        </div>
      ) : (
        <button
          onClick={async () => {
            try {
              if (isCheckedIn) {
                const geo = await getGeoLocation()
                await checkOut.mutateAsync(geo)
                toast('Checked out successfully', 'success')
              } else if (!isCheckedOut) {
                const geo = await getGeoLocation()
                await checkIn.mutateAsync({ checkInMethod: 'WEB', ...geo })
                toast('Checked in successfully', 'success')
              }
            } catch (err) {
              // Surface the backend's actual message (e.g. "Already checked in
              // today") instead of a generic failure.
              toast((err as Error)?.message || 'Failed to punch attendance', 'error')
            }
          }}
          disabled={isPending}
          className={clsx(
            'w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-bold text-sm transition-all shadow-sm active:scale-[0.98] relative z-10',
            isPending ? 'opacity-70 cursor-not-allowed' : '',
            isCheckedIn ? 'bg-warning hover:bg-warning-hover text-[#0F172A] shadow-warning/20' : 'bg-primary hover:bg-primary-hover text-[#0F172A] shadow-primary/30'
          )}
        >
          {isPending ? 'Processing...' : isCheckedIn ? <><LogOut size={18} /> Check Out</> : <><LogIn size={18} /> Check In</>}
        </button>
      )}
    </div>
  )
}

// ── My Attendance Tab ─────────────────────────────────────────────────────────

function MyAttendanceTab() {
  const now = new Date()
  const [year] = useState(now.getFullYear())
  const [month] = useState(now.getMonth() + 1)
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } = useMonthlyStats(year, month)
  const { data: history = [], isLoading: histLoading, error: histError, refetch: refetchHist } = useAttendanceHistory(year, month)

  const STATUS_BG: Record<string, string> = {
    PRESENT: 'bg-success text-[#0F172A] shadow-sm', ABSENT: 'bg-danger text-[#0F172A] shadow-sm', LATE: 'bg-warning text-[#0F172A] shadow-sm',
    HALF_DAY: 'bg-orange-500 text-[#0F172A] shadow-sm', ON_LEAVE: 'bg-accent-default text-[#0F172A] shadow-sm', HOLIDAY: 'bg-purple-500 text-[#0F172A] shadow-sm',
    WEEKEND: 'bg-bg-base text-text-secondary border border-border-default', WFH: 'bg-cyan-500 text-[#0F172A] shadow-sm',
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1 space-y-6">
        <PunchWidget />
        
        <div className="bg-white border border-border-default shadow-sm rounded-2xl p-5">
          <h3 className="text-sm font-bold text-text-primary uppercase tracking-wider mb-4 font-heading">{format(new Date(year, month - 1), 'MMMM yyyy')} Summary</h3>
          {statsLoading ? (
            <StatsSkeleton />
          ) : statsError ? (
            <EmptyState variant="error" title="Failed to load stats" primaryAction={{ label: 'Retry', onClick: () => refetchStats() }} />
          ) : stats ? (
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Present', value: stats.presentDays, color: 'text-success' },
                { label: 'Absent', value: stats.absentDays, color: 'text-danger' },
                { label: 'Late', value: stats.lateDays, color: 'text-warning' },
                { label: 'On Time', value: stats.onTimeDays, color: 'text-accent-default' },
                { label: 'Holidays', value: stats.holidays, color: 'text-purple-500' },
              ].map((s) => (
                <div key={s.label} className="bg-bg-base rounded-xl p-3 border border-border-default">
                  <p className={clsx('text-xl font-bold font-heading', s.color)}>{s.value}</p>
                  <p className="text-xs text-text-secondary font-medium mt-0.5">{s.label}</p>
                </div>
              ))}
              <div className="bg-primary-light/30 border border-primary/20 rounded-xl p-3 flex flex-col justify-center">
                <p className="text-2xl font-extrabold text-primary font-heading">{stats.attendanceScore}%</p>
                <p className="text-xs text-primary font-semibold mt-0.5">Score</p>
              </div>
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

  const STATUS_SC: Record<string, string> = {
    PRESENT: 'text-success bg-success/10 border-success/20',
    LATE: 'text-warning bg-warning/10 border-warning/20',
    ABSENT: 'text-danger bg-danger/10 border-danger/20',
    NOT_MARKED: 'text-text-tertiary bg-bg-surface border-border-default',
    ON_LEAVE: 'text-accent-default bg-accent-subtle border-accent-default/20',
    HALF_DAY: 'text-orange-600 bg-orange-100 border-orange-200',
  }

  const staff = (data?.staffStatuses ?? []).filter((s) => {
    if (!search) return true
    const q = search.toLowerCase()
    return s.fullName.toLowerCase().includes(q) || s.employeeCode.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-border-default shadow-sm">
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-bg-surface border border-border-default rounded-xl px-4 py-2 text-sm text-text-primary font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm" />
          <div className="relative w-[240px]">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team..." className="w-full bg-bg-surface border border-border-default rounded-xl pl-9 pr-4 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm" />
          </div>
        </div>
      </div>

      {data?.counts && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[['Present', data.counts.present, 'text-success'], ['Late', data.counts.late, 'text-warning'], ['On Leave', data.counts.onLeave, 'text-accent-default'], ['WFH', data.counts.workFromHome, 'text-cyan-600'], ['Not Marked', data.counts.notMarked, 'text-text-tertiary']].map(([label, val, colorClass]) => (
            <div key={label as string} className="bg-white border border-border-default rounded-2xl p-4 shadow-sm flex flex-col items-center justify-center">
              <p className={clsx("text-3xl font-extrabold font-heading", colorClass)}>{val as number}</p>
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-wider mt-1">{label as string}</p>
            </div>
          ))}
        </div>
      )}

      <div className="bg-white border border-border-default shadow-sm rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="border-b border-border-default bg-bg-surface">
              {['Employee', 'Department', 'Status', 'In', 'Out', 'Location'].map((h) => (
                <th key={h} className="px-6 py-4 text-xs font-bold text-text-tertiary uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-default">
            {isLoading
              ? [...Array(5)].map((_, i) => <tr key={i}><td colSpan={6} className="px-6 py-4"><Skeleton className="h-5 w-full rounded-md" /></td></tr>)
              : teamError
              ? <tr><td colSpan={6} className="py-10"><EmptyState variant="error" title="Failed to load team" primaryAction={{ label: 'Retry', onClick: () => refetchTeam() }} /></td></tr>
              : staff.length === 0
              ? <tr><td colSpan={6} className="text-center py-12 text-text-tertiary text-sm font-medium">No records found for this date</td></tr>
              : staff.map((s) => {
                  const sc = STATUS_SC[s.status] ?? STATUS_SC['NOT_MARKED']
                  return (
                    <tr key={s.employeeId} className="hover:bg-interactive-hover transition-colors">
                      <td className="px-6 py-4">
                        <p className="text-text-primary text-sm font-bold">{s.fullName}</p>
                        <p className="text-text-secondary text-xs mt-0.5">{s.employeeCode}</p>
                      </td>
                      <td className="px-6 py-4 text-text-secondary text-sm font-medium">{s.departmentName ?? '—'}</td>
                      <td className="px-6 py-4"><span className={clsx('px-2.5 py-1 text-xs font-bold rounded-lg border', sc)}>{s.status.replace('_', ' ')}</span></td>
                      <td className="px-6 py-4 text-text-secondary text-sm font-medium">{s.checkInAt ? format(new Date(s.checkInAt), 'h:mm a') : '—'}</td>
                      <td className="px-6 py-4 text-text-secondary text-sm font-medium">{s.checkOutAt ? format(new Date(s.checkOutAt), 'h:mm a') : '—'}</td>
                      <td className="px-6 py-4 text-text-secondary text-sm font-medium truncate max-w-[120px]" title={s.locationName}>{s.locationName ?? '—'}</td>
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
                  <button onClick={handleCreate} disabled={createCorrection.isPending} className="px-5 py-2 bg-primary hover:bg-primary-hover disabled:opacity-50 text-[#0F172A] font-bold text-sm rounded-xl transition-all shadow-sm shadow-primary/30">
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
            <span className="bg-warning text-[#0F172A] text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
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
                      <button onClick={() => handleDecide(c.id, true)} className="px-4 py-2 bg-success/10 text-success hover:bg-success hover:text-[#0F172A] border border-success/20 hover:border-success text-xs font-bold rounded-xl transition-all shadow-sm">Approve</button>
                      <button onClick={() => handleDecide(c.id, false)} className="px-4 py-2 bg-danger/10 text-danger hover:bg-danger hover:text-[#0F172A] border border-danger/20 hover:border-danger text-xs font-bold rounded-xl transition-all shadow-sm">Reject</button>
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
      <div>
        <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary font-heading tracking-tight">Attendance</h1>
        <p className="text-text-secondary text-sm sm:text-base font-medium mt-1.5">Track and manage attendance records.</p>
      </div>

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
