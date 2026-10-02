import { describe, expect, it } from 'vitest'
import { HttpError } from '@/core/api/client'
import { clockIst, deviceLabel, locationErrorText, punchRefusal } from './webPunch'

const refused = (status: number, errorCode?: string, message = 'Request failed') => new HttpError(message, status, errorCode ? { errorCode, message } : null)

describe('web punch', () => {
  it('labels the browser for the face log', () => {
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Web browser (Chrome on Windows)')
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Web browser (Edge on Windows)')
    expect(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15')).toBe('Web browser (Safari on macOS)')
    expect(deviceLabel('')).toBe('Web browser')
  })

  it('a face that does not match can be tried again; no face on record asks for enrolment', () => {
    expect(punchRefusal(refused(403, 'FAIL_MATCH'), 'in')).toMatchObject({ kind: 'retry' })
    expect(punchRefusal(refused(403, 'FAIL_LIVENESS'), 'out')).toMatchObject({ kind: 'retry' })
    expect(punchRefusal(refused(422, 'FAIL_NO_FACE'), 'in')).toMatchObject({ kind: 'retry' })
    expect(punchRefusal(refused(409, 'FACE_NOT_ENROLLED'), 'in')).toMatchObject({ kind: 'enroll' })
  })

  it('a lock, the company switch and a day already punched stop the dialog', () => {
    expect(punchRefusal(refused(423, 'FACE_LOCKED'), 'in')).toMatchObject({ kind: 'stop' })
    expect(punchRefusal(refused(422, 'WEB_PUNCH_NOT_ALLOWED'), 'in').text).toMatch(/turned off/)
    expect(punchRefusal(refused(422, 'ALREADY_CHECKED_IN'), 'in').text).toBe('You’ve already checked in today.')
    expect(punchRefusal(refused(422, 'NOT_CHECKED_IN'), 'out')).toMatchObject({ kind: 'stop' })
    expect(punchRefusal(refused(422, 'OUTSIDE_GEOFENCE', 'You are 800 meters outside the office boundary.'), 'in').text).toMatch(/800 meters/)
  })

  it('anything else reads plainly', () => {
    expect(punchRefusal(refused(500), 'in').text).toBe('We couldn’t check in just now. Try again in a moment.')
    expect(punchRefusal(new TypeError('Failed to fetch'), 'out').text).toMatch(/connection/)
    expect(punchRefusal(refused(403), 'out').text).toMatch(/role can’t check out/)
  })

  it('location errors and the clock', () => {
    expect(locationErrorText({ code: 1 })).toMatch(/blocked/)
    expect(locationErrorText({ code: 3 })).toMatch(/too long/)
    expect(clockIst('2026-10-01T03:44:00Z')).toBe('9:14 AM')
    expect(clockIst(null)).toBe('')
  })
})
