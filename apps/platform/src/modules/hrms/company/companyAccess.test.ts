// The SDK's applyCompanyAccess: GET /v1/canonical-auth/me asked with X-Company-Id gives the roles,
// permissions and personal-pages answer for that company; only those change in the session.
import { afterEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@unifiedtree/sdk'

const signedIn = () => useAuthStore.setState({
  status: 'authenticated',
  user: { id: 'u-1', email: 'mgr@x.com', firstName: 'Maya', lastName: 'Rao', roles: ['DEPT_MANAGER'] },
  tenant: { id: 't-1', slug: 'demo', displayName: 'Demo', contactEmail: '', status: 'ACTIVE', planType: 'PROFESSIONAL' },
  permissions: new Map([['attendance.team.read', 'ORG'], ['leave.request.self', 'ORG']]),
  modules: [{ key: 'hrms', displayName: 'hrms', enabled: true }],
  personalPages: true,
})
afterEach(() => useAuthStore.getState().reset())

describe('applyCompanyAccess', () => {
  it('takes the company’s roles, permissions and personal pages, and keeps the session', () => {
    signedIn()
    useAuthStore.getState().applyCompanyAccess({ roles: ['EMPLOYEE'], permissions: ['leave.request.self'], personalPages: true })
    const s = useAuthStore.getState()
    expect(s.user?.roles).toEqual(['EMPLOYEE'])
    expect([...s.permissions.keys()]).toEqual(['leave.request.self'])
    expect(s.status).toBe('authenticated')
    expect(s.user?.email).toBe('mgr@x.com')
    expect(s.tenant?.id).toBe('t-1')
    expect(s.modules.map((m) => m.key)).toEqual(['hrms'])
  })

  it('keeps what an answer leaves out', () => {
    signedIn()
    useAuthStore.getState().applyCompanyAccess({ personalPages: false })
    const s = useAuthStore.getState()
    expect(s.user?.roles).toEqual(['DEPT_MANAGER'])
    expect(s.permissions.has('attendance.team.read')).toBe(true)
    expect(s.personalPages).toBe(false)
  })

  it('does nothing when no one is signed in', () => {
    useAuthStore.getState().reset()
    useAuthStore.getState().applyCompanyAccess({ roles: ['OWNER'], permissions: ['*'] })
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().permissions.size).toBe(0)
  })
})
