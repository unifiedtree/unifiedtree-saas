// The Marketing launcher: when the tile shows, the calls it makes (and the token each one carries), the URL the
// browser goes to (the ticket in the fragment only) and the plain message for every refusal.
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MARKETING_APP_ORIGIN, MARKETING_CALLBACK_PATH, MarketingLaunchError, createAccountSessionStore, createMarketingTicket,
  fetchMarketingChoices, isRetryable, launchPlan, launcherEnabled, loadMarketingChoices, marketingCallbackUrl,
  marketingCompanies, marketingErrorMessage, openMarketing, parseMarketingAppUrl, refreshAccountSession, refusalCode,
  type FetchLike, type MarketingErrorCode, type MarketingWorkspaceChoice,
} from './marketingLauncher'

const TICKET = 'Zq3x_9-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'
const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const CO = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const CO2 = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const ME = 'owner@unifiedtree.demo'

type Call = { url: string; init: RequestInit }
/** A fetch that answers from a list of (status, body) in order and records every call. */
function fakeFetch(...answers: Array<[number, unknown]>) {
  const calls: Call[] = []
  const impl: FetchLike = async (url, init = {}) => {
    calls.push({ url, init })
    const [status, body] = answers.shift() ?? [500, null]
    return new Response(body === null ? '' : JSON.stringify(body), { status })
  }
  return { impl, calls }
}
const login = (email = ME, token = 'acct-token-1') => [200, { accessToken: token, accessTokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(), account: { email, status: 'ACTIVE' } }] as [number, unknown]
const header = (c: Call, name: string) => new Headers(c.init.headers).get(name)

afterEach(() => { vi.restoreAllMocks() })

describe('VITE_MARKETING_APP_URL', () => {
  it('unset (production today): the launcher is off and may make no call', () => {
    expect(MARKETING_APP_ORIGIN).toBeNull()
    expect(launcherEnabled(MARKETING_APP_ORIGIN, ME, TENANT)).toBe(false)
  })
  it('on only with an origin, a signed-in person and a workspace', () => {
    expect(launcherEnabled('https://marketing.unifiedtree.com', ME, TENANT)).toBe(true)
    expect(launcherEnabled('https://marketing.unifiedtree.com', '', TENANT)).toBe(false)
    expect(launcherEnabled('https://marketing.unifiedtree.com', ME, '')).toBe(false)
  })
  it('takes a bare https origin', () => {
    expect(parseMarketingAppUrl('https://marketing.unifiedtree.com', false)).toBe('https://marketing.unifiedtree.com')
    expect(parseMarketingAppUrl(' https://marketing.unifiedtree.com/ ', false)).toBe('https://marketing.unifiedtree.com')
    expect(parseMarketingAppUrl('https://marketing.unifiedtree.com:8443', false)).toBe('https://marketing.unifiedtree.com:8443')
  })
  it('refuses anything that could send the ticket somewhere else', () => {
    for (const raw of [
      'https://marketing.unifiedtree.com/auth', 'https://marketing.unifiedtree.com/?next=https://evil.example',
      'https://marketing.unifiedtree.com/#x', 'https://user:pw@marketing.unifiedtree.com', 'http://marketing.unifiedtree.com',
      'javascript:alert(1)', '//marketing.unifiedtree.com', 'marketing.unifiedtree.com', 'ftp://marketing.unifiedtree.com',
      'not a url', '', '   ', undefined, null, 42,
    ]) expect(parseMarketingAppUrl(raw, true), String(raw)).toBeNull()
  })
  it('plain http only for localhost, and only outside a production build', () => {
    expect(parseMarketingAppUrl('http://localhost:3998', true)).toBe('http://localhost:3998')
    expect(parseMarketingAppUrl('http://127.0.0.1:3998', true)).toBe('http://127.0.0.1:3998')
    expect(parseMarketingAppUrl('http://localhost:3998', false)).toBeNull()
    expect(parseMarketingAppUrl('http://evil.example:3998', true)).toBeNull()
    expect(parseMarketingAppUrl('http://localhost.evil.example', true)).toBeNull()
  })
})

describe('the URL the browser goes to', () => {
  it('is Marketing’s callback with the ticket in the fragment, and nothing in a query string', () => {
    const url = marketingCallbackUrl('https://marketing.unifiedtree.com', TICKET)
    expect(url).toBe(`https://marketing.unifiedtree.com/auth/unifiedtree/callback#ticket=${TICKET}`)
    expect(MARKETING_CALLBACK_PATH).toBe('/auth/unifiedtree/callback')
    const parsed = new URL(url)
    expect(parsed.search).toBe('')
    expect(parsed.pathname).toBe(MARKETING_CALLBACK_PATH)
    // Marketing reads it as new URLSearchParams(hash).get('ticket')
    expect(new URLSearchParams(parsed.hash.replace(/^#/, '')).get('ticket')).toBe(TICKET)
  })
  it('refuses a ticket Marketing would not accept (or one that could add parameters)', () => {
    for (const bad of ['short', `${TICKET}&next=x`, `${TICKET}#x`, `${TICKET}?x`, 'a'.repeat(513), 'tick et with spaces 123']) {
      expect(() => marketingCallbackUrl('https://m.example.com', bad), bad).toThrow(MarketingLaunchError)
    }
  })
})

describe('refusals in plain words', () => {
  const body = (code: string) => ({ status: 403, error: '403 FORBIDDEN', message: `${code}: something technical` })
  it('reads the code a 403 message starts with', () => {
    for (const code of ['MARKETING_NOT_ENTITLED', 'NOT_A_MEMBER', 'ACCOUNT_INACTIVE', 'ACCOUNT_LOCKED', 'COMPANY_ACCESS_DENIED', 'WORKSPACE_INACTIVE', 'COMPANY_INACTIVE']) {
      expect(refusalCode(403, body(code))).toBe(code)
    }
    expect(refusalCode(404, body('COMPANY_NOT_FOUND'))).toBe('COMPANY_NOT_FOUND')
  })
  it('falls back on the status', () => {
    expect(refusalCode(401, null)).toBe('SIGNED_OUT')
    expect(refusalCode(429, null)).toBe('RATE_LIMITED')
    expect(refusalCode(503, { message: 'Service Unavailable' })).toBe('UNAVAILABLE')
    expect(refusalCode(0, null)).toBe('UNAVAILABLE')
    expect(refusalCode(403, { message: 'Access Denied' })).toBe('COMPANY_ACCESS_DENIED')
    expect(refusalCode(403, body('SOMETHING_NEW'))).toBe('COMPANY_ACCESS_DENIED')
    expect(refusalCode(400, null)).toBe('UNKNOWN')
  })
  it('every failure has its own short message', () => {
    const codes: MarketingErrorCode[] = ['MARKETING_NOT_ENTITLED', 'NOT_A_MEMBER', 'ACCOUNT_INACTIVE', 'ACCOUNT_LOCKED', 'COMPANY_ACCESS_DENIED', 'COMPANY_INACTIVE', 'COMPANY_NOT_FOUND', 'WORKSPACE_INACTIVE', 'SIGNED_OUT', 'RATE_LIMITED', 'UNAVAILABLE']
    const messages = codes.map(marketingErrorMessage)
    expect(new Set(messages).size).toBe(codes.length)
    for (const m of messages) { expect(m.length).toBeGreaterThan(10); expect(m).not.toMatch(/[A-Z]{3,}_/) }
    expect(marketingErrorMessage('MARKETING_NOT_ENTITLED')).toMatch(/doesn’t have Marketing/)
    expect(marketingErrorMessage('UNAVAILABLE')).toMatch(/can’t be opened right now/)
  })
  it('only a temporary failure offers Try again', () => {
    expect(isRetryable('UNAVAILABLE')).toBe(true)
    expect(isRetryable('RATE_LIMITED')).toBe(true)
    for (const c of ['MARKETING_NOT_ENTITLED', 'NOT_A_MEMBER', 'ACCOUNT_INACTIVE', 'ACCOUNT_LOCKED', 'SIGNED_OUT'] as MarketingErrorCode[]) expect(isRetryable(c)).toBe(false)
  })
})

describe('the calls', () => {
  it('the account refresh: the cookie (credentialed), no bearer, no body', async () => {
    const f = fakeFetch(login())
    const s = await refreshAccountSession(f.impl, ME)
    expect(s).toEqual(expect.objectContaining({ token: 'acct-token-1', email: ME }))
    expect(f.calls[0].url).toMatch(/\/v1\/accounts\/auth\/refresh$/)
    expect(f.calls[0].init.method).toBe('POST')
    expect(f.calls[0].init.credentials).toBe('include')
    expect(f.calls[0].init.body).toBeUndefined()
    expect(header(f.calls[0], 'Authorization')).toBeNull()
  })
  it('no account sign-in (401) or another person’s (other email): none', async () => {
    expect(await refreshAccountSession(fakeFetch([401, { message: 'No refresh token supplied' }]).impl, ME)).toBeNull()
    expect(await refreshAccountSession(fakeFetch(login('someone.else@example.com')).impl, ME)).toBeNull()
    expect(await refreshAccountSession(fakeFetch(login('OWNER@UnifiedTree.demo')).impl, ME)).not.toBeNull()
  })
  it('the API down: UNAVAILABLE', async () => {
    await expect(refreshAccountSession(fakeFetch([502, null]).impl, ME)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    const broken: FetchLike = async () => { throw new TypeError('Failed to fetch') }
    await expect(refreshAccountSession(broken, ME)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
  it('the companies list: the account token as bearer, no cookies', async () => {
    const f = fakeFetch([200, []])
    expect(await fetchMarketingChoices(f.impl, 'acct-token-1')).toEqual([])
    expect(f.calls[0].url).toMatch(/\/v1\/sso\/marketing\/companies$/)
    expect(f.calls[0].init.method).toBe('GET')
    expect(f.calls[0].init.credentials).toBe('omit')
    expect(header(f.calls[0], 'Authorization')).toBe('Bearer acct-token-1')
    expect(await fetchMarketingChoices(fakeFetch([401, null]).impl, 'x')).toBeNull()
  })
  it('the handoff: POST {tenantId, companyId} with the account token; the ticket back', async () => {
    const f = fakeFetch([200, { ticket: TICKET, expiresAt: '2026-10-09T10:00:00Z' }])
    expect(await createMarketingTicket(f.impl, 'acct-token-1', TENANT, CO)).toBe(TICKET)
    expect(f.calls[0].url).toMatch(/\/v1\/sso\/marketing\/handoff$/)
    expect(f.calls[0].init.method).toBe('POST')
    expect(f.calls[0].init.credentials).toBe('omit')
    expect(header(f.calls[0], 'Authorization')).toBe('Bearer acct-token-1')
    expect(JSON.parse(String(f.calls[0].init.body))).toEqual({ tenantId: TENANT, companyId: CO })
  })
  it('the handoff refused: its code', async () => {
    const f = fakeFetch([403, { message: 'MARKETING_NOT_ENTITLED: This company does not have Marketing Automation' }])
    await expect(createMarketingTicket(f.impl, 't', TENANT, CO)).rejects.toMatchObject({ code: 'MARKETING_NOT_ENTITLED' })
    await expect(createMarketingTicket(fakeFetch([200, { ticket: 'x&y' }]).impl, 't', TENANT, CO)).rejects.toMatchObject({ code: 'BAD_TICKET' })
  })
})

describe('who sees the tile', () => {
  const choices: MarketingWorkspaceChoice[] = [
    { tenantId: 'other-tenant', companies: [{ companyId: 'x1', name: 'Elsewhere Ltd', marketingEntitled: true }] },
    { tenantId: TENANT, companies: [
      { companyId: CO, name: 'UnifiedTree Demo', marketingEntitled: false },
      { companyId: CO2, name: 'Second Co', marketingEntitled: true },
    ] },
  ]
  it('only this workspace’s companies with Marketing', () => {
    expect(marketingCompanies(choices, TENANT, CO)).toEqual([{ companyId: CO2, name: 'Second Co', current: false }])
    expect(marketingCompanies(choices, 'no-such-tenant', CO)).toEqual([])
    expect(marketingCompanies([], TENANT, CO)).toEqual([])
  })
  it('the current company first', () => {
    const both: MarketingWorkspaceChoice[] = [{ tenantId: TENANT, companies: [
      { companyId: CO2, name: 'Second Co', marketingEntitled: true }, { companyId: CO, name: 'UnifiedTree Demo', marketingEntitled: true },
    ] }]
    expect(marketingCompanies(both, TENANT, CO).map((c) => [c.companyId, c.current])).toEqual([[CO, true], [CO2, false]])
  })
  it('no company: no tile; one: straight in; several: the chooser', () => {
    expect(launchPlan([])).toEqual({ kind: 'none' })
    expect(launchPlan([{ companyId: CO, name: 'A', current: true }])).toEqual({ kind: 'direct', companyId: CO })
    expect(launchPlan([{ companyId: CO, name: 'A', current: true }, { companyId: CO2, name: 'B', current: false }])).toEqual({ kind: 'choose' })
  })
  it('without an account sign-in the companies are never asked for', async () => {
    const f = fakeFetch([401, null])
    expect(await loadMarketingChoices(createAccountSessionStore(f.impl), f.impl, ME)).toEqual([])
    expect(f.calls.map((c) => c.url.replace(/^.*\/v1/, '/v1'))).toEqual(['/v1/accounts/auth/refresh'])
  })
  it('an expired account token: refreshed once, then asked again', async () => {
    const f = fakeFetch(login(ME, 'old'), [401, null], login(ME, 'new'), [200, choices])
    expect(await loadMarketingChoices(createAccountSessionStore(f.impl), f.impl, ME)).toEqual(choices)
    expect(header(f.calls[3], 'Authorization')).toBe('Bearer new')
  })
})

describe('the account session is refreshed as rarely as possible (each refresh rotates the cookie)', () => {
  it('reused for the same person; concurrent callers share one refresh', async () => {
    const f = fakeFetch(login())
    const store = createAccountSessionStore(f.impl)
    const [a, b] = await Promise.all([store.get(ME), store.get(ME)])
    expect(a).toBe(b)
    await store.get(ME)
    expect(f.calls).toHaveLength(1)
  })
  it('“no account sign-in” is remembered; a forced refresh asks again', async () => {
    const f = fakeFetch([401, null], login())
    const store = createAccountSessionStore(f.impl)
    expect(await store.get(ME)).toBeNull()
    expect(await store.get(ME)).toBeNull()
    expect(f.calls).toHaveLength(1)
    expect(await store.get(ME, true)).not.toBeNull()
  })
  it('someone else signed in on this tab: refreshed for them', async () => {
    const f = fakeFetch(login(), login('second@unifiedtree.demo', 't2'))
    const store = createAccountSessionStore(f.impl)
    await store.get(ME)
    expect((await store.get('second@unifiedtree.demo'))?.token).toBe('t2')
    expect(f.calls).toHaveLength(2)
  })
  it('refreshed a minute before it expires', async () => {
    let now = Date.now()
    const f = fakeFetch(login(), login(ME, 't2'))
    const store = createAccountSessionStore(f.impl, () => now)
    await store.get(ME)
    now += 3600_000 - 30_000
    expect((await store.get(ME))?.token).toBe('t2')
  })
})

describe('opening Marketing', () => {
  const opts = (impl: FetchLike, navigate: (u: string) => void) => ({
    sessions: createAccountSessionStore(impl), fetchImpl: impl, origin: 'https://marketing.unifiedtree.com',
    email: ME, tenantId: TENANT, companyId: CO, navigate,
  })
  it('gets a ticket for the company and goes to the callback with it in the fragment (same tab)', async () => {
    const f = fakeFetch(login(), [200, { ticket: TICKET, expiresAt: '2026-10-09T10:00:00Z' }])
    const navigate = vi.fn()
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error'), vi.spyOn(console, 'debug')]
    await openMarketing(opts(f.impl, navigate))
    expect(navigate).toHaveBeenCalledTimes(1)
    const url = navigate.mock.calls[0][0] as string
    expect(url).toBe(`https://marketing.unifiedtree.com/auth/unifiedtree/callback#ticket=${TICKET}`)
    expect(url.split('#')[0]).not.toContain(TICKET)
    // The ticket is never written anywhere: no log line carries it, and no request URL does
    for (const spy of logs) expect(spy).not.toHaveBeenCalled()
    for (const c of f.calls) expect(c.url).not.toContain(TICKET)
  })
  it('an expired account token on the handoff: one fresh refresh, then the ticket', async () => {
    const f = fakeFetch(login(ME, 'old'), [401, null], login(ME, 'new'), [200, { ticket: TICKET }])
    const navigate = vi.fn()
    await openMarketing(opts(f.impl, navigate))
    expect(header(f.calls[3], 'Authorization')).toBe('Bearer new')
    expect(navigate).toHaveBeenCalledTimes(1)
  })
  it('no account sign-in any more: SIGNED_OUT, nothing opens', async () => {
    const navigate = vi.fn()
    await expect(openMarketing(opts(fakeFetch([401, null]).impl, navigate))).rejects.toMatchObject({ code: 'SIGNED_OUT' })
    expect(navigate).not.toHaveBeenCalled()
  })
  for (const [code, status] of [['MARKETING_NOT_ENTITLED', 403], ['NOT_A_MEMBER', 403], ['ACCOUNT_INACTIVE', 403], ['ACCOUNT_LOCKED', 403]] as const) {
    it(`refused (${code}): that code, nothing opens`, async () => {
      const navigate = vi.fn()
      const f = fakeFetch(login(), [status, { message: `${code}: refused` }])
      await expect(openMarketing(opts(f.impl, navigate))).rejects.toMatchObject({ code })
      expect(navigate).not.toHaveBeenCalled()
    })
  }
  it('Marketing’s sign-in service down: UNAVAILABLE, nothing opens', async () => {
    const navigate = vi.fn()
    await expect(openMarketing(opts(fakeFetch(login(), [503, null]).impl, navigate))).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    expect(navigate).not.toHaveBeenCalled()
  })
})
