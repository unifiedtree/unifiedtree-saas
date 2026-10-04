import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { NOTIFICATION_TYPES, groupFor, iconForGroup, isWebShapedRoute, livePath, mapUrlFor, timeAgo, webRouteFor, withinDays } from './notificationRoutes'
import { toDisplay } from './notificationStore'

// Every route pattern App.tsx registers ("/hrms/employees/:id" → a regex).
const appSource = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const ROUTES = [...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).filter((p) => p !== '*')
const routeRe = (p: string) => new RegExp('^' + p.replace(/\/:[a-zA-Z]+\?/g, '(/[^/]+)?').replace(/:[a-zA-Z]+/g, '[^/]+').replace(/\/\*$/, '(/.*)?') + '$')
const isAppRoute = (path: string) => ROUTES.some((r) => routeRe(r).test(path.split(/[?#]/)[0]))

// The catalog's group per type (NotificationEventCatalog), copied from the server.
const CATALOG: Record<string, string> = {
  LEAVE_SUBMITTED: 'Leave', LEAVE_APPROVED: 'Leave', LEAVE_REJECTED: 'Leave', LEAVE_CANCELLED: 'Leave', LEAVE_APPLIED_ON_BEHALF: 'Leave',
  LEAVE_ENCASHMENT_SUBMITTED: 'Leave', LEAVE_ENCASHMENT_APPROVED: 'Leave', LEAVE_ENCASHMENT_REJECTED: 'Leave',
  WFH_SUBMITTED: 'Work from home', WFH_APPROVED: 'Work from home', WFH_REJECTED: 'Work from home', WFH_CANCELLED: 'Work from home',
  CORRECTION_SUBMITTED: 'Attendance', CORRECTION_APPROVED: 'Attendance', CORRECTION_REJECTED: 'Attendance',
  OVERTIME_REQUESTED: 'Attendance', OVERTIME_APPROVED: 'Attendance', OVERTIME_REJECTED: 'Attendance', FACE_ENROLLMENT_COMPLETE: 'Attendance', FACE_ENROLLMENT_FAILED: 'Attendance',
  ATTENDANCE_STATUS_CHANGED: 'Attendance', CHECKIN_REMINDER: 'Attendance', TIMESHEET_SUBMITTED: 'Attendance', TIMESHEET_DECIDED: 'Attendance',
  SHIFT_CHANGE_SUBMITTED: 'Shifts', SHIFT_CHANGE_APPROVED: 'Shifts', SHIFT_CHANGE_REJECTED: 'Shifts',
  EXPENSE_SUBMITTED: 'Expenses and advances', EXPENSE_APPROVED: 'Expenses and advances', EXPENSE_REJECTED: 'Expenses and advances',
  ADVANCE_SUBMITTED: 'Expenses and advances', ADVANCE_APPROVED: 'Expenses and advances', ADVANCE_REJECTED: 'Expenses and advances',
  ADVANCE_RAISED_FOR_YOU: 'Expenses and advances', EXPENSE_CLAIM_RAISED_FOR_YOU: 'Expenses and advances',
  DECISION_UNDONE: 'Approvals', SALARY_REVISED: 'Payroll', PAYSLIP_QUERY_RAISED: 'Payroll', PAYSLIP_QUERY_ANSWERED: 'Payroll',
  DOCUMENT_UPLOADED: 'Documents', DOCUMENT_VERIFIED: 'Documents', DOCUMENT_REJECTED: 'Documents', ASSET_ISSUE_REPORTED: 'Assets',
  POLICY_PUBLISHED: 'Policies', POLICY_REMINDER: 'Policies', INTERVIEW_SCHEDULED: 'Hiring', INTERVIEW_RESCHEDULED: 'Hiring', INTERVIEW_CANCELLED: 'Hiring',
  SKILL_ASSESSMENT_SUBMITTED: 'Learning', SKILL_ASSESSMENT_APPROVED: 'Learning', SKILL_ASSESSMENT_REJECTED: 'Learning',
  PERFORMANCE_REVIEW_REMINDER: 'Performance', TEAM_MESSAGE: 'Team', WELCOME: 'People', RETIREMENT_DUE: 'People', PROBATION_TEAM_DECISION: 'People',
  PUNCH_IN_ALERT: 'Attendance',
  LETTER_SIGNATURE_REQUESTED: 'Letters', SUBSCRIPTION_HALTED: 'Billing', BILLING_OVER_CAP: 'Billing', TRIAL_ENDING_SOON: 'Billing', TRIAL_EXPIRED: 'Billing',
  GENERAL: 'Other',
}

// The mobile routes the server sends today (they must never be opened on the web).
const MOBILE = ['/requests-tab', '/leave-history', '/my-claims', '/my-advances', '/notifications', '/attendance', '/attendance-history', '/documents/pending', '/profile', '/(tabs)', '/wfh-apply', '/my-corrections', '/shift-change', '/leaves/[id]']

describe('notification routes', () => {
  it('maps every server type to its catalog group', () => {
    expect(NOTIFICATION_TYPES.length).toBe(Object.keys(CATALOG).length)
    for (const t of NOTIFICATION_TYPES) expect([t, groupFor(t)]).toEqual([t, CATALOG[t]])
  })
  it('gives every group an icon', () => {
    for (const g of new Set(Object.values(CATALOG))) expect(iconForGroup(g)).not.toBe(undefined)
  })
  it('opens every type on a real web route, for both sides, with or without the mobile route', () => {
    for (const t of NOTIFICATION_TYPES) {
      for (const approver of [true, false]) {
        for (const route of [undefined, ...MOBILE]) {
          const to = webRouteFor(t, route ? { route, employeeId: '11111111-1111-1111-1111-111111111111', kind: 'LEAVE' } : null, { approver, employeeId: 'me' })
          expect([t, to, isAppRoute(to)]).toEqual([t, to, true])
        }
      }
    }
  })
  it('sends only the bare fall-backs to /dashboard', () => {
    const toDash = NOTIFICATION_TYPES.filter((t) => webRouteFor(t, null, { approver: false, employeeId: 'me' }) === '/dashboard')
    expect(toDash).toEqual(['RETIREMENT_DUE', 'GENERAL'])
  })
  it('routes the types the web ignored before', () => {
    expect(webRouteFor('EXPENSE_SUBMITTED', { route: '/requests-tab' })).toBe('/hrms/expenses?tab=approvals')
    expect(webRouteFor('EXPENSE_REJECTED', { route: '/my-claims' })).toBe('/hrms/expenses?tab=my')
    expect(webRouteFor('ADVANCE_APPROVED', { route: '/my-advances' })).toBe('/hrms/advances?tab=my')
    expect(webRouteFor('OVERTIME_APPROVED', { route: '/attendance' })).toBe('/hrms/attendance?tab=my')
    expect(webRouteFor('OVERTIME_REQUESTED', { route: '/hrms/shifts?tab=overtime' })).toBe('/hrms/shifts?tab=overtime')
    expect(webRouteFor('OVERTIME_REQUESTED', null)).toBe('/hrms/shifts?tab=overtime')
    expect(webRouteFor('DOCUMENT_UPLOADED', { route: '/documents/pending' })).toBe('/hrms/documents/pending')
    expect(webRouteFor('DOCUMENT_VERIFIED', { route: '/profile' })).toBe('/hrms/documents?view=my')
  })
  it('routes the redesign types', () => {
    expect(webRouteFor('DECISION_UNDONE', { route: '/wfh-apply', kind: 'WFH' })).toBe('/me/wfh')
    expect(webRouteFor('DECISION_UNDONE', { route: '/my-claims', kind: 'EXPENSE' })).toBe('/hrms/expenses?tab=my')
    expect(webRouteFor('PAYSLIP_QUERY_RAISED', { route: '/hrms/payroll-dashboard' })).toBe('/hrms/payroll-dashboard')
    expect(webRouteFor('ASSET_ISSUE_REPORTED', { route: '/hrms/onboarding/instances?view=assets' })).toBe('/hrms/onboarding/instances?view=assets')
    expect(webRouteFor('PROBATION_TEAM_DECISION', { route: '/notifications', employeeId: 'e1' }, { employeeId: 'e1' })).toBe('/profile')
    expect(webRouteFor('PROBATION_TEAM_DECISION', { route: '/notifications', employeeId: 'e1' }, { employeeId: 'hr' })).toBe('/hrms/employees/e1')
    // Pages that aren't live in this release are never targets.
    const timesheetLive = PAGE_REGISTRY.some((e) => e.path === '/hrms/attendance?tab=timesheet')
    expect(webRouteFor('TIMESHEET_DECIDED', null)).toBe(timesheetLive ? '/hrms/attendance?tab=timesheet' : '/hrms/attendance')
    expect(livePath('/no/such/page', '/hrms/attendance')).toBe('/hrms/attendance')
  })
  it('opens a punch-in alert on Daily Logs, with a map link built from its own coordinates', () => {
    const data = { route: '/notifications', latitude: 17.38504, longitude: 78.48667, mapUrl: 'https://www.google.com/maps?q=17.385040,78.486670' }
    expect(webRouteFor('PUNCH_IN_ALERT', data)).toBe(livePath('/hrms/attendance?tab=team', '/hrms/attendance'))
    expect(mapUrlFor('PUNCH_IN_ALERT', data)).toBe('https://www.google.com/maps?q=17.385040,78.486670')
    expect(mapUrlFor('PUNCH_IN_ALERT', { latitude: -33.8688, longitude: 151.2093 })).toBe('https://www.google.com/maps?q=-33.868800,151.209300')
    // Only a Google Maps link the server sent, never anything else, and nothing without a place.
    expect(mapUrlFor('PUNCH_IN_ALERT', { mapUrl: 'https://www.google.com/maps?q=12.9,77.6' })).toBe('https://www.google.com/maps?q=12.9,77.6')
    expect(mapUrlFor('PUNCH_IN_ALERT', { mapUrl: 'https://evil.example/maps?q=1,2' })).toBeNull()
    expect(mapUrlFor('PUNCH_IN_ALERT', { mapUrl: 'javascript:alert(1)' })).toBeNull()
    expect(mapUrlFor('PUNCH_IN_ALERT', { latitude: 0, longitude: 0 })).toBeNull()
    expect(mapUrlFor('PUNCH_IN_ALERT', { latitude: '17.4', longitude: '78.4' })).toBeNull()
    expect(mapUrlFor('PUNCH_IN_ALERT', null)).toBeNull()
    expect(mapUrlFor('LEAVE_SUBMITTED', data)).toBeNull()
  })
  it('a punch-in alert in the bell carries its map link; other rows none', () => {
    const row = toDisplay({
      id: 'n1', type: 'PUNCH_IN_ALERT', title: 'Priya Rao punched in at 9:42 am', body: 'At Head Office. Face scan in the app.',
      data: { route: '/notifications', latitude: 17.38504, longitude: 78.48667 }, readAt: null, createdAt: '2026-10-05T04:12:05Z', group: 'Attendance',
    })
    expect(row).toMatchObject({ kind: 'PUNCH_IN_ALERT', group: 'Attendance', icon: 'clock', mapUrl: 'https://www.google.com/maps?q=17.385040,78.486670' })
    expect(row.link).toBe(livePath('/hrms/attendance?tab=team', '/hrms/attendance'))
    expect(toDisplay({ id: 'n2', type: 'LEAVE_SUBMITTED', title: 'New leave request', body: '', data: { route: '/requests-tab' }, readAt: null, createdAt: '2026-10-05T04:12:05Z' }).mapUrl).toBeNull()
  })
  it('keeps the cancelled fan-out per recipient', () => {
    expect(webRouteFor('LEAVE_CANCELLED', { audience: 'approver' })).toBe('/hrms/leave?tab=approvals')
    expect(webRouteFor('LEAVE_CANCELLED', null, { approver: false })).toBe('/hrms/leave?tab=my')
    expect(webRouteFor('WFH_CANCELLED', null, { approver: true })).toBe('/hrms/leave?tab=approvals')
  })
  it('recognises web and mobile routes', () => {
    expect(isWebShapedRoute('/hrms/policies')).toBe(true)
    for (const m of MOBILE) expect([m, isWebShapedRoute(m)]).toEqual([m, false])
  })
  it('says how long ago, as the design does', () => {
    const now = new Date(2026, 8, 30, 15, 0)
    expect(timeAgo(new Date(2026, 8, 30, 14, 59, 40).toISOString(), now)).toBe('now')
    expect(timeAgo(new Date(2026, 8, 30, 14, 48).toISOString(), now)).toBe('12 min ago')
    expect(timeAgo(new Date(2026, 8, 30, 12, 0).toISOString(), now)).toBe('3 hr ago')
    expect(timeAgo(new Date(2026, 8, 29, 20, 0).toISOString(), now)).toBe('Yesterday')
    expect(timeAgo(new Date(2026, 7, 31, 9, 0).toISOString(), now)).toBe('31 Aug')
  })
  it('keeps the last 7 days', () => {
    const now = new Date(2026, 8, 30, 15, 0)
    const rows = [{ createdAt: new Date(2026, 8, 24, 16, 0).toISOString() }, { createdAt: new Date(2026, 8, 22, 9, 0).toISOString() }, { createdAt: 'bad' }]
    expect(withinDays(rows, now)).toHaveLength(1)
  })
})
