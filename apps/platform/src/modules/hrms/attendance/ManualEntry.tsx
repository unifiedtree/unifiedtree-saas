// Manual attendance entry (/hrms/attendance/manual-entry), rebuilt on the redesign kit (PgTime a-daily
// "Manual entry"; it stays its own route and returns to the muster roll for the same day). HR or an
// admin punches on behalf of someone (missed check-in, biometric downtime…).
//   POST /v1/attendance/manual-entry       attendance.workforce.admin (V143.5); managers can open the
//                                          form but not save, and the Save button says so
//   POST /v1/attendance/review/status      "Absent" is a status change, not a punch (attendance.status.override)
//   GET  /v1/attendance/manual-entries     recent manual entries in your scope (BW-18), with who and why
// Every entry is audit-logged with your name and the reason.
//
// Who can be picked: the employee directory (hrms.employee.read). Roles without it get their team
// roster for the day (attendance.team.read), which is exactly who they may act for.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePermission, P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { Button, Callout, CellPerson, PageFrame, PageHeader, Section, Table, type TableColumn } from '@/design/kit/display'
import { Input, Select, Textarea, useToast } from '@/design/kit/overlays'
import { fmtWd, istToday } from '@/design/dc/dates'
import { useDebounce } from '@/shared/hooks/useDebounce'
import { useCurrentCompany } from '../company/CurrentCompany'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useManualEntry, useTeamDashboard } from '../api/useAttendance'
import { useChangeDayStatus } from '../api/useAttendanceReview'
import { MARK_AS, istInstant } from './daily/BulkMarkPanel'
import { hhmmIst } from './daily/dailyModel'
import './daily/daily.css'
import { RangeFilter, useRangeParam } from '@/design/kit/RangeFilter'
import { rangeKey, rangeQs } from '../api/shared/listRange'

/** The longest range GET /v1/attendance/manual-entries answers (ManualEntryLog.MAX_DAYS). */
const MANUAL_ENTRY_MAX_DAYS = 92

const fullName = (e: WorkforceEmployee) => [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') || e.email
interface PickerEmployee { id: string; code?: string; name: string; employmentStatus?: WorkforceEmployee['employmentStatus'] }
interface RecentEntry {
  recordId: string; employeeId: string; employeeName: string | null; employeeCode: string | null; departmentName: string | null
  date: string; checkInAt: string | null; checkOutAt: string | null; attendanceStatus: string | null; attendanceType: string | null
  reason: string | null; enteredByName: string | null; enteredAt: string | null
}

export function ManualEntry() {
  const navigate = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()
  const today = istToday()
  const prefillEmployeeId = params.get('employeeId') ?? ''
  const askedDate = params.get('date') ?? ''
  const companyId = useCurrentCompany().companyId || undefined
  const canReadDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const canSave = usePermission('attendance.workforce.admin')
  const canOverride = usePermission('attendance.status.override')
  const canTeam = usePermission(P.ATTENDANCE_TEAM_READ)
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const [employeeId, setEmployeeId] = useState(prefillEmployeeId)
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(askedDate) && askedDate <= today ? askedDate : today)
  const [checkIn, setCheckIn] = useState('09:00')
  const [checkOut, setCheckOut] = useState('18:00')
  const [as, setAs] = useState('PRESENT')
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)

  const dir = useEmployeeDirectory({ companyId, search: debounced || undefined, pageSize: 100 }, { enabled: canReadDirectory })
  // The team roster when the directory isn't available (no permission, or it failed).
  const useTeam = !canReadDirectory || dir.isError
  const team = useTeamDashboard(date || undefined, undefined, useTeam)
  const employees: PickerEmployee[] = useMemo(() => {
    if (!useTeam) return (dir.data?.content ?? []).map((e) => ({ id: e.id, code: e.employeeCode, name: fullName(e), employmentStatus: e.employmentStatus }))
    const q = debounced.trim().toLowerCase()
    return (team.data?.staffStatuses ?? []).map((s) => ({ id: s.employeeId, code: s.employeeCode, name: s.fullName }))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code ?? '').toLowerCase().includes(q))
  }, [useTeam, dir.data, team.data, debounced])
  const pickerLoading = useTeam ? team.isLoading : dir.isLoading
  const selected = employees.find((e) => e.id === employeeId)

  // The card's start / end calendar (?from=&to=): the server already takes the days entered (at most 92, not after
  // today). None = its default, the last 30 days.
  const [range, setRange] = useRangeParam({ max: today, maxSpan: MANUAL_ENTRY_MAX_DAYS })
  const recent = useQuery({
    queryKey: ['hrms', 'attendance', 'manual-entries', 'recent', ...(range ? [rangeKey(range)] : [])],
    queryFn: () => apiJson<RecentEntry[]>(`/v1/attendance/manual-entries?limit=20${rangeQs(range)}`),
    enabled: canTeam,
    retry: false,
  })
  const manual = useManualEntry()
  const change = useChangeDayStatus()
  const absent = as === 'ABSENT'
  const choice = MARK_AS.find((m) => m.value === as)
  const problems = {
    who: !employeeId ? 'Pick the person.' : null,
    time: absent ? null : !checkIn && !checkOut ? 'Enter a check-in, a check-out, or both.' : checkIn && checkOut && checkOut <= checkIn ? 'Check-out must be after check-in.' : null,
    reason: absent ? (reason.trim().length < 3 ? 'Say why (at least 3 characters). The person is told.' : null) : !reason.trim() ? 'Say why. It’s stored on the record and in the audit log.' : null,
  }
  const blocked = problems.who || problems.time || problems.reason
  const busy = manual.isPending || change.isPending
  const backToMuster = () => navigate(`/hrms/muster-roll${date ? `?date=${date}` : ''}`)

  const save = async () => {
    setTried(true)
    if (blocked || busy || !canSave) return
    try {
      if (absent) {
        await change.mutateAsync({ employeeId, date, status: 'ABSENT', reason: reason.trim() })
        toast.success(`${selected?.name ?? 'The day'} marked absent for ${fmtWd(date)}`)
      } else {
        await manual.mutateAsync({
          employeeId, attendanceDate: date, checkInAt: istInstant(date, checkIn), checkOutAt: istInstant(date, checkOut), reason: reason.trim(),
          attendanceType: choice?.type, ...(choice?.status ? { attendanceStatus: choice.status } : {}),
        })
        toast.success('Manual entry saved')
      }
      void recent.refetch()
      backToMuster()
    } catch (e) {
      toast.error('Couldn’t save the entry', { detail: (e as Error)?.message })
    }
  }

  const statusOptions = [...MARK_AS.map((m) => ({ value: m.value, label: m.label })), ...(canOverride ? [{ value: 'ABSENT', label: 'Absent (a status change)' }] : [])]
  const recentCols: TableColumn<RecentEntry>[] = [
    { key: 'who', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.employeeName || 'Employee'} sub={r.departmentName || r.employeeCode || undefined} /> },
    { key: 'date', header: 'Date', render: (r) => <span className="udt-num">{fmtWd(r.date).replace(/ \d{4}$/, '')}</span> },
    {
      key: 'change', header: 'Change', render: (r) => {
        const what = `${hhmmIst(r.checkInAt)} → ${hhmmIst(r.checkOutAt)}${r.attendanceType === 'WFH' ? ' · from home' : r.attendanceType === 'FIELD_WORK' ? ' · on duty' : r.attendanceStatus === 'HALF_DAY' ? ' · half day' : ''}`
        return <span className="udt-clip" title={[what, r.reason].filter(Boolean).join(' · ')}>{what}{r.reason ? ` · ${r.reason}` : ''}</span>
      },
    },
    { key: 'by', header: 'By', render: (r) => r.enteredByName || '—' },
  ]

  return (
    <PageFrame label="Manual attendance entry" className="udt">
      <PageHeader eyebrow="Attendance & time" title="Manual attendance entry"
        sub="Add or correct a punch. Every change is stored on the record and shown in the audit log."
        actions={<Button icon="chevronLeft" onClick={backToMuster}>Muster roll</Button>} />
      <div className="udt-split udt-split--me">
        <Section title="Manual attendance entry" variant="section" className="udt-main">
          <form className="ume-form" onSubmit={(e) => { e.preventDefault(); void save() }} noValidate>
            {!canSave && <Callout tone="warning">Your role can see this form but can’t record manual attendance. Manual entries are for HR and admins; managers can approve their team’s fix requests instead.</Callout>}
            <div className="ume-grid">
              <div className="ume-who">
                <Input label="Find a person" aria-label="Search employees" type="search" placeholder="Search by name, code or email" value={search} onChange={(e) => setSearch(e.target.value)}
                  hint={useTeam ? `From your team roster for ${date === today ? 'today' : fmtWd(date)}; your role can’t browse the full directory.` : undefined} />
                <Select label="Employee" size="md" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}
                  error={tried ? problems.who : undefined}
                  options={[
                    { value: '', label: pickerLoading ? 'Loading…' : employees.length ? 'Choose a person' : 'No one matches; try another search' },
                    ...(employeeId && !selected ? [{ value: employeeId, label: 'Picked from the muster roll' }] : []),
                    ...employees.map((e) => ({ value: e.id, label: `${e.name}${e.code ? ` · ${e.code}` : ''}` })),
                  ]} />
                {(selected?.employmentStatus === 'EXITED' || selected?.employmentStatus === 'TERMINATED') && (
                  <Callout tone="warning">{`This employee is ${String(selected.employmentStatus).toLowerCase()}. Backdated attendance is usually only valid before their last working day.`}</Callout>
                )}
              </div>
              <Input id="me-date" label="Date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
              <Input id="me-in" label="Came in" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} disabled={absent} />
              <Input id="me-out" label="Went out" type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} disabled={absent} error={tried ? problems.time : undefined} />
              <Select label="Status" value={as} onChange={(e) => setAs(e.target.value)} options={statusOptions}
                hint={absent ? 'Absent changes the day’s status; no punch is added.' : undefined} />
              <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Stored on the record and shown in the audit log." error={tried ? problems.reason : undefined} />
            </div>
            <div className="ume-foot">
              <span className="udt-q">When the employee has proof, it’s better that they ask for a fix themselves.</span>
              <Button type="submit" variant="primary" size={40} loading={busy} disabled={!canSave} title={canSave ? undefined : 'Manual entries are for HR and admins'}>Save entry</Button>
            </div>
          </form>
        </Section>
        {canTeam && (
          <Section title="Recent manual entries" variant="section" body="flush" className="udt-side"
            actions={<RangeFilter value={range} onChange={setRange} max={today} maxSpan={MANUAL_ENTRY_MAX_DAYS} label="Days entered" placeholder="Last 30 days" filterKey="manual-entry-dates" align="end" />}
            loading={recent.isLoading} error={recent.isError && (recent.error as { status?: number })?.status !== 404 ? recent.error : undefined} onRetry={() => void recent.refetch()}
            empty={!recent.isLoading && (recent.data ?? []).length === 0 ? { title: recent.isError ? 'Not available yet' : range ? 'No manual entries on these dates' : 'No manual entries lately', hint: recent.isError ? undefined : range ? 'Pick other dates, or clear them for the last 30 days.' : 'Entries from the last 30 days show here.' } : undefined}>
            <Table<RecentEntry> label="Recent manual entries" columns={recentCols} rows={recent.data ?? []} rowKey={(r) => r.recordId} mobile="cards" minWidth={520} />
          </Section>
        )}
      </div>
    </PageFrame>
  )
}

export default ManualEntry
