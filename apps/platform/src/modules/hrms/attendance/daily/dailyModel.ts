// Daily tracking's view logic (PgAttendance "Today", PgTime a-daily): plain functions over the API's
// rows, so the pages only lay things out and the rules can be unit tested. The day's bucket rule is
// the one Daily Logs always used (each person counts once; "Present" counts everyone who came in);
// the dashboard's own counts stay in attendanceBuckets.ts, unchanged.
import type { StatusTone } from '@/design/kit/display'
import type { StaffStatusResponse } from '../../api/useAttendance'
import type { FaceVerificationEvent } from '../face/useFacePunchLogs'
import { MON } from '@/design/dc/dates'

/** "09:24" in IST (24-hour, as the design writes times), or an em dash. */
export function hhmmIst(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' })
}

/** "4h 46m" (or "0h 05m"), from minutes. */
export function hm(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—'
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** Minutes from check-in to check-out, or to `now` while still in (today only). */
export function workedMinutes(inAt?: string | null, outAt?: string | null, now?: number): number | null {
  if (!inAt) return null
  const a = new Date(inAt).getTime()
  const b = outAt ? new Date(outAt).getTime() : now
  if (!Number.isFinite(a) || b == null || !Number.isFinite(b)) return null
  return Math.max(0, Math.round((b - a) / 60000))
}

/**
 * A row's status for the day: the effective status (company attendance policy and reviewers'
 * changes, V143.10) when the server sends it, else the punch. WFH is a present day worked from home.
 */
export function rowStatus(s: StaffStatusResponse): string {
  const eff = s.effectiveStatus
  if (eff) return eff === 'PRESENT' && s.attendanceType === 'WFH' ? 'WFH' : eff
  if (!s.checkInAt) return s.onLeave ? 'ON_LEAVE' : 'NOT_MARKED'
  if (s.status === 'HALF_DAY') return 'HALF_DAY'
  if (s.status === 'LATE') return 'LATE'
  return s.attendanceType === 'WFH' ? 'WFH' : 'PRESENT'
}

/** A past day: nobody is "not marked yet" any more; no punch and no leave is absent. */
export function statusOnDay(status: string, isToday: boolean): string {
  return !isToday && status === 'NOT_MARKED' ? 'ABSENT' : status
}

export const STATUS_META: Record<string, { label: string; tone: StatusTone }> = {
  PRESENT: { label: 'Present', tone: 'success' },
  LATE: { label: 'Late', tone: 'amber' },
  WFH: { label: 'Work from home', tone: 'mint' },
  ON_LEAVE: { label: 'On leave', tone: 'leave' },
  NOT_MARKED: { label: 'Not marked', tone: 'neutral' },
  ABSENT: { label: 'Absent', tone: 'danger' },
  HALF_DAY: { label: 'Half day', tone: 'warning' },
  HOLIDAY: { label: 'Holiday', tone: 'holiday' },
  WEEKLY_OFF: { label: 'Weekly off', tone: 'muted' },
  NOT_TRACKED: { label: 'Not tracked', tone: 'muted' },
}
// A day the server sends without a status gets no label instead of throwing (the profile's month calendar).
export const statusMeta = (s: string | null | undefined) => STATUS_META[s ?? ''] || { label: s ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : '', tone: 'neutral' as StatusTone }

/** The six filter cards, in the design's order. */
export const TILE_KEYS = ['PRESENT', 'LATE', 'WFH', 'ON_LEAVE', 'ABSENT', 'NOT_MARKED'] as const
export type TileKey = (typeof TILE_KEYS)[number]
/** URL statuses (from the dashboard's cards) → these keys. */
const ALIAS: Record<string, string> = { WORK_FROM_HOME: 'WFH' }
export const tileKeyOf = (s: string) => ALIAS[s] || s

/** Whether a row counts under a filter: "Present" is everyone who came in (late, from home and half days too). */
export function inStatus(status: string, key: string, earlyOut = false): boolean {
  if (key === 'EARLY_OUT') return earlyOut
  if (key === 'PRESENT') return status === 'PRESENT' || status === 'LATE' || status === 'WFH' || status === 'HALF_DAY'
  return status === key
}

/** How a punch arrived, in the design's words ("Face", "Mobile", "Web"…). */
const METHOD: Record<string, string> = {
  FACE_RECOGNITION: 'Face', FACE: 'Face', MOBILE_GPS: 'Mobile', GPS: 'Mobile', MOBILE: 'Mobile', GEO_FENCE: 'Mobile', WEB: 'Web',
  BIOMETRIC_FINGERPRINT: 'Fingerprint', BIOMETRIC: 'Fingerprint', DEVICE: 'Fingerprint', KIOSK: 'Kiosk', PIN: 'PIN', QR_CODE: 'QR code',
  MANUAL: 'Added by HR', MANAGER_OVERRIDE: 'Manager', OVERRIDE: 'Manager',
}
export function methodLabel(m?: string | null): string {
  if (!m) return ''
  return METHOD[m.toUpperCase()] || m.charAt(0) + m.slice(1).toLowerCase().replace(/_/g, ' ')
}

/** "Casual leave · 25–26 Sep" from a row's approved leave. */
export function leaveLine(s: Pick<StaffStatusResponse, 'leaveTypeName' | 'leaveFrom' | 'leaveTo'>): string {
  const type = s.leaveTypeName || 'On leave'
  if (!s.leaveFrom) return type
  const d = (iso: string) => {
    const x = new Date(iso.slice(0, 10) + 'T00:00:00')
    return { day: x.getDate(), mon: MON[x.getMonth()] }
  }
  const a = d(s.leaveFrom), b = s.leaveTo ? d(s.leaveTo) : a
  const range = s.leaveTo && s.leaveTo !== s.leaveFrom
    ? (a.mon === b.mon ? `${a.day}–${b.day} ${a.mon}` : `${a.day} ${a.mon} – ${b.day} ${b.mon}`)
    : `${a.day} ${a.mon}`
  return `${type} · ${range}`
}

/**
 * Who a Face Punch Logs row is: the person's name and code (the server names the person behind the login); else the
 * login's email (servers before that); else the start of the login id.
 */
export function logPerson(e: Pick<FaceVerificationEvent, 'employeeId' | 'employeeName' | 'employeeCode'>, email?: string): { name: string; sub: string } {
  const named = e.employeeName?.trim()
  const login = `User ${e.employeeId.slice(0, 8)}`
  if (named) return { name: named, sub: e.employeeCode || email || login }
  return { name: email || 'Unknown user', sub: login }
}

/** Checked in per branch (the design's "By branch" card), biggest first; people without a branch are left out. */
export function byBranch(rows: { branch: string | null; came: boolean; counted: boolean }[]) {
  const m = new Map<string, { name: string; came: number; total: number }>()
  for (const r of rows) {
    if (!r.branch || !r.counted) continue
    const cur = m.get(r.branch) || { name: r.branch, came: 0, total: 0 }
    cur.total++
    if (r.came) cur.came++
    m.set(r.branch, cur)
  }
  return [...m.values()].map((b) => ({ ...b, pct: b.total ? Math.round((b.came / b.total) * 100) : 0 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
}

/** The shift most of the roster is on ("General 09:30–18:30 with 15 min grace"), for the sub-line. */
export function mainShift(rows: { shiftName?: string | null; start?: string | null; end?: string | null; grace?: number | null }[]): string | null {
  const m = new Map<string, { n: number; text: string }>()
  for (const r of rows) {
    if (!r.shiftName) continue
    const times = r.start && r.end ? ` ${r.start}–${r.end}` : ''
    const grace = r.grace ? ` with ${r.grace} min grace` : ''
    const text = `${r.shiftName} shift${times}${grace}`
    const cur = m.get(text) || { n: 0, text }
    cur.n++
    m.set(text, cur)
  }
  let best: { n: number; text: string } | null = null
  for (const v of m.values()) if (!best || v.n > best.n) best = v
  return best ? best.text : null
}

/** "↘ 2 vs yesterday" pieces: the change and whether it is good (fewer late or absent people is good). */
export function versus(today: number, yesterday: number | null | undefined, lowerIsBetter = true): { delta: string; mood: 'good' | 'bad' | 'flat'; trend: 'up' | 'down' | 'flat' } | null {
  if (yesterday == null) return null
  const d = today - yesterday
  if (d === 0) return { delta: '0', mood: 'flat', trend: 'flat' }
  const better = lowerIsBetter ? d < 0 : d > 0
  return { delta: String(Math.abs(d)), mood: better ? 'good' : 'bad', trend: d > 0 ? 'up' : 'down' }
}
