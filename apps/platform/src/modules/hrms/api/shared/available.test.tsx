import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query'
import {
  asAvailable, daysInclusive, notAvailableReason, unmatchedPathParam, useAvailableQuery, withAvailability, type Availability,
} from './available'
import { answers } from './testing'

describe('notAvailableReason', () => {
  it('names the two "not there yet" answers', () => {
    expect(notAvailableReason(answers.notReady())).toBe('FEATURE_NOT_READY')
    expect(notAvailableReason(answers.notFound())).toBe('NOT_FOUND')
  })
  it('is null for everything else', () => {
    expect(notAvailableReason(answers.forbidden())).toBeNull()
    expect(notAvailableReason(answers.refused('X', 'no'))).toBeNull()
    expect(notAvailableReason(answers.serverError())).toBeNull()
    expect(notAvailableReason(answers.invalidParameter())).toBeNull()
    expect(notAvailableReason(new TypeError('Failed to fetch'))).toBeNull()
    expect(notAvailableReason(null)).toBeNull()
  })
})

describe('asAvailable', () => {
  it('wraps an answer', async () => {
    await expect(asAvailable(async () => ({ n: 1 }))).resolves.toEqual({ available: true, value: { n: 1 } })
  })
  it('folds 404 and FEATURE_NOT_READY into "not available"', async () => {
    await expect(asAvailable(async () => { throw answers.notReady() })).resolves.toEqual({ available: false, reason: 'FEATURE_NOT_READY' })
    await expect(asAvailable(async () => { throw answers.notFound() })).resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
  })
  it('rethrows the very same error for anything else', async () => {
    const e = answers.serverError()
    await expect(asAvailable(async () => { throw e })).rejects.toBe(e)
    const offline = new TypeError('Failed to fetch')
    await expect(asAvailable(async () => { throw offline })).rejects.toBe(offline)
  })
  it('reads an unbuilt path that fell into an /{id} mapping as not built, only when asked to', async () => {
    await expect(asAvailable(async () => { throw answers.invalidParameter() }, unmatchedPathParam))
      .resolves.toEqual({ available: false, reason: 'NOT_FOUND' })
    await expect(asAvailable(async () => { throw answers.invalidParameter() })).rejects.toMatchObject({ status: 400 })
    // A 400 with another code is a real error even then.
    const other = answers.refused('VALIDATION_FAILED', 'bad')
    await expect(asAvailable(async () => { throw other }, unmatchedPathParam)).rejects.toBe(other)
  })
})

/** A stand-in for React Query's tracked result: records which fields a component read. */
function tracked<T>(result: Partial<UseQueryResult<Availability<T>, Error>>) {
  const read = new Set<PropertyKey>()
  const proxy = new Proxy(result, { get: (t, k) => { read.add(k); return Reflect.get(t, k) } }) as UseQueryResult<Availability<T>, Error>
  return { proxy, read }
}

describe('withAvailability', () => {
  it('gives the answer as data', () => {
    const { proxy } = tracked<number[]>({ data: { available: true, value: [1, 2] }, isSuccess: true, isLoading: false })
    const r = withAvailability(proxy)
    expect(r.data).toEqual([1, 2])
    expect(r.notAvailable).toBe(false)
    expect(r.notAvailableReason).toBeNull()
    expect(r.isSuccess).toBe(true)
  })

  it('gives no data and a reason when not available', () => {
    const { proxy } = tracked<number[]>({ data: { available: false, reason: 'FEATURE_NOT_READY' }, isSuccess: true, isError: false })
    const r = withAvailability(proxy)
    expect(r.data).toBeUndefined()
    expect(r.notAvailable).toBe(true)
    expect(r.notAvailableReason).toBe('FEATURE_NOT_READY')
    expect(r.isError).toBe(false)
  })

  it('is neither while loading or on a real error', () => {
    const loading = withAvailability(tracked<number[]>({ data: undefined, isLoading: true }).proxy)
    expect(loading.data).toBeUndefined()
    expect(loading.notAvailable).toBe(false)
    const failed = withAvailability(tracked<number[]>({ data: undefined, isError: true, error: answers.serverError() }).proxy)
    expect(failed.notAvailable).toBe(false)
    expect(failed.error).toMatchObject({ status: 500 })
  })

  it('reads only the fields the page reads, so React Query keeps re-rendering only for those', () => {
    const { proxy, read } = tracked<number[]>({ data: { available: true, value: [] }, isLoading: false, isFetching: true })
    const r = withAvailability(proxy)
    void r.isLoading
    expect([...read]).toEqual(['isLoading'])
    void r.notAvailable
    expect(read.has('data')).toBe(true)
    expect(read.has('isFetching')).toBe(false)
  })
})

describe('useAvailableQuery with a real React Query cache', () => {
  function Probe({ queryKey }: { queryKey: string[] }) {
    const q = useAvailableQuery<string[]>({ queryKey, queryFn: async () => ({ available: true, value: [] }), enabled: false })
    return <pre>{JSON.stringify({ data: q.data ?? null, notAvailable: q.notAvailable, reason: q.notAvailableReason })}</pre>
  }
  const render = (cached: Availability<string[]>) => {
    const client = new QueryClient()
    client.setQueryData(['probe'], cached)
    const html = renderToStaticMarkup(<QueryClientProvider client={client}><Probe queryKey={['probe']} /></QueryClientProvider>)
    return JSON.parse(html.replace(/^<pre>|<\/pre>$/g, '').replace(/&quot;/g, '"'))
  }

  it('shows the cached answer as data', () => {
    expect(render({ available: true, value: ['a'] })).toEqual({ data: ['a'], notAvailable: false, reason: null })
  })
  it('shows a cached "not available" as notAvailable with no data', () => {
    expect(render({ available: false, reason: 'NOT_FOUND' })).toEqual({ data: null, notAvailable: true, reason: 'NOT_FOUND' })
  })
})

describe('daysInclusive', () => {
  it('counts both ends', () => {
    expect(daysInclusive('2026-09-28', '2026-09-28')).toBe(1)
    expect(daysInclusive('2026-09-28', '2026-10-04')).toBe(7)
    expect(daysInclusive('2026-10-01', '2026-09-30')).toBe(0)
    expect(Number.isNaN(daysInclusive('', '2026-09-30'))).toBe(true)
  })
})
