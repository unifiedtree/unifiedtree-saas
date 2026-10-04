// Add employee → Access → Create role: the new role is only ever offered
// through the list of roles the signed-in admin may give (the server's levels
// rules), and the role fields keep the Roles page's checks.
import { describe, expect, it } from 'vitest'
import { pickCreatedRole } from './newPersonAccess'
import type { AssignableRole } from './useWorkspaceAccess'
import { codeFromName, newRoleBody, roleDraftFor, roleDraftProblem } from '../components/RoleFields'

const role = (over: Partial<AssignableRole>): AssignableRole => ({
  roleCode: 'REGIONAL_HR', displayName: 'Regional HR', module: 'hrms', moduleActive: true, riskLevel: 'LOW', canGrant: true, grantBlockedReason: null, ...over,
})

describe('pickCreatedRole', () => {
  it('selects a role the admin may give', () => {
    const r = role({})
    expect(pickCreatedRole('REGIONAL_HR', 'Regional HR', [role({ roleCode: 'EMPLOYEE' }), r])).toEqual({ kind: 'select', role: r })
  })
  it('does not select a role above the admin’s own level, and says why', () => {
    const why = 'You can only give a role whose permissions you hold yourself. Regional HR includes 1 you don’t have: payroll.run.lock.'
    const pick = pickCreatedRole('REGIONAL_HR', 'Regional HR', [role({ canGrant: false, grantBlockedReason: why, riskLevel: 'HIGH' })])
    expect(pick).toEqual({ kind: 'skip', reason: `Regional HR was created, but it wasn’t selected. ${why}` })
  })
  it('a high-risk role goes through the same warning as ticking it by hand', () => {
    const r = role({ riskLevel: 'HIGH' })
    expect(pickCreatedRole('REGIONAL_HR', 'Regional HR', [r])).toEqual({ kind: 'confirm', role: r })
  })
  it('a role missing from the list is not selected', () => {
    expect(pickCreatedRole('REGIONAL_HR', 'Regional HR', [role({ roleCode: 'EMPLOYEE' })]))
      .toEqual({ kind: 'skip', reason: 'Regional HR was created, but it isn’t in the list of roles you can give, so it wasn’t selected.' })
  })
  it('a role whose module is off is not selected', () => {
    expect(pickCreatedRole('REGIONAL_HR', 'Regional HR', [role({ moduleActive: false })]).kind).toBe('skip')
  })
})

describe('role fields (shared with Roles & permissions)', () => {
  it('the code follows the name rule the server uses', () => {
    expect(codeFromName('Senior manager')).toBe('SENIOR_MANAGER')
    expect(codeFromName('2nd shift lead')).toBe('ROLE_2ND_SHIFT_LEAD')
  })
  it('a new role needs a code and a name', () => {
    const d = roleDraftFor('create')
    expect(roleDraftProblem(d, true)).toBe('Role code and name are required')
    expect(roleDraftProblem({ ...d, displayName: 'Regional HR', code: 'REGIONAL_HR' }, true)).toBeNull()
    expect(newRoleBody({ ...d, displayName: ' Regional HR ', code: 'regional hr', description: ' ' }))
      .toEqual({ code: 'REGIONAL_HR', displayName: 'Regional HR', description: undefined })
  })
})
