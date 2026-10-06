// Face station rules shared by the setup page and the station page (stationApi.ts).
import { describe, expect, it } from 'vitest'
import { HttpError } from '@/core/api/client'
import { canSetUpStations, shouldRenew, stationProblem, stationSearch, successLines } from './stationApi'

const DAY = 24 * 3600 * 1000
const refused = (status: number, errorCode?: string, message = `Request failed with status ${status}`) =>
  new HttpError(message, status, errorCode ? { errorCode, message } : null)

describe('canSetUpStations', () => {
  it('needs attendance settings AND punch-for-anyone, as the server does', () => {
    expect(canSetUpStations(() => true)).toBe(true)
    expect(canSetUpStations((c) => c === 'attendance.policy.manage')).toBe(false)
    expect(canSetUpStations((c) => c === 'attendance.assisted_punch.any')).toBe(false)
    expect(canSetUpStations(() => false)).toBe(false)
  })
})

describe('stationSearch', () => {
  it('searches only from 2 letters, so the branch is never listed whole', () => {
    expect(stationSearch('')).toBeNull()
    expect(stationSearch(' a ')).toBeNull()
    expect(stationSearch(' ra ')).toBe('ra')
  })
})

describe('shouldRenew', () => {
  const now = Date.parse('2026-10-06T06:00:00Z')
  it('renews once less than 29 of the 30 days are left, or when the expiry is unknown', () => {
    expect(shouldRenew(new Date(now + 30 * DAY).toISOString(), now)).toBe(false)
    expect(shouldRenew(new Date(now + 28 * DAY).toISOString(), now)).toBe(true)
    expect(shouldRenew(null, now)).toBe(true)
    expect(shouldRenew('garbage', now)).toBe(true)
  })
})

describe('stationProblem', () => {
  it('ends the station when it was switched off', () => {
    expect(stationProblem(refused(401, 'STATION_REVOKED', 'This station was switched off by your admin.')).next).toBe('off')
    expect(stationProblem(refused(403, 'STATION_ONLY_PUNCHES')).next).toBe('off')
    expect(stationProblem(refused(401)).next).toBe('off')
  })
  it('keeps the camera open for a face that did not match or was not clear, with the server’s words', () => {
    expect(stationProblem(refused(403, 'FAIL_MATCH', 'The face didn’t match Ravi Kumar.'))).toEqual({
      title: 'Face didn’t match', text: 'The face didn’t match Ravi Kumar.', next: 'camera',
    })
    expect(stationProblem(refused(422, 'FAIL_NO_FACE')).next).toBe('camera')
  })
  it('goes back to the start for what a new photo cannot fix', () => {
    for (const code of ['STATION_OTHER_BRANCH', 'FACE_NOT_ENROLLED', 'ALREADY_CHECKED_IN', 'NOT_CHECKED_IN', 'OUTSIDE_GEOFENCE', 'FACE_LOCKED']) {
      expect([code, stationProblem(refused(409, code)).next]).toEqual([code, 'start'])
    }
  })
  it('never shows a raw network message', () => {
    const p = stationProblem(new TypeError('Failed to fetch'))
    expect(p.title).toBe('Couldn’t reach the server')
    expect(p.text).not.toMatch(/fetch/i)
  })
})

describe('successLines', () => {
  it('greets by first name and says when the manager still has to confirm', () => {
    expect(successLines({ type: 'CHECK_IN', employeeName: 'Ravi Kumar', needsApproval: false }))
      .toEqual({ title: 'Punched in · welcome, Ravi', note: 'Recorded. You’re all set.' })
    expect(successLines({ type: 'CHECK_OUT', employeeName: 'Ravi Kumar', needsApproval: true }).note).toMatch(/manager will confirm/)
  })
})
