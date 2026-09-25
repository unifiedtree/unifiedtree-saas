// Attendance & Time → Daily Tracking → Review (V143.10): days that need a look
// (late, half day, absent, early leaving, no check-out, outside the zone, a
// rejected face punch) and face punches the camera wasn't sure about, from the
// last 7 days. Built from the module kit: Views, DecisionCard, State, HrButton.
import { useState } from 'react'
import { HrButton } from '@/shared/components/hr'
import { DecisionCard, State, Views, dmy, FONT } from '@/design/module/ModuleKit'
import type { FaceReviewEvent, ReviewException } from '../api/useAttendanceReview'
import { statusLabel } from '../api/useAttendanceReview'

const FLAG: Record<string, string> = {
  LATE: 'Late', HALF_DAY: 'Half day', ABSENT: 'Absent', EARLY_LEAVE: 'Left early', NO_CHECKOUT: 'No check-out',
  OUTSIDE_ZONE: 'Checked in outside the zone', FACE_REJECTED: 'Face punch rejected',
}
const TONE: Record<string, string> = { LATE: 'late', HALF_DAY: 'late', ABSENT: 'red', PRESENT: 'ok' }
const GROUP: Record<string, string[]> = {
  late: ['LATE', 'HALF_DAY'], absent: ['ABSENT', 'FACE_REJECTED'], hours: ['EARLY_LEAVE', 'NO_CHECKOUT'], zone: ['OUTSIDE_ZONE'],
}
const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—')
const hm = (m?: number | null) => (m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`)

export function ReviewList({ state, items, faces, canOverride, onChange, onExcuse, onFace, onRetry, errorText }: {
  state: 'loading' | 'error' | 'live'
  items: ReviewException[]
  faces: FaceReviewEvent[]
  canOverride: boolean
  onChange: (item: ReviewException) => void
  onExcuse: (item: ReviewException) => void
  onFace: (face: FaceReviewEvent, yes: boolean) => void
  onRetry: () => void
  errorText?: string
}) {
  const [view, setView] = useState('all')
  const inGroup = (i: ReviewException, g: string) => i.flags.some((f) => GROUP[g].includes(f))
  const count = (g: string) => items.filter((i) => inGroup(i, g)).length
  const views = [
    { key: 'all', label: 'Everything', count: items.length + faces.length, urgent: items.length + faces.length > 0, tip: 'Every day and face punch that needs a look' },
    { key: 'late', label: 'Late & half days', count: count('late'), tip: 'Late arrivals past the allowance and half days' },
    { key: 'absent', label: 'Absent', count: count('absent'), tip: 'No punch and no leave, or a rejected face punch' },
    { key: 'hours', label: 'Early & no check-out', count: count('hours'), tip: 'Left before the shift ended, or never checked out' },
    { key: 'zone', label: 'Outside the zone', count: count('zone'), tip: 'Checked in outside the attendance zone' },
    { key: 'face', label: 'Face checks', count: faces.length, tip: 'Face punches the camera wasn’t sure about' },
  ]
  const shown = view === 'all' ? items : view === 'face' ? [] : items.filter((i) => inGroup(i, view))
  const shownFaces = view === 'all' || view === 'face' ? faces : []
  const total = items.length + faces.length

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0, fontFamily: FONT, color: '#0f172a' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px' }}>
        <Views items={views} active={view} onChange={setView} label="Review views" />
        <p style={{ margin: 0, fontSize: 13, color: '#475569', fontVariantNumeric: 'tabular-nums' }}>
          {state === 'loading' ? 'Loading the last 7 days…' : `${total} to look at from the last 7 days`}
        </p>
      </div>
      {state === 'loading' && <State kind="loading" height={180} />}
      {state === 'error' && <State kind="error" title="Unable to load the review list" description={errorText || 'Other tabs still work.'} onRetry={onRetry} />}
      {state === 'live' && shown.length + shownFaces.length === 0 && (
        <State kind="empty" icon="checkCircle" title="Nothing to review" description="No late arrivals past the allowance, absences, half days, early leaving, missing check-outs, zone problems or unsure face punches here." />
      )}
      {state === 'live' && shownFaces.map((f) => {
        const first = (f.employeeName || 'this person').split(' ')[0]
        return (
          <DecisionCard key={f.id} name={f.employeeName} sub={`${f.employeeCode}${f.departmentName ? ' · ' + f.departmentName : ''}`} status={['Needs a look', 'warn']}
            facts={[{ k: 'Day', v: dmy(f.date) }, { k: 'Time', v: `${clock(f.createdAt)} IST` }, { k: 'Match', v: f.scoreBucket === 'LOW' ? 'Low' : 'Medium' }, { k: 'Punch', v: f.purpose === 'PUNCH_OUT' ? 'Punch out' : 'Punch in' }]}
            reason={`The camera was only ${f.scoreBucket === 'LOW' ? 'partly' : 'fairly'} sure this was ${first}. Medium- and low-confidence punches need a person to check.`}
            actions={canOverride ? <>
              <HrButton variant="ghost" size="sm" onClick={() => onFace(f, false)} data-tip="Rejects the punch; it stops counting">Not them</HrButton>
              <HrButton size="sm" onClick={() => onFace(f, true)} data-tip="Keeps the punch as verified">Yes, it’s {first}</HrButton>
            </> : undefined} />
        )
      })}
      {state === 'live' && shown.map((i) => {
        const facts = [
          { k: 'Day', v: dmy(i.date) }, { k: 'Came in', v: clock(i.checkIn) }, { k: 'Left', v: clock(i.checkOut) },
          ...(i.lateMinutes ? [{ k: 'Late by', v: `${i.lateMinutes} min` }] : []),
          ...(i.workedMinutes != null ? [{ k: 'Worked', v: hm(i.workedMinutes) }] : []),
          ...(i.earlyByMinutes ? [{ k: 'Left early by', v: `${i.earlyByMinutes} min` }] : []),
          ...(i.distanceMeters != null ? [{ k: 'Distance', v: `${i.distanceMeters} m away` }] : []),
        ]
        return (
          <DecisionCard key={i.id} name={i.employeeName} sub={`${i.employeeCode}${i.departmentName ? ' · ' + i.departmentName : ''}`}
            status={[statusLabel(i.status) + (i.lossOfPay ? ' · loss of pay' : ''), TONE[i.status] || 'gray']} facts={facts}
            reason={<><span style={{ color: '#64748b' }}>Needs a look:</span> {i.flags.map((f) => FLAG[f] || f).join(' · ')}{i.note ? <><br />{i.note}</> : null}</>}
            actions={canOverride ? <>
              <HrButton variant="ghost" size="sm" onClick={() => onChange(i)} data-tip="Set Present, Late, Half day or Absent with a reason">Change status</HrButton>
              <HrButton size="sm" onClick={() => onExcuse(i)} data-tip="Counts the day as present, with your reason">Excuse</HrButton>
            </> : undefined} />
        )
      })}
    </div>
  )
}
