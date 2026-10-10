/**
 * Where a notification opens on the web, which module it belongs to and its icon — for EVERY
 * type the server sends (`com.unifiedtree.notifications.enums.AppNotificationType`).
 *
 * The module ("group") is the server catalog's own (`NotificationEventCatalog`): the response
 * carries it once the server sends `group`; until then it is taken from the type here, with the
 * same names. Every route returned here is a real route in App.tsx (the unit test checks it), and
 * a tab is one the page reads. A page that isn't live in this release (registry `pkg`) is never
 * a target: its type falls back to the page that is live today.
 */
import { jwtDecode } from 'jwt-decode'
import { getAccessToken, useAuthStore as useSdkAuthStore } from '@unifiedtree/sdk'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'

/** Server enum; must stay in lock-step with AppNotificationType. */
export const NOTIFICATION_TYPES = [
  'LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'LEAVE_REJECTED', 'LEAVE_CANCELLED',
  'FACE_ENROLLMENT_COMPLETE', 'FACE_ENROLLMENT_FAILED', 'FACE_ENROLLMENT_RESET',
  'WFH_SUBMITTED', 'WFH_APPROVED', 'WFH_REJECTED', 'WFH_CANCELLED',
  'CORRECTION_SUBMITTED', 'CORRECTION_APPROVED', 'CORRECTION_REJECTED',
  'SHIFT_CHANGE_SUBMITTED', 'SHIFT_CHANGE_APPROVED', 'SHIFT_CHANGE_REJECTED',
  'EXPENSE_SUBMITTED', 'EXPENSE_APPROVED', 'EXPENSE_REJECTED',
  'ADVANCE_SUBMITTED', 'ADVANCE_APPROVED', 'ADVANCE_REJECTED', 'ADVANCE_RAISED_FOR_YOU',
  'SALARY_REVISED',
  'OVERTIME_REQUESTED', 'OVERTIME_APPROVED', 'OVERTIME_REJECTED',
  'ATTENDANCE_STATUS_CHANGED',
  'DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED', 'DOCUMENT_REJECTED',
  'LEAVE_ENCASHMENT_SUBMITTED', 'LEAVE_ENCASHMENT_APPROVED', 'LEAVE_ENCASHMENT_REJECTED',
  'POLICY_PUBLISHED', 'POLICY_REMINDER',
  'INTERVIEW_SCHEDULED', 'INTERVIEW_RESCHEDULED', 'INTERVIEW_CANCELLED',
  'SKILL_ASSESSMENT_SUBMITTED', 'SKILL_ASSESSMENT_APPROVED', 'SKILL_ASSESSMENT_REJECTED',
  'WELCOME', 'TRIAL_ENDING_SOON', 'TRIAL_EXPIRED', 'SUBSCRIPTION_HALTED', 'BILLING_OVER_CAP',
  'PAYMENT_DUE_SOON', 'PAYMENT_OVERDUE',
  'RETIREMENT_DUE',
  // The redesign's 13 (CONTRACTS.md, C0); OVERTIME_REQUESTED above is P-ATT-PLAN's.
  'DECISION_UNDONE', 'CHECKIN_REMINDER', 'PERFORMANCE_REVIEW_REMINDER', 'TEAM_MESSAGE', 'ASSET_ISSUE_REPORTED',
  'PAYSLIP_QUERY_RAISED', 'PAYSLIP_QUERY_ANSWERED', 'LEAVE_APPLIED_ON_BEHALF', 'EXPENSE_CLAIM_RAISED_FOR_YOU',
  'TIMESHEET_SUBMITTED', 'TIMESHEET_DECIDED', 'LETTER_SIGNATURE_REQUESTED', 'PROBATION_TEAM_DECISION',
  // Punch-in alerts (V143_72): when, how and where someone punched in, with a map link.
  'PUNCH_IN_ALERT',
  // Wishes a colleague sent from Celebrations (V143_84): who, and their message.
  'CELEBRATION_WISH',
  // Shift planning (V143_106): a roster was published for you, or one of your days changed on a republish.
  'ROSTER_PUBLISHED', 'ROSTER_DAY_CHANGED',
  'GENERAL',
] as const

export type AppNotificationType = (typeof NOTIFICATION_TYPES)[number]

/** The catalog's group for each type (NotificationEventCatalog), e.g. "Leave", "Expenses and advances". */
export function groupFor(type: string): string {
  if (type === 'WFH_SUBMITTED' || type.startsWith('WFH_')) return 'Work from home'
  if (type.startsWith('LEAVE_')) return 'Leave'
  if (type.startsWith('CORRECTION_') || type.startsWith('OVERTIME_') || type.startsWith('FACE_ENROLLMENT_') || type.startsWith('TIMESHEET_')
    || type === 'ATTENDANCE_STATUS_CHANGED' || type === 'CHECKIN_REMINDER' || type === 'PUNCH_IN_ALERT') return 'Attendance'
  if (type.startsWith('SHIFT_CHANGE_') || type.startsWith('ROSTER_')) return 'Shifts'
  if (type.startsWith('EXPENSE_') || type.startsWith('ADVANCE_')) return 'Expenses and advances'
  if (type === 'DECISION_UNDONE') return 'Approvals'
  if (type === 'SALARY_REVISED' || type.startsWith('PAYSLIP_QUERY_')) return 'Payroll'
  if (type.startsWith('DOCUMENT_')) return 'Documents'
  if (type === 'ASSET_ISSUE_REPORTED') return 'Assets'
  if (type.startsWith('POLICY_')) return 'Policies'
  if (type.startsWith('INTERVIEW_')) return 'Hiring'
  if (type.startsWith('SKILL_ASSESSMENT_')) return 'Learning'
  if (type === 'PERFORMANCE_REVIEW_REMINDER') return 'Performance'
  if (type === 'TEAM_MESSAGE') return 'Team'
  if (type === 'WELCOME' || type === 'RETIREMENT_DUE' || type === 'PROBATION_TEAM_DECISION' || type === 'CELEBRATION_WISH') return 'People'
  if (type === 'LETTER_SIGNATURE_REQUESTED') return 'Letters'
  if (type.startsWith('TRIAL_') || type.startsWith('PAYMENT_') || type === 'SUBSCRIPTION_HALTED' || type === 'BILLING_OVER_CAP') return 'Billing'
  return 'Other'
}

/** One icon per group (design/dc icon names). */
const GROUP_ICON: Record<string, string> = {
  Leave: 'calendar', 'Work from home': 'home', Attendance: 'clock', Shifts: 'swap', 'Expenses and advances': 'receipt',
  Approvals: 'inbox', Payroll: 'creditCard', Documents: 'fileText', Assets: 'laptop', Policies: 'shield', Hiring: 'briefcase',
  Learning: 'award', Performance: 'target', Team: 'users', People: 'userCheck', Letters: 'filePen', Billing: 'banknote', Other: 'bell',
}
export const iconForGroup = (group: string) => GROUP_ICON[group] ?? 'bell'

// Known web-route prefixes. A data.route that doesn't start with one of these is an Expo Router
// (mobile app) route — /requests-tab, /leaves/[id], /my-claims — that the web can't open.
const WEB_ROUTE_PREFIXES = [
  '/hrms/', '/me/', '/me', '/settings/', '/settings', '/plan',
  '/team', '/dashboard', '/analytics', '/audit-logs', '/users',
  '/roles', '/modules', '/files',
] as const

export function isWebShapedRoute(path: string): boolean {
  if (path === '/') return true
  if (path.includes('[') || path.includes(']')) return false // Expo bracket segments
  return WEB_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(p + '?') || path.startsWith(p + '/') || (p.endsWith('/') && path.startsWith(p)))
}

/**
 * The *_CANCELLED events fan out to BOTH the requester and the approver. The server may hint the
 * recipient in data.audience / data.recipient_role; otherwise it is inferred from the signed-in user.
 */
type RecipientRole = 'requester' | 'approver'
function inferRecipientRoleFromHint(data?: Record<string, unknown> | null): RecipientRole | null {
  const hintRaw =
    (typeof data?.audience === 'string' ? (data.audience as string) : undefined) ??
    (typeof data?.recipient_role === 'string' ? (data.recipient_role as string) : undefined) ??
    (typeof data?.recipientRole === 'string' ? (data.recipientRole as string) : undefined)
  // The server sends a cancellation to the approver with the app's approvals inbox as its route
  // (DomainEventListener onLeaveCancelled / onWfhCancelled), so that route says which side this is.
  // Without it an owner, whose role isn't in APPROVER_ROLES, was sent to their own leave list.
  if (!hintRaw) return typeof data?.route === 'string' && data.route.split(/[?#]/)[0] === '/requests-tab' ? 'approver' : null
  const hint = hintRaw.toLowerCase()
  if (hint === 'requester' || hint === 'employee' || hint === 'owner' || hint === 'self') return 'requester'
  if (hint === 'approver' || hint === 'manager' || hint === 'admin' || hint === 'hr' || hint === 'hr_manager') return 'approver'
  return null
}

/** Fall-back: is the signed-in user on the approver side? Plain EMPLOYEE = requester side. */
function currentUserIsApprover(): boolean {
  try {
    const roles = useSdkAuthStore.getState().user?.roles ?? []
    const APPROVER_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'FINANCE_LEAD']
    return roles.some((r) => APPROVER_ROLES.includes(r))
  } catch {
    return false
  }
}

function currentEmployeeId(): string | undefined {
  try {
    const token = getAccessToken()
    return token ? jwtDecode<{ employee_id?: string }>(token).employee_id ?? undefined : undefined
  } catch {
    return undefined
  }
}

/** A page or tab that is live in this release, else `fallback` (pages built later aren't targets yet). */
export function livePath(path: string, fallback: string): string {
  return PAGE_REGISTRY.some((e) => e.path === path) ? path : fallback
}

/** Where an undone decision is seen by the employee, by the journal's kind (DecisionKind). */
const UNDONE_ROUTE: Record<string, string> = {
  LEAVE: '/hrms/leave?tab=my', WFH: '/me/wfh', CORRECTION: '/hrms/attendance?tab=corrections',
  SHIFT_CHANGE: '/me/shift-change', EXPENSE: '/hrms/expenses?tab=my',
}

export interface RouteContext {
  /** The signed-in person is on the approver side (default: from their roles). */
  approver?: boolean
  /** The signed-in person's employee id (default: from the session). */
  employeeId?: string
}

export function webRouteFor(type: string, data?: Record<string, unknown> | null, ctx: RouteContext = {}): string {
  const raw = typeof data?.route === 'string' ? (data.route as string) : undefined
  // The sender's route wins only when it is a web route.
  if (raw && isWebShapedRoute(raw)) return raw
  const isApprover = () => (ctx.approver ?? currentUserIsApprover())
  const side = () => inferRecipientRoleFromHint(data) ?? (isApprover() ? 'approver' : 'requester')

  switch (type) {
    // Leave: approvers work the queue; the requester sees their own list.
    case 'LEAVE_SUBMITTED': return '/hrms/leave?tab=approvals'
    case 'LEAVE_CANCELLED': return side() === 'approver' ? '/hrms/leave?tab=approvals' : '/hrms/leave?tab=my'
    // WFH
    case 'WFH_APPROVED': case 'WFH_REJECTED': return '/me/wfh'
    case 'WFH_SUBMITTED': return '/hrms/leave?tab=approvals'
    case 'WFH_CANCELLED': return side() === 'approver' ? '/hrms/leave?tab=approvals' : '/me/wfh'
    // Attendance
    case 'ATTENDANCE_STATUS_CHANGED': return '/hrms/attendance?tab=my'
    // An employee asked for overtime: their approver's overtime queue.
    case 'OVERTIME_REQUESTED': return '/hrms/shifts?tab=overtime'
    case 'OVERTIME_APPROVED': case 'OVERTIME_REJECTED': return '/hrms/attendance?tab=my'
    case 'CHECKIN_REMINDER': return '/me'
    // Someone punched in: today's Daily Logs (the row also links to the map, mapUrlFor).
    case 'PUNCH_IN_ALERT': return livePath('/hrms/attendance?tab=team', '/hrms/attendance')
    case 'TIMESHEET_SUBMITTED': return livePath('/team?view=approvals', '/team')
    case 'TIMESHEET_DECIDED': return livePath('/hrms/attendance?tab=timesheet', '/hrms/attendance')
    // Shifts
    case 'SHIFT_CHANGE_APPROVED': case 'SHIFT_CHANGE_REJECTED': return '/me/shift-change'
    case 'SHIFT_CHANGE_SUBMITTED': return '/hrms/shifts'
    // Your schedule: My Shift until the My Schedule page arrives (shift planning Phase 2). The sender's route is the app's.
    case 'ROSTER_PUBLISHED': case 'ROSTER_DAY_CHANGED': return '/hrms/shifts?tab=myshift'
    // Face enrollment happens in the mobile app; Home is the closest web page.
    case 'FACE_ENROLLMENT_COMPLETE': case 'FACE_ENROLLMENT_FAILED': return '/me'
    // HR reset your face: your profile's Face enrollment, where you can enroll it again.
    case 'FACE_ENROLLMENT_RESET': return '/profile#st-face'
    // Expenses and advances
    case 'EXPENSE_SUBMITTED': return '/hrms/expenses?tab=approvals'
    case 'EXPENSE_APPROVED': case 'EXPENSE_REJECTED': case 'EXPENSE_CLAIM_RAISED_FOR_YOU': return '/hrms/expenses?tab=my'
    case 'ADVANCE_SUBMITTED': return '/hrms/advances'
    case 'ADVANCE_APPROVED': case 'ADVANCE_REJECTED': return '/hrms/advances?tab=my'
    case 'ADVANCE_RAISED_FOR_YOU': return '/hrms/advances'
    // Approvals taken back: where the employee sees that kind of request.
    case 'DECISION_UNDONE': return UNDONE_ROUTE[String(data?.kind ?? '')] ?? '/me'
    // Payroll
    case 'SALARY_REVISED': return '/me/salary'
    case 'PAYSLIP_QUERY_RAISED': return '/hrms/payroll-dashboard'
    case 'PAYSLIP_QUERY_ANSWERED': return '/me/payslips'
    // Documents and letters
    case 'DOCUMENT_UPLOADED': return '/hrms/documents/pending'
    case 'DOCUMENT_VERIFIED': case 'DOCUMENT_REJECTED': return '/hrms/documents?view=my'
    case 'LETTER_SIGNATURE_REQUESTED': return '/hrms/letters/my'
    case 'ASSET_ISSUE_REPORTED': return '/hrms/onboarding/instances?view=assets'
    // Policies (the sender carries a web route; this is the same page)
    case 'POLICY_PUBLISHED': case 'POLICY_REMINDER': return '/hrms/policies'
    // Hiring, learning, performance
    case 'INTERVIEW_SCHEDULED': case 'INTERVIEW_RESCHEDULED': case 'INTERVIEW_CANCELLED': return '/me/interviews'
    case 'SKILL_ASSESSMENT_SUBMITTED': return '/hrms/learning?view=approvals'
    case 'SKILL_ASSESSMENT_APPROVED': case 'SKILL_ASSESSMENT_REJECTED': return '/hrms/learning?view=my'
    case 'PERFORMANCE_REVIEW_REMINDER': return '/hrms/performance?view=my-reviews'
    // Team and people
    case 'TEAM_MESSAGE': return '/me'
    case 'PROBATION_TEAM_DECISION': {
      const who = typeof data?.employeeId === 'string' ? (data.employeeId as string) : undefined
      const me = ctx.employeeId ?? currentEmployeeId()
      if (!who || who === me) return '/profile'
      return `/hrms/employees/${who}`
    }
    case 'RETIREMENT_DUE': return typeof data?.employeeId === 'string' ? `/hrms/employees/${data.employeeId}` : '/dashboard'
    // A colleague wished you: the Celebrations page, with "Your wishes" (the route sent is the app's).
    case 'CELEBRATION_WISH': return '/me/celebrations'
    // Billing: the plan page explains each case.
    case 'TRIAL_ENDING_SOON': case 'TRIAL_EXPIRED': case 'SUBSCRIPTION_HALTED': case 'BILLING_OVER_CAP':
    case 'PAYMENT_DUE_SOON': case 'PAYMENT_OVERDUE': return '/plan'
    case 'WELCOME': return '/'
    // A colleague's birthday or work anniversary (MilestoneReminderService: a GENERAL row whose
    // data.type is MILESTONE_*, with the app's /milestones): Celebrations, not Home.
    case 'GENERAL':
      if (typeof data?.type === 'string' && data.type.startsWith('MILESTONE_') && data.route === '/milestones') return '/me/celebrations'
      break
  }
  if (type.startsWith('LEAVE_')) return '/hrms/leave?tab=my'
  if (type.startsWith('CORRECTION_')) return '/hrms/attendance?tab=corrections'
  // Unknown types: the person's own Home (/dashboard sends people without an admin home to /me).
  return '/dashboard'
}

/** Severity (the dead NotificationPanel's tone). */
export function severityFor(type: string): 'success' | 'warning' | 'error' | 'info' {
  if (type.endsWith('_APPROVED') || type === 'FACE_ENROLLMENT_COMPLETE' || type === 'WELCOME') return 'success'
  if (type.endsWith('_REJECTED') || type === 'FACE_ENROLLMENT_FAILED' || type === 'TRIAL_EXPIRED' || type === 'SUBSCRIPTION_HALTED' || type === 'PAYMENT_OVERDUE') return 'error'
  if (type.endsWith('_SUBMITTED') || type === 'TRIAL_ENDING_SOON' || type === 'PAYMENT_DUE_SOON' || type === 'BILLING_OVER_CAP' || type === 'FACE_ENROLLMENT_RESET') return 'warning'
  return 'info'
}

/** "now", "12 min ago", "3 hr ago", "Yesterday", "31 Aug" (the design's meta line). */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const mins = Math.floor((now.getTime() - t.getTime()) / 60_000)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins} min ago`
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (t >= start) return `${Math.floor(mins / 60)} hr ago`
  const yesterday = new Date(start.getTime() - 86_400_000)
  if (t >= yesterday) return 'Yesterday'
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(t.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

const GOOGLE_MAPS = 'https://www.google.com/maps?q='

/**
 * The map link of a punch-in alert (PUNCH_IN_ALERT), or null. Built from the payload's own
 * coordinates when they are real numbers; otherwise only a Google Maps link the server sent is
 * used, so a notification can never open anywhere else.
 */
export function mapUrlFor(type: string, data?: Record<string, unknown> | null): string | null {
  if (type !== 'PUNCH_IN_ALERT' || !data) return null
  const lat = typeof data.latitude === 'number' ? data.latitude : Number.NaN
  const lng = typeof data.longitude === 'number' ? data.longitude : Number.NaN
  if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
    return `${GOOGLE_MAPS}${lat.toFixed(6)},${lng.toFixed(6)}`
  }
  const sent = typeof data.mapUrl === 'string' ? data.mapUrl : ''
  return /^https:\/\/www\.google\.com\/maps\?q=-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(sent) ? sent : null
}

export const LAST_DAYS = 7
/** Rows from the last 7 days (the popover's "Last 7 days"). */
export function withinDays<T extends { createdAt: string }>(rows: readonly T[], now: Date = new Date(), days = LAST_DAYS): T[] {
  const from = now.getTime() - days * 86_400_000
  return rows.filter((r) => { const t = new Date(r.createdAt).getTime(); return !Number.isNaN(t) && t >= from })
}

/**
 * The popover's rows, in the order given (newest first): every unread one, however old (the badge
 * counts them all, so each must be there to be read), then read ones from the last 7 days up to
 * {@code max} rows in all.
 */
export function bellRows<T extends { createdAt: string; isRead: boolean }>(rows: readonly T[], now: Date = new Date(), max = 8): T[] {
  const unread = rows.filter((r) => !r.isRead)
  const read = withinDays(rows.filter((r) => r.isRead), now).slice(0, Math.max(0, max - unread.length))
  const keep = new Set<T>([...unread, ...read])
  return rows.filter((r) => keep.has(r))
}
