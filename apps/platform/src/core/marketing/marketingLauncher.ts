/**
 * Opening Marketing (Marketing Automation, a separate app) from this app, signed in as the same person.
 *
 * Hidden unless the build sets VITE_MARKETING_APP_URL (Marketing's https origin). Unset — as in production today —
 * nothing here runs and no call is made.
 *
 * How it works, with the Java SSO API that already exists (MarketingSsoController):
 *  1. The Marketing endpoints take an ACCOUNT token (role ACCOUNT_USER), not this app's workspace token. The only way
 *     this page can get one is the account sign-in the website and Google sign-in leave behind: the ut_acct_rt cookie
 *     (HttpOnly, Domain=.unifiedtree.com), sent to POST /v1/accounts/auth/refresh. Someone who signed in here with
 *     the workspace password only has no such cookie, so the Marketing tile stays hidden for them.
 *  2. GET /v1/sso/marketing/companies — this workspace's companies the person may enter, each marked with Marketing.
 *  3. POST /v1/sso/marketing/handoff {tenantId, companyId} — a single-use ticket, valid 60 seconds.
 *  4. The browser goes to {Marketing}/auth/unifiedtree/callback#ticket=… (the ticket in the fragment only, never a
 *     query string, so it never reaches a server log or a Referer). Marketing redeems it server-to-server.
 *
 * The account token and the ticket are kept in memory only: never stored, logged or put in a query string.
 */
import { API_BASE_URL } from '@/core/api/client'

/** Marketing's page that takes a ticket (profitera/frontend: src/app/auth/unifiedtree/callback). */
export const MARKETING_CALLBACK_PATH = '/auth/unifiedtree/callback'

/** What Marketing's callback accepts as a ticket (UnifiedTreeCallback.tsx: TICKET_RE). */
const TICKET_RE = /^[A-Za-z0-9._~-]{16,512}$/

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/**
 * Marketing's origin from the build's VITE_MARKETING_APP_URL, or null (launcher off).
 * Only a bare https origin is accepted (no path, query, fragment or credentials); plain http only for localhost,
 * and only outside a production build. Anything else switches the launcher off rather than sending a ticket to it.
 */
export function parseMarketingAppUrl(raw: unknown, allowLocalHttp: boolean): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  let url: URL
  try { url = new URL(raw.trim()) } catch { return null }
  if (url.username || url.password || url.search || url.hash) return null
  if (url.pathname !== '/' && url.pathname !== '') return null
  const host = url.hostname.toLowerCase()
  const local = LOCAL_HOSTS.has(host) || host.endsWith('.localhost')
  if (url.protocol === 'https:') return url.origin
  if (url.protocol === 'http:' && allowLocalHttp && local) return url.origin
  return null
}

/** This build's Marketing origin (null = the launcher is off). */
export const MARKETING_APP_ORIGIN: string | null = parseMarketingAppUrl(
  import.meta.env.VITE_MARKETING_APP_URL, !import.meta.env.PROD,
)

/** Where the browser goes with a ticket: the fragment carries it, nothing else does. */
export function marketingCallbackUrl(origin: string, ticket: string): string {
  if (!TICKET_RE.test(ticket)) throw new MarketingLaunchError('BAD_TICKET')
  return `${origin}${MARKETING_CALLBACK_PATH}#ticket=${encodeURIComponent(ticket)}`
}

// ── The API's shapes (MarketingAccessService) ───────────────────────────────

export interface MarketingCompanyChoice {
  companyId: string
  name: string
  logoUrl?: string | null
  home?: boolean
  access?: string
  roles?: string[]
  marketingEntitled: boolean
}

export interface MarketingWorkspaceChoice {
  tenantId: string
  subdomain?: string
  displayName?: string
  workspaceRole?: string
  companies: MarketingCompanyChoice[]
}

/** A company the person can open Marketing for. */
export interface MarketingCompany {
  companyId: string
  name: string
  current: boolean
}

/** The account sign-in behind the Marketing calls (memory only). */
export interface AccountSession {
  token: string
  email: string
  expiresAt: number
}

// ── Errors ─────────────────────────────────────────────────────────────────

/** Refusals from the API ("CODE: message" in a 403's message) and this side's own failures. */
export type MarketingErrorCode =
  | 'MARKETING_NOT_ENTITLED' | 'NOT_A_MEMBER' | 'ACCOUNT_INACTIVE' | 'ACCOUNT_LOCKED' | 'COMPANY_ACCESS_DENIED'
  | 'COMPANY_INACTIVE' | 'COMPANY_NOT_FOUND' | 'WORKSPACE_INACTIVE'
  | 'SIGNED_OUT' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'BAD_TICKET' | 'UNKNOWN'

const KNOWN_REFUSALS: ReadonlySet<string> = new Set([
  'MARKETING_NOT_ENTITLED', 'NOT_A_MEMBER', 'ACCOUNT_INACTIVE', 'ACCOUNT_LOCKED', 'COMPANY_ACCESS_DENIED',
  'COMPANY_INACTIVE', 'COMPANY_NOT_FOUND', 'WORKSPACE_INACTIVE',
])

export class MarketingLaunchError extends Error {
  readonly code: MarketingErrorCode
  constructor(code: MarketingErrorCode) {
    super(code)
    this.name = 'MarketingLaunchError'
    this.code = code
  }
}

const MESSAGES: Record<MarketingErrorCode, string> = {
  MARKETING_NOT_ENTITLED: 'This company doesn’t have Marketing. Ask your administrator to add it.',
  NOT_A_MEMBER: 'You’re no longer a member of this business. Ask your administrator.',
  ACCOUNT_INACTIVE: 'Your login is switched off. Ask your administrator.',
  ACCOUNT_LOCKED: 'Your login is locked for a while after too many attempts. Try again later.',
  COMPANY_ACCESS_DENIED: 'You don’t have access to this company.',
  COMPANY_INACTIVE: 'This company has been archived.',
  COMPANY_NOT_FOUND: 'This company isn’t part of this business.',
  WORKSPACE_INACTIVE: 'This business isn’t active.',
  SIGNED_OUT: 'Your UnifiedTree sign-in has ended. Sign in again to open Marketing.',
  RATE_LIMITED: 'Too many tries. Wait a minute and try again.',
  UNAVAILABLE: 'Marketing can’t be opened right now. Try again in a few minutes.',
  BAD_TICKET: 'Marketing couldn’t be opened. Try again.',
  UNKNOWN: 'Marketing couldn’t be opened. Try again.',
}

/** The plain message for a failure. */
export function marketingErrorMessage(code: MarketingErrorCode): string {
  return MESSAGES[code] ?? MESSAGES.UNKNOWN
}

/** The refusal behind a failed response: the "CODE:" its message starts with, else one from the status. */
export function refusalCode(status: number, body: unknown): MarketingErrorCode {
  const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
    ? (body as { message: string }).message : ''
  const prefixed = /^([A-Z][A-Z0-9_]{2,63}):/.exec(message)?.[1]
  if (prefixed && KNOWN_REFUSALS.has(prefixed)) return prefixed as MarketingErrorCode
  if (status === 401) return 'SIGNED_OUT'
  if (status === 429) return 'RATE_LIMITED'
  if (status === 0 || status >= 500) return 'UNAVAILABLE'
  if (status === 403) return 'COMPANY_ACCESS_DENIED'
  return 'UNKNOWN'
}

// ── Calls ──────────────────────────────────────────────────────────────────

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const TIMEOUT_MS = 20_000

async function call(fetchImpl: FetchLike, path: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null
  let response: Response
  try {
    response = await fetchImpl(`${API_BASE_URL}${path}`, { cache: 'no-store', ...init, signal: controller?.signal })
  } catch {
    return { status: 0, body: null }
  } finally {
    if (timer) clearTimeout(timer)
  }
  const text = await response.text().catch(() => '')
  let body: unknown
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  return { status: response.status, body }
}

/**
 * The account sign-in behind this browser's ut_acct_rt cookie, or null when there is none (401/403) or it is another
 * person's (its email is not the one signed in here). The refresh rotates the cookie (the response sets the new one),
 * so it is called once per page load at most (see useMarketingLauncher). Throws UNAVAILABLE when the API can't answer.
 */
export async function refreshAccountSession(fetchImpl: FetchLike, expectedEmail: string): Promise<AccountSession | null> {
  const { status, body } = await call(fetchImpl, '/v1/accounts/auth/refresh', {
    method: 'POST',
    // The cookie is the credential: it only travels on a credentialed request
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (status === 401 || status === 403) return null
  if (status < 200 || status >= 300) throw new MarketingLaunchError(refusalCode(status, body))
  const data = (body ?? {}) as { accessToken?: unknown; accessTokenExpiresAt?: unknown; account?: { email?: unknown } | null }
  const token = typeof data.accessToken === 'string' ? data.accessToken : ''
  const email = typeof data.account?.email === 'string' ? data.account.email : ''
  if (!token || !email) return null
  if (!sameEmail(email, expectedEmail)) return null
  const exp = typeof data.accessTokenExpiresAt === 'string' ? Date.parse(data.accessTokenExpiresAt) : NaN
  return { token, email, expiresAt: Number.isFinite(exp) ? exp : Date.now() + 10 * 60_000 }
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = (a ?? '').trim().toLowerCase()
  return !!x && x === (b ?? '').trim().toLowerCase()
}

const bearer = (token: string) => ({ Accept: 'application/json', Authorization: `Bearer ${token}` })

/** GET /v1/sso/marketing/companies. null when the account token was refused (401). */
export async function fetchMarketingChoices(fetchImpl: FetchLike, token: string): Promise<MarketingWorkspaceChoice[] | null> {
  // The bearer calls go without cookies: only the refresh above needs one
  const { status, body } = await call(fetchImpl, '/v1/sso/marketing/companies', { method: 'GET', credentials: 'omit', headers: bearer(token) })
  if (status === 401) return null
  if (status < 200 || status >= 300) throw new MarketingLaunchError(refusalCode(status, body))
  return Array.isArray(body) ? (body as MarketingWorkspaceChoice[]) : []
}

/** POST /v1/sso/marketing/handoff: the ticket, or null when the account token was refused (401). */
export async function createMarketingTicket(fetchImpl: FetchLike, token: string, tenantId: string, companyId: string): Promise<string | null> {
  const { status, body } = await call(fetchImpl, '/v1/sso/marketing/handoff', {
    method: 'POST',
    credentials: 'omit',
    headers: { ...bearer(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, companyId }),
  })
  if (status === 401) return null
  if (status < 200 || status >= 300) throw new MarketingLaunchError(refusalCode(status, body))
  const ticket = (body as { ticket?: unknown } | null)?.ticket
  if (typeof ticket !== 'string' || !TICKET_RE.test(ticket)) throw new MarketingLaunchError('BAD_TICKET')
  return ticket
}

/**
 * The companies of THIS workspace that have Marketing, the current one (the company selector's) first.
 * Other workspaces the account belongs to are left out: this page is one business.
 */
export function marketingCompanies(choices: readonly MarketingWorkspaceChoice[], tenantId: string, currentCompanyId: string): MarketingCompany[] {
  const ws = choices.find((w) => w && w.tenantId === tenantId)
  const list = (ws?.companies ?? [])
    .filter((c) => c && c.marketingEntitled === true && typeof c.companyId === 'string' && c.companyId)
    .map((c) => ({ companyId: c.companyId, name: c.name || 'Company', current: c.companyId === currentCompanyId }))
  return list.sort((a, b) => Number(b.current) - Number(a.current))
}

/** What a click on the tile does: open the one company straight away, or ask which. */
export function launchPlan(companies: readonly MarketingCompany[]): { kind: 'none' } | { kind: 'direct'; companyId: string } | { kind: 'choose' } {
  if (companies.length === 0) return { kind: 'none' }
  if (companies.length === 1) return { kind: 'direct', companyId: companies[0].companyId }
  return { kind: 'choose' }
}

/** Whether the launcher may make any call at all: the build names Marketing and someone is signed in here. */
export function launcherEnabled(origin: string | null, email: string | null | undefined, tenantId: string | null | undefined): boolean {
  return !!origin && !!(email ?? '').trim() && !!tenantId
}

// ── The account session, once per page load ───────────────────────────────

export interface AccountSessionStore {
  /** The held session for this email, else one refresh (shared by concurrent callers). `fresh` forces a refresh. */
  get(email: string, fresh?: boolean): Promise<AccountSession | null>
}

/**
 * Holds the account token in memory for this page. Each refresh rotates the ut_acct_rt cookie, so the store refreshes
 * as rarely as it can: one at a time, reused until a minute before it expires, and a "no account sign-in" answer is
 * remembered (only a forced refresh asks again).
 */
export function createAccountSessionStore(fetchImpl: FetchLike, now: () => number = () => Date.now()): AccountSessionStore {
  let held: AccountSession | null = null
  let noneFor: string | null = null
  let inflight: { email: string; promise: Promise<AccountSession | null> } | null = null
  return {
    get(email, fresh = false) {
      if (!fresh) {
        if (held && sameEmail(held.email, email) && held.expiresAt - now() > 60_000) return Promise.resolve(held)
        if (noneFor !== null && sameEmail(noneFor, email)) return Promise.resolve(null)
      }
      if (inflight && sameEmail(inflight.email, email)) return inflight.promise
      held = null
      const promise = refreshAccountSession(fetchImpl, email).then((s) => {
        held = s
        noneFor = s ? null : email
        return s
      }).finally(() => { if (inflight?.promise === promise) inflight = null })
      inflight = { email, promise }
      return promise
    },
  }
}

/** The workspaces and companies for the tile ([] when there is no account sign-in for this person). */
export async function loadMarketingChoices(sessions: AccountSessionStore, fetchImpl: FetchLike, email: string): Promise<MarketingWorkspaceChoice[]> {
  const first = await sessions.get(email)
  if (!first) return []
  const choices = await fetchMarketingChoices(fetchImpl, first.token)
  if (choices !== null) return choices
  // The held token was refused (expired): once more with a fresh one
  const again = await sessions.get(email, true)
  if (!again) return []
  return (await fetchMarketingChoices(fetchImpl, again.token)) ?? []
}

export interface OpenMarketingOptions {
  sessions: AccountSessionStore
  fetchImpl: FetchLike
  origin: string
  email: string
  tenantId: string
  companyId: string
  /** Same-tab navigation (window.location.assign). */
  navigate: (url: string) => void
}

/**
 * Get a ticket for the company and go to Marketing with it. The server checks membership, company access and
 * entitlement now; a refusal throws its MarketingLaunchError and nothing navigates.
 */
export async function openMarketing({ sessions, fetchImpl, origin, email, tenantId, companyId, navigate }: OpenMarketingOptions): Promise<void> {
  const attempt = async (fresh: boolean) => {
    const s = await sessions.get(email, fresh)
    if (!s) throw new MarketingLaunchError('SIGNED_OUT')
    return createMarketingTicket(fetchImpl, s.token, tenantId, companyId)
  }
  const ticket = (await attempt(false)) ?? (await attempt(true))
  if (!ticket) throw new MarketingLaunchError('SIGNED_OUT')
  navigate(marketingCallbackUrl(origin, ticket))
}

/** Failures worth a "Try again" (a refusal is not: trying again gets the same answer). */
export function isRetryable(code: MarketingErrorCode): boolean {
  return code === 'UNAVAILABLE' || code === 'RATE_LIMITED' || code === 'BAD_TICKET' || code === 'UNKNOWN'
}
