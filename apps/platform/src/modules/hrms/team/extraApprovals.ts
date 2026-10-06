// Approvals the server's inbox doesn't list: salary advances, overtime and skill levels. The website decides
// them on their own pages (Advances, Shifts & overtime › Overtime, Learning › Skill approvals); the Approvals page
// reads the same lists and shows them as inbox rows, as the phone app does (utils/approvals.ts there). Every value
// comes from the API; these only shape and count the rows. Your own request is never yours to decide.
import type { InboxRow, InboxTab } from '../api/shared/contracts'
import type { AdvanceRequest } from '../api/useAdvance'
import type { OvertimeEntry, OvertimeRequest } from '../api/useOvertime'
import type { SkillAssessment } from '../api/useLearning'
import { hm, isoDay } from '../attendance/shifts/shiftModel'
import { INBOX_TABS, money, tabOfKind } from './teamModel'

/** "6:30 PM" from the shift's "18:30:00". */
function to12(t: string | null | undefined): string {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

/** "7:05 PM" in IST from an instant (ISO text or epoch millis); '' when there is none. */
function clock12(v: string | number | null | undefined): string {
  if (v == null || v === '') return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })
}

/** An instant as ISO text, for sorting and "2 hr ago"; the day itself when there is none. */
function instantText(v: string | number | null | undefined, fallbackDay: string): string {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString()
  if (typeof v === 'string' && v.trim()) return v
  return fallbackDay
}

const notMine = (employeeId: string | null | undefined, me: string | null | undefined) => !!employeeId && employeeId !== me

/**
 * Advances waiting for a decision (REQUESTED; APPROVED ones wait for payout, not a decision), kind ADVANCE under
 * Requests. Decided with POST /v1/advance/requests/{id}/decision (hrms.advance.approve).
 */
export function advanceRows(list: readonly AdvanceRequest[], me: string | null | undefined): InboxRow[] {
  return list.filter((a) => a.status === 'REQUESTED').map((a) => ({
    kind: 'ADVANCE' as const,
    requestId: a.id,
    employeeId: a.employeeId,
    employeeName: a.employeeName || 'Employee',
    employeeCode: a.employeeCode ?? null,
    departmentName: null,
    createdAt: a.createdAt ?? '',
    title: 'Salary advance',
    fromDate: null,
    toDate: null,
    days: null,
    amount: Number(a.amount) || 0,
    currency: 'INR',
    reason: a.reason || null,
    facts: [
      ...(a.repaymentMonths ? [{ key: 'repayment', label: 'Repaid over', value: `${a.repaymentMonths} ${a.repaymentMonths === 1 ? 'month' : 'months'}` }] : []),
      ...(a.monthlyDeduction ? [{ key: 'monthly', label: 'Monthly deduction', value: money(a.monthlyDeduction, 'INR') }] : []),
      ...(a.raisedByName ? [{ key: 'raisedBy', label: 'Raised by', value: a.raisedByName }] : []),
    ],
    warnings: [],
    canDecide: notMine(a.employeeId, me),
    rejectNeedsReason: false,
  }))
}

const OT_RAISED: Record<string, string> = {
  EMPLOYEE: 'Reason from the employee', FIX_REQUEST: 'Times from an approved fix request', MANUAL_ENTRY: 'Times entered by HR',
}

/**
 * Overtime waiting for a decision, under Attendance: from punches (kind OVERTIME, POST
 * /v1/attendance/overtime/{id}/approve|reject) and asked for (kind OVERTIME_REQUEST, POST
 * /v1/attendance/overtime/requests/{id}/approve|reject), both with attendance.overtime.approve. A rejection needs a note.
 */
export function overtimeRows(entries: readonly OvertimeEntry[], asks: readonly OvertimeRequest[], me: string | null | undefined): InboxRow[] {
  const out: InboxRow[] = []
  for (const o of entries) {
    if (o.status !== 'PENDING') continue
    const day = isoDay(o.date)
    const minutes = typeof o.countedMinutes === 'number' ? o.countedMinutes : o.minutes
    const left = clock12(o.checkOutAt)
    out.push({
      kind: 'OVERTIME', requestId: o.id, employeeId: o.employeeId, employeeName: o.employeeName || 'Employee',
      employeeCode: null, departmentName: null, createdAt: instantText(o.checkOutAt, day), title: 'Overtime',
      fromDate: day || null, toDate: day || null, days: null, amount: null, currency: null, reason: o.reason || null,
      facts: [
        { key: 'extra', label: 'Extra time', value: `+${hm(minutes)}` },
        ...(o.shiftEnd ? [{ key: 'shiftEnded', label: 'Shift ended', value: [to12(o.shiftEnd), o.shiftName].filter(Boolean).join(' · ') }] : []),
        ...(left ? [{ key: 'leftAt', label: 'Left at', value: left }] : []),
        { key: 'raised', label: 'Raised', value: (o.reasonSource && OT_RAISED[o.reasonSource]) || 'Recorded automatically' },
      ],
      warnings: [], canDecide: notMine(o.employeeId, me), rejectNeedsReason: true,
    })
  }
  for (const r of asks) {
    if (r.status !== 'PENDING') continue
    const day = isoDay(r.date)
    out.push({
      kind: 'OVERTIME_REQUEST', requestId: r.id, employeeId: r.employeeId, employeeName: r.employeeName || 'Employee',
      employeeCode: r.employeeCode ?? null, departmentName: null, createdAt: instantText(r.createdAt, day), title: 'Overtime request',
      fromDate: day || null, toDate: day || null, days: null, amount: null, currency: null, reason: r.reason || null,
      facts: [{ key: 'extra', label: 'Extra time', value: `+${hm(r.minutes)}` }],
      warnings: [], canDecide: notMine(r.employeeId, me), rejectNeedsReason: true,
    })
  }
  return out
}

const SKILL_WORD: Record<number, string> = { 1: 'Beginner', 2: 'Basic', 3: 'Intermediate', 4: 'Advanced', 5: 'Expert' }
const skillWord = (n: number | null | undefined) => (n == null ? 'new skill' : SKILL_WORD[Math.max(1, Math.min(5, Math.round(n)))])

/**
 * Skill levels waiting for a decision, kind SKILL under Requests, decided with POST
 * /v1/learning/skill-assessments/{id}/decide (hrms.learning.skill.approve). A rejection needs a note.
 */
export function skillRows(list: readonly SkillAssessment[], me: string | null | undefined): InboxRow[] {
  return list.filter((a) => a.status === 'PENDING').map((a) => ({
    kind: 'SKILL' as const,
    requestId: a.id,
    employeeId: a.employeeId,
    employeeName: a.employeeName || 'Employee',
    employeeCode: a.employeeCode ?? null,
    departmentName: a.department ?? null,
    createdAt: a.createdAt ?? '',
    title: `${a.skillName}: ${skillWord(a.currentProficiency)} → ${skillWord(a.proposedProficiency)}`,
    fromDate: null,
    toDate: null,
    days: null,
    amount: null,
    currency: null,
    reason: a.employeeNote || null,
    facts: a.certificationName ? [{ key: 'certification', label: 'Certification', value: a.certificationName }] : [],
    warnings: [],
    canDecide: notMine(a.employeeId, me),
    rejectNeedsReason: true,
  }))
}

/** Newest first, as the server orders its own rows. */
export function newestFirst(rows: readonly InboxRow[]): InboxRow[] {
  const at = (r: InboxRow) => { const t = Date.parse(r.createdAt); return Number.isFinite(t) ? t : 0 }
  return [...rows].sort((a, b) => at(b) - at(a))
}

/** The extra rows a tab shows: all of them under All; under a tab only when the person may open that tab. */
export function extraRowsInTab(extras: readonly InboxRow[], tab: InboxTab, tabs: readonly InboxTab[] | undefined): InboxRow[] {
  if (tab === 'all') return [...extras]
  const open = new Set(tabs ?? [])
  return extras.filter((r) => tabOfKind(r.kind) === tab && open.has(tab))
}

/** The server's per-tab counts plus the extra rows (each under All, and under its own tab when that tab is open). */
export function countsWithExtras(counts: Partial<Record<InboxTab, number>> | undefined, extras: readonly InboxRow[],
  tabs: readonly InboxTab[] | undefined): Record<InboxTab, number> {
  const out = Object.fromEntries(INBOX_TABS.map((t) => [t, counts?.[t] ?? 0])) as Record<InboxTab, number>
  const open = new Set(tabs ?? [])
  for (const r of extras) {
    out.all += 1
    const t = tabOfKind(r.kind)
    if (open.has(t)) out[t] += 1
  }
  return out
}
