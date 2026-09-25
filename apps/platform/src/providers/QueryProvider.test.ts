import { describe, expect, it } from 'vitest'
import { isRetryable } from './QueryProvider'
import { HttpError } from '@/core/api/client'

// Queries must not turn one failed request into four. Before this, the
// predicate read the axios error shape (`error.response.status`), which
// apiJson never produces, so every failure — including a 403 on a section the
// role cannot see, and responses the browser blocked — was retried 3 times.

describe('isRetryable', () => {
  const NO_RETRY = [401, 403, 404, 409, 422, 429]
  for (const status of NO_RETRY) {
    it(`does not retry ${status} from apiJson (flat .status)`, () => {
      expect(isRetryable(1, new HttpError('nope', status))).toBe(false)
    })
  }

  it('does not retry 403 from the SDK either (axios shape)', () => {
    expect(isRetryable(1, { response: { status: 403 } })).toBe(false)
  })

  it('retries a server error once, then stops', () => {
    expect(isRetryable(1, new HttpError('boom', 500))).toBe(true)
    expect(isRetryable(2, new HttpError('boom', 500))).toBe(false)
  })

  it('retries a request timeout once', () => {
    expect(isRetryable(1, new HttpError('slow', 408))).toBe(true)
    expect(isRetryable(2, new HttpError('slow', 408))).toBe(false)
  })

  it('retries a blocked or dropped request once, then stops', () => {
    // What a CORS block, an offline tab or a rate-limit page looks like here:
    // fetch rejects with a TypeError that carries no status at all.
    const blocked = new TypeError('Failed to fetch')
    expect(isRetryable(1, blocked)).toBe(true)
    expect(isRetryable(2, blocked)).toBe(false)
  })

  it('survives a null or odd error without throwing', () => {
    expect(isRetryable(1, null)).toBe(true)
    expect(isRetryable(2, undefined)).toBe(false)
    expect(isRetryable(1, 'a string')).toBe(true)
  })
})
