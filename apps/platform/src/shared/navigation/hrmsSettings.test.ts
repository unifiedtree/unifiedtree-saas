import { describe, expect, it } from 'vitest'
import { accessState, type AccessContext } from './access'
import { canOpenHrmsSettings, hrmsSettingsFor, HRMS_SETTINGS, HUB_PAGES } from './hrmsSettings'
import { menuRule, PAGE_REGISTRY } from './pageRegistry'
import { workspaceSettingsFor } from './workspaceSettings'

// Built-in role grants as seeded (ut_w3_base, 26 Sep), trimmed to the codes these rules read.
const EMPLOYEE = ['attendance.checkin.self', 'hrms.ess.read', 'hrms.document.type.read', 'hrms.policy.read', 'hrms.policy.acknowledge.self', 'leave.request.self', 'workspace.account.read', 'workspace.context.read']
const DEPT_MANAGER = [...EMPLOYEE, 'attendance.team.read', 'hrms.leave.approve.l1', 'hrms.contractor.read']
const FINANCE_LEAD = [...EMPLOYEE, 'hrms.expense.policy.read', 'payroll.components.manage', 'payroll.components.read', 'payroll.settings.read', 'payroll.settings.update', 'settings.read', 'payroll.runs.read']
const HR_MANAGER = [...DEPT_MANAGER, 'attendance.policy.manage', 'attendance.workforce.admin', 'hrms.document.type.write', 'hrms.integration.read', 'hrms.integration.write', 'hrms.notiftemplate.read',
  'hrms.notiftemplate.write', 'hrms.policy.write', 'hrms.probation.config.read', 'hrms.probation.config.update', 'leave.type.write', 'payroll.components.read', 'payroll.settings.read', 'settings.holidays.write',
  'hrms.branch.read', 'org.geofence.write', 'hrms.expense.policy.read', 'hrms.expense.policy.write']

function ctx(perms: string[], o: Partial<AccessContext> = {}): AccessContext {
  const set = new Set(perms)
  return { has: (c) => set.has('*') || set.has(c), modules: ['hrms', 'attendance', 'payroll', 'leave'], self: true, adminRole: false, planAdmin: false, ...o }
}
const OWNER = ctx(['*'], { adminRole: true, planAdmin: true })
const items = (c: AccessContext) => new Set(hrmsSettingsFor(c).flatMap((g) => g.items.map((i) => i.key)))
const menuOpen = (c: AccessContext, path: string) => accessState(menuRule(path, 'hrsettings'), c) === 'open'

describe('HRMS settings hub', () => {
  it('employees and department managers get no hub and no HR settings', () => {
    for (const c of [ctx(EMPLOYEE), ctx(DEPT_MANAGER)]) {
      expect(canOpenHrmsSettings(c)).toBe(false)
      expect(hrmsSettingsFor(c)).toEqual([])
      for (const p of Object.values(HUB_PAGES)) expect(menuOpen(c, p)).toBe(false)
    }
  })

  it('the owner sees every section, including roles and HRMS access', () => {
    const seen = items(OWNER)
    for (const k of ['hr-config', 'late', 'week', 'shift-rules', 'punch-zones', 'leave-rules', 'holidays', 'payroll', 'components', 'statutory', 'expense-policies', 'document-types', 'policies', 'notifications', 'roles', 'access']) expect(seen.has(k), k).toBe(true)
    for (const p of Object.values(HUB_PAGES)) expect(menuOpen(OWNER, p), p).toBe(true)
  })

  it('HR sees HR settings but not roles; finance sees payroll and HR configuration', () => {
    const hr = items(ctx(HR_MANAGER))
    for (const k of ['hr-config', 'notifications', 'document-types', 'holidays', 'policies', 'shift-rules', 'leave-rules', 'components', 'statutory', 'expense-policies']) expect(hr.has(k), k).toBe(true)
    expect(hr.has('roles')).toBe(false)
    const fin = items(ctx(FINANCE_LEAD))
    for (const k of ['payroll', 'components', 'statutory', 'hr-config', 'expense-policies']) expect(fin.has(k), k).toBe(true)
    for (const k of ['notifications', 'roles', 'policies', 'shift-rules', 'leave-rules']) expect(fin.has(k), k).toBe(false)
  })

  it('the hub’s pages keep their rules in the registry, at their new addresses', () => {
    const byId = (id: string) => PAGE_REGISTRY.find((e) => e.id === id)!
    expect(byId('hr-config').path).toBe(HUB_PAGES.hrConfig)
    expect(byId('pay-settings').path).toBe(HUB_PAGES.payroll)
    expect(byId('s-documents').path).toBe(HUB_PAGES.documentTypes)
    expect(byId('notif-templates').path).toBe(HUB_PAGES.notifications)
    expect(byId('roles').path).toBe(HUB_PAGES.roles)
    expect(byId('roles:assignments').path).toBe(`${HUB_PAGES.roles}?view=assignments`)
    expect(byId('hr-integrations').path).toBe('/settings/integrations/register')
    expect(byId('m-shift-rules').path).toBe(HUB_PAGES.shiftRules)
    expect(byId('m-leave-rules').path).toBe(HUB_PAGES.leaveRules)
    expect(byId('components').path).toBe(HUB_PAGES.components)
    expect(byId('m-statutory').path).toBe(HUB_PAGES.statutory)
    expect(byId('m-policies').path).toBe(HUB_PAGES.policies)
    expect(byId('expense-policies').path).toBe(HUB_PAGES.expensePolicies)
    // Employees keep reading and acknowledging policies at /hrms/policies.
    expect(byId('policies').path).toBe('/hrms/policies')
    // A workspace without payroll: payroll settings are hidden (plan admins see them locked).
    expect(accessState(menuRule(HUB_PAGES.payroll), ctx(FINANCE_LEAD, { modules: ['hrms'] }))).toBe('hidden')
  })
})

describe('one settings place in HRMS', () => {
  it('every hub card opens inside the hub, except Holidays and punch zones (parts of pages everyone uses)', () => {
    const out = HRMS_SETTINGS.flatMap((g) => g.items).filter((i) => !i.path.startsWith(HUB_PAGES.overview + '/'))
    expect(out.map((i) => i.key).sort()).toEqual(['holidays', 'punch-zones'])
  })

  it('no menu or search entry still points at an old settings address', () => {
    const OLD = ['/hrms/master/shift-rules', '/hrms/master/leave-rules', '/hrms/master/statutory', '/hrms/payroll/components', '/hrms/payroll/settings', '/hrms/notification-templates', '/hrms/integrations', '/settings/documents', '/roles']
    for (const e of PAGE_REGISTRY) expect(OLD.includes(e.path.split('?')[0]), e.id).toBe(false)
    expect(PAGE_REGISTRY.some((e) => e.path.includes('tab=policies'))).toBe(false)
  })
})

describe('workspace settings', () => {
  it('an employee is offered only their own security', () => {
    expect(workspaceSettingsFor(ctx(EMPLOYEE)).map((p) => p.key)).toEqual(['s-security'])
    expect(workspaceSettingsFor(ctx(DEPT_MANAGER)).map((p) => p.key)).toEqual(['s-security'])
  })

  it('the owner gets every workspace page, starting with the workspace profile, and no HR pages', () => {
    const keys = workspaceSettingsFor(OWNER).map((p) => p.key)
    expect(keys[0]).toBe('s-profile')
    for (const k of ['s-branding', 's-security', 's-billing', 's-integrations', 's-users', 's-audit', 's-danger']) expect(keys).toContain(k)
    expect(workspaceSettingsFor(OWNER).some((p) => p.path.startsWith('/hrms') || p.path === '/roles')).toBe(false)
  })
})
