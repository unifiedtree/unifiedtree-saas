// Daily Logs = the design's "Today" (PgAttendance): the day's numbers as filter cards, everyone's
// check-in with how and where it was made, what needs attention, and check-ins by branch.
// Real data only: GET /v1/attendance/dashboard?date= (with the roster facts of BW-13), yesterday's
// for the "vs yesterday" notes, the review list (BW-14) and the sent reminders (BW-10).
//
// Actions, each with its endpoint's permission: Export the day register (hrms.report.attendance,
// BW-19), Mark attendance for several people (attendance.workforce.admin, BW-17), Punch for a team
// member with their face (attendance.assisted_punch.team|any), Remind the people not marked yet
// (attendance.team.read, BW-10), and per person: Change status (attendance.status.override),
// Fix this day (manual entry), View history, Open full profile.
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Button, CellPerson, PageHeader, ProgressBar, Section, StatCard, StatGrid, StatusPill, Table,
  type TableColumn, type RowKey,
} from '@/design/kit/display'
import { BulkBar, DateChip } from '@/design/kit/data'
import { Menu, Select, SidePanel, useToast } from '@/design/kit/overlays'
import { addDays, fmtLong, fmtShort, fmtWd, istToday } from '@/design/dc/dates'
import { dashIcon } from '@/design/dc/icons'
import { apiBlob } from '@/core/api/client'
import { saveServerFile } from '@/shared/export/fileExport'
import { useCompanies } from '../../api/useOrg'
import { useTeamDashboard, type StaffStatusResponse } from '../../api/useAttendance'
import { useChangeDayStatus, useReviewExceptions, statusLabel } from '../../api/useAttendanceReview'
import { useAssistedPunches, punchedByMap } from '../../api/useAssistedPunches'
import { useShiftPolicies } from '../../api/useShiftPolicies'
import { useReminders, useSendReminders } from '../../api/shared/useReminders'
import { StatusChangeDrawer, type StatusTarget } from '../StatusChangeDrawer'
import { AssistedPunchDialog } from '../webpunch/AssistedPunchDialog'
import { BulkMarkPanel } from './BulkMarkPanel'
import { MarkLeavePanel } from './MarkLeavePanel'
import type { DailyPerms } from './DailyTracking'
import {
  TILE_KEYS, byBranch, hhmmIst, hm, inStatus, leaveLine, mainShift, methodLabel, rowStatus, statusMeta, statusOnDay, tileKeyOf,
  versus, workedMinutes, type TileKey,
} from './dailyModel'

export interface LogRow {
  id: string; code: string; name: string; dept: string; branch: string | null
  shiftName: string | null; shiftStart: string | null; shiftEnd: string | null; grace: number | null; shiftMinutes: number | null
  status: string; effective: string | null; note: string | null; manual: boolean
  inAt: string | null; outAt: string | null; late: number; earlyOut: boolean
  how: string; leave: string | null; pendingLeave: boolean; worked: number | null
  punchedBy: string | null; punchedByDetail: string | null; outside: boolean; rejected: boolean
}

const CARD: Record<TileKey, { label: string; icon: string; tone: 'brand' | 'gold' | 'red' | 'gray' }> = {
  PRESENT: { label: 'Present', icon: 'userCheck', tone: 'brand' },
  LATE: { label: 'Late', icon: 'clock', tone: 'gold' },
  WFH: { label: 'Work from home', icon: 'home', tone: 'brand' },
  ON_LEAVE: { label: 'On leave', icon: 'calendarDays', tone: 'gray' },
  ABSENT: { label: 'Absent', icon: 'userX', tone: 'red' },
  NOT_MARKED: { label: 'Not marked', icon: 'help', tone: 'gray' },
}
const PAGE = 50
const hhmm = (t?: string | null) => (t ? t.slice(0, 5) : null)

export function DailyLogs({ perms }: { perms: DailyPerms }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const toast = useToast()
  const today = istToday()
  const askedDate = params.get('date') || ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(askedDate) && askedDate <= today ? askedDate : today
  const isToday = date === today
  const status = tileKeyOf(params.get('status') || '')

  const [q, setQ] = useState('')
  const [dept, setDept] = useState('')
  const [shift, setShift] = useState('')
  const [page, setPage] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)
  const [selected, setSelected] = useState<RowKey[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [assist, setAssist] = useState<{ employeeId?: string } | null>(null)
  const [target, setTarget] = useState<StatusTarget | null>(null)
  const [leaveFor, setLeaveFor] = useState<{ id: string; name: string } | null>(null)
  const [exporting, setExporting] = useState(false)

  // ── data ──
  const { data: companies = [] } = useCompanies()
  const companyId: string = companies[0]?.id ?? ''
  const team = useTeamDashboard(date, undefined, perms.team, !isToday)
  const before = useTeamDashboard(addDays(date, -1), undefined, perms.team, true)
  const policies = useShiftPolicies(companyId)
  const assisted = useAssistedPunches(date, date, undefined, perms.team)
  const weekAgo = addDays(today, -6)
  const review = useReviewExceptions(weekAgo, today, perms.team && perms.review)
  const reminders = useReminders(isToday ? date : undefined, { enabled: perms.team && isToday })
  const remind = useSendReminders()
  const changeStatus = useChangeDayStatus()

  const policyByName = useMemo(() => new Map((policies.data ?? []).map((p) => [p.name, p])), [policies.data])
  const rows: LogRow[] = useMemo(() => {
    const by = punchedByMap(assisted.data, (p) => (p.attendanceDate === date ? p.employeeId : null))
    const now = Date.now()
    return (team.data?.staffStatuses ?? []).map((s: StaffStatusResponse) => {
      const sp = s.shiftName ? policyByName.get(s.shiftName) : undefined
      const start = sp ? hhmm(sp.startTime) : s.expectedCheckInAt ? hhmmIst(s.expectedCheckInAt) : null
      const end = sp ? hhmm(sp.endTime) : null
      const st = statusOnDay(rowStatus(s), isToday)
      const method = methodLabel(s.checkInMethod)
      const how = s.punchRejected ? 'Face punch rejected by HR'
        : s.checkInAt ? [method, s.locationName || s.branchName].filter(Boolean).join(' · ') + (s.outsideGeofence ? ' · outside the zone' : '') || 'Checked in'
          : s.onLeave ? leaveLine(s) : isToday ? 'No punch yet' : 'No punch · no leave'
      return {
        id: s.employeeId, code: s.employeeCode, name: s.fullName, dept: s.departmentName || '—', branch: s.branchName || null,
        shiftName: s.shiftName || null, shiftStart: start, shiftEnd: end, grace: s.graceMinutes ?? sp?.gracePeriodMinutes ?? null,
        shiftMinutes: sp?.workingHoursPerDay ? Math.round(sp.workingHoursPerDay * 60) : null,
        status: st, effective: s.effectiveStatus || null, note: s.statusNote || null, manual: !!s.statusManual,
        inAt: s.checkInAt || null, outAt: s.checkOutAt || null, late: s.lateByMinutes || 0, earlyOut: !!s.earlyCheckout,
        how, leave: s.onLeave ? leaveLine(s) : null, pendingLeave: !!s.pendingLeave,
        worked: s.workedMinutes ?? workedMinutes(s.checkInAt, s.checkOutAt, isToday ? now : undefined),
        punchedBy: by.get(s.employeeId)?.short || null, punchedByDetail: by.get(s.employeeId)?.detail || null,
        outside: !!s.outsideGeofence, rejected: !!s.punchRejected,
      }
    })
  }, [team.data, assisted.data, policyByName, date, isToday])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const k of [...TILE_KEYS, 'EARLY_OUT']) c[k] = rows.filter((r) => inStatus(r.status, k, r.earlyOut)).length
    return c
  }, [rows])
  const yesterday = useMemo(() => {
    const list = before.data?.staffStatuses
    if (!list) return null
    const c: Record<string, number> = {}
    for (const k of TILE_KEYS) c[k] = list.filter((s) => inStatus(statusOnDay(rowStatus(s), false), k, !!s.earlyCheckout)).length
    return c
  }, [before.data])

  const departments = useMemo(() => [...new Set(rows.map((r) => r.dept).filter((d) => d && d !== '—'))].sort(), [rows])
  const shifts = useMemo(() => [...new Set(rows.map((r) => r.shiftName).filter(Boolean) as string[])].sort(), [rows])
  const filtered = useMemo(() => {
    const text = q.trim().toLowerCase()
    return rows.filter((r) => (!status || inStatus(r.status, status, r.earlyOut)) && (!dept || r.dept === dept) && (!shift || r.shiftName === shift)
      && (!text || `${r.name} ${r.code}`.toLowerCase().includes(text)))
  }, [rows, status, dept, shift, q])
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE)
  const notMarked = rows.filter((r) => r.status === 'NOT_MARKED')
  const sentIds = new Set((reminders.data ?? []).map((r) => r.employeeId))

  const setStatus = (k: string) => {
    const next = new URLSearchParams(params)
    if (k && k !== status) next.set('status', k); else next.delete('status')
    next.set('tab', 'team')
    setParams(next, { replace: true }); setPage(0)
  }
  const setDate = (iso: string) => {
    const next = new URLSearchParams(params)
    next.set('tab', 'team')
    if (iso && iso !== today) next.set('date', iso); else next.delete('date')
    setParams(next, { replace: true }); setPage(0); setSelected([])
  }

  const exportDay = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await apiBlob(`/v1/attendance/register/export.csv?date=${date}`)
      saveServerFile(`muster-roll-${date}.csv`, blob)
      toast.success('Day register downloaded')
    } catch (e) {
      toast.error('Couldn’t download the day register', { detail: (e as Error)?.message })
    } finally { setExporting(false) }
  }
  const sendReminders = (ids: string[]) => {
    if (!ids.length) return
    remind.mutateAsync({ date, reason: 'NOT_CHECKED_IN', employeeIds: ids })
      .then((r) => {
        if (!r.available) { toast.info('Reminders aren’t switched on yet.'); return }
        const list = r.value
        const sent = list.filter((x) => x.outcome === 'SENT').length, already = list.filter((x) => x.outcome === 'ALREADY_SENT').length
        toast.success(sent ? `Reminded ${sent} ${sent === 1 ? 'person' : 'people'}${already ? ` · ${already} already reminded` : ''}` : already ? 'They were already reminded today' : 'Nobody needed a reminder')
      })
      .catch((e) => toast.error('Couldn’t send the reminders', { detail: (e as Error)?.message }))
  }
  const openStatus = (r: LogRow) => setTarget({
    kind: 'status', employeeId: r.id, name: r.name, sub: `${r.code} · ${r.dept}`, date, status: r.effective || (r.status === 'WFH' ? 'PRESENT' : r.status),
    note: r.note, manual: r.manual, facts: [{ k: 'Came in', v: hhmmIst(r.inAt) }, { k: 'Left', v: hhmmIst(r.outAt) }],
  })
  // The status drawer: a day's new status, with the reason the person is told.
  const saveStatus = (t: StatusTarget, next: string, reason: string) =>
    changeStatus.mutateAsync({ employeeId: t.employeeId, date: t.date, status: next, reason })
      .then((d) => {
        const first = t.name.split(' ')[0]
        toast.success(next === 'EXCUSE' ? `Excused — ${first}’s day counts as present` : `${first}’s day is now ${statusLabel(d.status).toLowerCase()}`)
        return true
      })
      .catch((e) => { toast.error('Couldn’t change the status', { detail: (e as Error)?.message }); return false })
  const fixDay = (r: LogRow) => navigate(`/hrms/attendance/manual-entry?employeeId=${r.id}&date=${date}`)

  // ── header ──
  const main = mainShift(rows.map((r) => ({ shiftName: r.shiftName, start: r.shiftStart, end: r.shiftEnd, grace: r.grace })))
  const sub = [isToday ? fmtLong(date) : fmtLong(date), main, 'all branches'].filter(Boolean).join(' · ')
  const actions = (
    <>
      {perms.report && <Button icon="download" onClick={() => void exportDay()} loading={exporting}>Export</Button>}
      {perms.admin && <Button icon="pencil" onClick={() => navigate(`/hrms/attendance/manual-entry?date=${date}`)}>Manual entry</Button>}
      {perms.assist && isToday && (
        <Button variant={perms.admin ? 'secondary' : 'primary'} icon="scanFace" onClick={() => setAssist({})}>Punch for a team member</Button>
      )}
      {perms.admin && (
        <Button variant="primary" icon="userCheck" onClick={() => setBulkOpen(true)}
          title={selected.length ? `Mark attendance for the ${selected.length} people you picked` : 'Pick people in the table, or choose them in the panel'}>
          Mark attendance
        </Button>
      )}
    </>
  )

  // ── the six cards ──
  const loading = team.isLoading
  const cardNote = (k: TileKey) => {
    if (k === 'PRESENT') { const onTime = rows.filter((r) => r.status === 'PRESENT').length; return `${onTime} on time` }
    if (k === 'WFH') { const sched = rows.filter((r) => r.status !== 'ON_LEAVE' && r.status !== 'HOLIDAY' && r.status !== 'WEEKLY_OFF').length; return `${sched ? Math.round((counts.WFH / sched) * 100) : 0}% of scheduled` }
    if (k === 'ON_LEAVE') { const p = rows.filter((r) => r.pendingLeave).length; return p ? `approved · ${p} waiting` : 'approved' }
    if (k === 'NOT_MARKED') return 'no punch yet'
    const v = versus(counts[k], yesterday?.[k])
    return v && v.delta === '0' ? 'same as yesterday' : 'vs yesterday'
  }
  const cards = TILE_KEYS.filter((k) => isToday || k !== 'NOT_MARKED').map((k, i) => {
    const v = k === 'LATE' || k === 'ABSENT' ? versus(counts[k], yesterday?.[k]) : null
    return (
      <StatCard key={k} variant="stat" label={CARD[k].label} icon={CARD[k].icon} tone={CARD[k].tone} index={i}
        value={team.isError ? null : counts[k]} note={cardNote(k)} loading={loading}
        delta={v && v.delta !== '0' ? v.delta : undefined} trend={v?.trend} mood={v?.mood}
        active={status === k} onClick={() => setStatus(k)}
        ariaLabel={`${CARD[k].label} ${counts[k] ?? ''}${status === k ? ', showing now' : ''}`} />
    )
  })

  // ── table ──
  const columns: TableColumn<LogRow>[] = [
    { key: 'name', header: 'Employee', primary: true, render: (r) => <CellPerson name={r.name} sub={[r.code, r.dept !== '—' ? r.dept : null, r.punchedBy ? `Punched by ${r.punchedBy}` : null].filter(Boolean).join(' · ')} /> },
    { key: 'shift', header: 'Shift', render: (r) => <span className="udt-two"><span>{r.shiftName || 'No shift yet'}</span>{r.shiftName && r.shiftStart && <span className="udt-q">{r.shiftStart}{r.shiftEnd ? `–${r.shiftEnd}` : ''}</span>}</span> },
    {
      key: 'in', header: 'Check-in', render: (r) => (
        <span className="udt-two">
          <span className="udt-num">{hhmmIst(r.inAt)}{r.late > 0 && <span className="udt-late">+{r.late}m</span>}</span>
          <span className="udt-q udt-clip" title={r.how}>{r.how}</span>
        </span>
      ),
    },
    {
      key: 'worked', header: isToday ? 'Worked today' : 'Worked', render: (r) => (
        <span className="udt-worked">
          <span className="udt-num">{r.worked != null ? hm(r.worked) : '—'}{r.outAt ? '' : r.inAt && isToday ? '' : ''}</span>
          <ProgressBar value={r.worked ?? 0} max={r.shiftMinutes || 540} height={4} label={undefined} />
        </span>
      ),
    },
    {
      key: 'status', header: 'Status', render: (r) => {
        const m = statusMeta(r.status)
        return (
          <span className="udt-status">
            <StatusPill tone={m.tone} dot>{m.label}</StatusPill>
            {r.pendingLeave && r.status !== 'ON_LEAVE' && <StatusPill tone="muted" size="xs">Leave waiting</StatusPill>}
            {isToday && r.status === 'NOT_MARKED' && sentIds.has(r.id) && <span className="udt-q">Reminded</span>}
          </span>
        )
      },
    },
    {
      key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', width: 64, render: (r) => (
        <Menu label={`Actions for ${r.name}`} width={240} placement="bottom-end"
          trigger={({ props }) => <button type="button" {...props} className="udt-more" aria-label={`More for ${r.name}`} data-row-ignore="">⋮</button>}
          items={[
            { key: 'open', label: 'See the day', icon: 'eye', onSelect: () => setOpenId(r.id) },
            ...(perms.override ? [{ key: 'status', label: 'Change status', icon: 'pencil', onSelect: () => openStatus(r) }] : []),
            ...(perms.approve ? [{ key: 'fix', label: 'Fix this day', icon: 'clock', onSelect: () => fixDay(r) }] : []),
            ...(perms.assist && isToday && !r.outAt && r.status !== 'ON_LEAVE' ? [{ key: 'punch', label: r.inAt ? 'Punch out with face' : 'Punch in with face', icon: 'scanFace', onSelect: () => setAssist({ employeeId: r.id }) }] : []),
            ...(perms.leaveOthers && !r.inAt && r.status !== 'ON_LEAVE' ? [{ key: 'leave', label: 'Mark leave', icon: 'calendarDays', onSelect: () => setLeaveFor({ id: r.id, name: r.name }) }] : []),
            ...(isToday && r.status === 'NOT_MARKED' ? [{ key: 'remind', label: sentIds.has(r.id) ? 'Reminded today' : 'Remind to check in', icon: 'bell', disabled: sentIds.has(r.id), onSelect: () => sendReminders([r.id]) }] : []),
            { key: 'history', label: 'View history', icon: 'calendarDays', onSelect: () => navigate(`/hrms/employees/${r.id}?tab=attendance`) },
          ]} />
      ),
    },
  ]

  const statusWord = status ? CARD[status as TileKey]?.label.toLowerCase() || statusLabel(status).toLowerCase() : ''
  const resultLine = loading ? 'Loading this day’s roster…'
    : `Showing ${filtered.length > PAGE ? `${page * PAGE + 1}–${Math.min(filtered.length, page * PAGE + PAGE)}` : filtered.length} of ${status ? counts[status] ?? filtered.length : rows.length}${status ? ' · ' + statusWord : ' people'}${dept ? ' in ' + dept : ''} · ${fmtShort(date)}, IST`

  // ── side cards ──
  const attention = useMemo(() => {
    const out: { key: string; icon: string; title: string; sub: string; action: string; onClick: () => void }[] = []
    for (const e of (review.data ?? []).slice(0, 4)) {
      const f = e.flags[0] || ''
      const title = f === 'NO_CHECKOUT' ? `${e.employeeName} missed a punch-out`
        : f === 'OUTSIDE_ZONE' ? `${e.employeeName} punched outside the zone`
          : f === 'ABSENT' ? `${e.employeeName} is absent without leave`
            : f === 'LATE' ? `${e.employeeName} was ${e.lateMinutes ?? ''} min late`.replace('  ', ' ')
              : f === 'EARLY_LEAVE' ? `${e.employeeName} left early`
                : `${e.employeeName}: ${statusLabel(e.status).toLowerCase()}`
      out.push({
        key: e.id, icon: f === 'OUTSIDE_ZONE' ? 'mapPin' : f === 'ABSENT' ? 'userX' : 'clock', title,
        sub: [fmtWd(e.date).replace(/ \d{4}$/, ''), e.shiftName].filter(Boolean).join(' · '), action: 'Review',
        onClick: () => navigate('/hrms/attendance?tab=review', { replace: true }),
      })
    }
    return out
  }, [review.data, navigate])
  const branches = byBranch(rows.map((r) => ({ branch: r.branch, came: !!r.inAt, counted: r.status !== 'ON_LEAVE' && r.status !== 'HOLIDAY' && r.status !== 'WEEKLY_OFF' })))

  const open = openId ? rows.find((r) => r.id === openId) || null : null

  return (
    <>
      <PageHeader eyebrow="Attendance & time · Daily tracking" title={isToday ? 'Today' : fmtWd(date)} sub={sub} actions={actions} />
      <div className="udt-dayrow">
        <DateChip value={date} today={today} max={today} onChange={setDate} label="Showing day" />
        {!isToday && <Button size={36} variant="ghost" onClick={() => setDate(today)}>Back to today</Button>}
        {isToday && perms.team && notMarked.length > 0 && (
          <Button size={36} variant="soft" icon="bell" loading={remind.isPending} onClick={() => sendReminders(notMarked.filter((r) => !sentIds.has(r.id)).map((r) => r.id))}
            disabled={notMarked.every((r) => sentIds.has(r.id))}>
            {notMarked.every((r) => sentIds.has(r.id)) ? 'Everyone not marked was reminded' : `Remind ${notMarked.filter((r) => !sentIds.has(r.id)).length} not marked yet`}
          </Button>
        )}
      </div>
      <StatGrid min={170} label={isToday ? 'Today at a glance' : 'The day at a glance'}>{cards}</StatGrid>

      <div className="udt-split">
        <Section title="Check-ins" variant="section" body="flush" className="udt-main"
          sub={<span className="udt-live">{isToday && <span className="udt-live__dot" aria-hidden="true" />}{isToday ? 'Live · ' : ''}{resultLine}</span>}
          actions={
            <div className="udt-filters">
              <input className="udt-search" type="search" aria-label="Find a person" placeholder="Find a person or code" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} />
              <Select aria-label="Department" size="md" value={dept} onChange={(e) => { setDept(e.target.value); setPage(0) }} options={[{ value: '', label: 'All departments' }, ...departments.map((d) => ({ value: d, label: d }))]} />
              {shifts.length > 1 && <Select aria-label="Shift" size="md" value={shift} onChange={(e) => { setShift(e.target.value); setPage(0) }} options={[{ value: '', label: 'All shifts' }, ...shifts.map((s) => ({ value: s, label: s }))]} />}
            </div>
          }
          error={team.isError ? team.error : undefined} onRetry={() => void team.refetch()} retrying={team.isFetching}>
          {perms.admin && selected.length > 0 && (
            <BulkBar selected={selected} onClear={() => setSelected([])} countLabel={(n) => `${n} picked`}
              actions={[{ key: 'mark', label: 'Mark attendance', icon: 'userCheck', onClick: () => setBulkOpen(true) }]} />
          )}
          <Table<LogRow>
            label="Check-ins" columns={columns} rows={pageRows} rowKey={(r) => r.id} rowLabel={(r) => r.name}
            onRowClick={(r) => setOpenId(r.id)} loading={loading} loadingRows={8} mobile="cards" minWidth={760}
            selectable={perms.admin} selected={selected} onSelectedChange={setSelected}
            empty={rows.length === 0 ? (isToday ? 'Nobody is on the roster today.' : 'Nobody was on the roster that day.') : 'No one matches these filters.'} />
          {filtered.length > PAGE && (
            <div className="udt-pager">
              <span className="udt-q">{resultLine}</span>
              <span className="udt-pager__btns">
                <Button size={32} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button size={32} disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</Button>
              </span>
            </div>
          )}
        </Section>

        <div className="udt-side">
          {perms.review && (
            <Section title="Needs attention" count={attention.length || null} countTone="gold" variant="section"
              loading={review.isLoading} error={review.isError ? review.error : undefined} onRetry={() => void review.refetch()}
              empty={attention.length === 0 ? { title: 'Nothing needs a look', hint: 'Late arrivals, missed punches and absences from the last 7 days show here.', variant: 'success' } : undefined}>
              <ul className="udt-attn">
                {attention.map((a) => (
                  <li key={a.key} className="udt-attn__row">
                    <span className="udt-attn__ic" aria-hidden="true">{dashIcon(a.icon, 16)}</span>
                    <span className="udt-attn__txt"><span className="udt-attn__t">{a.title}</span><span className="udt-q">{a.sub}</span></span>
                    <Button size={30} onClick={a.onClick} aria-label={`${a.action}: ${a.title}`}>{a.action}</Button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="By branch" sub="Checked in, including work from home" variant="section" loading={loading}
            empty={!loading && branches.length === 0 ? { title: 'No branches on the roster', hint: 'People with a branch show here once they have one.' } : undefined}>
            <ul className="udt-branches">
              {branches.map((b) => (
                <li key={b.name}>
                  <span className="udt-branches__row"><span>{b.name}</span><span className="udt-num"><b>{b.pct}%</b> · {b.came} of {b.total}</span></span>
                  <ProgressBar value={b.pct} height={6} />
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>

      <SidePanel open={!!open} onClose={() => setOpenId(null)} title={open?.name ?? ''} sub={open ? `${open.code} · ${open.dept}` : undefined}
        footerAlign="between"
        footer={open ? (
          <>
            <Button size={36} onClick={() => navigate(`/hrms/employees/${open.id}`)}>Open full profile</Button>
            <span className="udt-panel-acts">
              {perms.approve && <Button size={36} variant="ghost" onClick={() => { setOpenId(null); fixDay(open) }}>Fix this day</Button>}
              {perms.override && <Button size={36} variant="ghost" onClick={() => { setOpenId(null); openStatus(open) }}>Change status</Button>}
              <Button size={36} variant="ghost" onClick={() => navigate(`/hrms/employees/${open.id}?tab=attendance`)}>View history</Button>
            </span>
          </>
        ) : undefined}>
        {open && <DayFacts row={open} date={date} />}
      </SidePanel>

      {bulkOpen && (
        <BulkMarkPanel date={date} rows={rows} picked={selected.map(String)} onClose={() => setBulkOpen(false)}
          onDone={() => { setBulkOpen(false); setSelected([]) }} />
      )}
      <AssistedPunchDialog open={!!assist} employeeId={assist?.employeeId} onClose={() => setAssist(null)} onDone={() => void team.refetch()} />
      {target && <StatusChangeDrawer target={target} onClose={() => setTarget(null)} onSubmit={saveStatus} />}
      <MarkLeavePanel person={leaveFor} date={date} companyId={companyId} onClose={() => setLeaveFor(null)} />
    </>
  )
}

function DayFacts({ row: r, date }: { row: LogRow; date: string }) {
  const m = statusMeta(r.status)
  const facts: { k: string; v: string }[] = [
    { k: 'Date', v: fmtWd(date) },
    { k: 'Shift', v: r.shiftName ? `${r.shiftName}${r.shiftStart ? ` · ${r.shiftStart}${r.shiftEnd ? `–${r.shiftEnd}` : ''}` : ''}` : 'No shift yet' },
    { k: 'Check in', v: hhmmIst(r.inAt) },
    { k: 'Check out', v: hhmmIst(r.outAt) },
    { k: 'Hours worked', v: r.worked != null ? hm(r.worked) : '—' },
    { k: 'How they punched', v: r.how },
    { k: 'Late by', v: r.late ? `${r.late} min` : '—' },
    ...(r.branch ? [{ k: 'Branch', v: r.branch }] : []),
    ...(r.leave ? [{ k: 'Leave', v: r.leave }] : []),
    ...(r.pendingLeave ? [{ k: 'Leave request', v: 'Waiting for approval' }] : []),
    ...(r.punchedByDetail ? [{ k: 'Punched by', v: r.punchedByDetail }] : []),
    ...(r.note ? [{ k: r.manual ? 'Changed by a reviewer' : 'Why this status', v: r.note }] : []),
  ]
  return (
    <div className="udt-facts">
      <StatusPill tone={m.tone} dot size="md">{m.label}</StatusPill>
      <dl>
        {facts.map((f) => <div key={f.k} className="udt-facts__row"><dt>{f.k}</dt><dd>{f.v}</dd></div>)}
      </dl>
    </div>
  )
}
