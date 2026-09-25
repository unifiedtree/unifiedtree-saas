import { describe, expect, it } from 'vitest'
import { accessState, type AccessContext } from './access'
import { canOpenHrmsSettings, hrmsSettingsFor, HUB_PAGES } from './hrmsSettings'
import { menuRule, PAGE_REGISTRY } from './pageRegistry'
import { workspaceSettingsFor } from './workspaceSettings'

// Built-in role grants as seeded (ut_w3_base, 26 Sep), trimmed to the codes these rules read.
const EMPLOYEE = ['attendance.checkin.self', 'hrms.ess.read', 'hrms.document.type.read', 'hrms.policy.read', 'hrms.policy.acknowledge.self', 'leave.request.self', 'workspace.account.read', 'workspace.context.read']
const DEPT_MANAGER = [...EMPLOYEE, 'attendance.team.read', 'hrms.leave.approve.l1', 'hrms.contractor.read']
const FINANCE_LEAD = [...EMPLOYEE, 'payroll.components.manage', 'payroll.components.read', 'payroll.settings.read', 'payroll.settings.update', 'settings.read', 'payroll.runs.read']
const HR_MANAGER = [...DEPT_MANAGER, 'attendance.policy.manage', 'attendance.workforce.admin', 'hrms.document.type.write', 'hrms.integration.read', 'hrms.integration.write', 'hrms.notiftemplate.read',
  'hrms.notiftemplate.write', 'hrms.policy.write', 'hrms.probation.config.read', 'hrms.probation.config.update', 'leave.type.write', 'payroll.components.read', 'payroll.settings.read', 'settings.holidays.write',
  'hrms.branch.read', 'org.geofence.write']

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
    for (const k of ['hr-config', 'late', 'week', 'shift-rules', 'punch-zones', 'leave-rules', 'holidays', 'payroll', 'components', 'statutory', 'document-types', 'policies', 'notifications', 'roles', 'access']) expect(seen.has(k), k).toBe(true)
    for (const p of Object.values(HUB_PAGES)) expect(menuOpen(OWNER, p), p).toBe(true)
  })

  it('HR sees HR settings but not roles; finance sees payroll and HR configuration', () => {
    const hr = items(ctx(HR_MANAGER))
    expect(hr.has('hr-config') && hr.has('notifications') && hr.has('document-types') && hr.has('holidays') && hr.has('policies')).toBe(true)
    expect(hr.has('roles')).toBe(false)
    const fin = items(ctx(FINANCE_LEAD))
    expect(fin.has('payroll') && fin.has('components') && fin.has('hr-config')).toBe(true)
    expect(fin.has('notifications') || fin.has('roles') || fin.has('policies')).toBe(false)
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
    // A workspace without payroll: payroll settings are hidden (plan admins see them locked).
    expect(accessState(menuRule(HUB_PAGES.payroll), ctx(FINANCE_LEAD, { modules: ['hrms'] }))).toBe('hidden')
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
