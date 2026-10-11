// Every notification type, clicked by each kind of person (client report 7 Oct 2026: "when they
// clicked on the notification it showed a full white page and nothing"). For the payload each sender
// really writes (data.route and ids, as in DomainEventListener and the notifier services), the bell
// must open a route App.tsx has, whose permission gates let that person in for every type they are
// sent. The pages themselves are clicked in e2e/recovery/live-w3-w62-notifclick.mjs.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { P } from '@unifiedtree/sdk'
import { TEAM_APPROVE_CODES } from '@/shared/navigation/shellCodes'
import { NOTIFICATION_TYPES, webRouteFor } from './notificationRoutes'
import ROLE_PERMISSIONS from './__fixtures__/builtInRolePermissions.json'

const appSource = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

// ── App.tsx's routes and their permission gates ─────────────────────────────
type Gate = string[] // the person needs any one of these codes
interface AppRoute { path: string; re: RegExp; params: number; gates: Gate[] }

const codesOf = (expr: string): string[] => {
  if (expr.trim() === 'TEAM_ROUTE_CODES') return [P.ATTENDANCE_TEAM_READ, P.HRMS_LEAVE_APPROVE_L1, ...TEAM_APPROVE_CODES]
  return expr.replace(/^\s*\[|\]\s*$/g, '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const p = /^P\.([A-Z0-9_]+)$/.exec(t)
    if (p) {
      const code = (P as Record<string, string>)[p[1]]
      if (!code) throw new Error(`unknown permission constant ${t}`)
      return code
    }
    const lit = /^'([^']+)'$/.exec(t)
    if (lit) return lit[1]
    throw new Error(`can't read the gate ${t}`)
  })
}

const ROUTES: AppRoute[] = [...appSource.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"([\s\S]*?)(?=<Route\b|<\/>\s*\)\s*$)/g)]
  .filter((m) => m[1] !== '*')
  .map((m) => {
    const body = m[2]
    const gates = [
      ...[...body.matchAll(/anyOf=\{(\[[^\]]*\]|[A-Z_]+)\}/g)].map((g) => codesOf(g[1])),
      ...[...body.matchAll(/RequirePermission code=\{([^}]+)\}/g)].map((g) => codesOf(`[${g[1]}]`)),
    ]
    const re = new RegExp('^' + m[1].replace(/\/:[a-zA-Z]+\?/g, '(/[^/]+)?').replace(/:[a-zA-Z]+/g, '[^/]+').replace(/\/\*$/, '(/.*)?') + '$')
    return { path: m[1], re, params: (m[1].match(/[:*]/g) ?? []).length, gates }
  })

/** The route React Router picks for a path: static segments win over parameters. */
function routeOf(to: string): AppRoute | undefined {
  const bare = to.split(/[?#]/)[0]
  return ROUTES.filter((r) => r.re.test(bare)).sort((a, b) => a.params - b.params)[0]
}

// ── The people ──────────────────────────────────────────────────────────────
interface Person { who: string; roles: string[]; perms: Set<string> | 'all'; employeeId: string }
const OWNER_ID = '11111111-1111-1111-1111-111111111111'
const READER_ID = '22222222-2222-2222-2222-222222222222'
const PEOPLE: Person[] = [
  { who: 'owner', roles: ['OWNER'], perms: 'all', employeeId: OWNER_ID },
  { who: 'hrm', roles: ['HR_MANAGER'], perms: new Set(ROLE_PERMISSIONS.HR_MANAGER), employeeId: '33333333-3333-3333-3333-333333333333' },
  { who: 'mgr', roles: ['DEPT_MANAGER'], perms: new Set(ROLE_PERMISSIONS.DEPT_MANAGER), employeeId: '44444444-4444-4444-4444-444444444444' },
  { who: 'reader', roles: ['EMPLOYEE'], perms: new Set(ROLE_PERMISSIONS.EMPLOYEE), employeeId: READER_ID },
]
// notificationRoutes.ts currentUserIsApprover: the roles it counts as the approver side.
const APPROVER_ROLES = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'FINANCE_LEAD']
const passes = (p: Person, gate: Gate) => p.perms === 'all' || gate.some((c) => (p.perms as Set<string>).has(c))

// Who each type is sent to (the catalog's audience); everyone else may get any of the rest.
const APPROVERS = ['owner', 'hrm', 'mgr']
const HR = ['owner', 'hrm']
const ADMINS = ['owner']
const AUDIENCE: Record<string, string[]> = {
  LEAVE_SUBMITTED: APPROVERS, LEAVE_CANCELLED: APPROVERS, WFH_SUBMITTED: APPROVERS, WFH_CANCELLED: APPROVERS,
  CORRECTION_SUBMITTED: APPROVERS, SHIFT_CHANGE_SUBMITTED: APPROVERS, EXPENSE_SUBMITTED: APPROVERS, ADVANCE_SUBMITTED: APPROVERS,
  OVERTIME_REQUESTED: APPROVERS, TIMESHEET_SUBMITTED: APPROVERS, SKILL_ASSESSMENT_SUBMITTED: APPROVERS, PUNCH_IN_ALERT: APPROVERS,
  DOCUMENT_UPLOADED: HR, LEAVE_ENCASHMENT_SUBMITTED: HR, ASSET_ISSUE_REPORTED: HR, PAYSLIP_QUERY_RAISED: HR, RETIREMENT_DUE: HR,
  TRIAL_ENDING_SOON: ADMINS, TRIAL_EXPIRED: ADMINS, SUBSCRIPTION_HALTED: ADMINS, PAYMENT_DUE_SOON: ADMINS, PAYMENT_OVERDUE: ADMINS, BILLING_OVER_CAP: ADMINS,
}
const sentTo = (type: string, who: string) => (AUDIENCE[type] ?? PEOPLE.map((p) => p.who)).includes(who)

// What each sender puts in data (rd/int e232563b).
const PAYLOAD: Record<string, Record<string, unknown>> = {
  LEAVE_SUBMITTED: { route: '/requests-tab', leaveRequestId: 'l1' }, LEAVE_APPROVED: { route: '/leave-history' }, LEAVE_REJECTED: { route: '/leave-history' },
  LEAVE_CANCELLED: { route: '/requests-tab', leaveRequestId: 'l1' },
  FACE_ENROLLMENT_COMPLETE: { route: '/face-enroll' }, FACE_ENROLLMENT_FAILED: { route: '/face-enroll' }, FACE_ENROLLMENT_RESET: { route: '/face-enroll?reason=reset' },
  WFH_SUBMITTED: { route: '/requests-tab' }, WFH_APPROVED: { route: '/wfh-apply' }, WFH_REJECTED: { route: '/wfh-apply' }, WFH_CANCELLED: { route: '/requests-tab' },
  CORRECTION_SUBMITTED: { route: '/requests-tab' }, CORRECTION_APPROVED: { route: '/my-corrections' }, CORRECTION_REJECTED: { route: '/my-corrections' },
  SHIFT_CHANGE_SUBMITTED: { route: '/requests-tab' }, SHIFT_CHANGE_APPROVED: { route: '/shift-change' }, SHIFT_CHANGE_REJECTED: { route: '/shift-change' },
  EXPENSE_SUBMITTED: { route: '/requests-tab' }, EXPENSE_APPROVED: { route: '/my-claims' }, EXPENSE_REJECTED: { route: '/my-claims' },
  ADVANCE_SUBMITTED: { route: '/requests-tab' }, ADVANCE_APPROVED: { route: '/my-advances' }, ADVANCE_REJECTED: { route: '/my-advances' },
  ADVANCE_RAISED_FOR_YOU: { route: '/notifications' }, SALARY_REVISED: { route: '/notifications' },
  OVERTIME_REQUESTED: { route: '/hrms/shifts?tab=overtime' }, OVERTIME_APPROVED: { route: '/attendance' }, OVERTIME_REJECTED: { route: '/attendance' },
  ATTENDANCE_STATUS_CHANGED: { route: '/attendance-history' },
  DOCUMENT_UPLOADED: { route: '/documents/pending', employeeId: READER_ID }, DOCUMENT_VERIFIED: { route: '/profile' }, DOCUMENT_REJECTED: { route: '/profile' },
  LEAVE_ENCASHMENT_SUBMITTED: { route: '/hrms/leave?tab=encash', audience: 'approver' }, LEAVE_ENCASHMENT_APPROVED: { route: '/hrms/leave?tab=encash' },
  LEAVE_ENCASHMENT_REJECTED: { route: '/hrms/leave?tab=encash' },
  POLICY_PUBLISHED: { route: '/hrms/policies' }, POLICY_REMINDER: { route: '/hrms/policies' },
  INTERVIEW_SCHEDULED: { route: '/me/interviews' }, INTERVIEW_RESCHEDULED: { route: '/me/interviews' }, INTERVIEW_CANCELLED: { route: '/me/interviews' },
  SKILL_ASSESSMENT_SUBMITTED: { employeeId: READER_ID }, SKILL_ASSESSMENT_APPROVED: {}, SKILL_ASSESSMENT_REJECTED: {},
  WELCOME: { route: '/(tabs)' }, TRIAL_ENDING_SOON: { route: '/billing' }, TRIAL_EXPIRED: { route: '/billing' }, SUBSCRIPTION_HALTED: { route: '/plan' },
  PAYMENT_DUE_SOON: { route: '/plan', kind: 'DUE_SOON' }, PAYMENT_OVERDUE: { route: '/plan', kind: 'OVERDUE' }, BILLING_OVER_CAP: { route: '/plan' },
  RETIREMENT_DUE: { route: '/milestones', employeeId: READER_ID },
  DECISION_UNDONE: { kind: 'LEAVE', route: '/leave-history' }, CHECKIN_REMINDER: { route: '/(tabs)' },
  PERFORMANCE_REVIEW_REMINDER: { route: '/hrms/performance?view=my-reviews' }, TEAM_MESSAGE: { route: '/notifications' },
  ASSET_ISSUE_REPORTED: { route: '/hrms/onboarding/instances?view=assets' }, PAYSLIP_QUERY_RAISED: { route: '/hrms/payroll-dashboard' },
  PAYSLIP_QUERY_ANSWERED: { route: '/me/payslips' }, LEAVE_APPLIED_ON_BEHALF: { route: '/leave-history' }, EXPENSE_CLAIM_RAISED_FOR_YOU: { route: '/my-claims' },
  TIMESHEET_SUBMITTED: { route: '/requests-tab' }, TIMESHEET_DECIDED: { weekStart: '2026-09-28' }, LETTER_SIGNATURE_REQUESTED: { route: '/hrms/letters/my' },
  PROBATION_TEAM_DECISION: { route: '/notifications', employeeId: READER_ID },
  PUNCH_IN_ALERT: { route: '/notifications', employeeId: READER_ID, latitude: 17.38504, longitude: 78.48667 },
  CELEBRATION_WISH: { route: '/milestones', occasion: 'BIRTHDAY' },
  // Shift planning (V143_106, RosterNotifier): your roster was published, or a republish changed your days.
  ROSTER_PUBLISHED: { route: '/my-schedule', rosterId: 'r1', from: '2026-10-01', to: '2026-10-31' },
  ROSTER_DAY_CHANGED: { route: '/my-schedule', rosterId: 'r1', dates: ['2026-10-12', '2026-10-13'] },
  GENERAL: { type: 'MILESTONE_BIRTHDAY', route: '/milestones', employeeId: READER_ID, self: false },
}

const targetFor = (type: string, p: Person) =>
  webRouteFor(type, { type, ...PAYLOAD[type] }, { approver: p.roles.some((r) => APPROVER_ROLES.includes(r)), employeeId: p.employeeId })

describe('a notification click, per person', () => {
  it('reads the routes and gates App.tsx declares', () => {
    expect(ROUTES.length).toBeGreaterThan(80)
    expect(routeOf('/hrms/leave?tab=approvals')?.gates).toEqual([[P.HRMS_LEAVE_READ, P.HRMS_ESS_READ, P.LEAVE_REQUEST_SELF]])
    expect(routeOf('/hrms/employees/abc')?.path).toBe('/hrms/employees/:id')
    expect(routeOf('/hrms/employees/import')?.path).toBe('/hrms/employees/import')
  })

  it('has a payload for every type the server sends', () => {
    expect(Object.keys(PAYLOAD).sort()).toEqual([...NOTIFICATION_TYPES].sort())
  })

  for (const person of PEOPLE) {
    it(`${person.who}: every type opens a real page${person.who === 'owner' ? '' : ' that this person can open when it is sent to them'}`, () => {
      const problems: string[] = []
      for (const type of NOTIFICATION_TYPES) {
        const to = targetFor(type, person)
        const route = routeOf(to)
        if (!route) { problems.push(`${type} -> ${to}: no such page`); continue }
        if (!sentTo(type, person.who)) continue
        const shut = route.gates.find((g) => !passes(person, g))
        if (shut) problems.push(`${type} -> ${to}: needs one of ${shut.join(', ')}`)
      }
      expect(problems).toEqual([])
    })
  }

  it('sends an approver who is told of a cancellation to the approvals, whatever their role', () => {
    const owner = PEOPLE[0]
    expect(targetFor('LEAVE_CANCELLED', owner)).toBe('/hrms/leave?tab=approvals')
    expect(targetFor('WFH_CANCELLED', owner)).toBe('/hrms/leave?tab=approvals')
    // A server that says who it is for still wins.
    expect(webRouteFor('LEAVE_CANCELLED', { route: '/requests-tab', audience: 'requester' }, { approver: true })).toBe('/hrms/leave?tab=my')
    // Without a route the signed-in person's roles decide, as before.
    expect(webRouteFor('WFH_CANCELLED', null, { approver: false })).toBe('/me/wfh')
  })

  it("opens a colleague's birthday or anniversary on Celebrations; other general notices go Home", () => {
    expect(webRouteFor('GENERAL', { type: 'MILESTONE_WORK_ANNIVERSARY', route: '/milestones', self: false })).toBe('/me/celebrations')
    expect(webRouteFor('GENERAL', { type: 'MILESTONE_BIRTHDAY', self: true })).toBe('/dashboard')
    expect(webRouteFor('GENERAL', { route: '/milestones' })).toBe('/dashboard')
    expect(webRouteFor('GENERAL', null)).toBe('/dashboard')
  })
})
