// Shift planning's pilot on the web (test businesses only): the planner's and the import's pages open only for a
// business in the pilot, any other business is sent to Shifts & overtime, and nothing shows while the answer is
// pending. A page reached directly treats 403 FEATURE_NOT_ENABLED like FEATURE_NOT_READY ("isn't switched on yet").
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { Navigate } from 'react-router-dom'
import { HttpError } from '@/core/api/client'

const answer = { enabled: false, known: false, pending: true }
vi.mock('../../api/useShiftPlanning', async () => ({
  ...(await vi.importActual<object>('../../api/useShiftPlanning')),
  useShiftPlanningAvailability: () => answer,
}))

import { ShiftPlanningGate } from './ShiftPlanningGate'
import { isFeatureNotEnabled, isShiftPlanningOff } from '../../api/useShiftPlanning'

const gate = () => ShiftPlanningGate({ children: <p>planner page</p> })
const answered = (enabled: boolean, known = true) => Object.assign(answer, { enabled, known, pending: !known })

describe('ShiftPlanningGate', () => {
  it('shows nothing until the answer is in', () => {
    answered(false, false)
    expect(gate()).toBeNull()
    answered(true, false)
    expect(gate()).toBeNull()
  })

  it('opens the page for a business in the pilot', () => {
    answered(true)
    expect(renderToStaticMarkup(gate())).toBe('<p>planner page</p>')
  })

  it('sends any other business to Shifts & overtime', () => {
    answered(false)
    const el = gate()
    expect(el?.type).toBe(Navigate)
    expect(el?.props).toMatchObject({ to: '/hrms/shifts', replace: true })
  })
})

describe('the answers that mean shift planning is off', () => {
  const notEnabled = new HttpError('Shift planning isn’t switched on for this business yet.', 403, { errorCode: 'FEATURE_NOT_ENABLED' })
  const notReady = new HttpError('This isn’t switched on yet.', 503, { errorCode: 'FEATURE_NOT_READY' })
  const scope = new HttpError('Only HR can plan rosters outside the departments you head.', 403, { errorCode: 'ROSTER_SCOPE' })
  const noModule = new HttpError('This workspace has not provisioned the attendance module.', 403)

  it('is 403 FEATURE_NOT_ENABLED (not in the pilot) or 503 FEATURE_NOT_READY (tables not live)', () => {
    expect(isFeatureNotEnabled(notEnabled)).toBe(true)
    expect(isShiftPlanningOff(notEnabled)).toBe(true)
    expect(isFeatureNotEnabled(notReady)).toBe(false)
    expect(isShiftPlanningOff(notReady)).toBe(true)
  })

  it('is not any other refusal, which the page shows as an error', () => {
    for (const e of [scope, noModule, new Error('offline'), null, undefined]) {
      expect(isFeatureNotEnabled(e)).toBe(false)
      expect(isShiftPlanningOff(e)).toBe(false)
    }
  })
})
