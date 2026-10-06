// Company access on Roles & permissions and the employee Access tab: who can work
// in which company and their role there, which companies and roles can be given,
// and a server without company access reads as "not available" (not an error).
import { describe, expect, it } from 'vitest'
import { HttpError } from '@/core/api/client'
import {
  accessLabel, companyAccessError, companyAccessUnavailable, grantableCompanies, rolesForCompany, rolesInCompany,
  type CompanyAccessView,
} from './useCompanyAccess'

const ACME = 'c-acme', BETA = 'c-beta', GAMMA = 'c-gamma'
const all = [{ id: ACME, name: 'Acme' }, { id: BETA, name: 'Beta' }, { id: GAMMA, name: 'Gamma' }]

const scoped: CompanyAccessView = {
  userId: 'u1', homeCompanyId: ACME, allCompanies: false,
  companies: [
    { companyId: ACME, name: 'Acme', logoUrl: null, active: true, home: true, access: 'HOME', roles: [{ code: 'DEPT_MANAGER', name: 'Dept Manager', source: 'ROLES', grantedBy: null, grantedAt: null }] },
    { companyId: BETA, name: 'Beta', logoUrl: null, active: true, home: false, access: 'GRANT', roles: [{ code: 'EMPLOYEE', name: 'Employee', source: 'GRANT', grantedBy: 'u0', grantedAt: '2026-10-06T10:00:00Z' }] },
  ],
}

describe('grantableCompanies', () => {
  it('offers every company but their main one (a granted company stays, for another role there)', () => {
    expect(grantableCompanies(scoped, all).map((c) => c.id)).toEqual([BETA, GAMMA])
  })
  it('offers nothing to someone whose roles cover every company', () => {
    expect(grantableCompanies({ ...scoped, allCompanies: true }, all)).toEqual([])
  })
  it('offers nothing before their access has loaded', () => {
    expect(grantableCompanies(undefined, all)).toEqual([])
  })
})

describe('rolesForCompany', () => {
  const roles = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'DEPT_MANAGER', 'EMPLOYEE', 'SUPERVISOR'].map((roleCode) => ({ roleCode }))
  it('never offers the roles that cover the whole business', () => {
    expect(rolesForCompany(roles, scoped, GAMMA).map((r) => r.roleCode)).toEqual(['HR_MANAGER', 'DEPT_MANAGER', 'EMPLOYEE', 'SUPERVISOR'])
  })
  it('leaves out a role they already have in that company', () => {
    expect(rolesForCompany(roles, scoped, BETA).map((r) => r.roleCode)).toEqual(['HR_MANAGER', 'DEPT_MANAGER', 'SUPERVISOR'])
  })
})

describe('rolesInCompany (Who has which role, per company)', () => {
  const mgr = { roles: [{ roleCode: 'DEPT_MANAGER', displayName: 'Dept Manager' }] }
  const grants = [{ companyId: BETA, roleName: 'Employee' }]
  it('their roles in their main company', () => {
    expect(rolesInCompany(mgr, ACME, grants, ACME)).toEqual({ via: 'HOME', roles: ['Dept Manager'] })
  })
  it('a grant’s role in another company', () => {
    expect(rolesInCompany(mgr, ACME, grants, BETA)).toEqual({ via: 'GRANT', roles: ['Employee'] })
  })
  it('nothing in a company they can’t open', () => {
    expect(rolesInCompany(mgr, ACME, grants, GAMMA)).toBeNull()
  })
  it('Admin (owner minus billing), HR manager and the owner reach every company', () => {
    for (const code of ['ADMIN', 'HR_MANAGER', 'OWNER']) {
      expect(rolesInCompany({ roles: [{ roleCode: code, displayName: code }] }, ACME, [], GAMMA)).toEqual({ via: 'WORKSPACE', roles: [code] })
    }
  })
  it('a login with no employee record reaches every company', () => {
    expect(rolesInCompany(mgr, null, [], GAMMA)?.via).toBe('WORKSPACE')
  })
  it('an unknown main company only counts their grants', () => {
    expect(rolesInCompany(mgr, undefined, grants, ACME)).toBeNull()
    expect(rolesInCompany(mgr, undefined, grants, BETA)?.via).toBe('GRANT')
  })
})

describe('company access not on the server yet', () => {
  it('a missing endpoint or an unapplied migration is "not available"', () => {
    expect(companyAccessUnavailable(new HttpError('Not Found', 404, {}))).toBe(true)
    expect(companyAccessUnavailable(new HttpError('later', 503, { errorCode: 'FEATURE_NOT_READY' }))).toBe(true)
    expect(companyAccessError(new HttpError('Not Found', 404))).toBe('Company access isn’t available on this server yet.')
  })
  it('a refusal or an unknown person is a real error, with the server’s words', () => {
    expect(companyAccessUnavailable(new HttpError('User not found', 404, { errorCode: 'USER_NOT_FOUND' }))).toBe(false)
    const refused = new HttpError('You can only give a role whose permissions you hold yourself.', 403, { errorCode: 'PERMISSION_NOT_HELD' })
    expect(companyAccessUnavailable(refused)).toBe(false)
    expect(companyAccessError(refused)).toBe('You can only give a role whose permissions you hold yourself.')
  })
})

describe('accessLabel', () => {
  it('says how they reach the company', () => {
    expect(['WORKSPACE', 'HOME', 'GRANT'].map((access) => accessLabel(access as 'HOME'))).toEqual(['Every company', 'Main company', 'Given access'])
  })
})
