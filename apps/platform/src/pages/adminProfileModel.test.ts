import { describe, expect, it } from 'vitest'
import type { AccessContext } from '@/shared/navigation/access'
import { activityLine, adminPlaces, areasFrom, moduleName, roleWords, rolesToShow } from './adminProfileModel'

// My profile for an administrator (AdminProfile.tsx): the plain-words pieces.
const ctxOf = (codes: string[], o: Partial<AccessContext> = {}): AccessContext => ({
  has: (c) => codes.includes('*') || codes.includes(c),
  modules: ['hrms', 'payroll'], self: true, adminRole: true, personalPages: false, planAdmin: true, ...o,
})

describe('admin profile model', () => {
  it('says what each built-in role lets the person do', () => {
    expect(roleWords('OWNER')).toMatchObject({ name: 'Owner' })
    expect(roleWords('OWNER').words).toContain('billing')
    expect(roleWords('ADMIN').words).toContain('except billing')
    expect(roleWords('SUPER_ADMIN').name).toBe('Super admin')
  })

  it('a role the workspace made: its own name and description, else a plain line', () => {
    expect(roleWords('SITE_LEAD', { name: 'Site lead', description: 'Runs the Pune site.' })).toEqual({ code: 'SITE_LEAD', name: 'Site lead', words: 'Runs the Pune site.' })
    const bare = roleWords('SITE_LEAD')
    expect(bare.name).toBe('Site lead')
    expect(bare.words).toContain('A role your workspace made')
  })

  it('shows the most powerful role first and never ours', () => {
    expect(rolesToShow(['EMPLOYEE', 'OWNER', 'PLATFORM_SUPER_ADMIN', 'OWNER', 'CUSTOM_X'])).toEqual(['OWNER', 'EMPLOYEE', 'CUSTOM_X'])
  })

  it('reads the areas they look after from their permissions', () => {
    const has = (c: string) => ['hrms.employee.read', 'payroll.runs.read', 'audit.read'].includes(c)
    expect(areasFrom(has)).toEqual(['People', 'Payroll', 'Audit log'])
    expect(areasFrom(() => false)).toEqual([])
  })

  it('lists the admin places only when each opens for them', () => {
    const all = adminPlaces(ctxOf(['*'])).map((p) => p.key)
    expect(all).toEqual(['dashboard', 'people', 'approvals', 'settings', 'roles', 'audit'])
    const few = adminPlaces(ctxOf(['hrms.employee.read'])).map((p) => p.key)
    expect(few).toContain('people')
    expect(few).not.toContain('roles')
    expect(few).not.toContain('audit')
    expect(few).not.toContain('approvals')
    // People needs the HRMS module on.
    expect(adminPlaces(ctxOf(['hrms.employee.read'], { modules: [], planAdmin: false })).map((p) => p.key)).not.toContain('people')
    expect(adminPlaces(ctxOf(['*'])).find((p) => p.key === 'approvals')?.path).toBe('/team?view=approvals')
  })

  it('names modules and audit events in plain words', () => {
    expect(moduleName('hrms')).toBe('HRMS')
    expect(moduleName('assets')).toBe('Assets')
    expect(activityLine({ action: 'LOGIN' })).toBe('Signed in')
    expect(activityLine({ action: 'UPDATE', resourceType: 'EMPLOYEE', resourceName: 'Rahul Verma' })).toBe('Changed Rahul Verma')
    expect(activityLine({ action: 'DELETE', resourceType: 'LEAVE_REQUEST' })).toBe('Removed leave request')
    expect(activityLine({ action: 'UPDATE', summary: 'Changed the work week' })).toBe('Changed the work week')
  })
})
