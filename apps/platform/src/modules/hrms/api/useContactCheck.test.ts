// The forms' email and phone checks (2026-10-05): what they ask the server and how a refused
// save is read. (The repo has no DOM test environment, so the hooks' timing is covered by the
// live test, live-unique-email.mjs.)
import { beforeEach, describe, expect, it, vi } from 'vitest'

const asked: string[] = []
let answer: unknown = { available: true }
vi.mock('@/core/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/core/api/client')>('@/core/api/client')
  return { ...actual, apiJson: async (url: string) => { asked.push(url); return answer } }
})

import { HttpError } from '@/core/api/client'
import { EMAIL_ALREADY_USED, checkEmail, checkPhone, emailConflictMessage, normalizeEmail, phoneKey } from './useContactCheck'

beforeEach(() => { asked.length = 0; answer = { available: true } })

describe('normalising', () => {
  it('compares emails trimmed and lower-cased, as the server saves them', () => {
    expect(normalizeEmail('  READER@UnifiedTree.demo ')).toBe('reader@unifiedtree.demo')
    expect(normalizeEmail(null)).toBe('')
  })
  it('compares phone numbers by their last ten digits', () => {
    expect(phoneKey('+91 98450-12345')).toBe('9845012345')
    expect(phoneKey('98450 12345')).toBe('9845012345')
  })
})

describe('the checks', () => {
  it('asks about the normalised email, leaving out the person being edited', async () => {
    answer = { available: false, ownerName: 'Reader User', ownerCode: 'EMP002', message: 'This email already belongs to Reader User (EMP002).' }
    const r = await checkEmail(' READER@unifiedtree.demo ', 'emp-1')
    expect(asked).toEqual(['/v1/employees/email-check?email=reader%40unifiedtree.demo&excludeEmployeeId=emp-1'])
    expect(r.available).toBe(false)
    expect(r.message).toBe('This email already belongs to Reader User (EMP002).')
  })
  it('leaves the exclusion out when adding someone', async () => {
    await checkEmail('new@x.com')
    expect(asked).toEqual(['/v1/employees/email-check?email=new%40x.com'])
  })
  it('asks who else has a phone number', async () => {
    answer = { inUse: true, count: 1, usedBy: [{ name: 'Reader User', code: 'EMP002' }], message: 'Also used by Reader User (EMP002).' }
    const r = await checkPhone(' +91 98450 12345 ', 'emp-1')
    expect(asked).toEqual(['/v1/employees/phone-check?phone=%2B91%2098450%2012345&excludeEmployeeId=emp-1'])
    expect(r.message).toBe('Also used by Reader User (EMP002).')
  })
})

describe('a refused save', () => {
  it('puts the 409 EMAIL_ALREADY_USED message on the email field', () => {
    const err = new HttpError('This email already belongs to Aisha Khan (EMP-0003).', 409,
      { errorCode: EMAIL_ALREADY_USED, message: 'This email already belongs to Aisha Khan (EMP-0003).' })
    expect(emailConflictMessage(err)).toBe('This email already belongs to Aisha Khan (EMP-0003).')
  })
  it('leaves every other error to the form', () => {
    expect(emailConflictMessage(new HttpError('Employee code in use', 422, { errorCode: 'DUPLICATE_EMPLOYEE_CODE' }))).toBeNull()
    expect(emailConflictMessage(new Error('Network down'))).toBeNull()
    expect(emailConflictMessage(undefined)).toBeNull()
  })
})
