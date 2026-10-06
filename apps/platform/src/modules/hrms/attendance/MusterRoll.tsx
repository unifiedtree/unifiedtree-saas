// Muster roll (/hrms/muster-roll), rebuilt on the redesign kit (PgTime cp-muster): the statutory
// register of who worked on a day. Live data only: the team dashboard for the day (each person's
// status and punch times) and the attendance event log (raw punches). "Download muster" is the
// day register CSV (GET /v1/attendance/register/export.csv, BW-19; hrms.report.attendance); a server
// without it falls back to today's attendance summary export for the day.
//
// Today, anyone without a punch is "not marked yet" (absent only once the day is over), the same
// rule Daily Logs and My team use. The register lists everyone on the roll that day: people on their
// weekly off as "Weekly off" (never counted as absent), and a company-wide viewer's own row, so it is
// the same register whoever opens it (includeWeeklyOff / includeSelf, as the downloaded file has it).
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission, P } from '@unifiedtree/sdk'
import {
  Button, CellPerson, PageFrame, PageHeader, Section, StatusPill, Table, type StatusTone, type TableColumn,
} from '@/design/kit/display'
import { Input, Select, useToast } from '@/design/kit/overlays'
import { addDays, fmtLong, istToday } from '@/design/dc/dates'
import { apiBlob, HttpError } from '@/core/api/client'
import { saveServerFile } from '@/shared/export/fileExport'
import { useDepartments } from '../api/useOrg'
import { useCurrentCompany } from '../company/CurrentCompany'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { useTeamDashboard, useAttendanceLogs, type StaffStatusResponse } from '../api/useAttendance'
import { hhmmIst, hm, rowStatus, statusOnDay, workedMinutes } from './daily/dailyModel'
import './daily/daily.css'

/** The day's split, in the design's order. */
const SPLIT: { key: string; label: string; tone: StatusTone; dot: string }[] = [
  { key: 'PRESENT', label: 'Present', tone: 'success', dot: 'var(--u-br, #0F6E56)' },
  { key: 'LATE', label: 'Late', tone: 'amber', dot: 'var(--u-gd, #C8912E)' },
  { key: 'HALF_DAY', label: 'Half day', tone: 'warning', dot: 'var(--u-gd, #C8912E)' },
  { key: 'ON_LEAVE', label: 'On leave', tone: 'leave', dot: 'var(--u-k-leave, #3B6FD9)' },
  { key: 'WFH', label: 'Work from home', tone: 'mint', dot: 'var(--u-k-wfh, #3B6FD9)' },
  { key: 'NOT_MARKED', label: 'Not marked yet', tone: 'neutral', dot: 'var(--u-gy, #C9D2CE)' },
  { key: 'ABSENT', label: 'Absent', tone: 'danger', dot: 'var(--u-rd, #C4453A)' },
  { key: 'WEEKLY_OFF', label: 'Weekly off', tone: 'muted', dot: 'var(--u-gy, #C9D2CE)' },
]
const LABEL: Record<string, { label: string; tone: StatusTone }> = Object.fromEntries(SPLIT.map((s) => [s.key, { label: s.label, tone: s.tone }]))
LABEL.HOLIDAY = { label: 'Holiday', tone: 'holiday' }
LABEL.NOT_TRACKED = { label: 'Not tracked', tone: 'muted' }

interface Row { id: string; name: string; code: string; dept: string; shift: string; inAt?: string; outAt?: string; worked: number | null; status: string; punches: number }
/** The whole roll for the day: weekly offs listed, and the viewer's own row (company-wide viewers). */
const REGISTER = { includeWeeklyOff: true, includeSelf: true } as const

export function MusterRoll() {
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const [params] = useSearchParams()
  const asked = params.get('date') || ''
  const [date, setDate] = useState(/^\d{4}-\d{2}-\d{2}$/.test(asked) && asked <= today ? asked : today)
  const [deptId, setDeptId] = useState('')
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)
  const canExport = usePermission(P.HRMS_REPORT_ATTENDANCE)
  const canManual = usePermission('attendance.workforce.admin')
  const { companyId } = useCurrentCompany()
  const { data: departments = [] } = useDepartments(companyId)
  const { data: me } = useCurrentUser()
  const dash = useTeamDashboard(date, deptId || undefined, true, false, REGISTER)
  const all = useTeamDashboard(date, undefined, true, false, REGISTER)
  const logs = useAttendanceLogs(date, deptId || undefined)
  const isToday = date === today

  const punches = useMemo(() => {
    const m = new Map<string, number>()
    for (const ev of logs.data ?? []) m.set(ev.employeeId, (m.get(ev.employeeId) ?? 0) + 1)
    return m
  }, [logs.data])
  const rows: Row[] = useMemo(() => (dash.data?.staffStatuses ?? []).map((s: StaffStatusResponse) => ({
    id: s.employeeId, name: s.fullName?.trim() || s.employeeCode || 'Employee', code: s.employeeCode, dept: s.departmentName || '—',
    shift: s.shiftName || '—', inAt: s.checkInAt, outAt: s.checkOutAt,
    worked: s.workedMinutes ?? workedMinutes(s.checkInAt, s.checkOutAt, isToday ? Date.now() : undefined),
    // Today nobody is absent yet: no punch and no leave is "not marked yet" until the day is over (client rule).
    status: isToday && rowStatus(s) === 'ABSENT' ? 'NOT_MARKED' : statusOnDay(rowStatus(s), isToday), punches: punches.get(s.employeeId) ?? 0,
  })).sort((a, b) => a.name.localeCompare(b.name)), [dash.data, punches, isToday])
  const shown = rows.filter((r) => { const t = q.trim().toLowerCase(); return !t || `${r.name} ${r.code} ${r.dept}`.toLowerCase().includes(t) })
  const split = SPLIT.filter((s) => (isToday ? s.key !== 'ABSENT' : s.key !== 'NOT_MARKED')).map((s) => ({ ...s, n: rows.filter((r) => r.status === s.key).length }))

  // Departments: the org list plus the ones on the day's roster (for roles without org reads).
  const deptOptions = useMemo(() => {
    const byId = new Map<string, string>()
    for (const d of departments) byId.set(d.id, d.name)
    for (const s of all.data?.staffStatuses ?? []) if (s.departmentId && !byId.has(s.departmentId)) byId.set(s.departmentId, s.departmentName?.trim() || 'Unnamed department')
    return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [departments, all.data])
  const deptName = deptOptions.find((d) => d.value === deptId)?.label

  const download = async () => {
    if (exporting) return
    setExporting(true)
    try {
      let blob: Blob
      try {
        blob = await apiBlob(`/v1/attendance/register/export.csv?${new URLSearchParams({ date, ...(deptId ? { departmentId: deptId } : {}) })}`)
      } catch (e) {
        // A server without the day register: today's attendance summary export for the day.
        if (!(e instanceof HttpError && e.status === 404) || !companyId) throw e
        blob = await apiBlob(`/v1/reports/attendance-summary/export.csv?${new URLSearchParams({ companyId, from: date, to: date })}`)
      }
      saveServerFile(`muster-roll-${date}.csv`, blob)
      toast.success('Muster roll downloaded')
    } catch (e) {
      toast.error('Couldn’t download the muster roll', { detail: (e as Error)?.message })
    } finally { setExporting(false) }
  }

  const columns: TableColumn<Row>[] = [
    { key: 'who', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.name} sub={[r.code, r.dept !== '—' ? r.dept : null].filter(Boolean).join(' · ')} /> },
    { key: 'shift', header: 'Shift', render: (r) => r.shift },
    { key: 'in', header: 'In', render: (r) => <span className="udt-num">{hhmmIst(r.inAt)}</span> },
    { key: 'out', header: 'Out', render: (r) => <span className="udt-num">{hhmmIst(r.outAt)}</span> },
    { key: 'hours', header: 'Hours', render: (r) => <span className="udt-num">{r.worked != null ? hm(r.worked) : '—'}</span> },
    { key: 'punches', header: 'Punches', numeric: true, render: (r) => (r.punches ? r.punches : '—') },
    { key: 'status', header: 'Status', render: (r) => { const m = LABEL[r.status] || { label: r.status, tone: 'neutral' as StatusTone }; return <StatusPill tone={m.tone}>{m.label}</StatusPill> } },
    ...(canManual ? [{
      // Nobody records manual attendance for themselves (the server refuses it), so your own row has none.
      key: 'act', header: <span className="uk-sr">Manual entry</span>, label: 'Manual entry', align: 'right' as const, render: (r: Row) => (r.id === me?.employeeId ? null : (
        <Button size={30} variant="ghost" aria-label={`Manual entry for ${r.name}`}
          onClick={() => navigate(`/hrms/attendance/manual-entry?employeeId=${encodeURIComponent(r.id)}&date=${encodeURIComponent(date)}`)}>Manual entry</Button>
      )),
    }] : []),
  ]

  return (
    <PageFrame label="Muster roll" className="udt">
      <PageHeader eyebrow="Attendance & time" title="Muster roll"
        sub={`${fmtLong(date)} · ${deptName || 'all departments'} · statutory register of who worked.`}
        actions={<>
          <Button onClick={() => setDate(addDays(date, -1))}>Previous day</Button>
          {!isToday && <Button onClick={() => setDate(addDays(date, 1) > today ? today : addDays(date, 1))}>Next day</Button>}
          {canExport && <Button variant="primary" icon="download" loading={exporting} onClick={() => void download()}>Download muster</Button>}
        </>} />
      <div className="udt-filters">
        <Input label="Date" type="date" value={date} max={today} onChange={(e) => { if (e.target.value) setDate(e.target.value) }} size="md" />
        {deptOptions.length > 0 && (
          <Select label="Department" size="md" value={deptId} onChange={(e) => setDeptId(e.target.value)} options={[{ value: '', label: 'All departments' }, ...deptOptions]} />
        )}
      </div>
      <Section title="How the day splits" sub={isToday ? 'So far today; people without a punch are “not marked yet” until the day is over.' : 'Everyone on the roster for this day.'}
        variant="section" body="tight" loading={dash.isLoading} skeleton="stats" error={dash.isError ? dash.error : undefined} onRetry={() => void dash.refetch()}>
        <ul className="umr-split" aria-label="How the day splits">
          {split.map((s) => (
            <li key={s.key} className="umr-tile">
              <span className="umr-tile__label"><span className="umr-dot" style={{ background: s.dot }} aria-hidden="true" />{s.label}</span>
              <span className="umr-tile__n">{s.n}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="On the roster" count={rows.length} variant="section" body="flush"
        sub={`${shown.length} of ${rows.length} shown · ${(logs.data ?? []).length} punches logged`}
        actions={<input className="udt-search" type="search" aria-label="Search the roster" placeholder="Search name, code or department" value={q} onChange={(e) => setQ(e.target.value)} />}
        error={dash.isError ? dash.error : undefined} onRetry={() => void dash.refetch()}>
        <Table<Row> label="On the roster" columns={columns} rows={shown} rowKey={(r) => r.id} loading={dash.isLoading} mobile="cards" minWidth={760}
          empty={rows.length === 0 ? 'No one on the roster for this day.' : 'No one matches your search.'} />
      </Section>
      {!canExport && <p className="udt-q">Downloading the register needs the attendance report permission.</p>}
    </PageFrame>
  )
}
