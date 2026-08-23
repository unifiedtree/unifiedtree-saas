import React, { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Save, UserPlus } from 'lucide-react'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useManualEntry } from '../api/useAttendance'
import { useDebounce } from '@/shared/hooks/useDebounce'

// Manual Entry = admin / HR punches on behalf of an employee (missed check-in,
// forgot to swipe, biometric downtime, etc). Backend: POST /v1/attendance/manual-entry
// requires attendance.regularization.approve. Reason is mandatory so the audit
// trail always knows WHY the punch was hand-entered.

// Convert a yyyy-MM-dd date + HH:mm time in the browser's local zone to the ISO
// instant string the backend expects (Instant). Returns undefined if either
// piece is missing so the field stays optional (check-in only, check-out only).
function toIsoInstant(date: string, hhmm: string): string | undefined {
  if (!date || !hhmm) return undefined
  const [h, m] = hhmm.split(':')
  if (h == null || m == null) return undefined
  const d = new Date(date)
  d.setHours(Number(h), Number(m), 0, 0)
  return d.toISOString()
}

function fullName(e: WorkforceEmployee): string {
  return [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') || e.email
}

// Minimum data required for the employee picker — only fetch a lean directory
// page and let the dropdown filter client-side after typing narrows the list.
const PICKER_PAGE_SIZE = 100

export const ManualEntry: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [params] = useSearchParams()

  const prefillEmployeeId = params.get('employeeId') ?? ''
  const prefillDate = params.get('date') ?? format(new Date(), 'yyyy-MM-dd')

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)

  const { data: page, isLoading: dirLoading } = useEmployeeDirectory({
    companyId,
    search: debouncedSearch || undefined,
    pageSize: PICKER_PAGE_SIZE,
  })
  const employees = page?.content ?? []

  const [employeeId, setEmployeeId] = useState<string>(prefillEmployeeId)
  const [date, setDate] = useState<string>(prefillDate)
  const [checkIn, setCheckIn] = useState<string>('09:00')
  const [checkOut, setCheckOut] = useState<string>('18:00')
  const [reason, setReason] = useState<string>('')

  // Keep the picker in sync if the row-click deep-link changes after mount
  // (rare — usually only mount-time, but guards against a stale form).
  useEffect(() => {
    if (prefillEmployeeId) setEmployeeId(prefillEmployeeId)
  }, [prefillEmployeeId])

  const selected = useMemo(
    () => employees.find((e) => e.id === employeeId),
    [employees, employeeId],
  )

  const manual = useManualEntry()

  const canSubmit =
    employeeId.trim().length > 0 &&
    date.trim().length > 0 &&
    reason.trim().length > 0 &&
    // Either a check-in or a check-out (or both) — an empty punch is not useful.
    (checkIn.trim().length > 0 || checkOut.trim().length > 0) &&
    !manual.isPending

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return

    // Reject nonsensical checkout-before-checkin up front. Backend will also
    // reject, but a client-side toast beats a raw HTTP error every time.
    if (checkIn && checkOut && checkIn >= checkOut) {
      toast('Check-out time must be after check-in time', 'error')
      return
    }

    try {
      await manual.mutateAsync({
        employeeId,
        attendanceDate: date,
        checkInAt: toIsoInstant(date, checkIn),
        checkOutAt: toIsoInstant(date, checkOut),
        reason: reason.trim(),
      })
      toast('Manual entry saved', 'success')
      // Bounce back to the muster roll for the same date so the admin sees
      // the newly-created punch in context.
      navigate(`/hrms/muster-roll?date=${date}`)
    } catch {
      toast('Failed to save manual entry', 'error')
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 sm:p-8">
      <HrPageHeader
        crumb="Attendance & Time"
        title="Manual Attendance Entry"
        subtitle="Punch on behalf of an employee for a specific day. All entries are audit-logged with your name and the reason you provide."
        actions={
          <HrButton variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft size={14} /> Back
          </HrButton>
        }
      />

      <form
        onSubmit={onSubmit}
        className="ut-card ut-card-lg space-y-5 p-6"
      >
        {/* Employee picker: type-to-filter combo. When arriving with a
            ?employeeId= deep-link we show the current selection above the
            list so the admin sees who they're editing. */}
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Employee *
          </label>
          {selected && (
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-[var(--text-primary)]">
              <UserPlus size={14} className="text-[var(--text-tertiary)]" />
              {fullName(selected)}
              <span className="text-xs text-[var(--text-tertiary)]">· {selected.employeeCode}</span>
            </p>
          )}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, code or email…"
            className="mb-2 w-full rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
          />
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            size={6}
            className="w-full rounded-lg border border-[var(--border-default)] bg-white px-2 py-1.5 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
          >
            {dirLoading && <option>Loading…</option>}
            {!dirLoading && employees.length === 0 && (
              <option disabled>No employees match — try a different search</option>
            )}
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {fullName(e)} · {e.employeeCode}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Date *
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              max={format(new Date(), 'yyyy-MM-dd')}
              className="w-full rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Check-in
            </label>
            <input
              type="time"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
              Check-out
            </label>
            <input
              type="time"
              value={checkOut}
              onChange={(e) => setCheckOut(e.target.value)}
              className="w-full rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[13px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Reason *
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={4}
            placeholder="e.g. Biometric downtime — employee was in office all day, verified via CCTV."
            className="w-full resize-y rounded-lg border border-[var(--border-default)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20"
          />
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">
            A short justification is stored on the record and shown in audit logs.
          </p>
        </div>

        {selected?.employmentStatus === 'EXITED' || selected?.employmentStatus === 'TERMINATED' ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
            This employee is {String(selected.employmentStatus).toLowerCase().replace('_', ' ')}. Backdated
            attendance is usually only valid before their last working day.
          </p>
        ) : null}

        <div className="flex justify-end gap-3 pt-2">
          <HrButton type="button" variant="ghost" onClick={() => navigate(-1)}>
            Cancel
          </HrButton>
          <HrButton type="submit" variant="primary" disabled={!canSubmit}>
            <Save size={14} /> {manual.isPending ? 'Saving…' : 'Save Entry'}
          </HrButton>
        </div>
      </form>

      {/* Small orientation footer — reminds the admin what this is for. */}
      <p className="text-xs text-[var(--text-tertiary)]">
        Prefer the employee to submit a correction request themselves when they have proof.
        Manual entries here are for cases where the employee cannot file their own request
        (e.g. system downtime, missed enrolment on their first day).{' '}
        <button
          type="button"
          className="font-medium text-[#047857] underline-offset-2 hover:underline"
          onClick={() => navigate('/hrms/muster-roll' + (date ? `?date=${date}` : ''))}
        >
          Back to muster roll
        </button>
      </p>
    </div>
  )
}

export default ManualEntry
