import { describe, expect, it } from 'vitest'
import { HttpError } from './client'
import { FEATURE_NOT_READY, FEATURE_NOT_READY_MESSAGE, errorCodeOf, httpStatusOf, isFeatureNotReady } from './featureNotReady'

// What the backend sends while a feature's migration isn't applied yet
// (com.hrms.core.exception.FeatureNotReady through the global handler).
const body = { timestamp: '2026-09-27T04:30:00Z', status: 503, errorCode: 'FEATURE_NOT_READY', message: 'This isn’t switched on yet.' }

describe('isFeatureNotReady', () => {
  it('recognises the 503 FEATURE_NOT_READY answer from apiJson', () => {
    expect(isFeatureNotReady(new HttpError(body.message, 503, body))).toBe(true)
  })

  it('recognises it from the SDK client too (ApiError and a raw axios error)', () => {
    expect(isFeatureNotReady({ status: 503, code: 'FEATURE_NOT_READY', detail: body.message })).toBe(true)
    expect(isFeatureNotReady({ response: { status: 503, data: body } })).toBe(true)
  })

  it('is false for every other failure', () => {
    expect(isFeatureNotReady(new HttpError('down', 503, { errorCode: 'INTERNAL_ERROR' }))).toBe(false)
    expect(isFeatureNotReady(new HttpError('down', 503))).toBe(false) // a gateway 503 with no body
    expect(isFeatureNotReady(new HttpError('missing', 404, { errorCode: 'NOT_FOUND' }))).toBe(false)
    // The code alone is not enough: only the backend's 503 means "not switched on yet".
    expect(isFeatureNotReady(new HttpError('odd', 500, { errorCode: 'FEATURE_NOT_READY' }))).toBe(false)
    expect(isFeatureNotReady(new TypeError('Failed to fetch'))).toBe(false)
    expect(isFeatureNotReady(null)).toBe(false)
    expect(isFeatureNotReady(undefined)).toBe(false)
    expect(isFeatureNotReady('FEATURE_NOT_READY')).toBe(false)
  })

  it('keeps the backend wording in one place', () => {
    expect(FEATURE_NOT_READY).toBe('FEATURE_NOT_READY')
    expect(FEATURE_NOT_READY_MESSAGE).toBe(body.message)
  })
})

describe('httpStatusOf / errorCodeOf', () => {
  it('read both error shapes', () => {
    expect(httpStatusOf(new HttpError('x', 422, { errorCode: 'WFH_OVERLAP' }))).toBe(422)
    expect(errorCodeOf(new HttpError('x', 422, { errorCode: 'WFH_OVERLAP' }))).toBe('WFH_OVERLAP')
    expect(httpStatusOf({ response: { status: 409, data: { errorCode: 'CONCURRENT_UPDATE' } } })).toBe(409)
    expect(errorCodeOf({ response: { status: 409, data: { errorCode: 'CONCURRENT_UPDATE' } } })).toBe('CONCURRENT_UPDATE')
  })

  it('return undefined when there is nothing to read', () => {
    expect(httpStatusOf(new TypeError('Failed to fetch'))).toBeUndefined()
    expect(errorCodeOf(new HttpError('x', 500, 'not json'))).toBeUndefined()
    expect(errorCodeOf({ code: 20 })).toBeUndefined() // a DOMException-style numeric code is not an errorCode
    expect(httpStatusOf(null)).toBeUndefined()
    expect(errorCodeOf(undefined)).toBeUndefined()
  })
})
