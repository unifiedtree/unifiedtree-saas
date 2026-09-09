import React, { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Save, UserPlus } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrButton } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useCompanies } from '../api/useOrg'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useManualEntry, useTeamDashboard } from '../api/useAttendance'
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

/**
 * The picker needs an id, a code and a display name and nothing else. Both
 * sources — the full directory and the team roster — are normalised to this so
 * the dropdown does not care which permission the caller got in on.
 */
interface PickerEmployee {
  id: string
  code?: string
  name: string
  /**
   * Only the directory carries this. The team roster's own `status` field is
   * today's ATTENDANCE state (PRESENT/ABSENT), a different thing entirely —
   * mapping it here would make the "this employee has exited" warning fire on
   * anyone who happened to be absent. Left undefined on the fallback path, so
   * the warning simply does not render rather than rendering wrongly.
   */
  employmentStatus?: WorkforceEmployee['employmentStatus']
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

  // Declared before the picker queries because the team-roster fallback keys
  // off the selected date.
  const [employeeId, setEmployeeId] = useState<string>(prefillEmployeeId)
  const [date, setDate] = useState<string>(prefillDate)
  const [checkIn, setCheckIn] = useState<string>('09:00')
  const [checkOut, setCheckOut] = useState<string>('18:00')
  const [reason, setReason] = useState<string>('')

  const { data: page, isLoading: dirLoading, isError: dirError } = useEmployeeDirectory({
    companyId,
    search: debouncedSearch || undefined,
    pageSize: PICKER_PAGE_SIZE,
  })

  // 2026-09-09: the directory 403 used to be a dead end — the page simply told
  // DEPT_MANAGER to go away and come back via a Muster Roll deep link. That is
  // an explanation, not a fix: the role this page EXISTS for still could not
  // start a manual entry from the page itself.
  //
  // The team dashboard is the honest source for them. It returns
  // StaffStatusResponse rows carrying employeeId / employeeCode / fullName /
  // departmentName, and it is gated on attendance.team.read — the same
  // authority the route guard already admits, and one DEPT_MANAGER holds. So
  // the fallback grants no visibility the role did not already have; it just
  // stops throwing away data the user can legitimately see.
  //
  // Only fetched when the directory actually failed, so HR/admin keep the
  // richer server-side search and pay nothing for this path.
  const useTeamFallback = dirError
  const { data: teamDash, isLoading: teamLoading } = useTeamDashboard(
    date || undefined, undefined, useTeamFallback,
  )

  const employees: PickerEmployee[] = useMemo(() => {
    if (!useTeamFallback) {
      return (page?.content ?? []).map((e) => ({
        id: e.id,
        code: e.employeeCode,
        name: fullName(e),
        employmentStatus: e.employmentStatus,
      }))
    }
    // Team roster is unpaginated and unsearched server-side, so filter here.
    const q = debouncedSearch.trim().toLowerCase()
    return (teamDash?.staffStatuses ?? [])
      .map((s) => ({ id: s.employeeId, code: s.employeeCode, name: s.fullName }))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code ?? '').toLowerCase().includes(q))
  }, [useTeamFallback, page, teamDash, debouncedSearch])

  // 2026-09-08 audit. Two permission mismatches on this page:
  //  * The directory is hrms.employee.read, which V112 deliberately removed
  //    from DEPT_MANAGER (the PII-leak fix) — yet DEPT_MANAGER is exactly the
  //    role that holds attendance.regularization.approve, i.e. the role this
  //    page exists for. The 403 was swallowed into an empty picker that read as
  //    "no employees match". Superseded 2026-09-09 by the team-roster fallback
  //    above, which makes the picker actually work for that role; the muster
  //    roll deep-link is now only the last resort when the roster is empty too.
  //  * The route guard admits attendance.team.read, but POST /manual-entry
  //    needs attendance.regularization.approve. ADMIN/MANAGER workspace roles
  //    hold team.read alone, filled the form, and got a generic "Failed to
  //    save". Gate Save on the real permission and say why.
  const canSaveEntry = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)

  // Whichever source is actually feeding the picker is the one whose loading
  // state the dropdown must reflect.
  const pickerLoading = useTeamFallback ? teamLoading : dirLoading

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
    canSaveEntry &&
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
              {selected.name}
              {selected.code && <span className="text-xs text-[var(--text-tertiary)]">· {selected.code}</span>}
            </p>
          )}
          {dirError && employees.length === 0 && !teamLoading ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
              {employeeId ? (
                <>
                  <span className="font-semibold">Employee pre-selected from the muster roll.</span>{' '}
                  Your role can't browse the full directory, but you can still save this entry.
                </>
              ) : (
                <>
                  <span className="font-semibold">No employees available to select.</span>{' '}
                  Your role can't browse the full directory and no one appears on your team roster
                  for this date. Open the{' '}
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => navigate('/hrms/muster-roll' + (date ? `?date=${date}` : ''))}
                  >
                    muster roll
                  </button>{' '}
                  and use the row action there — it brings you back here with the employee filled in.
                </>
              )}
            </div>
          ) : (
            <>
              {dirError && (
                // Team-roster fallback is in play. Say so plainly rather than
                // letting the user wonder why a colleague they know exists is
                // missing from a box that looks like a full directory search.
                <p className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-[var(--text-secondary)]">
                  Showing your team roster for {date || 'today'} — your role can't browse the full
                  employee directory.
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
                {pickerLoading && <option>Loading…</option>}
                {!pickerLoading && employees.length === 0 && (
                  <option disabled>No employees match — try a different search</option>
                )}
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.code ? ` · ${e.code}` : ''}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {!canSaveEntry && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
            You can view this form but your role can&rsquo;t record manual attendance
            (needs the &ldquo;approve regularization&rdquo; permission). Ask HR or an admin to save it.
          </p>
        )}

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
