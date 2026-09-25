import { describe, expect, it } from 'vitest'
import { accessState, type AccessContext } from './access'
import { PAGE_REGISTRY, menuRule, visibleEntries, firstOpenIn } from './pageRegistry'

// Built-in role grants as seeded (local recovery DB, 25 Sep), trimmed to the codes the rules read.
const EMPLOYEE = ['attendance.checkin.self', 'hrms.advance.request.self', 'hrms.department.read', 'hrms.designation.read', 'hrms.document.read.self', 'hrms.document.write.self',
  'hrms.ess.read', 'hrms.expense.claim.self', 'hrms.learning.enroll.self', 'hrms.learning.read', 'hrms.leave.read', 'hrms.letters.read.self', 'hrms.onboarding.instance.read',
  'hrms.onboarding.task.complete', 'hrms.performance.review.self', 'hrms.pli.read.self', 'hrms.policy.acknowledge.self', 'hrms.policy.read', 'leave.balance.read', 'leave.request.self',
  'org.company.read', 'payroll.payslip.read.self', 'payroll.structure.read.self', 'wfh.request.self']
const DEPT_MANAGER = [...EMPLOYEE, 'attendance.overtime.approve', 'attendance.regularization.approve', 'attendance.team.read', 'hrms.advance.approve', 'hrms.advance.read',
  'hrms.contractor.read', 'hrms.expense.claim.approve', 'hrms.expense.claim.read', 'hrms.hiring.candidate.write', 'hrms.hiring.read', 'hrms.leave.approve.l1', 'hrms.onboarding.asset.read',
  'hrms.performance.read', 'wfh.approve']
const HR_MANAGER = [...DEPT_MANAGER, 'hrms.employee.read', 'hrms.employee.write', 'hrms.branch.read', 'hrms.branch.write', 'hrms.department.write', 'org.geofence.write',
  'payroll.runs.read', 'payroll.settings.read', 'payroll.components.read', 'hrms.fnf.read', 'hrms.document.read', 'hrms.document.verify', 'hrms.report.headcount', 'settings.holidays.write',
  'attendance.workforce.admin', 'hrms.letters.read', 'hrms.letters.template.read']

function ctx(perms: string[], o: Partial<AccessContext> = {}): AccessContext {
  const set = new Set(perms)
  return { has: (c) => set.has('*') || set.has(c), modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}
const open = (c: AccessContext, path: string, group?: string) => accessState(menuRule(path, group), c) === 'open'
const ids = (c: AccessContext) => new Set(visibleEntries(c).map((e) => e.id))

describe('page registry', () => {
  it('has unique ids and "/" paths, and real routes', () => {
    const idList = PAGE_REGISTRY.map((e) => e.id)
    expect(new Set(idList).size).toBe(idList.length)
    const slashes = PAGE_REGISTRY.map((e) => e.slash)
    expect(new Set(slashes).size).toBe(slashes.length)
    for (const e of PAGE_REGISTRY) expect(e.path.startsWith('/')).toBe(true)
  })

  it('no longer offers the retired Geofencing page; its old paths lead to Companies & Branches', () => {
    expect(PAGE_REGISTRY.some((e) => e.path.startsWith('/hrms/attendance/geofencing'))).toBe(false)
    const companies = PAGE_REGISTRY.find((e) => e.id === 'companies')!
    expect(companies.aliases).toContain('attendance/geofencing')
    expect(companies.keywords).toContain('geofence')
  })

  it('tabs use the query parameter their page reads', () => {
    const param: Record<string, string> = {
      'att-analytics': 'tab', 'att-daily': 'tab', 'att-shifts': 'tab', leave: 'tab', hiring: 'tab', expenses: 'tab', fnf: 'tab',
      onboarding: 'view', documents: 'view', performance: 'view', learning: 'view', compliance: 'view', roles: 'view',
    }
    for (const e of PAGE_REGISTRY.filter((x) => x.parent)) {
      expect(param[e.parent!], e.id).toBeTruthy()
      expect(e.path.split('?')[1]?.startsWith(param[e.parent!] + '='), e.id).toBe(true)
    }
  })
})

describe('menu and search access (permission-only)', () => {
  it('a plain employee sees self-service, not admin pages', () => {
    const c = ctx(EMPLOYEE)
    expect(open(c, '/me')).toBe(true)
    expect(open(c, '/hrms/attendance', 'ess')).toBe(true)
    expect(open(c, '/hrms/leave', 'ess')).toBe(true)
    expect(open(c, '/me/payslips')).toBe(true)
    expect(open(c, '/dashboard')).toBe(false)
    expect(open(c, '/hrms/employees')).toBe(false)
    expect(open(c, '/hrms/attendance', 'attendance')).toBe(false)
    expect(open(c, '/hrms/payroll-dashboard')).toBe(false)
    expect(open(c, '/hrms/companies')).toBe(false)
    expect(open(c, '/team')).toBe(false)
    const seen = ids(c)
    expect(seen.has('me-payslips')).toBe(true)
    expect(seen.has('att-daily:team')).toBe(false)
    expect(seen.has('soon-crm')).toBe(false)
  })

  it('self-service needs the person’s own employee record', () => {
    expect(open(ctx(EMPLOYEE, { self: false }), '/me')).toBe(false)
    expect(open(ctx(EMPLOYEE, { self: false }), '/profile')).toBe(true)
  })

  it('a department manager gets My team and the team views, not the directory', () => {
    const c = ctx(DEPT_MANAGER)
    expect(open(c, '/team')).toBe(true)
    expect(open(c, '/dashboard')).toBe(true)
    expect(open(c, '/hrms/attendance', 'attendance')).toBe(true)
    expect(open(c, '/hrms/employees')).toBe(false)
    expect(ids(c).has('att-shifts:myshift')).toBe(false)
  })

  it('HR sees the directory, branches and payroll runs; My team stays a manager view', () => {
    const c = ctx(HR_MANAGER)
    expect(open(c, '/hrms/employees')).toBe(true)
    expect(open(c, '/hrms/companies')).toBe(true)
    expect(open(c, '/hrms/payroll/runs')).toBe(true)
    expect(open(c, '/team')).toBe(false)
  })

  it('a module the workspace lacks is hidden from everyone but plan admins, who see it locked', () => {
    const noPayroll = { modules: ['hrms'] }
    expect(accessState(menuRule('/hrms/payroll/runs'), ctx(HR_MANAGER, noPayroll))).toBe('hidden')
    expect(accessState(menuRule('/hrms/payroll/runs'), ctx(HR_MANAGER, { ...noPayroll, planAdmin: true }))).toBe('locked')
    expect(accessState(menuRule('/me/payslips'), ctx(EMPLOYEE, noPayroll))).toBe('hidden')
  })

  it('coming-soon apps are offered to plan admins only', () => {
    expect(ids(ctx(HR_MANAGER)).has('soon-crm')).toBe(false)
    expect(ids(ctx(['*'], { planAdmin: true, adminRole: true })).has('soon-crm')).toBe(true)
  })

  it('the Leave page’s personal tabs are not offered to admin roles (the page hides them)', () => {
    expect(ids(ctx(HR_MANAGER)).has('leave:apply')).toBe(true)
    expect(ids(ctx(['*'], { adminRole: true, planAdmin: true })).has('leave:apply')).toBe(false)
  })

  it('an area opens the first page the person may open', () => {
    expect(firstOpenIn('attendance', visibleEntries(ctx(HR_MANAGER)))?.path).toBe('/hrms/att-analytics')
    expect(firstOpenIn('attendance', visibleEntries(ctx(EMPLOYEE)))?.path).toBe('/hrms/attendance')
  })
})
