import { describe, expect, it } from 'vitest'
import type { AccessContext } from '@/shared/navigation/access'
import { hasTeamBlocks, resolveHome } from './useHome'

// The seeded roles' grants (ut_w3_base, 27 Sep), trimmed to the codes the Home rule reads.
const EMPLOYEE = ['attendance.checkin.self', 'hrms.ess.read', 'leave.request.self', 'hrms.leave.read', 'payroll.payslip.read.self', 'hrms.policy.read', 'hrms.policy.acknowledge.self', 'hrms.department.read']
const DEPT_MANAGER = [...EMPLOYEE, 'attendance.team.read', 'hrms.leave.approve.l1', 'wfh.approve', 'attendance.regularization.approve', 'hrms.expense.claim.approve']
const HR_MANAGER = [...DEPT_MANAGER, 'hrms.employee.read', 'hrms.employee.write', 'payroll.runs.read', 'org.company.write', 'hrms.report.headcount']
const FINANCE_LEAD = [...EMPLOYEE, 'attendance.team.read', 'hrms.employee.read', 'payroll.runs.read', 'hrms.report.attendance', 'hrms.report.leave']

function ctx(perms: string[], o: Partial<AccessContext> = {}): AccessContext {
  const set = new Set(perms)
  return { has: (c) => set.has('*') || set.has(c), modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}

describe('Home by permission (DECISIONS 12)', () => {
  const table: [who: string, c: AccessContext, kind: string, path: string, team: boolean][] = [
    ['owner', ctx(['*'], { adminRole: true, planAdmin: true }), 'admin', '/dashboard', false],
    ['hrm', ctx(HR_MANAGER), 'admin', '/dashboard', false],
    ['fin', ctx(FINANCE_LEAD), 'admin', '/dashboard', false],
    ['mgr', ctx(DEPT_MANAGER), 'self', '/me', true],
    ['reader', ctx(EMPLOYEE), 'self', '/me', false],
    // A custom role with one report: company-wide data, so the admin dashboard.
    ['custom: leave report', ctx(['hrms.report.leave']), 'admin', '/dashboard', false],
    // A custom role that can only read policies (no self-service): the first page they can open.
    ['custom: policies only', ctx(['hrms.policy.read'], { self: false }), 'first', '/hrms/policies', false],
    // A custom approver without the directory: Home, with the team blocks.
    ['custom: team approver', ctx(['hrms.leave.approve.l1', 'attendance.checkin.self']), 'self', '/me', true],
    ['none', ctx([], { self: false }), 'none', '/no-access', false],
  ]
  for (const [who, c, kind, path, team] of table) {
    it(`${who}: ${kind} → ${path}${team ? ' with team blocks' : ''}`, () => {
      const home = resolveHome(c)
      expect(home.kind).toBe(kind)
      expect(home.path).toBe(path)
      expect(home.team).toBe(team)
    })
  }

  it('names the Home: "Dashboard" for the admin dashboard, "Home" for the self-service one', () => {
    expect(resolveHome(ctx(HR_MANAGER)).label).toBe('Dashboard')
    expect(resolveHome(ctx(EMPLOYEE)).label).toBe('Home')
  })

  it('self-service Home needs the person’s own employee record and the HRMS module', () => {
    expect(resolveHome(ctx(EMPLOYEE, { self: false })).kind).not.toBe('self')
    expect(resolveHome(ctx(EMPLOYEE, { modules: [] })).kind).not.toBe('self')
  })

  it('never lands on the launcher, the plan page, sign-in security or your own profile', () => {
    // Those are always open; someone with nothing else goes to /no-access.
    expect(resolveHome(ctx([], { self: false, planAdmin: true })).path).toBe('/no-access')
  })

  it('team blocks follow today’s /team rule', () => {
    expect(hasTeamBlocks(ctx(DEPT_MANAGER))).toBe(true)
    expect(hasTeamBlocks(ctx(['hrms.leave.approve.l1']))).toBe(true)
    expect(hasTeamBlocks(ctx(HR_MANAGER))).toBe(false)
    expect(hasTeamBlocks(ctx(EMPLOYEE))).toBe(false)
  })
})
