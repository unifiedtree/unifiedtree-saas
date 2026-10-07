import { describe, expect, it } from 'vitest'
import { returnPathFrom } from './returnPath'

describe('returnPathFrom (after signing in)', () => {
  it('goes back to the page that asked for a sign-in', () => {
    expect(returnPathFrom({ returnUrl: '/hrms/payroll-dashboard' })).toBe('/hrms/payroll-dashboard')
    expect(returnPathFrom({ returnUrl: '/hrms/leave?tab=approvals' })).toBe('/hrms/leave?tab=approvals')
    expect(returnPathFrom({ returnUrl: '/me/celebrations' })).toBe('/me/celebrations')
  })

  it('goes Home without one', () => {
    expect(returnPathFrom(null)).toBe('/')
    expect(returnPathFrom(undefined)).toBe('/')
    expect(returnPathFrom({})).toBe('/')
    expect(returnPathFrom('/hrms/leave')).toBe('/')
    expect(returnPathFrom({ returnUrl: 42 })).toBe('/')
  })

  it('never leaves the site or loops back to the sign-in pages', () => {
    for (const bad of ['https://evil.example/x', '//evil.example/x', '/\\evil.example', 'hrms/leave', '/x?next=https://evil.example',
      '/login', '/login?x=1', '/forgot-password', '/reset-password/abc', '/accept-invite', '/pending-approval', '/a b', '/a\nb', '/' + 'x'.repeat(600)]) {
      expect([bad, returnPathFrom({ returnUrl: bad })]).toEqual([bad, '/'])
    }
    expect(returnPathFrom({ returnUrl: '/loginfo' })).toBe('/loginfo')
  })
})
