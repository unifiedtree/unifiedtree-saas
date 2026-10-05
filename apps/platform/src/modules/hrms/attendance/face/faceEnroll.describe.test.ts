import { describe, expect, it } from 'vitest'
import { describeFace, type FaceStatus } from './faceEnroll'

const status = (o: Partial<FaceStatus>): FaceStatus => ({ status: 'ACTIVE', samplesRequired: 3, samplesCaptured: 3, remainingAngles: [], lockedRequiresManagerReset: false, ...o })

describe('face status line on a profile', () => {
  it('shows the enrolment date when the server sends one', () => {
    expect(describeFace(status({ enrolledAt: '2026-10-05T07:47:00Z' }), false).detail).toBe('Enrolled on 5 Oct 2026')
  })

  it('an unreadable date shows no date instead of throwing', () => {
    expect(describeFace(status({ enrolledAt: 'not a date' }), false)).toMatchObject({ label: 'Enrolled', detail: 'Enrolled' })
    expect(describeFace(status({ enrolledAt: null }), false).detail).toBe('Enrolled')
  })
})
