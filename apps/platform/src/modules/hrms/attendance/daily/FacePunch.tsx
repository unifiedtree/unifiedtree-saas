// Face Punch: face check-ins, three ways.
//   1. To check: punches the camera wasn't sure about (medium or low match), last 7 days
//      (GET /review/face-events); "Yes, it's them" or "Not them" with attendance.status.override.
//   2. Face punches calendar-wise (client decision, 1 Oct): one person's month, a day per box,
//      and that day's punches when a day is opened (GET /review/face-events/employee/{id}). The
//      people to pick are the whole team, people on their weekly off included, on any day.
//   3. Face Punch Logs: every face verification on record, newest first, with the employee filter
//      (GET /face/admin/events, attendance.face.admin.read; keyed by login, shown by the person's
//      name and code, else the login's email on servers that don't send them).
import { useMemo, useState } from 'react'
import {
  Button, CellActions, CellPerson, MonthCalendar, PageHeader, Section, StatusPill, Table,
  type CalendarDay, type StatusTone, type TableColumn,
} from '@/design/kit/display'
import { Select, useToast } from '@/design/kit/overlays'
import { Pager, Timeline, type TimelineItem } from '@/design/kit/data'
import { MONTHS, addDays, fmtLong, fmtWd, istToday } from '@/design/dc/dates'
import { useTeamDashboard } from '../../api/useAttendance'
import { notAvailableReason } from '../../api/shared/available'
import {
  useDecideFacePunch, useEmployeeFaceEvents, useFaceReviewEvents, statusLabel, type FaceReviewEvent,
} from '../../api/useAttendanceReview'
import { useFaceEnrollments, useFaceEvents, type FaceVerificationEvent } from '../face/useFacePunchLogs'
import { StatusChangeDrawer, type StatusTarget } from '../StatusChangeDrawer'
import { hhmmIst, logPerson } from './dailyModel'
import type { DailyPerms } from './DailyTracking'

const BAND: Record<string, { label: string; tone: StatusTone }> = {
  HIGH: { label: 'High', tone: 'success' }, MEDIUM: { label: 'Medium', tone: 'info' }, LOW: { label: 'Low', tone: 'warning' },
  REJECTED: { label: 'Below threshold', tone: 'danger' }, UNKNOWN: { label: 'Not scored', tone: 'muted' },
}
const RESULT: Record<string, { label: string; tone: StatusTone }> = {
  PASS: { label: 'Verified', tone: 'success' }, FAIL_MATCH: { label: 'No match', tone: 'danger' }, FAIL_LIVENESS: { label: 'Liveness failed', tone: 'danger' },
  FAIL_LOCKED: { label: 'Locked', tone: 'danger' }, FAIL_LOW_QUALITY: { label: 'Low quality', tone: 'warning' }, FAIL_NO_FACE: { label: 'No face', tone: 'warning' },
  FAIL_MULTIPLE_FACES: { label: 'Multiple faces', tone: 'warning' }, FAIL_NOT_ENROLLED: { label: 'Not enrolled', tone: 'neutral' },
  FAIL_WORKER_UNAVAILABLE: { label: 'Service unavailable', tone: 'amber' }, FAIL_OTHER: { label: 'Failed', tone: 'neutral' },
}
const DECIDED: Record<string, { label: string; tone: StatusTone }> = {
  OK: { label: 'Verified', tone: 'success' }, REVIEW: { label: 'Needs a look', tone: 'amber' }, CONFIRMED: { label: 'Checked by HR', tone: 'success' },
  FLAGGED: { label: 'Rejected by HR', tone: 'danger' }, FAILED: { label: 'Not verified', tone: 'neutral' },
}
const PURPOSE: Record<string, string> = { PUNCH_IN: 'Punch in', PUNCH_OUT: 'Punch out', ENROLLMENT_SAMPLE: 'Enrolment photo', MANUAL_TEST: 'Verification test' }
const LOG_PAGE = 20
const shortDay = (iso: string) => fmtWd(iso).replace(/ \d{4}$/, '')
const monthEnd = (ym: string) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0); return `${ym}-${String(d.getDate()).padStart(2, '0')}` }
const monthShift = (ym: string, delta: number) => { const d = new Date(`${ym}-01T00:00:00`); d.setMonth(d.getMonth() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const stamp = (iso: string) => { const d = new Date(iso); return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}, ${hhmmIst(iso)}` }

/** A day of one person's face punches on the calendar. */
export function faceDay(date: string, list: FaceReviewEvent[]): CalendarDay {
  const passed = list.filter((e) => e.result === 'PASS' && e.status !== 'FLAGGED')
  const unsure = list.some((e) => e.status === 'REVIEW')
  const first = [...passed].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
  const n = list.length
  return {
    date,
    tone: unsure ? 'late' : passed.length ? 'present' : 'absent',
    label: first ? `${n} · in ${hhmmIst(first.createdAt)}` : `${n} failed`,
    tip: `${n} face ${n === 1 ? 'punch' : 'punches'}${unsure ? ' · one needs a look' : ''}`,
  }
}

export function FacePunch({ perms }: { perms: DailyPerms }) {
  const toast = useToast()
  const today = istToday()
  const weekAgo = addDays(today, -6)
  const recent = useFaceReviewEvents(weekAgo, today, true)
  // The team on any day: people on their weekly off are listed too, so a Sunday's picker isn't empty.
  const roster = useTeamDashboard(today, undefined, perms.team, false, { includeWeeklyOff: true })
  const decide = useDecideFacePunch()
  const [busy, setBusy] = useState<string | null>(null)
  const [target, setTarget] = useState<StatusTarget | null>(null)

  // ── 1. to check ──
  const toCheck = (recent.data ?? []).filter((e) => e.status === 'REVIEW')
  const yes = (f: FaceReviewEvent) => {
    setBusy(f.id)
    decide.mutateAsync({ id: f.id, decision: 'CONFIRMED' })
      .then(() => toast.success(`Checked — the punch stays as ${f.employeeName.split(' ')[0]}’s`))
      .catch((e) => { toast.error('Could not record the check', { detail: (e as Error)?.message }); void recent.refetch() })
      .finally(() => setBusy(null))
  }
  const no = (f: FaceReviewEvent) => setTarget({
    kind: 'face-reject', employeeId: f.employeeId, name: f.employeeName, sub: `${f.employeeCode}${f.departmentName ? ' · ' + f.departmentName : ''}`, date: f.date,
    faceEventId: f.id, punchOut: f.purpose === 'PUNCH_OUT', facts: [{ k: 'Time', v: `${hhmmIst(f.createdAt)} IST` }, { k: 'Match', v: (BAND[f.scoreBucket || 'UNKNOWN'] || BAND.UNKNOWN).label }],
  })
  const reject = (t: StatusTarget, _s: string, reason: string) =>
    decide.mutateAsync({ id: t.faceEventId!, decision: 'REJECTED', note: reason })
      .then((r) => { toast.success(`Punch rejected — ${t.name.split(' ')[0]}’s ${shortDay(t.date)} now counts as ${statusLabel(r.day?.status).toLowerCase()}`); return true })
      .catch((e) => { toast.error('Could not reject the punch', { detail: (e as Error)?.message }); void recent.refetch(); return false })
  const checkCols: TableColumn<FaceReviewEvent>[] = [
    { key: 'who', header: 'Employee', primary: true, render: (f) => <CellPerson name={f.employeeName} sub={[f.employeeCode, f.departmentName].filter(Boolean).join(' · ')} /> },
    { key: 'when', header: 'When', render: (f) => <span className="udt-num">{shortDay(f.date)}, {hhmmIst(f.createdAt)}</span> },
    { key: 'what', header: 'Punch', render: (f) => PURPOSE[f.purpose] || f.purpose },
    { key: 'band', header: 'Match', render: (f) => { const b = BAND[f.scoreBucket || 'UNKNOWN'] || BAND.UNKNOWN; return <StatusPill tone={b.tone}>{b.label}</StatusPill> } },
    { key: 'device', header: 'Where', render: (f) => <span className="udt-q2">{[f.device || 'Not recorded', f.punchedBy ? `punched by ${f.punchedBy}` : null].filter(Boolean).join(' · ')}</span> },
    ...(perms.override ? [{
      key: 'act', header: <span className="uk-sr">Decide</span>, label: 'Decide', align: 'right' as const, render: (f: FaceReviewEvent) => (
        <CellActions>
          <Button size={30} variant="danger-outline" disabled={busy === f.id} onClick={() => no(f)}>Not them</Button>
          <Button size={30} variant="soft" loading={busy === f.id} onClick={() => yes(f)}>{`Yes, it’s ${f.employeeName.split(' ')[0]}`}</Button>
        </CellActions>
      ),
    }] : []),
  ]

  // ── 2. one person's month ──
  // The roster, plus anyone in the last week's face punches it doesn't list (both are the caller's team).
  const people = useMemo(() => {
    const m = new Map<string, { employeeId: string; fullName: string; employeeCode: string }>()
    for (const s of roster.data?.staffStatuses ?? []) m.set(s.employeeId, { employeeId: s.employeeId, fullName: s.fullName, employeeCode: s.employeeCode })
    for (const f of recent.data ?? []) if (!m.has(f.employeeId)) m.set(f.employeeId, { employeeId: f.employeeId, fullName: f.employeeName, employeeCode: f.employeeCode })
    return [...m.values()].sort((a, b) => a.fullName.localeCompare(b.fullName))
  }, [roster.data, recent.data])
  const firstWithPunch = (recent.data ?? [])[0]?.employeeId
  const [who, setWho] = useState<string>('')
  const person = who || firstWithPunch || people[0]?.employeeId || ''
  const [ym, setYm] = useState(today.slice(0, 7))
  const [picked, setPicked] = useState<string | null>(null)
  const from = `${ym}-01`, to = ym === today.slice(0, 7) ? today : monthEnd(ym)
  const month = useEmployeeFaceEvents(person || undefined, from, to, !!person)
  const byDay = useMemo(() => {
    const m = new Map<string, FaceReviewEvent[]>()
    for (const e of month.data ?? []) m.set(e.date, [...(m.get(e.date) || []), e])
    return m
  }, [month.data])
  const cells = useMemo(() => [...byDay.entries()].map(([d, list]) => faceDay(d, list)), [byDay])
  const day = picked && picked.startsWith(ym) ? picked : [...byDay.keys()].sort().pop() || null
  const dayList = day ? [...(byDay.get(day) || [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) : []
  const timeline: TimelineItem[] = dayList.map((e) => {
    const b = BAND[e.scoreBucket || 'UNKNOWN'] || BAND.UNKNOWN, st = DECIDED[e.status] || DECIDED.OK
    return {
      key: e.id, time: hhmmIst(e.createdAt), label: `${PURPOSE[e.purpose] || e.purpose} · ${e.result === 'PASS' ? st.label : (RESULT[e.result] || RESULT.FAIL_OTHER).label}`,
      sub: [`${b.label} match`, e.device, e.punchedBy ? `punched by ${e.punchedBy}` : null, e.decisionNote].filter(Boolean).join(' · '),
      state: e.result !== 'PASS' || e.status === 'FLAGGED' ? 'failed' : e.status === 'REVIEW' ? 'current' : 'done',
    }
  })
  const personName = people.find((p) => p.employeeId === person)?.fullName || (month.data ?? [])[0]?.employeeName || ''

  // ── 3. the full log ──
  const [logWho, setLogWho] = useState('')
  const [logPage, setLogPage] = useState(0)
  const log = useFaceEvents(logWho || undefined, perms.face)
  const enrollments = useFaceEnrollments(perms.face)
  const emailById = useMemo(() => new Map((enrollments.data ?? []).map((e) => [e.employeeId, e.email ?? undefined])), [enrollments.data])
  const logRows = log.data ?? []
  const logShown = logRows.slice(logPage * LOG_PAGE, logPage * LOG_PAGE + LOG_PAGE)
  const logOptions = (enrollments.data ?? []).map((e) => ({
    value: e.employeeId,
    label: e.employeeName?.trim() ? `${e.employeeName.trim()}${e.employeeCode ? ` · ${e.employeeCode}` : ''}` : e.email || `User ${e.employeeId.slice(0, 8)}`,
  })).sort((a, b) => a.label.localeCompare(b.label))
  const logCols: TableColumn<FaceVerificationEvent>[] = [
    { key: 'who', header: 'Employee', primary: true, render: (e) => { const named = logPerson(e, emailById.get(e.employeeId)); return <CellPerson name={named.name} sub={named.sub} /> } },
    { key: 'what', header: 'Event', render: (e) => PURPOSE[e.purpose] || e.purpose },
    { key: 'when', header: 'Time', render: (e) => <span className="udt-num">{stamp(e.createdAt)}</span> },
    { key: 'result', header: 'Result', render: (e) => { const r = RESULT[e.result] || { label: e.result, tone: 'neutral' as StatusTone }; return <StatusPill tone={r.tone}>{r.label}</StatusPill> } },
    { key: 'band', header: 'Match confidence', render: (e) => { const b = e.scoreBucket ? BAND[e.scoreBucket] : undefined; return b ? <StatusPill tone={b.tone}>{b.label}</StatusPill> : <span className="udt-q">—</span> } },
    { key: 'device', header: 'Device', render: (e) => <span className="udt-q2">{e.device || '—'}</span> },
    { key: 'reason', header: 'Reason', render: (e) => (e.reason ? <span className="udt-clip udt-q2" title={e.reason}>{e.reason}</span> : <span className="udt-q">—</span>) },
  ]

  return (
    <>
      <PageHeader eyebrow="Attendance & time · Daily tracking" title="Face Punch"
        sub="Every check-in made with a face. When the camera isn’t sure it’s the right person, it asks you to take a look." />

      {(recent.isLoading || toCheck.length > 0 || recent.isError) && (
        <Section title="To check" count={toCheck.length || null} countTone="gold" variant="section" body="flush"
          sub="Medium and low matches from the last 7 days need a person to check."
          error={recent.isError ? recent.error : undefined} onRetry={() => void recent.refetch()}>
          <Table<FaceReviewEvent> label="Face punches to check" columns={checkCols} rows={toCheck} rowKey={(f) => f.id} loading={recent.isLoading} mobile="cards" minWidth={760} />
        </Section>
      )}

      {/* A server without the per-person endpoint yet (404 / FEATURE_NOT_READY): the block stays out. */}
      {!notAvailableReason(month.error) && <div className="udt-split udt-split--cal">
        <Section title="Face punches by person" variant="section" body="tight" className="udt-main"
          sub={personName ? `${personName} · ${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : 'Pick a person to see their month.'}
          actions={
            <span className="udt-filters">
              <Select aria-label="Person" size="md" value={person} onChange={(e) => { setWho(e.target.value); setPicked(null) }}
                options={people.length ? people.map((p) => ({ value: p.employeeId, label: `${p.fullName} · ${p.employeeCode}` })) : [{ value: '', label: 'No one on the roster' }]} />
              <Button size={32} icon="chevronLeft" aria-label="Previous month" onClick={() => { setYm(monthShift(ym, -1)); setPicked(null) }} />
              <Button size={32} icon="chevronRight" aria-label="Next month" disabled={ym >= today.slice(0, 7)} onClick={() => { setYm(monthShift(ym, 1)); setPicked(null) }} />
            </span>
          }
          loading={roster.isLoading || month.isLoading} skeleton="chart" error={month.isError ? month.error : roster.isError ? roster.error : undefined}
          onRetry={() => { void roster.refetch(); void month.refetch() }}>
          <MonthCalendar month={ym} days={cells} variant="detail" today={today} selected={day} onSelect={setPicked}
            label={`${personName || 'Face punches'} · ${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`}
            legend={[{ tone: 'present', label: 'Verified' }, { tone: 'late', label: 'Needs a look' }, { tone: 'absent', label: 'Not verified' }]} />
        </Section>
        <Section title={day ? fmtLong(day).split(', ')[1] : 'No face punches'} sub={day ? fmtLong(day).split(', ')[0] : `None in ${MONTHS[Number(ym.slice(5, 7)) - 1]}`} variant="section" className="udt-side">
          {timeline.length ? <Timeline variant="rail" label="The day’s face punches" items={timeline} />
            : <p className="udt-q">{person ? 'No face punches on this day.' : 'Pick a person.'}</p>}
        </Section>
      </div>}

      {perms.face && (
        <Section title="Face Punch Logs" variant="section" body="flush"
          sub={log.isPending ? 'Loading face verification events…'
            : logRows.length >= 500 ? 'Latest 500 face verification events, newest first — older events are not listed.'
              : `${logRows.length} face verification ${logRows.length === 1 ? 'event' : 'events'}, newest first.`}
          actions={logOptions.length > 0 ? (
            <Select aria-label="Employee" size="md" value={logWho} onChange={(e) => { setLogWho(e.target.value); setLogPage(0) }}
              options={[{ value: '', label: 'All employees' }, ...logOptions]} />
          ) : undefined}
          error={log.isError ? log.error : undefined} onRetry={() => void log.refetch()}
          empty={!log.isPending && logRows.length === 0 ? {
            title: logWho ? 'No face events for this employee' : 'No face punches recorded yet',
            hint: logWho ? 'This employee has no face verification attempts on record.' : 'Events appear here once people enrol and punch in with their face.',
          } : undefined}>
          <Table<FaceVerificationEvent> label="Face punch logs" columns={logCols} rows={logShown} rowKey={(e) => e.id} loading={log.isPending} mobile="cards" minWidth={860} />
          {logRows.length > LOG_PAGE && (
            <div className="udt-pager"><Pager page={logPage} pageSize={LOG_PAGE} total={logRows.length} onPageChange={setLogPage} noun="events" /></div>
          )}
        </Section>
      )}
      {target && <StatusChangeDrawer target={target} onClose={() => setTarget(null)} onSubmit={reject} />}
    </>
  )
}
