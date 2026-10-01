import { describe, expect, it } from 'vitest'
import { accessState, type AccessContext } from './access'
import { ALL_PAGE_ENTRIES, PAGE_REGISTRY, MENU_RULES, READY_PAGES, isReadyPage, menuRule, visibleEntries, firstOpenIn } from './pageRegistry'

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
/** Including the pages and tabs not live yet (their package isn't in READY_PAGES). */
const idsAll = (c: AccessContext) => new Set(visibleEntries(c, ALL_PAGE_ENTRIES).map((e) => e.id))

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
      exit: 'tab', 'workforce-analytics': 'tab',
      onboarding: 'view', documents: 'view', performance: 'view', learning: 'view', compliance: 'view', roles: 'view', team: 'view',
    }
    for (const e of ALL_PAGE_ENTRIES.filter((x) => x.parent)) {
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
    // Managers' Home is the self-service Home now (DECISIONS 12): no company-wide read, no admin dashboard.
    expect(open(c, '/dashboard')).toBe(false)
    expect(open(c, '/me', 'home')).toBe(true)
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

  it('My Attendance is not offered to admin roles (the Attendance page hides it); staff keep it', () => {
    for (const perms of [EMPLOYEE, DEPT_MANAGER, HR_MANAGER]) {
      const seen = ids(ctx(perms))
      expect(seen.has('me-attendance')).toBe(true)
      expect(seen.has('att-daily:my')).toBe(true)
    }
    const admin = ids(ctx(['*'], { adminRole: true, planAdmin: true }))
    expect(admin.has('me-attendance')).toBe(false)
    expect(admin.has('att-daily:my')).toBe(false)
    expect(admin.has('att-daily:team')).toBe(true)
  })

  it('an area opens the first page the person may open', () => {
    expect(firstOpenIn('attendance', visibleEntries(ctx(HR_MANAGER)))?.path).toBe('/hrms/att-analytics')
    expect(firstOpenIn('attendance', visibleEntries(ctx(EMPLOYEE)))?.path).toBe('/hrms/attendance')
  })
})

describe('the redesign rail rules (DECISIONS 11, 12)', () => {
  const FIN = [...EMPLOYEE, 'attendance.team.read', 'hrms.employee.read', 'payroll.runs.read', 'hrms.report.headcount', 'hrms.report.leave', 'hrms.expense.claim.read',
    'hrms.advance.read', 'hrms.advance.disburse', 'hrms.pli.read', 'hrms.fnf.read', 'settings.read']
  const OWNER = ctx(['*'], { adminRole: true, planAdmin: true })
  const MY_WORK: [string, string][] = [
    ['mytime', '/hrms/attendance'], ['mytime', '/me/wfh'], ['mytime', '/me/shift-change'], ['myleave', '/hrms/leave'],
    ['mypay', '/me/payslips'], ['mypay', '/me/salary'], ['mypay', '/hrms/expenses?tab=my'], ['mypay', '/hrms/advances?tab=my'], ['mypay', '/hrms/pli'],
    ['mydocs', '/hrms/letters/my'], ['mydocs', '/hrms/documents?view=my'], ['mydocs', '/me/assets'], ['mydocs', '/hrms/policies?view=documents'],
    ['mygrowth', '/hrms/performance?view=my-reviews'], ['mygrowth', '/hrms/learning?view=my'], ['mygrowth', '/me/interviews'],
  ]

  it('every My work link has its own rule (none falls back to a wider one)', () => {
    for (const [group, path] of MY_WORK) expect(MENU_RULES[`${group}:${path}`], `${group}:${path}`).toBeTruthy()
    expect(MENU_RULES['home:/me']).toBeTruthy()
  })

  it('My work never shows for the roles that run the workspace; staff keep it', () => {
    for (const [group, path] of MY_WORK) expect(open(OWNER, path, group), `${group}:${path}`).toBe(false)
    const reader = ctx(EMPLOYEE)
    for (const [group, path] of [['mytime', '/hrms/attendance'], ['myleave', '/hrms/leave'], ['mypay', '/me/payslips'], ['mypay', '/hrms/expenses?tab=my'],
      ['mydocs', '/hrms/letters/my'], ['mygrowth', '/hrms/performance?view=my-reviews']] as [string, string][]) expect(open(reader, path, group), `${group}:${path}`).toBe(true)
    // An HR manager is staff too (not an admin role): they keep their own time and leave.
    expect(open(ctx(HR_MANAGER), '/hrms/leave', 'myleave')).toBe(true)
    expect(open(ctx(HR_MANAGER), '/hrms/attendance', 'mytime')).toBe(true)
  })

  it('My work copies the self-service rules: it needs the person’s own employee record', () => {
    const noRecord = ctx(EMPLOYEE, { self: false })
    expect(open(noRecord, '/hrms/attendance', 'mytime')).toBe(false)
    expect(open(noRecord, '/hrms/leave', 'myleave')).toBe(false)
    expect(open(noRecord, '/me', 'home')).toBe(false)
  })

  it('Home (the self-service Home) is for people without the admin dashboard', () => {
    expect(open(ctx(EMPLOYEE), '/me', 'home')).toBe(true)
    expect(open(ctx(DEPT_MANAGER), '/me', 'home')).toBe(true)
    expect(open(ctx(HR_MANAGER), '/me', 'home')).toBe(false)
    expect(open(ctx(FIN), '/me', 'home')).toBe(false)
    expect(open(OWNER, '/me', 'home')).toBe(false)
  })

  it('the Dashboard link and the registry entry use the admin-home rule', () => {
    const dash = PAGE_REGISTRY.find((e) => e.id === 'dashboard')!
    for (const perms of [HR_MANAGER, FIN, ['*']]) {
      expect(open(ctx(perms), '/dashboard')).toBe(true)
      expect(accessState(dash.access, ctx(perms))).toBe('open')
    }
    for (const perms of [EMPLOYEE, DEPT_MANAGER]) {
      expect(open(ctx(perms), '/dashboard')).toBe(false)
      expect(accessState(dash.access, ctx(perms))).toBe('hidden')
    }
  })

  it('admin links that My work covers show only with an admin permission (as Attendance and Leave do)', () => {
    const reader = ctx(EMPLOYEE)
    expect(open(reader, '/hrms/expenses', 'expense')).toBe(false)
    expect(open(reader, '/hrms/advances', 'payroll-hr')).toBe(false)
    expect(open(reader, '/hrms/performance', 'performance')).toBe(false)
    expect(open(reader, '/hrms/learning', 'performance')).toBe(false)
    const mgr = ctx(DEPT_MANAGER)
    expect(open(mgr, '/hrms/expenses', 'expense')).toBe(true)
    expect(open(mgr, '/hrms/advances', 'payroll-hr')).toBe(true)
    expect(open(mgr, '/hrms/performance', 'performance')).toBe(true)
    expect(open(ctx(['hrms.learning.skill.approve']), '/hrms/learning', 'performance')).toBe(true)
    // Nothing becomes unreachable: the pages still open (their registry entries are unchanged).
    for (const id of ['expenses', 'pay-advances', 'performance', 'learning']) expect(ids(reader).has(id), id).toBe(true)
  })

  it('the new tabs are registered with their own rules', () => {
    const ids = idsAll
    const hr = ids(ctx([...HR_MANAGER, 'hrms.leave.employee.read']))
    expect(hr.has('att-daily:timesheet')).toBe(true)
    expect(hr.has('att-analytics:punctuality')).toBe(true)
    expect(hr.has('leave:all-balances')).toBe(true)
    expect(hr.has('exit:notice') && hr.has('exit:exited') && hr.has('exit:terminated')).toBe(true)
    expect(hr.has('workforce-analytics:headcount')).toBe(true)
    // Your own timesheet is personal, like My Attendance: not for admin roles; they get the tab only to approve their team's weeks.
    expect(ids(OWNER).has('att-daily:timesheet')).toBe(true)
    expect(ids(ctx(['attendance.checkin.self', 'attendance.team.read'], { adminRole: true })).has('att-daily:timesheet')).toBe(false)
    expect(ids(ctx(['attendance.team.read', 'hrms.timesheet.approve'], { adminRole: true })).has('att-daily:timesheet')).toBe(true)
    // Each workforce analytics tab needs its own report.
    const headcountOnly = ids(ctx(['hrms.report.headcount']))
    expect(headcountOnly.has('workforce-analytics:headcount')).toBe(true)
    expect(headcountOnly.has('workforce-analytics:attrition')).toBe(false)
    // My team's views: the schedule needs the team read; the approvals any approve permission.
    const mgr = ids(ctx(DEPT_MANAGER))
    expect(mgr.has('team:schedule') && mgr.has('team:approvals')).toBe(true)
    expect(ids(ctx(EMPLOYEE)).has('team:approvals')).toBe(false)
  })

  it('a page or tab of a package not shipped yet stays out of the app (READY_PAGES)', () => {
    const pending = ALL_PAGE_ENTRIES.filter((e) => e.pkg && !READY_PAGES.has(e.pkg)).map((e) => e.id)
    for (const id of pending) expect(PAGE_REGISTRY.some((e) => e.id === id), id).toBe(false)
    // Daily tracking (P-ATT-DAY) is released; every other new tab is still out, today's pages are all in.
    expect([...READY_PAGES]).toEqual(['P-ATT-DAY'])
    expect(PAGE_REGISTRY.some((e) => e.id === 'att-daily:timesheet')).toBe(true)
    expect(pending.sort()).toEqual(['att-analytics:punctuality', 'exit:exited', 'exit:notice', 'exit:terminated', 'leave:all-balances',
      'team:approvals', 'team:schedule', 'workforce-analytics:attrition', 'workforce-analytics:diversity', 'workforce-analytics:headcount'])
    expect(PAGE_REGISTRY.length + pending.length).toBe(ALL_PAGE_ENTRIES.length)
    const hr = ids(ctx([...HR_MANAGER, 'hrms.leave.employee.read']))
    expect(hr.has('leave:all-balances') || hr.has('att-analytics:punctuality') || hr.has('exit:notice')).toBe(false)
    expect(ids(ctx(DEPT_MANAGER)).has('team:approvals')).toBe(false)
    // Listing a package brings its pages in.
    expect(isReadyPage({ pkg: 'P-TEAM' }, new Set(['P-TEAM']))).toBe(true)
    expect(isReadyPage({ pkg: 'P-TEAM' })).toBe(false)
    expect(isReadyPage({})).toBe(true)
  })
})
