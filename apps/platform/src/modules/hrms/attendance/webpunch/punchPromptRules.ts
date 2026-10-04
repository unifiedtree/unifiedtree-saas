// The check-in prompt after sign-in (client-approved NextWave reference, DECISIONS 21): once the
// sign-in, its loading and the welcome animation are over, the web punch dialog opens by itself in
// check-in mode, before the person starts on the page. It opens only when ALL of these hold:
//   - the person may punch from the web at all: an employee record, HRMS on for the workspace, and
//     the two permissions a web punch needs, attendance.checkin.self (the punch) and
//     attendance.face.verify.self (its face check). The shell loads the prompt only for them.
//   - their company allows web check-in (GET /v1/attendance/web-punch-setting), and "Your day" agrees;
//   - "Your day" (GET /v1/attendance/my-day, Home's source of today) says they haven't checked in,
//     on a day they work (not on leave, a holiday, a weekly off, or a day before they started);
//   - it hasn't opened already in this visit (this browser tab, today);
//   - no other dialog or panel is open.
// Anything still loading waits; anything missing, failing or not available means no prompt.
// The Check in buttons on Home and My Attendance work as before whatever happens here.
import { P } from '@unifiedtree/sdk'
import type { MyDay } from './useMyDay'

/** What the shell knows about the signed-in person (useAccessContext). */
export interface PunchAccess {
  /** Has an employee record (the access token carries employee_id). */
  self: boolean
  modules: readonly string[]
  has: (code: string) => boolean
}

/** Whether this person could check in from the web at all. */
export function mayPunchFromWeb(ctx: PunchAccess): boolean {
  return ctx.self && ctx.modules.includes('hrms')
    && ctx.has(P.ATTENDANCE_CHECKIN_SELF) && ctx.has(P.ATTENDANCE_FACE_VERIFY_SELF)
}

/** Days with nothing to check in for: no prompt (the Check in button is still there). */
const NOT_A_WORKDAY = new Set(['ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF', 'NOT_TRACKED'])

export interface PromptFacts {
  /** The welcome animation is over and the shell is on screen. */
  ready: boolean
  /** Own employee record: undefined while loading, null when there is none (or it couldn't be read). */
  employee: { companyId?: string | null } | null | undefined
  /** The company's "Allow web check-in": undefined while loading; false when off, failing or not available. */
  allowed: boolean | undefined
  /** "Your day": undefined while loading, null when it failed or isn't available. */
  day: Pick<MyDay, 'checkedIn' | 'status' | 'webPunchAllowed'> | null | undefined
  /** Another dialog or panel is open: never put the prompt on top of it. */
  otherDialog: boolean
}

export type PromptDecision = 'wait' | 'open' | 'skip'

export function promptDecision(f: PromptFacts): PromptDecision {
  // A definite "no" settles it at once, even before the welcome is over.
  if (f.employee === null || (f.employee && !f.employee.companyId)) return 'skip'
  if (f.allowed === false || f.day === null) return 'skip'
  if (f.day && (f.day.checkedIn || !f.day.webPunchAllowed || NOT_A_WORKDAY.has(f.day.status ?? ''))) return 'skip'
  if (f.employee === undefined || f.allowed === undefined || f.day === undefined || !f.ready) return 'wait'
  return f.otherDialog ? 'skip' : 'open'
}

// ── What this browser remembers (a convenience: storage can be unavailable, so every read and
//    write is guarded, and without it the prompt simply asks at most once per page load) ──

const openedKey = (userId: string) => `ut.punch-prompt.opened:${userId}`
/** This page's own memory of the visit, for when session storage can't be used. */
const openedHere = new Set<string>()

/** The prompt already opened in this visit (this tab) on `today`. */
export function openedThisVisit(userId: string, today: string): boolean {
  if (openedHere.has(`${userId}|${today}`)) return true
  try { return sessionStorage.getItem(openedKey(userId)) === today } catch { return false }
}

export function markOpened(userId: string, today: string): void {
  openedHere.add(`${userId}|${today}`)
  try { sessionStorage.setItem(openedKey(userId), today) } catch { /* the page's own memory still holds it */ }
}

/** True when a dialog or side panel is already open on the page. */
export function anotherDialogOpen(): boolean {
  try { return typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]') !== null } catch { return false }
}
