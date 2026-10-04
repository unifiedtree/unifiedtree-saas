import { describe, expect, it } from 'vitest'
import { primaryRole, roleLabel, rolesLine } from './roleLabels'

describe('role labels', () => {
  it('reads built-in role codes as names', () => {
    expect(roleLabel('HR_MANAGER')).toBe('HR Manager')
    expect(roleLabel('OWNER')).toBe('Company Owner')
  })

  it('never shows a custom role code raw', () => {
    expect(roleLabel('SITE_SUPERVISOR')).toBe('Site supervisor')
  })

  it('lists every role held, most senior first', () => {
    expect(rolesLine(['SUPER_ADMIN', 'OWNER'])).toBe('Super Admin, Company Owner')
    expect(rolesLine(['EMPLOYEE', 'SITE_SUPERVISOR', 'HR_MANAGER'])).toBe('HR Manager, Employee, Site supervisor')
    expect(rolesLine([])).toBeNull()
  })

  it('picks the most senior built-in role for one-line titles', () => {
    expect(primaryRole(['EMPLOYEE', 'HR_MANAGER'])).toBe('HR_MANAGER')
    expect(primaryRole(['SITE_SUPERVISOR'])).toBeNull()
  })
})
