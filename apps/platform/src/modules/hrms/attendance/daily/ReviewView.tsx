// Review (PgTime a-daily "Review"): days and punches that need a second look before payroll locks,
// from the last 7 days. GET /v1/attendance/review/exceptions (late past the allowance, half days,
// absences, early leaving, no check-out, outside the zone, a rejected face punch; with the branch,
// zone and method, BW-14) and the face punches the camera wasn't sure about
// (/review/face-events, status REVIEW). Decisions need attendance.status.override:
//   a day   → Excuse (counts as present) or Change status, with a reason the person is told
//   a face  → "Yes, it's them" or "Not them" (the punch stops counting)
// There is no Undo on Review (AUDIT 5.7). "2nd time this month" is counted from this month's list.
import { useMemo, useState } from 'react'
import { Button, CellActions, CellPerson, FilterPills, PageHeader, Section, StatusPill, Table, type TableColumn, type StatusTone } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { addDays, fmtWd, istToday } from '@/design/dc/dates'
import {
  useChangeDayStatus, useDecideFacePunch, useFaceReviewEvents, useReviewExceptions, statusLabel,
  type FaceReviewEvent, type ReviewException,
} from '../../api/useAttendanceReview'
import { StatusChangeDrawer, type StatusTarget } from '../StatusChangeDrawer'
import { hhmmIst, hm, methodLabel } from './dailyModel'
import type { DailyPerms } from './DailyTracking'

type Group = 'all' | 'late' | 'absent' | 'hours' | 'zone' | 'face'
const GROUP: Record<Exclude<Group, 'all' | 'face'>, string[]> = {
  late: ['LATE', 'HALF_DAY'], absent: ['ABSENT', 'FACE_REJECTED'], hours: ['EARLY_LEAVE', 'NO_CHECKOUT'], zone: ['OUTSIDE_ZONE'],
}
const PILL: Record<string, { label: string; tone: StatusTone }> = {
  LATE: { label: 'Late', tone: 'amber' }, HALF_DAY: { label: 'Half day', tone: 'warning' }, ABSENT: { label: 'Absent', tone: 'danger' },
  EARLY_LEAVE: { label: 'Early out', tone: 'amber' }, NO_CHECKOUT: { label: 'No check-out', tone: 'amber' },
  OUTSIDE_ZONE: { label: 'Outside zone', tone: 'danger' }, FACE_REJECTED: { label: 'Face rejected', tone: 'danger' }, FACE: { label: 'Check face', tone: 'info' },
}
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}`
const shortDay = (iso: string) => fmtWd(iso).replace(/ \d{4}$/, '')

interface Item { key: string; kind: 'day' | 'face'; name: string; sub: string; date: string; what: string; source: string; flag: string; day?: ReviewException; face?: FaceReviewEvent }

/** What happened, in one line ("Came in 09:52 · 22 min late"). */
function whatHappened(i: ReviewException): string {
  const f = i.flags[0]
  if (f === 'LATE' || f === 'HALF_DAY') return `Came in ${hhmmIst(i.checkIn)}${i.lateMinutes ? ` · ${i.lateMinutes} min late` : ''}${f === 'HALF_DAY' && i.workedMinutes != null ? ` · worked ${hm(i.workedMinutes)}` : ''}`
  if (f === 'ABSENT') return 'No punch yet · not on leave'
  if (f === 'EARLY_LEAVE') return `Left ${hhmmIst(i.checkOut)}${i.earlyByMinutes ? ` · ${i.earlyByMinutes} min early` : ''}`
  if (f === 'NO_CHECKOUT') return 'No check-out recorded'
  if (f === 'OUTSIDE_ZONE') return `Punched ${i.distanceMeters != null ? `${i.distanceMeters >= 1000 ? (i.distanceMeters / 1000).toFixed(1) + ' km' : i.distanceMeters + ' m'} from ` : 'outside '}${i.zoneName || i.branchName || 'the zone'}`
  if (f === 'FACE_REJECTED') return 'Face punch rejected · the day has no punch'
  return statusLabel(i.status)
}

export function ReviewView({ perms }: { perms: DailyPerms }) {
  const toast = useToast()
  const today = istToday()
  const [group, setGroup] = useState<Group>('all')
  const [target, setTarget] = useState<StatusTarget | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const days = useReviewExceptions(addDays(today, -6), today, true)
  const month = useReviewExceptions(today.slice(0, 8) + '01', today, true)
  const faces = useFaceReviewEvents(addDays(today, -6), today, true)
  const change = useChangeDayStatus()
  const decideFace = useDecideFacePunch()

  // How many times each person had the same flag this month.
  const nth = useMemo(() => {
    const seen = new Map<string, string[]>()
    for (const i of [...(month.data ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
      for (const f of i.flags) { const k = `${i.employeeId}|${f}`; seen.set(k, [...(seen.get(k) || []), i.date]) }
    }
    return (i: ReviewException) => { const list = seen.get(`${i.employeeId}|${i.flags[0]}`) || []; const n = list.indexOf(i.date) + 1; return n > 1 ? n : 0 }
  }, [month.data])

  const items: Item[] = useMemo(() => [
    ...(faces.data ?? []).filter((f) => f.status === 'REVIEW').map((f): Item => ({
      key: 'f' + f.id, kind: 'face', name: f.employeeName, sub: f.departmentName || f.employeeCode, date: f.date,
      what: `Face match ${f.scoreBucket === 'LOW' ? 'low' : 'medium'} · ${f.purpose === 'PUNCH_OUT' ? 'punch out' : 'punch in'} at ${hhmmIst(f.createdAt)}`,
      source: f.device ? `Face check-in · ${f.device}` : 'Face check-in', flag: 'FACE', face: f,
    })),
    ...(days.data ?? []).map((i): Item => {
      const n = nth(i)
      return {
        key: 'd' + i.id, kind: 'day', name: i.employeeName, sub: i.departmentName || i.employeeCode, date: i.date,
        what: whatHappened(i) + (n ? ` · ${ordinal(n)} time this month` : ''),
        source: [methodLabel(i.checkInMethod), i.branchName].filter(Boolean).join(' · ') || '—', flag: i.flags[0] || i.status, day: i,
      }
    }),
  ], [faces.data, days.data, nth])
  const inGroup = (it: Item, g: Group) => g === 'all' || (g === 'face' ? it.kind === 'face' : it.kind === 'day' && !!it.day && it.day.flags.some((f) => GROUP[g].includes(f)))
  const shown = items.filter((it) => inGroup(it, group))
  const count = (g: Group) => items.filter((it) => inGroup(it, g)).length

  const statusTarget = (i: ReviewException, preset?: string): StatusTarget => ({
    kind: 'status', employeeId: i.employeeId, name: i.employeeName, sub: `${i.employeeCode}${i.departmentName ? ' · ' + i.departmentName : ''}`, date: i.date,
    status: i.status, note: i.note, preset, facts: [{ k: 'Came in', v: hhmmIst(i.checkIn) }, { k: 'Left', v: hhmmIst(i.checkOut) }],
  })
  const faceYes = (f: FaceReviewEvent) => {
    setBusy(f.id)
    decideFace.mutateAsync({ id: f.id, decision: 'CONFIRMED' })
      .then(() => toast.success(`Checked — the punch stays as ${f.employeeName.split(' ')[0]}’s`))
      .catch((e) => { toast.error('Could not record the check', { detail: (e as Error)?.message }); void faces.refetch() })
      .finally(() => setBusy(null))
  }
  const faceNo = (f: FaceReviewEvent) => setTarget({
    kind: 'face-reject', employeeId: f.employeeId, name: f.employeeName, sub: `${f.employeeCode}${f.departmentName ? ' · ' + f.departmentName : ''}`, date: f.date,
    faceEventId: f.id, punchOut: f.purpose === 'PUNCH_OUT', facts: [{ k: 'Time', v: `${hhmmIst(f.createdAt)} IST` }, { k: 'Match', v: f.scoreBucket === 'LOW' ? 'Low' : 'Medium' }],
  })
  const submit = (t: StatusTarget, status: string, reason: string) => {
    const first = t.name.split(' ')[0]
    if (t.kind === 'face-reject' && t.faceEventId) {
      return decideFace.mutateAsync({ id: t.faceEventId, decision: 'REJECTED', note: reason })
        .then((r) => { toast.success(`Punch rejected — ${first}’s ${shortDay(t.date)} now counts as ${statusLabel(r.day?.status).toLowerCase()}`); return true })
        .catch((e) => { toast.error('Could not reject the punch', { detail: (e as Error)?.message }); void faces.refetch(); return false })
    }
    return change.mutateAsync({ employeeId: t.employeeId, date: t.date, status, reason })
      .then((d) => { toast.success(status === 'EXCUSE' ? `Excused — ${first}’s ${shortDay(t.date)} counts as present` : `${first}’s ${shortDay(t.date)} is now ${statusLabel(d.status).toLowerCase()}`); return true })
      .catch((e) => { toast.error('Could not change the status', { detail: (e as Error)?.message }); void days.refetch(); return false })
  }

  const columns: TableColumn<Item>[] = [
    { key: 'who', header: 'Employee', primary: true, render: (it) => <CellPerson name={it.name} sub={it.sub} /> },
    { key: 'date', header: 'Date', render: (it) => <span className="udt-num">{shortDay(it.date)}</span> },
    { key: 'what', header: 'What happened', render: (it) => <span className="udt-clip" title={it.what}>{it.what}</span> },
    { key: 'source', header: 'Source', render: (it) => <span className="udt-clip udt-q2" title={it.source}>{it.source}</span> },
    { key: 'status', header: 'Status', render: (it) => { const p = PILL[it.flag] || { label: statusLabel(it.flag), tone: 'neutral' as StatusTone }; return <StatusPill tone={p.tone}>{p.label}{it.day?.lossOfPay ? ' · LOP' : ''}</StatusPill> } },
    ...(perms.override ? [{
      key: 'act', header: <span className="uk-sr">Decide</span>, label: 'Decide', align: 'right' as const, render: (it: Item) => it.face ? (
        <CellActions>
          <Button size={30} variant="danger-outline" disabled={busy === it.face.id} onClick={() => faceNo(it.face!)}>Not them</Button>
          <Button size={30} variant="soft" loading={busy === it.face.id} onClick={() => faceYes(it.face!)}>{`Yes, it’s ${it.name.split(' ')[0]}`}</Button>
        </CellActions>
      ) : (
        <CellActions>
          <Button size={30} variant="danger-outline" onClick={() => setTarget(statusTarget(it.day!))}>Change status</Button>
          <Button size={30} variant="soft" onClick={() => setTarget(statusTarget(it.day!, 'EXCUSE'))}>Excuse</Button>
        </CellActions>
      ),
    }] : []),
  ]

  const loading = days.isLoading || faces.isLoading
  const options = ([['all', 'Everything'], ['late', 'Late & half days'], ['absent', 'Absent'], ['hours', 'Early & no check-out'], ['zone', 'Outside the zone'], ['face', 'Face checks']] as [Group, string][])
    .map(([value, label]) => ({ value, label, count: loading ? null : count(value) || null }))

  return (
    <>
      <PageHeader eyebrow="Attendance & time" title="Daily tracking" sub="Punches that need a second look before payroll locks. From the last 7 days." />
      <Section title="Review list" count={loading ? null : items.length} countTone="gold" variant="section" body="flush"
        actions={<FilterPills label="Review views" size="sm" options={options} value={group} onChange={(v) => setGroup(v as Group)} />}
        error={days.isError ? days.error : faces.isError ? faces.error : undefined} onRetry={() => { void days.refetch(); void faces.refetch() }}>
        <Table<Item> label="Review list" columns={columns} rows={shown} rowKey={(it) => it.key} loading={loading} mobile="cards" minWidth={860}
          empty={items.length ? 'Nothing in this group.' : 'Nothing to review: no late arrivals past the allowance, absences, half days, early leaving, missing check-outs, zone problems or unsure face punches.'} />
      </Section>
      {!perms.override && items.length > 0 && <p className="udt-q udt-pad">Deciding needs the “Change a day’s attendance status” permission.</p>}
      {target && <StatusChangeDrawer target={target} onClose={() => setTarget(null)} onSubmit={submit} />}
    </>
  )
}
