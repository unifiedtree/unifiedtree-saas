// "Page not found" (F-20): an address no page answers to shows the not-found screen in the shell,
// and every address the app itself links to, or used to (the crash sweep's old links, the moved
// HRMS settings hub, the menu, notification targets), still reaches its page or redirect.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, createRoutesFromChildren, matchRoutes } from 'react-router-dom'

vi.mock('@/design/shell/useHome', () => ({ useHome: () => ({ ready: true, kind: 'self', path: '/me', label: 'Home', team: false }) }))

import { NotFound } from './NotFound'
import { ROUTE_TREE } from '@/App'
import { PAGE_REGISTRY } from '@/shared/navigation/pageRegistry'
import { webRouteFor } from '@/core/notifications/notificationRoutes'

const render = (entries: string[]) =>
  renderToStaticMarkup(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><NotFound /></MemoryRouter>)

describe('NotFound', () => {
  it('says the page is not found and shows the address', () => {
    const s = render(['/hrms/no-such-page?tab=x'])
    expect(s).toContain('Page not found')
    expect(s).toContain('/hrms/no-such-page?tab=x')
    expect(s).toContain('Go to Home')
  })

  it('offers Back only when there is a page to go back to', () => {
    expect(render(['/nope'])).not.toContain('Back')
    expect(render(['/me', '/nope'])).toContain('Back')
  })
})

const routes = createRoutesFromChildren(ROUTE_TREE)
/** The path pattern of the deepest route an address lands on. */
const landsOn = (address: string) => {
  const m = matchRoutes(routes, address.split('#')[0])
  return m?.[m.length - 1]?.route.path
}

describe('the catch-all route', () => {
  it('an unknown address lands on the not-found route', () => {
    for (const a of ['/nope', '/hrms/nope', '/hrms/settings/nope/deeper', '/me/nope']) expect(landsOn(a), a).toBe('*')
  })

  it('old addresses keep reaching their page or redirect', () => {
    const OLD = [
      // live-crash-sweep.mjs EXTRA
      '/', '/dashboard', '/modules', '/profile', '/hrms/ess', '/me/celebrations', '/hrms/onboarding', '/hrms/settings/work-time', '/analytics', '/files',
      '/settings', '/settings/profile', '/settings/branding', '/settings/notifications', '/settings/integrations', '/settings/documents', '/settings/billing', '/settings/danger', '/settings/security',
      '/hrms/attendance/geofencing', '/payroll', '/module-workspace', '/hrms/soon/timesheets', '/hrms/settings/payroll', '/hrms/settings/access', '/documents/pending',
      '/hrms/onboarding/instances/new', '/hrms/employees/00000000-0000-0000-0000-000000000000', '/hrms/employees/not-an-id',
      '/crm', '/accounts', '/projects', '/inventory', '/procurement', '/sales', '/manufacturing', '/pos', '/reports', '/no-access',
      '/hrms/payroll/runs/00000000-0000-0000-0000-000000000000', '/hrms/performance/employees/00000000-0000-0000-0000-000000000000', '/hrms/learning/programs/00000000-0000-0000-0000-000000000000',
      '/hrms/onboarding/templates/00000000-0000-0000-0000-000000000000', '/hrms/onboarding/instances/00000000-0000-0000-0000-000000000000', '/hrms/letters/templates/00000000-0000-0000-0000-000000000000',
      '/hrms/letters/generated/00000000-0000-0000-0000-000000000000', '/hrms/letters/distributions/00000000-0000-0000-0000-000000000000',
      '/hrms/master/departments', '/hrms/master/branches', '/team', '/users', '/roles', '/audit-logs', '/hrms/muster-roll',
      // The short-lived HRMS settings hub (26 Sep) and the old integrations address
      '/hrms/settings/hr-configuration', '/hrms/settings/shift-rules', '/hrms/settings/leave-rules', '/hrms/settings/salary-components', '/hrms/settings/statutory',
      '/hrms/settings/expense-policies', '/hrms/settings/document-types', '/hrms/settings/policies', '/hrms/settings/notifications', '/hrms/settings/roles',
      '/settings/integrations/register',
    ]
    for (const a of OLD) expect(landsOn(a), a).not.toBe('*')
  })

  it('every page in the menu and search has a route', () => {
    for (const e of PAGE_REGISTRY) expect(landsOn(e.path.split('?')[0]), `${e.id} ${e.path}`).not.toBe('*')
  })

  it('every notification opens a page that exists', () => {
    const TYPES = ['LEAVE_SUBMITTED', 'LEAVE_APPROVED', 'WFH_APPROVED', 'WFH_SUBMITTED', 'ATTENDANCE_STATUS_CHANGED', 'OVERTIME_REQUESTED', 'OVERTIME_APPROVED',
      'CHECKIN_REMINDER', 'SHIFT_CHANGE_APPROVED', 'SHIFT_CHANGE_SUBMITTED', 'FACE_ENROLLMENT_COMPLETE', 'FACE_ENROLLMENT_RESET', 'EXPENSE_SUBMITTED', 'EXPENSE_APPROVED',
      'ADVANCE_SUBMITTED', 'ADVANCE_APPROVED', 'SALARY_REVISED', 'PAYSLIP_QUERY_RAISED', 'PAYSLIP_QUERY_ANSWERED', 'DOCUMENT_UPLOADED', 'DOCUMENT_VERIFIED',
      'LETTER_SIGNATURE_REQUESTED', 'ASSET_ISSUE_REPORTED', 'POLICY_PUBLISHED', 'INTERVIEW_SCHEDULED', 'SKILL_ASSESSMENT_SUBMITTED', 'SKILL_ASSESSMENT_APPROVED',
      'PERFORMANCE_REVIEW_REMINDER', 'TEAM_MESSAGE', 'CELEBRATION_WISH', 'TRIAL_ENDING_SOON', 'WELCOME', 'CORRECTION_APPROVED', 'SOMETHING_NEW']
    for (const t of TYPES) {
      const to = webRouteFor(t, null, { approver: false, employeeId: 'me' })
      expect(landsOn(to.split('?')[0]), `${t} → ${to}`).not.toBe('*')
    }
  })
})
