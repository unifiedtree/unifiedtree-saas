// Manual attendance entry (/hrms/attendance/manual-entry), on the module kit.
// HR or a manager punches on behalf of someone (missed check-in, biometric
// downtime…). POST /v1/attendance/manual-entry needs
// attendance.regularization.approve; the reason is mandatory so the audit
// trail always says why the punch was entered by hand.
//
// Who can be picked: the employee directory (hrms.employee.read). Roles
// without it (department managers since V112) get their team roster for the
// day instead (attendance.team.read), which is exactly who they may act for.
import React, { useMemo, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton } from '@/shared/components/hr'
import { ModulePage, Panel, Note, useDesignToast, todayIso } from '@/design/module/ModuleKit'
import { useCompanies } from '../api/useOrg'
import { useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useManualEntry, useTeamDashboard } from '../api/useAttendance'
import { useDebounce } from '@/shared/hooks/useDebounce'

/** A yyyy-MM-dd date and HH:mm time in the browser's zone → the ISO instant the API expects. */
function toIsoInstant(date: string, hhmm: string): string | undefined {
  if (!date || !hhmm) return undefined
  const [h, m] = hhmm.split(':')
  if (h == null || m == null) return undefined
  // `${date}T00:00` parses as local time; new Date(date) alone is UTC midnight.
  const d = new Date(`${date}T00:00`)
  d.setHours(Number(h), Number(m), 0, 0)
  return d.toISOString()
}
const fullName = (e: WorkforceEmployee) => [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ') || e.email
interface PickerEmployee { id: string; code?: string; name: string; employmentStatus?: WorkforceEmployee['employmentStatus'] }
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

export const ManualEntry: React.FC = () => {
  const navigate = useNavigate()
  const { show, node } = useDesignToast()
  const [params] = useSearchParams()
  const today = todayIso()
  const prefillEmployeeId = params.get('employeeId') ?? ''
  const prefillDate = params.get('date') ?? today
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id
  const canReadDirectory = usePermission(P.HRMS_EMPLOYEE_READ)
  const canSaveEntry = usePermission(P.ATTENDANCE_REGULARIZATION_APPROVE)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [employeeId, setEmployeeId] = useState<string>(prefillEmployeeId)
  const [date, setDate] = useState<string>(prefillDate)
  const [checkIn, setCheckIn] = useState<string>('09:00')
  const [checkOut, setCheckOut] = useState<string>('18:00')
  const [reason, setReason] = useState<string>('')
  const { data: page, isLoading: dirLoading, isError: dirError } = useEmployeeDirectory({ companyId, search: debouncedSearch || undefined, pageSize: 100 }, { enabled: canReadDirectory })
  // Team roster when the directory isn't available (no permission, or it failed).
  const useTeam = !canReadDirectory || dirError
  const { data: teamDash, isLoading: teamLoading } = useTeamDashboard(date || undefined, undefined, useTeam)
  const employees: PickerEmployee[] = useMemo(() => {
    if (!useTeam) return (page?.content ?? []).map((e) => ({ id: e.id, code: e.employeeCode, name: fullName(e), employmentStatus: e.employmentStatus }))
    const q = debouncedSearch.trim().toLowerCase()
    return (teamDash?.staffStatuses ?? []).map((s) => ({ id: s.employeeId, code: s.employeeCode, name: s.fullName }))
      .filter((e) => !q || e.name.toLowerCase().includes(q) || (e.code ?? '').toLowerCase().includes(q))
  }, [useTeam, page, teamDash, debouncedSearch])
  const pickerLoading = useTeam ? teamLoading : dirLoading
  useEffect(() => { if (prefillEmployeeId) setEmployeeId(prefillEmployeeId) }, [prefillEmployeeId])
  const selected = useMemo(() => employees.find((e) => e.id === employeeId), [employees, employeeId])
  const manual = useManualEntry()
  const hasPunch = checkIn.trim().length > 0 || checkOut.trim().length > 0
  const canSubmit = canSaveEntry && !!employeeId.trim() && !!date.trim() && !!reason.trim() && hasPunch && !manual.isPending
  const backToMuster = () => navigate(`/hrms/muster-roll${date ? `?date=${date}` : ''}`)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    if (checkIn && checkOut && checkIn >= checkOut) { show('Check-out must be after check-in', true); return }
    try {
      await manual.mutateAsync({ employeeId, attendanceDate: date, checkInAt: toIsoInstant(date, checkIn), checkOutAt: toIsoInstant(date, checkOut), reason: reason.trim() })
      show('Manual entry saved')
      backToMuster()
    } catch (err) { show('Couldn’t save the entry', true, (err as Error)?.message) }
  }

  return (
    <ModulePage crumb="Attendance" title="Manual attendance entry" subtitle="Punch in or out for someone on a given day. Every entry is audit-logged with your name and the reason."
      actions={<HrButton variant="ghost" onClick={backToMuster}>← Muster roll</HrButton>}>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 16, maxWidth: 820 }}>
        {!canSaveEntry && <Note tone="red">Your role can see this form but can’t record manual attendance. It needs the “approve regularization” permission, so ask HR or an admin.</Note>}
        <Panel title="Who" sub={useTeam ? `From your team roster for ${date || 'today'}; your role can’t browse the full directory.` : 'Search the employee directory.'}>
          {selected && <Note tone="green"><strong>{selected.name}</strong>{selected.code ? ` · ${selected.code}` : ''}</Note>}
          {useTeam && employees.length === 0 && !teamLoading ? (
            <Note tone="amber">
              {employeeId ? 'Picked from the muster roll. You can still save this entry.' : <>No one is on your team roster for this date. Open the <button type="button" className="font-semibold underline underline-offset-2" onClick={backToMuster}>muster roll</button> and use “Manual entry” on a row.</>}
            </Note>
          ) : (
            <>
              <input type="search" aria-label="Search employees" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, code or email" className="ut-input" />
              <select aria-label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} size={6} className="ut-input" style={{ height: 'auto', padding: 6 }}>
                {pickerLoading && <option disabled>Loading…</option>}
                {!pickerLoading && employees.length === 0 && <option disabled>No one matches; try another search</option>}
                {employees.map((e) => <option key={e.id} value={e.id}>{`${e.name}${e.code ? ` · ${e.code}` : ''}`}</option>)}
              </select>
            </>
          )}
          {(selected?.employmentStatus === 'EXITED' || selected?.employmentStatus === 'TERMINATED') && (
            <Note tone="amber">{`This employee is ${String(selected.employmentStatus).toLowerCase()}. Backdated attendance is usually only valid before their last working day.`}</Note>
          )}
        </Panel>
        <Panel title="When">
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
            <div><label className={label} htmlFor="me-date">Date</label><input id="me-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} className="ut-input" /></div>
            <div><label className={label} htmlFor="me-in">Check-in</label><input id="me-in" type="time" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className="ut-input" /></div>
            <div><label className={label} htmlFor="me-out">Check-out</label><input id="me-out" type="time" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className="ut-input" /></div>
          </div>
          {!hasPunch && <Note tone="amber">Enter a check-in, a check-out, or both.</Note>}
        </Panel>
        <Panel title="Why" sub="Stored on the record and shown in the audit log.">
          <textarea aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required rows={4} placeholder="e.g. Biometric downtime; in office all day, verified on CCTV." className="ut-input resize-y" />
        </Panel>
        <Note>When the employee has proof, it’s better that they raise a correction themselves. Use this when they can’t, for example during downtime or before they’re enrolled.</Note>
        <div className="flex justify-end gap-3">
          <HrButton type="button" variant="ghost" onClick={() => navigate(-1)}>Cancel</HrButton>
          <HrButton type="submit" disabled={!canSubmit}>{manual.isPending ? 'Saving…' : 'Save entry'}</HrButton>
        </div>
      </form>
      {node}
    </ModulePage>
  )
}

export default ManualEntry
