import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccessContext } from '@/shared/navigation/access'
import {
  activePage, drawsOwnPages, fitRail, isMorePath, litPage, isSettingsPath, moduleTarget, NAV_MODULES, owningModules, preferencesTarget, railGroups,
  readLastPages, readPinned, saveLastPage, savePinned, settingsActive, settingsPages, SETTINGS_PAGES, type VisibleGroup,
} from './navModel'
import { pageTitleLabel } from './pageTitle'

// Built-in role grants as seeded (ut_w3_base, 27 Sep), trimmed to the codes the rules read.
const EMPLOYEE = ['attendance.checkin.self', 'hrms.advance.request.self', 'hrms.department.read', 'hrms.document.read.self', 'hrms.document.write.self', 'hrms.ess.read',
  'hrms.expense.claim.self', 'hrms.hiring.interview.self', 'hrms.learning.enroll.self', 'hrms.learning.read', 'hrms.leave.read', 'hrms.letters.read.self',
  'hrms.onboarding.asset.self', 'hrms.onboarding.instance.read', 'hrms.performance.review.self', 'hrms.pli.read.self', 'hrms.policy.acknowledge.self', 'hrms.policy.read',
  'leave.balance.read', 'leave.request.self', 'org.company.read', 'payroll.payslip.read.self', 'payroll.structure.read.self', 'wfh.request.self']
const DEPT_MANAGER = [...EMPLOYEE, 'attendance.overtime.approve', 'attendance.regularization.approve', 'attendance.status.review', 'attendance.team.read', 'hrms.advance.approve',
  'hrms.advance.read', 'hrms.contractor.read', 'hrms.expense.claim.approve', 'hrms.expense.claim.read', 'hrms.hiring.candidate.write', 'hrms.hiring.read', 'hrms.leave.approve.l1',
  'hrms.onboarding.asset.read', 'hrms.performance.read', 'hrms.learning.skill.approve', 'wfh.approve']
const HR_MANAGER = [...DEPT_MANAGER, 'hrms.employee.read', 'hrms.employee.write', 'hrms.branch.read', 'hrms.branch.write', 'hrms.department.write', 'org.company.write',
  'payroll.runs.read', 'payroll.settings.read', 'payroll.components.read', 'hrms.fnf.read', 'hrms.document.read', 'hrms.document.verify', 'hrms.report.headcount',
  'settings.holidays.write', 'hrms.probation.config.read', 'attendance.workforce.admin', 'hrms.letters.read', 'hrms.letters.template.read', 'hrms.document.type.read',
  'hrms.policy.write', 'hrms.compliance.read', 'hrms.notiftemplate.read', 'hrms.integration.read', 'settings.hrconfig.write']

function ctx(perms: string[], o: Partial<AccessContext> = {}): AccessContext {
  const set = new Set(perms)
  return { has: (c) => set.has('*') || set.has(c), modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}
const OWNER = ctx(['*'], { adminRole: true, planAdmin: true })
const keys = (g: VisibleGroup[]) => g.map((x) => `${x.key}:${x.modules.map((m) => m.railLabel).join('|')}`)

describe('rail groups', () => {
  it('an employee: Home, then My work with the design’s short labels (nothing else)', () => {
    const g = railGroups(ctx(EMPLOYEE), { selfFirst: true })
    expect(keys(g)).toEqual(['home:Home', 'mine:Time|Leave|Pay|Documents|Growth'])
    // Accessible names are always "My …".
    expect(g[1].modules.map((m) => m.name)).toEqual(['My time', 'My leave', 'My pay', 'My documents', 'My growth'])
    expect(g[0].label).toBe('Home')
  })

  it('a department manager: Home, My team, My work first; the admin modules their permissions open follow', () => {
    const g = railGroups(ctx(DEPT_MANAGER), { selfFirst: true })
    expect(g.map((x) => x.key)).toEqual(['home', 'team', 'mine', 'people', 'time', 'pay', 'org'])
    // Muster roll (team read) keeps Compliance for them, as today.
    expect(g.find((x) => x.key === 'org')!.modules.map((m) => m.pages.map((p) => p.label).join())).toEqual(['Muster Roll'])
    const mine = g.find((x) => x.key === 'mine')!
    // "Leave" would clash with the admin Leave item, so My work's reads "My leave".
    expect(mine.modules.map((m) => m.railLabel)).toEqual(['Time', 'My leave', 'Pay', 'Documents', 'Growth'])
    const time = g.find((x) => x.key === 'time')!
    expect(time.modules.map((m) => m.label)).toEqual(['Attendance & time', 'Leave'])
    expect(g.find((x) => x.key === 'team')!.modules[0].pages.map((p) => p.path)).toEqual(['/team'])
    expect(g.flatMap((x) => x.modules.map((m) => m.key))).not.toContain('dashboard')
  })

  it('an HR manager: the admin groups first, My work after them, no My team and no self-service Home', () => {
    const g = railGroups(ctx(HR_MANAGER), { selfFirst: false })
    expect(g.map((x) => x.key)).toEqual(['home', 'people', 'time', 'pay', 'org', 'insights', 'mine'])
    expect(g[0].modules.map((m) => m.key)).toEqual(['dashboard', 'company'])
  })

  it('an owner: no My work, and the business apps (plan admins only) last, with their Soon badges', () => {
    const g = railGroups(OWNER, { selfFirst: false, soonApps: new Set(['crm']) })
    expect(g.map((x) => x.key)).toEqual(['home', 'people', 'time', 'pay', 'org', 'insights', 'apps'])
    const apps = g.find((x) => x.key === 'apps')!
    expect(apps.modules.map((m) => m.label)).toEqual(['CRM', 'Accounts', 'Projects', 'Inventory', 'Purchase'])
    expect(apps.modules.map((m) => m.soon)).toEqual([true, false, false, false, false])
    expect(railGroups(ctx(HR_MANAGER), { selfFirst: false }).some((x) => x.key === 'apps')).toBe(false)
  })

  it('keeps every module’s internal key and page paths (and the old page order)', () => {
    const byKey = Object.fromEntries(NAV_MODULES.map((m) => [m.key, m]))
    for (const k of ['dashboard', 'myteam', 'company', 'master', 'attendance', 'leave', 'recruit', 'payroll-hr', 'expense', 'performance', 'compliance', 'reports', 'exit', 'hrsettings']) expect(byKey[k], k).toBeTruthy()
    expect(byKey.attendance.pages.map((p) => p.path)).toEqual(['/hrms/att-analytics', '/hrms/attendance', '/hrms/shifts'])
    expect(byKey.master.pages.map((p) => p.label)).toEqual(['Overview', 'Workforce Directory', 'Organization Setup', 'Rules & Policies', 'Payroll Configuration'])
  })
})

describe('where an address belongs', () => {
  const mgr = railGroups(ctx(DEPT_MANAGER), { selfFirst: true })
  const hr = railGroups(ctx(HR_MANAGER), { selfFirst: false })
  it('Leave belongs to both Leave and My leave for a manager', () => {
    expect(owningModules(mgr, '/hrms/leave').map((m) => m.key).sort()).toEqual(['leave', 'myleave'])
  })
  it('Home owns /me only, not the pages under it', () => {
    const emp = railGroups(ctx(EMPLOYEE), { selfFirst: true })
    expect(owningModules(emp, '/me').map((m) => m.key)).toEqual(['home'])
    expect(owningModules(emp, '/me/payslips').map((m) => m.key)).toEqual(['mypay'])
    expect(owningModules(emp, '/me/wfh').map((m) => m.key)).toEqual(['mytime'])
  })
  it('the longest matching route picks the page (and pages own their sub-routes)', () => {
    const master = hr.flatMap((g) => g.modules).find((m) => m.key === 'master')!
    expect(activePage(master.pages, '/hrms/master')?.label).toBe('Overview')
    expect(activePage(master.pages, '/hrms/master/leave-rules')?.label).toBe('Rules & Policies')
    expect(activePage(master.pages, '/hrms/master/departments')?.label).toBe('Organization Setup')
    expect(activePage(master.pages, '/hrms/master/statutory')?.label).toBe('Payroll Configuration')
    expect(activePage(master.pages, '/hrms/employees/abc')?.label).toBe('Workforce Directory')
    const recruit = hr.flatMap((g) => g.modules).find((m) => m.key === 'recruit')!
    expect(activePage(recruit.pages, '/hrms/documents/pending')?.label).toBe('Docs to Review')
    expect(activePage(recruit.pages, '/hrms/documents')?.label).toBe('Employee Vault')
  })
  it('a My work page matches its route whatever tab is open', () => {
    const pay = railGroups(ctx(EMPLOYEE), { selfFirst: true }).flatMap((g) => g.modules).find((m) => m.key === 'mypay')!
    expect(activePage(pay.pages, '/hrms/expenses')?.label).toBe('Expense claims')
  })
})

describe('fit (the design’s overflow into More)', () => {
  const G = [{ key: 'home', items: ['a', 'b'] }, { key: 'people', items: ['c', 'd', 'e'] }, { key: 'time', items: ['f'] }]
  it('shows everything before the rail is measured', () => {
    expect(fitRail(0, G).overflow).toEqual([])
    expect(fitRail(0, G).shown.size).toBe(6)
  })
  it('uses the design sizes: items 40, gap 2, a group label row 24 (not before the first group)', () => {
    // a 40 + b 42 = 82; c: 24 + 40 = 64 → 146; d 42 → 188; e 42 → 230; f: 24 + 40 → 294
    expect(fitRail(294, G).overflow).toEqual([])
    expect(fitRail(293, G).overflow).toEqual(['f'])
    expect(fitRail(229, G).overflow).toEqual(['e', 'f'])
    expect(fitRail(145, G).overflow).toEqual(['c', 'd', 'e', 'f'])
  })
  it('once an item does not fit, every later one moves to More', () => {
    expect(fitRail(83, G).overflow).toEqual(['c', 'd', 'e', 'f'])
  })
})

describe('settings', () => {
  it('Preferences opens the first settings page the person can open', () => {
    expect(preferencesTarget(OWNER)).toBe('/settings')
    expect(preferencesTarget(ctx(HR_MANAGER))).toBe('/settings')
    expect(preferencesTarget(ctx(['settings.read']))).toBe('/settings')
    expect(preferencesTarget(ctx(DEPT_MANAGER))).toBe('/settings/security')
    expect(preferencesTarget(ctx(EMPLOYEE))).toBe('/settings/security')
    expect(preferencesTarget(ctx([]))).toBe('/settings/security')
    expect(preferencesTarget(ctx(['settings.branding.write']))).toBe('/settings/branding')
    expect(preferencesTarget(ctx(['workspace.users.read']))).toBe('/settings/security')
  })
  it('lists today’s settings row, Document types after Integrations', () => {
    expect(SETTINGS_PAGES.map((p) => p.label)).toEqual(['Profile', 'Branding', 'Security', 'Notifications', 'Billing & Plan', 'Integrations', 'Document types', 'Users & Access', 'Roles & Permissions', 'Audit Logs', 'Danger Zone'])
    expect(settingsPages(ctx(EMPLOYEE)).map((p) => p.label)).toEqual(['Profile', 'Security'])
    expect(settingsPages(ctx(HR_MANAGER)).map((p) => p.label)).toEqual(['Profile', 'Security', 'Notifications', 'Integrations', 'Document types'])
    expect(settingsPages(OWNER).length).toBe(11)
  })
  it('lights the settings page at the address; /settings lights Profile as before', () => {
    const pages = settingsPages(OWNER)
    expect(settingsActive(pages, '/settings')?.label).toBe('Profile')
    expect(settingsActive(pages, '/settings/profile')).toBeUndefined()
    expect(settingsActive(pages, '/settings/branding')?.label).toBe('Branding')
    expect(settingsActive(pages, '/roles')?.label).toBe('Roles & Permissions')
  })
  it('More lights on settings, My profile and All apps', () => {
    for (const p of ['/settings', '/settings/security', '/users', '/roles', '/audit-logs']) expect(isSettingsPath(p), p).toBe(true)
    for (const p of ['/profile', '/modules']) { expect(isMorePath(p), p).toBe(true); expect(isSettingsPath(p), p).toBe(false) }
    for (const p of ['/hrms/settings', '/me', '/dashboard', '/settingsx']) expect(isMorePath(p), p).toBe(false)
  })
})

describe('memory', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const memory = () => {
    const store = new Map<string, string>()
    return { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) } }
  }
  it('a rail click returns to the module’s last page (still visible), else its first page', () => {
    vi.stubGlobal('sessionStorage', memory())
    const mod = { key: 'payroll-hr', pages: [{ label: 'A', path: '/a' }, { label: 'B', path: '/b' }] }
    expect(moduleTarget(mod, readLastPages())).toBe('/a')
    saveLastPage('payroll-hr', '/b')
    expect(moduleTarget(mod, readLastPages())).toBe('/b')
    saveLastPage('payroll-hr', '/gone')
    expect(moduleTarget(mod, readLastPages())).toBe('/a')
  })
  it('works without storage', () => {
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    vi.stubGlobal('sessionStorage', blocked)
    vi.stubGlobal('localStorage', blocked)
    expect(readLastPages()).toEqual({})
    expect(() => saveLastPage('x', '/y')).not.toThrow()
    expect(readPinned()).toBe(false)
    expect(() => savePinned(true)).not.toThrow()
  })
  it('keeps the pin per device', () => {
    vi.stubGlobal('localStorage', memory())
    expect(readPinned()).toBe(false)
    savePinned(true)
    expect(readPinned()).toBe(true)
    savePinned(false)
    expect(readPinned()).toBe(false)
  })
})

describe('browser tab titles stay as they were', () => {
  // From the app before the redesign rail (the baseline captured on 27 Sep).
  it('settings and master pages', () => {
    expect(pageTitleLabel('/settings', OWNER)).toBe('Configuration')
    expect(pageTitleLabel('/settings/profile', OWNER)).toBe('Configuration')
    expect(pageTitleLabel('/settings/documents', OWNER)).toBe('Configuration')
    expect(pageTitleLabel('/settings/branding', OWNER)).toBe('Branding')
    expect(pageTitleLabel('/roles', OWNER)).toBe('Roles & Perms')
    expect(pageTitleLabel('/profile', OWNER)).toBe('Profile')
    expect(pageTitleLabel('/hrms/master/leave-rules', OWNER)).toBe('Overview')
    expect(pageTitleLabel('/hrms/policies', OWNER)).toBeNull()
    expect(pageTitleLabel('/hrms/payroll/components', OWNER)).toBe('Payroll Configuration')
    expect(pageTitleLabel('/settings/security', ctx(EMPLOYEE))).toBe('Security')
  })
  it('pages two menus shared keep the name each person saw', () => {
    expect(pageTitleLabel('/hrms/leave', ctx(HR_MANAGER))).toBe('Leave Operations Center')
    expect(pageTitleLabel('/hrms/leave', ctx(EMPLOYEE))).toBe('Leave')
    expect(pageTitleLabel('/me', ctx(EMPLOYEE))).toBe('Overview')
    expect(pageTitleLabel('/hrms/expenses', ctx(EMPLOYEE))).toBe('Expense Center')
    expect(pageTitleLabel('/team', ctx(DEPT_MANAGER))).toBe('My Team')
    expect(pageTitleLabel('/hrms/attendance', ctx(DEPT_MANAGER))).toBe('Daily Tracking')
  })
})

describe('the top bar’s page tabs (Release 1.1)', () => {
  const master = NAV_MODULES.find((m) => m.key === 'master')!
  it('lights the page the address belongs to', () => {
    expect(litPage('master', master.pages, '/hrms/master/shift-rules')?.label).toBe('Rules & Policies')
    expect(litPage('master', master.pages, '/hrms/master')?.label).toBe('Overview')
    expect(litPage('master', master.pages, '/hrms/employees/123')?.label).toBe('Workforce Directory')
  })
  it('lights nothing when that page is one the person does not see (not a shorter page that also matches)', () => {
    const seen = master.pages.filter((p) => ['Overview', 'Workforce Directory', 'Payroll Configuration'].includes(p.label))
    expect(litPage('master', seen, '/hrms/master/shift-rules')).toBeUndefined()
    expect(litPage('master', seen, '/hrms/master')?.label).toBe('Overview')
  })
  it('the Attendance page still draws its own pages bar, so its module shows no tabs; others do', () => {
    expect(drawsOwnPages('attendance')).toBe(true)
    expect(drawsOwnPages('master')).toBe(false)
    expect(drawsOwnPages('mytime')).toBe(false)
  })
})
