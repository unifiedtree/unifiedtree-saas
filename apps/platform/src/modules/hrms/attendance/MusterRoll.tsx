// Muster roll (/hrms/muster-roll): the daily attendance register, on the
// module kit. Everything comes from two live endpoints: the team dashboard
// (per-person status and counts for a date) and the attendance event log (raw
// punches for the same date).
//
// Today, the API counts anyone without a punch as "absent" (absent = no punch
// and no leave so far). Until the day is over that is "not marked yet", so the
// page says that for today, the same as My team.
import React, { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrStatusPill, TableCard, HrButton, HrAvatar, type PillTone } from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { apiBlob } from '@/core/api/client'
import { saveAndRecord } from '@/shared/export/fileExport'
import { ModulePage, StatRow, State, Panel, Note, useDesignToast, todayIso } from '@/design/module/ModuleKit'
import { DonutChart } from '../reports/ReportKit'
import { dashIcon } from '@/design/dc/icons'
import { useCompanies, useDepartments } from '../api/useOrg'
import { useTeamDashboard, useAttendanceLogs, type StaffStatusResponse } from '../api/useAttendance'

const COLOR = { present: '#10b981', late: '#f59e0b', halfDay: '#06b6d4', onLeave: '#8b5cf6', wfh: '#2563eb', absent: '#ef4444', notMarked: '#94a3b8' }

function statusMeta(status: string | undefined, today: boolean): { tone: PillTone; label: string } {
  const s = (status ?? '').toUpperCase()
  switch (s) {
    case 'PRESENT': return { tone: 'ok', label: 'Present' }
    case 'LATE': return { tone: 'late', label: 'Late' }
    case 'HALF_DAY': case 'HALFDAY': return { tone: 'teal', label: 'Half day' }
    case 'ON_LEAVE': case 'LEAVE': return { tone: 'purple', label: 'On leave' }
    case 'WORK_FROM_HOME': case 'WFH': return { tone: 'blue', label: 'Work from home' }
    case 'ABSENT': return today ? { tone: 'gray', label: 'Not marked yet' } : { tone: 'red', label: 'Absent' }
    case 'NOT_MARKED': case 'NOTMARKED': case '': return { tone: 'gray', label: today ? 'Not marked yet' : 'Not marked' }
    case 'HOLIDAY': return { tone: 'purple', label: 'Holiday' }
    case 'WEEKLY_OFF': return { tone: 'gray', label: 'Weekly off' }
    case 'NOT_TRACKED': return { tone: 'gray', label: 'Not tracked' }
    default: return { tone: 'info', label: s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }
  }
}
/**
 * The day's effective status (company attendance policy + reviewers' changes,
 * V143.10) when the server sends it; otherwise a punch beats a stale ABSENT and
 * approved leave without a punch reads as leave.
 */
const rowStatus = (s: StaffStatusResponse) => {
  if (s.effectiveStatus) return s.effectiveStatus === 'PRESENT' && s.attendanceType === 'WFH' ? 'WFH' : s.effectiveStatus
  const st = (s.status ?? '').toUpperCase(); if (s.checkInAt && (st === 'ABSENT' || st === 'NOT_MARKED' || !st)) return 'PRESENT'; if (!s.checkInAt && s.onLeave) return 'ON_LEAVE'; return s.status
}
const fullName = (s: StaffStatusResponse) => s.fullName?.trim() || s.employeeCode || 'Employee'
const fmtTime = (iso?: string) => { if (!iso) return '—'; try { return format(parseISO(iso), 'h:mm a') } catch { return '—' } }

export const MusterRoll: React.FC = () => {
  const { show, node } = useDesignToast()
  const navigate = useNavigate()
  const today = todayIso()
  // ?date= (Manual entry comes back here with the day it saved).
  const [params] = useSearchParams()
  const asked = params.get('date') || ''
  const [date, setDate] = useState<string>(/^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today)
  const [deptId, setDeptId] = useState<string>('')
  const [search, setSearch] = useState('')
  const [exporting, setExporting] = useState(false)
  // The export route is @perm.check('hrms.report.attendance'); the button follows it.
  const canExport = usePermission(P.HRMS_REPORT_ATTENDANCE)
  // Saving a manual entry needs attendance.workforce.admin (V143.5); the row shortcut follows it.
  const canManual = usePermission('attendance.workforce.admin')
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: departments = [] } = useDepartments(companyId)
  const { data: dashboard, isLoading, isFetching, error, refetch } = useTeamDashboard(date, deptId || undefined)
  // The unfiltered roster for the same day (same query key when no department is picked).
  const { data: rosterAll } = useTeamDashboard(date)
  const { data: logs = [], refetch: refetchLogs } = useAttendanceLogs(date, deptId || undefined)
  const counts = dashboard?.counts
  const staff = useMemo(() => dashboard?.staffStatuses ?? [], [dashboard])
  const isToday = date === today

  // Department options: the org list (needs org reads) plus the departments on
  // the roster itself (arrives with attendance.team.read), so the filter works
  // for every role the route admits and for multi-company tenants.
  const departmentOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const d of departments) byId.set(d.id, d.name)
    for (const s of rosterAll?.staffStatuses ?? []) if (s.departmentId && !byId.has(s.departmentId)) byId.set(s.departmentId, s.departmentName?.trim() || 'Unnamed department')
    if (deptId && !byId.has(deptId)) byId.set(deptId, 'Selected department')
    return [...byId.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  }, [departments, rosterAll, deptId])

  const punchByEmp = useMemo(() => {
    const m = new Map<string, number>()
    for (const ev of logs) m.set(ev.employeeId, (m.get(ev.employeeId) ?? 0) + 1)
    return m
  }, [logs])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = q ? staff.filter((s) => fullName(s).toLowerCase().includes(q) || (s.employeeCode ?? '').toLowerCase().includes(q) || (s.departmentName ?? '').toLowerCase().includes(q)) : staff
    return [...rows].sort((a, b) => fullName(a).localeCompare(fullName(b)))
  }, [staff, search])
  const parts = counts ? [
    { label: 'Present', value: counts.present, color: COLOR.present },
    { label: 'Late', value: counts.late, color: COLOR.late },
    { label: 'Half day', value: counts.halfDay, color: COLOR.halfDay },
    { label: 'On leave', value: counts.onLeave, color: COLOR.onLeave },
    { label: 'Work from home', value: counts.workFromHome, color: COLOR.wfh },
    // absent = no punch and not on leave (notMarked also counts people on leave, who are above).
    isToday ? { label: 'Not marked yet', value: counts.absent, color: COLOR.notMarked } : { label: 'Absent', value: counts.absent, color: COLOR.absent },
  ].filter((p) => p.value > 0) : []

  const shiftDay = (delta: number) => { const d = parseISO(date); d.setDate(d.getDate() + delta); setDate(format(d, 'yyyy-MM-dd')) }
  const onRefresh = () => { refetch(); refetchLogs(); show('Muster roll refreshed') }
  // GET /v1/reports/attendance-summary/export.csv takes companyId/from/to only;
  // the department filter isn't sent (it would be ignored), and we say so.
  const onExportCsv = async () => {
    if (exporting) return
    if (!companyId) { show('No company is visible to your role, so the register can’t be exported', true); return }
    setExporting(true)
    try {
      const blob = await apiBlob(`/v1/reports/attendance-summary/export.csv?${new URLSearchParams({ companyId, from: date, to: date })}`)
      saveAndRecord(`muster-roll-${date}.csv`, blob, { report: 'Muster roll', fmt: 'CSV', company: companies[0]?.name })
      show('Muster roll exported', false, deptId ? 'The CSV covers every department; the export has no department filter.' : undefined)
    } catch (err) { show('Couldn’t export the muster roll', true, (err as Error)?.message) } finally { setExporting(false) }
  }

  return (
    <ModulePage crumb="Attendance" title="Muster roll" subtitle="The daily attendance register: everyone’s status and punch times for the day you pick."
      actions={<>
        <HrButton variant="ghost" onClick={onRefresh} disabled={isFetching}>{dashIcon('clock', 15)} {isFetching ? 'Refreshing…' : 'Refresh'}</HrButton>
        {canExport && <HrButton onClick={onExportCsv} disabled={exporting || !companyId}>{dashIcon('download', 15)} {exporting ? 'Exporting…' : 'Export CSV'}</HrButton>}
      </>}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        <Panel pad={14}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <HrButton size="sm" variant="ghost" aria-label="Previous day" onClick={() => shiftDay(-1)}>←</HrButton>
            <input type="date" aria-label="Date" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} className="ut-input h-9 w-44" />
            <HrButton size="sm" variant="ghost" aria-label="Next day" onClick={() => shiftDay(1)} disabled={isToday}>→</HrButton>
            {!isToday && <HrButton size="sm" variant="ghost" onClick={() => setDate(today)}>Today</HrButton>}
            <strong style={{ fontSize: 14, marginLeft: 6 }}>{format(parseISO(date), 'EEEE, d MMMM yyyy')}</strong>
            <span style={{ flex: 1 }} />
            {departmentOptions.length === 0
              ? <span title="No departments are readable for your role, or none have staff on this date." style={{ fontSize: 13, color: '#94a3b8' }}>No departments to filter by</span>
              : (
                <select aria-label="Department" value={deptId} onChange={(e) => setDeptId(e.target.value)} className="ut-select ut-select-sm w-56">
                  <option value="">All departments</option>
                  {departmentOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
          </div>
        </Panel>

        {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
          { icon: 'users', color: 'blue', label: 'On the roster', value: String(staff.length), sub: 'People in scope' },
          { icon: 'userCheck', color: 'green', label: 'Present', value: String(counts?.present ?? 0), sub: counts ? `${counts.workFromHome} working from home` : undefined },
          { icon: 'clock', color: 'orange', label: 'Late', value: String(counts?.late ?? 0), sub: counts ? `${counts.halfDay} half day` : undefined },
          isToday
            ? { icon: 'help', color: 'purple', label: 'Not marked yet', value: String(counts?.absent ?? 0), sub: counts ? `No punch and not on leave · ${counts.onLeave} on leave` : undefined }
            : { icon: 'userX', color: 'red', label: 'Absent', value: String(counts?.absent ?? 0), sub: counts ? `${counts.onLeave} on leave` : undefined },
        ]} />}

        {!isLoading && parts.length > 0 && (
          <Panel title="How the day splits" sub={isToday ? 'So far today; people without a punch are "not marked yet" until the day is over.' : 'Everyone on the roster for this day.'}>
            <DonutChart parts={parts} centerLabel="People" />
          </Panel>
        )}

        <TableCard search={{ value: search, onChange: setSearch, placeholder: 'Search name, code or department' }}
          footer={<div className="flex items-center justify-between text-xs text-text-tertiary"><span>{`${filtered.length} of ${staff.length} shown`}</span><span>{`${logs.length} punches logged`}</span></div>}>
          {error ? <State kind="error" title="Couldn’t load the muster roll for this day" description={(error as Error)?.message} onRetry={() => refetch()} /> : (
            <DataTable
              columns={[
                { key: 'employee', header: 'Employee', render: (s) => <HrAvatar name={fullName(s)} sub={[s.employeeCode, s.jobTitle].filter(Boolean).join(' · ') || undefined} /> },
                { key: 'department', header: 'Department', render: (s) => <span className="text-text-secondary">{s.departmentName ?? '—'}</span> },
                { key: 'status', header: 'Status', render: (s) => { const m = statusMeta(rowStatus(s), isToday); return <HrStatusPill tone={m.tone}>{m.label}</HrStatusPill> } },
                { key: 'in', header: 'In', render: (s) => <span className="font-medium text-text-primary tabular-nums">{fmtTime(s.checkInAt)}</span> },
                { key: 'out', header: 'Out', render: (s) => <span className="font-medium text-text-primary tabular-nums">{fmtTime(s.checkOutAt)}</span> },
                { key: 'location', header: 'Location', render: (s) => <span className="text-text-secondary">{s.locationName ?? '—'}</span> },
                { key: 'punches', header: 'Punches', render: (s) => { const p = punchByEmp.get(s.employeeId) ?? 0; return <div className="text-right tabular-nums text-text-secondary">{p > 0 ? p : '—'}</div> } },
                ...(canManual ? [{ key: 'actions', header: '', render: (s: StaffStatusResponse) => (
                  <div className="text-right">
                    <HrButton size="sm" variant="ghost" aria-label={`Manual entry for ${fullName(s)}`} onClick={() => navigate(`/hrms/attendance/manual-entry?employeeId=${encodeURIComponent(s.employeeId)}&date=${encodeURIComponent(date)}`)}>Manual entry</HrButton>
                  </div>
                ) }] : []),
              ]}
              data={filtered}
              keyField="employeeId"
              loading={isLoading}
              emptyMessage={staff.length === 0 ? 'No one on the roster for this day.' : 'No one matches your search.'}
            />
          )}
        </TableCard>
        {!canExport && <Note>Exporting the register needs the attendance report permission.</Note>}
      </div>
      {node}
    </ModulePage>
  )
}
