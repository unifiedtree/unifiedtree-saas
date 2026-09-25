import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The branding store must never retry in a tight loop: a 429 from the edge's
// per-IP rate limit (which the browser reports as a CORS error) used to be
// retried on every re-render, keeping a whole office network banned.

const apiJson = vi.fn()

vi.mock('@unifiedtree/sdk', () => ({
  useAuthStore: Object.assign(() => null, { getState: () => ({}) }),
  getAccessToken: () => '',
  setAccessToken: () => {},
}))

vi.mock('@/core/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/core/api/client')>('@/core/api/client')
  return {
    ...actual,
    apiJson: (path: string) => apiJson(path),
    currentSubdomain: () => 'acme',
  }
})

const { useBrandingStore } = await import('./workspaceBranding')
const { HttpError } = await import('@/core/api/client')

const DTO = { workspaceName: 'Acme Pvt Ltd', logoUrl: null, markUrl: null }

describe('workspace branding load', () => {
  let key = 0
  // A fresh key per test: the backoff is kept per key for the page's lifetime.
  const k = (kind: 'auth' | 'pub') => `${kind}:t${key}`

  beforeEach(() => {
    key += 1
    apiJson.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T12:00:00Z'))
    useBrandingStore.setState({ key: null, status: 'idle', data: null })
  })
  afterEach(() => { vi.useRealTimers() })

  it('does not call again right after a failure, only after the backoff', async () => {
    apiJson.mockRejectedValue(new TypeError('Failed to fetch'))
    const { load } = useBrandingStore.getState()

    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(1)
    expect(useBrandingStore.getState().status).toBe('error')

    await load(k('pub'), false)
    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(16_000)
    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(2)

    // Second failure doubles the wait: 16 s later is still too soon.
    vi.advanceTimersByTime(16_000)
    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(16_000)
    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(3)
  })

  it('a session flipping between signed in and out does not reset the backoff', async () => {
    apiJson.mockRejectedValue(new HttpError('Too many requests', 429))
    const { load } = useBrandingStore.getState()

    await load(k('auth'), true)
    await load(k('pub'), false)
    expect(apiJson).toHaveBeenCalledTimes(2)

    await load(k('auth'), true)
    await load(k('pub'), false)
    await load(k('auth'), true)
    expect(apiJson).toHaveBeenCalledTimes(2)
    expect(useBrandingStore.getState().status).toBe('error')
  })

  it('a rate-limited or failed signed-in read does not also hit the public lookup', async () => {
    apiJson.mockRejectedValue(new HttpError('Too many requests', 429))
    await useBrandingStore.getState().load(k('auth'), true)
    expect(apiJson).toHaveBeenCalledTimes(1)
    expect(apiJson).toHaveBeenCalledWith('/v1/workspace/branding')
  })

  it('a lapsed subscription (402) still falls back to the public lookup', async () => {
    apiJson
      .mockRejectedValueOnce(new HttpError('Payment required', 402))
      .mockResolvedValueOnce(DTO)
    await useBrandingStore.getState().load(k('auth'), true)
    expect(apiJson).toHaveBeenCalledTimes(2)
    expect(apiJson).toHaveBeenLastCalledWith('/v1/public/workspace-branding?subdomain=acme')
    expect(useBrandingStore.getState()).toMatchObject({ status: 'ready', data: DTO })
  })

  it('force (after an upload) ignores the backoff, and success clears it', async () => {
    apiJson.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue(DTO)
    const { load } = useBrandingStore.getState()
    await load(k('pub'), false)
    await load(k('pub'), false, true)
    expect(apiJson).toHaveBeenCalledTimes(2)
    expect(useBrandingStore.getState().status).toBe('ready')
  })
})
