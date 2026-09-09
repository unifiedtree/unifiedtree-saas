import React, { useMemo, useState } from 'react'
import { Clock, Moon, Timer, Building2, Plus, Pencil, Trash2, X } from 'lucide-react'
import { startOfMonth, endOfMonth, format } from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from './../api/useOrg'
// attendance.shift_policies, not org.shifts. This screen used to read useOrg's
// useShifts (/v1/hrms/shifts), which is a different table that the attendance
// engine never reads — so an "Attendance & Time" page was showing timings and a
// grace value that had nothing to do with who actually got marked Late.
// See useShiftPolicies.ts for the full trap.
import {
  useShiftPolicies, useCreateShiftPolicy, useUpdateShiftPolicy, useDeleteShiftPolicy,
  type ShiftType, type ShiftPolicy, type ShiftPolicyPayload,
} from './../api/useShiftPolicies'
import { useAttendanceSummaryReport } from './../api/useReports'

const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : '—')
/** "09:00:00" → "09:00" for <input type="time">; '' when absent. */
const timeInput = (t?: string | null) => (t ? t.slice(0, 5) : '')

const TYPE_LABEL: Record<ShiftType, string> = {
  FIXED: 'Fixed',
  FLEXIBLE: 'Flexible',
  ROTATIONAL: 'Rotational',
  NIGHT: 'Night',
}

const SHIFT_TYPES: { value: ShiftType; label: string }[] = [
  { value: 'FIXED', label: 'Fixed' },
  { value: 'FLEXIBLE', label: 'Flexible' },
  { value: 'ROTATIONAL', label: 'Rotational' },
  { value: 'NIGHT', label: 'Night' },
]

// Server-side bounds, copied from ShiftDtos.ShiftPolicyRequest so the form
// rejects a bad value with a readable toast instead of letting the API answer
// with a bare 400 the user cannot act on:
//   @Min(0) @Max(120)               gracePeriodMinutes
//   @DecimalMin("0.5") @DecimalMax("24.0")  workingHoursPerDay
//   @DecimalMin("1.0") @DecimalMax("9.99")  overtimeMultiplier
const GRACE_MIN = 0
const GRACE_MAX = 120
const HOURS_MIN = 0.5
const HOURS_MAX = 24
const OT_MIN = 1
const OT_MAX = 9.99

interface ShiftFormState {
  name: string
  shiftType: ShiftType
  startTime: string
  endTime: string
  gracePeriodMinutes: string
  workingHoursPerDay: string
  overtimeApplicable: boolean
  overtimeMultiplier: string
}

const emptyForm = (): ShiftFormState => ({
  name: '',
  shiftType: 'FIXED',
  startTime: '09:00',
  endTime: '18:00',
  // 15 mirrors the attendance.shift_policies.grace_period_minutes default.
  gracePeriodMinutes: '15',
  workingHoursPerDay: '8',
  overtimeApplicable: false,
  overtimeMultiplier: '1.5',
})

const formFromShift = (s: ShiftPolicy): ShiftFormState => ({
  name: s.name ?? '',
  shiftType: s.shiftType ?? 'FIXED',
  // Times arrive as "HH:mm:ss"; <input type="time"> wants "HH:mm".
  startTime: timeInput(s.startTime) || '09:00',
  endTime: timeInput(s.endTime) || '18:00',
  gracePeriodMinutes: String(s.gracePeriodMinutes ?? 15),
  workingHoursPerDay: s.workingHoursPerDay != null ? String(s.workingHoursPerDay) : '8',
  overtimeApplicable: !!s.overtimeApplicable,
  overtimeMultiplier: s.overtimeMultiplier != null ? String(Number(s.overtimeMultiplier)) : '1.5',
})

/** "HH:mm" → minutes since midnight, or null when unparseable. */
const parseHHMM = (v: string): number | null => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(v)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const FIELD_CLS =
  'w-full bg-bg-surface border border-border-default rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary transition-colors'

// ── Slide-over form ─────────────────────────────────────────────────────────────
//
// Mirrors ZoneFormModal in this folder (GeofenceZones.tsx) so the two write
// surfaces on "Attendance & Time" look and behave identically.

function ShiftFormModal({
  open, onClose, editing, companyId,
}: {
  open: boolean
  onClose: () => void
  editing: ShiftPolicy | null
  companyId: string
}) {
  const { toast } = useToast()
  const createShift = useCreateShiftPolicy()
  const updateShift = useUpdateShiftPolicy()
  const isEditing = !!editing

  const [form, setForm] = useState<ShiftFormState>(emptyForm())
  // Re-seed the form whenever the modal opens for a different shift.
  const seedKey = (open ? 'open' : 'closed') + ':' + (editing?.id ?? 'new')
  const [seededKey, setSeededKey] = useState('')
  if (open && seededKey !== seedKey) {
    setForm(editing ? formFromShift(editing) : emptyForm())
    setSeededKey(seedKey)
  }
  if (!open && seededKey !== '') setSeededKey('')

  const set = <K extends keyof ShiftFormState>(k: K, v: ShiftFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }))
  const isPending = createShift.isPending || updateShift.isPending

  const handleSubmit = async () => {
    if (isPending) return
    const name = form.name.trim()
    if (!name) { toast('Shift name is required', 'error'); return }

    // Mirrors EmployeeShiftService.validateShiftWindow: a zero-length window is
    // always rejected (the late-mark math divides by it), and only NIGHT may
    // wrap past midnight (22:00 → 06:00).
    const startMin = parseHHMM(form.startTime)
    const endMin = parseHHMM(form.endTime)
    if (startMin === null || endMin === null) {
      toast('Start and end time must be a valid 24-hour time', 'error'); return
    }
    if (startMin === endMin) {
      toast('Shift start and end time must differ', 'error'); return
    }
    if (form.shiftType === 'FIXED' && endMin < startMin) {
      toast('A fixed shift must end after it starts — use the Night type to wrap past midnight', 'error'); return
    }
    const grace = Number(form.gracePeriodMinutes)
    if (!Number.isFinite(grace) || grace < GRACE_MIN || grace > GRACE_MAX) {
      toast(`Grace period must be between ${GRACE_MIN} and ${GRACE_MAX} minutes`, 'error'); return
    }
    const hours = Number(form.workingHoursPerDay)
    if (!Number.isFinite(hours) || hours < HOURS_MIN || hours > HOURS_MAX) {
      toast(`Working hours per day must be between ${HOURS_MIN} and ${HOURS_MAX}`, 'error'); return
    }
    const multiplier = Number(form.overtimeMultiplier)
    if (form.overtimeApplicable && (!Number.isFinite(multiplier) || multiplier < OT_MIN || multiplier > OT_MAX)) {
      toast(`Overtime rate must be between ${OT_MIN.toFixed(1)} and ${OT_MAX}`, 'error'); return
    }

    const payload: ShiftPolicyPayload = {
      name,
      shiftType: form.shiftType,
      // Jackson accepts "HH:mm", but send seconds so what we PUT matches the
      // "HH:mm:ss" the API hands back.
      startTime: `${form.startTime}:00`,
      endTime: `${form.endTime}:00`,
      gracePeriodMinutes: grace,
      workingHoursPerDay: hours,
      overtimeApplicable: form.overtimeApplicable,
      // Only send a multiplier when OT is on — the server bound is 1.0..9.99 and
      // rejects anything below 1.0, so an OT-off shift must omit it entirely.
      ...(form.overtimeApplicable ? { overtimeMultiplier: multiplier } : {}),
    }

    try {
      if (isEditing) {
        // PUT /v1/shifts/{shiftId} — the id is enough; companyId is only carried
        // so the hook can invalidate the right cache bucket.
        await updateShift.mutateAsync({ id: editing!.id, companyId, data: payload })
        toast('Shift updated', 'success')
      } else {
        if (!companyId) { toast('No company available to attach this shift to', 'error'); return }
        await createShift.mutateAsync({ companyId, data: payload })
        toast('Shift created', 'success')
      }
      onClose()
    } catch (err) {
      // The API surfaces validation and 403s as a message; never swallow it.
      toast((err as Error)?.message || 'Failed to save shift', 'error')
    }
  }

  if (!open) return null

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-text-primary/40 backdrop-blur-sm" onClick={onClose} />
      <div className="ut-card ut-glass ut-card-lg fixed right-0 top-0 bottom-0 z-[110] w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default">
          <h3 className="text-text-primary font-semibold">{isEditing ? 'Edit Shift' : 'Add Shift'}</h3>
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-text-tertiary hover:text-text-primary rounded-lg hover:bg-bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Shift Name *</label>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. General"
              className={FIELD_CLS}
            />
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Shift Type</label>
            <select
              value={form.shiftType}
              onChange={(e) => set('shiftType', e.target.value as ShiftType)}
              className={FIELD_CLS}
            >
              {SHIFT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-5">
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Start Time *</label>
              <input type="time" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} className={FIELD_CLS} />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">End Time *</label>
              <input type="time" value={form.endTime} onChange={(e) => set('endTime', e.target.value)} className={FIELD_CLS} />
            </div>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Grace Period (minutes)</label>
            <input
              type="number"
              min={GRACE_MIN}
              max={GRACE_MAX}
              value={form.gracePeriodMinutes}
              onChange={(e) => set('gracePeriodMinutes', e.target.value)}
              className={FIELD_CLS}
            />
            <p className="mt-1 text-[12px] text-text-tertiary">
              {GRACE_MIN}–{GRACE_MAX}. Check-ins within this window are not marked Late.
            </p>
          </div>

          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Working Hours per Day</label>
            <input
              type="number"
              step="0.5"
              min={HOURS_MIN}
              max={HOURS_MAX}
              value={form.workingHoursPerDay}
              onChange={(e) => set('workingHoursPerDay', e.target.value)}
              className={FIELD_CLS}
            />
            <p className="mt-1 text-[12px] text-text-tertiary">{HOURS_MIN}–{HOURS_MAX}. The daily target for this shift.</p>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={form.overtimeApplicable}
              onChange={(e) => set('overtimeApplicable', e.target.checked)}
              className="w-4 h-4 rounded border-border-default accent-primary"
            />
            <span className="text-sm text-text-primary">Overtime applicable on this shift</span>
          </label>

          {form.overtimeApplicable && (
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Overtime Rate (multiplier)</label>
              <input
                type="number"
                step="0.25"
                min={OT_MIN}
                max={OT_MAX}
                value={form.overtimeMultiplier}
                onChange={(e) => set('overtimeMultiplier', e.target.value)}
                className={FIELD_CLS}
              />
              <p className="mt-1 text-[12px] text-text-tertiary">
                {OT_MIN.toFixed(1)}–{OT_MAX} × the normal hourly rate (2.0 = double pay). Stored as the configured
                rate — no payroll run applies it automatically yet.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-border-default">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 border border-border-default text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex-1 py-2.5 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors"
          >
            {isPending ? 'Saving…' : isEditing ? 'Update Shift' : 'Create Shift'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────

export const ShiftsAndOt: React.FC = () => {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  // The nav item is literally "Shifts & Overtime" but this page shipped as a
  // read-only table: no Add, no Edit, no Delete. The mutations existed the whole
  // time (useCreateShiftPolicy/useUpdate…/useDelete…) and Policies.tsx →
  // OrgSetup.tsx both drive them — this screen just never imported them, so the
  // page an admin naturally goes to for shift timings could not change one.
  //
  // ShiftController gates every write on `attendance.regularization.approve`
  // (POST /v1/shifts, PUT /v1/shifts/{shiftId}, DELETE /v1/shifts/{shiftId});
  // only the GET is `attendance.checkin.self`. Gate on the write code the API
  // actually enforces so we never render a button that 403s.
  const canManageShifts = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)

  const { data: shifts = [], isLoading: shiftsLoading } = useShiftPolicies(activeCompany)
  const deleteShift = useDeleteShiftPolicy()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ShiftPolicy | null>(null)

  const openAdd = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (s: ShiftPolicy) => { setEditing(s); setModalOpen(true) }

  const handleDelete = async (s: ShiftPolicy) => {
    // Destructive and irreversible from this screen — confirm first. Shipping a
    // one-click delete on a statutory record is a bug this codebase has repeated.
    if (!window.confirm(
      `Delete the shift "${s.name}"? Employees still assigned to it must be moved to another shift first.`
    )) return
    try {
      await deleteShift.mutateAsync({ id: s.id, companyId: activeCompany })
      toast('Shift deleted', 'success')
    } catch (err) {
      // 409 SHIFT_IN_USE carries a "reassign employees first" message from the API.
      toast((err as Error)?.message || 'Failed to delete shift', 'error')
    }
  }

  const now = new Date()
  const from = format(startOfMonth(now), 'yyyy-MM-dd')
  const to = format(endOfMonth(now), 'yyyy-MM-dd')
  const { data: summary = [], isLoading: otLoading } = useAttendanceSummaryReport(activeCompany || null, from, to)

  const otRows = useMemo(
    () => [...summary]
      .filter((r) => (r.total_overtime_mins ?? 0) > 0)
      .sort((a, b) => (b.total_overtime_mins ?? 0) - (a.total_overtime_mins ?? 0)),
    [summary],
  )
  const totalOtHours = useMemo(
    () => Math.round((summary.reduce((s, r) => s + (r.total_overtime_mins ?? 0), 0) / 60) * 10) / 10,
    [summary],
  )
  // /v1/shifts only returns active policies (delete is a soft-delete that drops
  // the row from the list), so an "Active Shifts" tile would just restate
  // shifts.length. Count the night shifts instead — that's a real distinction.
  const nightShifts = shifts.filter((s) => s.shiftType === 'NIGHT').length

  // Both /v1/shifts and the OT report are companyId-keyed, so with no company in
  // hand every query below is disabled and the page renders a *false* "nothing
  // defined". Say which it is instead of implying the tenant has no shifts.
  const noCompany = !activeCompany

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Attendance & Time"
        title="Shifts & Overtime"
        subtitle="Shift schedules and this month's overtime across the workforce"
        actions={(companies.length > 1 || canManageShifts) ? (
          <div className="flex flex-wrap items-center gap-2.5">
            {companies.length > 1 && (
              <div className="relative">
                <Building2 size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" />
                <select
                  value={activeCompany}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="rounded-lg border border-border-default bg-white py-2 pl-8 pr-3 text-sm focus:border-[#059669] focus:outline-none"
                >
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            {canManageShifts && (
              <HrButton
                onClick={openAdd}
                disabled={noCompany}
                title={noCompany ? 'No company is visible to your role, so a shift cannot be created' : 'Add a shift schedule'}
              >
                <Plus size={16} /> Add Shift
              </HrButton>
            )}
          </div>
        ) : undefined}
      />

      {!canManageShifts && (
        <div className="flex items-center gap-2 rounded-xl border border-[#6EE7B7] bg-[#ECFDF5] px-4 py-3">
          <Clock size={16} className="text-[#047857]" />
          <p className="text-sm font-medium text-text-secondary">
            View only — ask an admin or HR manager to add, edit, or remove shift schedules.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<Clock size={18} />} color="blue" value={shifts.length} label="Shifts Defined" loading={shiftsLoading} />
        <HrStatCard icon={<Moon size={18} />} color="green" value={nightShifts} label="Night Shifts" loading={shiftsLoading} />
        <HrStatCard icon={<Timer size={18} />} color="orange" value={`${totalOtHours}h`} label="Overtime (This Month)" loading={otLoading} />
      </div>

      {/* Shift schedules */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-text-primary">Shift Schedules</h3>
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Shift</th>
                <th>Timing</th>
                <th className="hidden sm:table-cell">Grace</th>
                <th className="hidden sm:table-cell">Hours/Day</th>
                <th>Type</th>
                {canManageShifts && <th className="text-right"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {shiftsLoading ? (
                [...Array(3)].map((_, i) => <tr key={i}><td colSpan={canManageShifts ? 6 : 5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
              ) : shifts.length === 0 ? (
                <tr>
                  <td colSpan={canManageShifts ? 6 : 5} className="py-12 text-center text-sm text-text-tertiary">
                    {noCompany
                      ? 'Shifts are defined per company, and no company is visible to your role — ask an admin to open this screen.'
                      : 'No shifts defined for this company yet.'}
                  </td>
                </tr>
              ) : shifts.map((s) => (
                <tr key={s.id}>
                  <td>
                    <div className="font-medium text-text-primary">{s.name}</div>
                  </td>
                  <td className="text-text-secondary">{hhmm(s.startTime)} – {hhmm(s.endTime)}</td>
                  {/* gracePeriodMinutes — the value the late-mark cutoff actually uses. */}
                  <td className="hidden sm:table-cell text-text-secondary">{s.gracePeriodMinutes} min</td>
                  <td className="hidden sm:table-cell text-text-secondary">{s.workingHoursPerDay != null ? `${s.workingHoursPerDay} h` : '—'}</td>
                  <td>{s.shiftType === 'NIGHT' ? <HrStatusPill tone="purple"><Moon size={11} className="mr-1 inline" />Night</HrStatusPill> : <HrStatusPill tone="info">{TYPE_LABEL[s.shiftType] ?? 'Day'}</HrStatusPill>}</td>
                  {canManageShifts && (
                    <td className="text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(s)}
                          aria-label={`Edit shift ${s.name}`}
                          title="Edit shift"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-bg-base hover:text-text-primary"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(s)}
                          disabled={deleteShift.isPending}
                          aria-label={`Delete shift ${s.name}`}
                          title="Delete shift"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C] disabled:opacity-40"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>

      {/* Overtime this month */}
      <div>
        <h3 className="mb-2 text-sm font-bold text-text-primary">Overtime — {format(now, 'MMMM yyyy')}</h3>
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Employee</th>
                <th className="hidden sm:table-cell">Present Days</th>
                <th>Overtime</th>
              </tr>
            </thead>
            <tbody>
              {otLoading ? (
                [...Array(3)].map((_, i) => <tr key={i}><td colSpan={3} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
              ) : otRows.length === 0 ? (
                <tr><td colSpan={3} className="py-12 text-center text-sm text-text-tertiary">No overtime recorded this month.</td></tr>
              ) : otRows.map((r, i) => (
                <tr key={r.employee_code ?? i}>
                  <td><HrAvatar name={r.employee_name ?? r.employee_code ?? 'Employee'} sub={r.department ?? undefined} seed={i} /></td>
                  <td className="hidden sm:table-cell text-text-secondary">{r.present_days ?? 0}</td>
                  <td className="font-semibold text-text-primary">{Math.round(((r.total_overtime_mins ?? 0) / 60) * 10) / 10}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      </div>

      {/* Rendered only for roles the API will accept a write from. */}
      {canManageShifts && (
        <ShiftFormModal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          editing={editing}
          companyId={activeCompany}
        />
      )}
    </div>
  )
}
