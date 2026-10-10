// Signing in on the business's own address with the website's sign-in (silentSignIn.ts, 11 Oct 2026).
// The exchange runs against a stub fetch; the sign-out mark against a stub localStorage. The cookies themselves
// (Domain=.unifiedtree.com) can't exist here: what is checked is every call the page makes and what it does
// with each answer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthResponse, WorkspaceStatus } from '@/core/api/client'
import type { FetchLike } from './silentSignIn'

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const STATUS: WorkspaceStatus = { tenantId: TENANT, tenantName: 'Acme', subdomain: 'acme', status: 'ACTIVE', activeModules: ['hrms'], requestedModules: [] }
const AUTH: AuthResponse = {
  accessToken: 'business-token', refreshToken: 'business-refresh', userId: 'u-1', tenantId: TENANT,
  email: 'ravi@acme.test', firstName: 'Ravi', lastName: 'Kumar', roles: ['EMPLOYEE'], permissions: ['hrms.ess.read'], personalPages: true,
}

/** A fresh copy of the module: its one-try-per-page-load state starts empty. */
async function load() {
  vi.resetModules()
  return import('./silentSignIn')
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: vi.fn((k: string) => map.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { map.set(k, v) }),
    removeItem: vi.fn((k: string) => { map.delete(k) }),
  }
}
const blockedStorage = () => {
  const no = () => { throw new DOMException('denied', 'SecurityError') }
  return { getItem: no, setItem: no, removeItem: no }
}

let storage: ReturnType<typeof memoryStorage>
function onHost(hostname: string, local: object = storage) {
  vi.stubGlobal('window', { location: { hostname, pathname: '/login', search: '' }, localStorage: local })
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A stub API: each path answers with its function; every call is kept. */
function api(answers: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; init: RequestInit }[] = []
  const impl: FetchLike = async (url, init = {}) => {
    calls.push({ url, init })
    const key = Object.keys(answers).find((k) => url.endsWith(k))
    if (!key) throw new Error(`unexpected call ${url}`)
    return answers[key](init)
  }
  return { impl, calls }
}
const REFRESH = '/v1/accounts/auth/refresh'
const SESSION = '/v1/accounts/workspaces/session'
/** Never answers; fails when the call is cancelled. */
const hang = (init: RequestInit) => new Promise<Response>((_, reject) => {
  init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
})

const signedInOnTheWebsite = () => api({
  [REFRESH]: () => json(200, { accessToken: 'account-token', account: { email: 'ravi@acme.test' }, workspaces: [] }),
  [SESSION]: () => json(200, { auth: AUTH, workspace: { tenantId: TENANT } }),
})

beforeEach(() => {
  storage = memoryStorage()
  onHost('acme.unifiedtree.com')
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the exchange', () => {
  it('no business session, signed in on the website: signed in here, without the form', async () => {
    const { signInFromWebsite } = await load()
    const a = signedInOnTheWebsite()
    let statusAsked = 0
    const done = await signInFromWebsite({ workspaceStatus: async () => { statusAsked++; return STATUS }, fetchImpl: a.impl, locks: null })

    expect(done).toEqual({ auth: AUTH, status: STATUS })
    expect(statusAsked).toBe(1)
    expect(a.calls.map((c) => c.url)).toEqual(['/api/v1/accounts/auth/refresh', '/api/v1/accounts/workspaces/session'])
    // The account cookie only travels on a credentialed call; the business cookie is only kept from one.
    expect(a.calls.every((c) => c.init.credentials === 'include' && c.init.method === 'POST')).toBe(true)
    const session = a.calls[1].init
    expect((session.headers as Record<string, string>).Authorization).toBe('Bearer account-token')
    expect(JSON.parse(String(session.body))).toEqual({ tenantId: TENANT, silent: true })
    // No token in any address.
    expect(a.calls.some((c) => /token/i.test(c.url))).toBe(false)
  })

  it('the account token is kept nowhere but in this call', async () => {
    const { signInFromWebsite } = await load()
    const session = memoryStorage()
    vi.stubGlobal('sessionStorage', session)
    vi.stubGlobal('localStorage', storage)
    await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: signedInOnTheWebsite().impl, locks: null })
    for (const s of [storage, session]) {
      expect(s.setItem).not.toHaveBeenCalled()
      expect([...s.map.values()].join()).not.toContain('account-token')
    }
  })

  it('no account sign-in: the form, at once, after one call', async () => {
    const { signInFromWebsite } = await load()
    const a = api({ [REFRESH]: () => json(401, { message: 'No refresh token supplied' }) })
    let statusAsked = 0
    const started = Date.now()
    const done = await signInFromWebsite({ workspaceStatus: async () => { statusAsked++; return STATUS }, fetchImpl: a.impl, locks: null })
    expect(done).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    expect(a.calls).toHaveLength(1)
    expect(statusAsked).toBe(0)
  })

  it('an empty or unreadable refresh answer is no account sign-in', async () => {
    const { signInFromWebsite } = await load()
    for (const answer of [() => json(204), () => json(200, {}), () => new Response('not json', { status: 200 }), () => { throw new TypeError('Failed to fetch') }]) {
      const a = api({ [REFRESH]: answer })
      expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null })).toBeNull()
      expect(a.calls).toHaveLength(1)
    }
  })

  it('the server refuses (not a member, a closed business, an inactive or two-factor login, an operator): the form', async () => {
    const { signInFromWebsite } = await load()
    for (const [status, code] of [[403, 'USE_PASSWORD_FOR_TWO_FACTOR'], [403, 'You do not have access to this workspace'], [422, 'ACCOUNT_INACTIVE'], [401, ''], [500, ''], [429, '']] as const) {
      const a = api({
        [REFRESH]: () => json(200, { accessToken: 'account-token' }),
        [SESSION]: () => json(status, { errorCode: code, message: code }),
      })
      expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null })).toBeNull()
      expect(a.calls).toHaveLength(2)
    }
  })

  it('an answer that is not a session for this business: the form', async () => {
    const { signInFromWebsite } = await load()
    const answers = [
      { auth: { ...AUTH, tenantId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' } },
      { auth: { ...AUTH, accessToken: '' } },
      { auth: { ...AUTH, roles: undefined } },
      { auth: null },
      {},
    ]
    for (const body of answers) {
      const a = api({ [REFRESH]: () => json(200, { accessToken: 'account-token' }), [SESSION]: () => json(200, body) })
      expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null })).toBeNull()
    }
  })

  it('a business that is not active (pending approval) or not known: the form, and no session is asked for', async () => {
    const { signInFromWebsite } = await load()
    for (const status of [async () => ({ ...STATUS, status: 'PENDING_APPROVAL' }), async () => { throw new Error('404') }, async () => ({ ...STATUS, tenantId: '' })]) {
      const a = signedInOnTheWebsite()
      expect(await signInFromWebsite({ workspaceStatus: status, fetchImpl: a.impl, locks: null })).toBeNull()
      expect(a.calls.map((c) => c.url)).toEqual(['/api/v1/accounts/auth/refresh'])
    }
  })

  it('no answer in time: the form at the deadline, and the calls are cancelled', async () => {
    const { signInFromWebsite } = await load()
    const a = api({ [REFRESH]: hang })
    const started = Date.now()
    const done = await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null, timeoutMs: 60 })
    expect(done).toBeNull()
    expect(Date.now() - started).toBeGreaterThanOrEqual(55)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(a.calls[0].init.signal?.aborted).toBe(true)
  })

  it('a slow business status or session counts against the same deadline', async () => {
    const { signInFromWebsite } = await load()
    const never = new Promise<WorkspaceStatus>(() => {})
    const slowStatus = signedInOnTheWebsite()
    expect(await signInFromWebsite({ workspaceStatus: () => never, fetchImpl: slowStatus.impl, locks: null, timeoutMs: 60 })).toBeNull()
    expect(slowStatus.calls).toHaveLength(1)

    const slowSession = api({ [REFRESH]: () => json(200, { accessToken: 'account-token' }), [SESSION]: hang })
    expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: slowSession.impl, locks: null, timeoutMs: 60 })).toBeNull()
    expect(slowSession.calls[1].init.signal?.aborted).toBe(true)
  })

  it('an account answer that comes after the deadline asks for nothing more', async () => {
    const { signInFromWebsite } = await load()
    const a = api({
      [REFRESH]: () => new Promise<Response>((resolve) => setTimeout(() => resolve(json(200, { accessToken: 'account-token' })), 120)),
      [SESSION]: () => json(200, { auth: AUTH }),
    })
    expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null, timeoutMs: 40 })).toBeNull()
    await new Promise((r) => setTimeout(r, 150))
    expect(a.calls.map((c) => c.url)).toEqual(['/api/v1/accounts/auth/refresh'])
  })

  it('tabs opening together take turns (a Web Lock), and waiting counts against the deadline', async () => {
    const { signInFromWebsite } = await load()
    const request = vi.fn((_name: string, _options: LockOptions, callback: LockGrantedCallback<unknown>) => Promise.resolve(callback(null)))
    const a = signedInOnTheWebsite()
    expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: { request } as unknown as LockManager })).not.toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('ut-sign-in-from-website')
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)

    // Another tab holds the lock for longer than the deadline.
    const held = vi.fn((_name: string, options: LockOptions) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const b = signedInOnTheWebsite()
    expect(await signInFromWebsite({ workspaceStatus: async () => STATUS, fetchImpl: b.impl, locks: { request: held } as unknown as LockManager, timeoutMs: 40 })).toBeNull()
    expect(b.calls).toHaveLength(0)
  })

  it('one try a page load: a second caller shares the first', async () => {
    const { signInFromWebsiteOnce, maySignInSilently } = await load()
    const a = signedInOnTheWebsite()
    const opts = { workspaceStatus: async () => STATUS, fetchImpl: a.impl, locks: null }
    const first = signInFromWebsiteOnce(opts)
    expect(signInFromWebsiteOnce(opts)).toBe(first)
    await first
    expect(a.calls).toHaveLength(2)
    // Shown again in the same page load (a failure, or after a sign-out): the form at once.
    expect(maySignInSilently({ subdomain: 'acme', host: { kind: 'open', branding: {} as never }, search: new URLSearchParams() })).toBe(false)
  })
})

describe('whether to try', () => {
  const open = { kind: 'open', branding: { workspaceName: 'Acme' } } as const
  const ctx = (over: Partial<{ subdomain: string; host: unknown; search: string }> = {}) => ({
    subdomain: over.subdomain ?? 'acme',
    host: (over.host === undefined ? open : over.host) as never,
    search: new URLSearchParams(over.search ?? ''),
  })

  it('an open business on its own address, no sign-out here: yes', async () => {
    const { maySignInSilently } = await load()
    expect(maySignInSilently(ctx())).toBe(true)
    onHost('demo.localhost')
    expect(maySignInSilently(ctx({ subdomain: 'demo' }))).toBe(true)
  })

  it('after "Sign out" on this business: no (and no call is made)', async () => {
    const { maySignInSilently, markSignedOut } = await load()
    markSignedOut('acme')
    expect(maySignInSilently(ctx())).toBe(false)
  })

  it('UnifiedTree’s own addresses and the platform’s own business never try', async () => {
    const { maySignInSilently } = await load()
    for (const sub of ['admin', 'www', 'app', 'api', 'unifiedtree']) {
      onHost(`${sub}.unifiedtree.com`)
      expect(maySignInSilently(ctx({ subdomain: sub })), sub).toBe(false)
    }
    // marketing. and business. are not in the app's own list: the address lookup says "reserved" there.
    onHost('marketing.unifiedtree.com')
    expect(maySignInSilently(ctx({ subdomain: 'marketing', host: { kind: 'reserved' } }))).toBe(false)
  })

  it('only when the address lookup said "an open business is here"', async () => {
    const { maySignInSilently } = await load()
    for (const host of [null, { kind: 'unknown' }, { kind: 'unavailable', branding: {} }, { kind: 'not_found' }, { kind: 'reserved' }, { kind: 'platform' }]) {
      expect(maySignInSilently(ctx({ host })), JSON.stringify(host)).toBe(false)
    }
  })

  it('not over a refusal the page shows (?error=), and never off a business address', async () => {
    const { maySignInSilently } = await load()
    expect(maySignInSilently(ctx({ search: 'error=USE_PASSWORD_FOR_TWO_FACTOR' }))).toBe(false)
    expect(maySignInSilently(ctx({ subdomain: '' }))).toBe(false)
  })

  it('storage that can’t be read counts as signed out', async () => {
    const { maySignInSilently } = await load()
    onHost('acme.unifiedtree.com', blockedStorage())
    expect(maySignInSilently(ctx())).toBe(false)
  })
})

describe('"Sign out" sticks', () => {
  it('the mark is per business, and signing in again spends it', async () => {
    const { markSignedOut, clearSignedOut, signedOutHere } = await load()
    expect(signedOutHere('acme')).toBe(false)
    markSignedOut('acme')
    expect(signedOutHere('acme')).toBe(true)
    expect(signedOutHere('beta')).toBe(false)
    clearSignedOut('acme')
    expect(signedOutHere('acme')).toBe(false)
  })

  it('this address by default; nothing off a business address; blocked storage never throws', async () => {
    const { markSignedOut, clearSignedOut, signedOutHere } = await load()
    markSignedOut()
    expect(storage.map.get('ut.signed-out:acme')).toBe('1')
    expect(signedOutHere()).toBe(true)
    clearSignedOut()
    expect(signedOutHere()).toBe(false)
    onHost('localhost')
    markSignedOut()
    expect(storage.setItem).toHaveBeenCalledTimes(1)
    onHost('acme.unifiedtree.com', blockedStorage())
    expect(() => { markSignedOut(); clearSignedOut() }).not.toThrow()
  })

  it('every sign-out (the SDK’s logout) tells the app first, and a listener can never stop it', async () => {
    vi.unstubAllGlobals() // no address: the SDK's sign-out call is refused locally, no network
    const { useAuthStore, onSignOut } = await import('@unifiedtree/sdk')
    useAuthStore.setState({ status: 'authenticated' })
    const seen: string[] = []
    const off = onSignOut(() => { seen.push(useAuthStore.getState().status) })
    const offBroken = onSignOut(() => { throw new Error('broken listener') })
    await useAuthStore.getState().logout()
    expect(seen).toEqual(['authenticated']) // before the session is gone
    expect(useAuthStore.getState().status).toBe('unauthenticated')
    off(); offBroken()
    await useAuthStore.getState().logout()
    expect(seen).toHaveLength(1)
  })

  it('a sign-in beginning spends the mark: the form, Google, the website’s hand-over, a session back on load', async () => {
    const { isSignInStart } = await load()
    expect(isSignInStart('unauthenticated', 'authenticated')).toBe(true) // the form, or the website's sign-in here
    expect(isSignInStart('idle', 'authenticated')).toBe(true)            // a page load with the business cookie or ?token=
    expect(isSignInStart('authenticated', 'authenticated')).toBe(false)  // a signed-in page asking /me again
    expect(isSignInStart('authenticated', 'unauthenticated')).toBe(false)
    expect(isSignInStart('idle', 'unauthenticated')).toBe(false)
  })

  it('as AuthProvider runs it: sign out, then sign in with the form, and the mark is gone', async () => {
    const { isSignInStart, markSignedOut, clearSignedOut, signedOutHere } = await load()
    let settled: Parameters<typeof isSignInStart>[0] = 'idle'
    const status = (s: typeof settled) => {
      if (s === 'loading') return
      if (isSignInStart(settled, s)) clearSignedOut('acme')
      settled = s
    }
    status('loading'); status('authenticated')       // signed in on load
    markSignedOut('acme'); status('unauthenticated') // "Sign out"
    expect(signedOutHere('acme')).toBe(true)
    status('authenticated')                         // the form
    expect(signedOutHere('acme')).toBe(false)
    markSignedOut('acme')
    status('loading'); status('authenticated')       // only a re-read of /me in an open session (another tab signed out)
    expect(signedOutHere('acme')).toBe(true)
  })
})
