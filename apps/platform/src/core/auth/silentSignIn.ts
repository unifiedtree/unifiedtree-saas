/**
 * Signing in on the business's own address with the website's sign-in (owner, 11 Oct 2026: "When signed in from
 * the website it should go directly to the Apps page — the business sign-in page should not be there").
 *
 * Signing in on unifiedtree.com signs in an ACCOUNT: the ut_acct_rt cookie (HttpOnly, Domain=.unifiedtree.com,
 * 30 days). The website's own hand-over (WorkspacesPage) exchanges it for this business's session, which sets the
 * business's ut_rt_<tenant> cookie, and the business signs in from that cookie on load. When the person opens the
 * business's address themselves instead (a bookmark, a link, a new tab later, or after the 7-day business cookie has
 * run out), this browser has no business session, and the sign-in page makes the same exchange once, before it
 * shows the form:
 *   1. POST /v1/accounts/auth/refresh, credentialed (the cookie is the credential): an account token, kept in memory
 *      for this one exchange only;
 *   2. POST /v1/accounts/workspaces/session {tenantId, silent: true} with it. The server decides: membership, the
 *      business, the login (inactive, locked, a platform operator) and, as nobody typed anything, two-factor. On yes
 *      it sets the business cookie and answers with a business session, which the page starts exactly as it starts
 *      a password sign-in (LoginPage's finishLogin).
 * Anything else (no account sign-in, a refusal, no answer within 4 s) shows the form, without a word: the form
 * already says what there is to say.
 *
 * "Sign out" sticks: it marks this business in this browser (localStorage), and nothing is tried while the mark is
 * there. Signing in again (the form, Google, the website's Enter or its hand-over) clears it (AuthProvider).
 * No token ever goes in the address or in storage.
 */
import { resolveTenantSlug } from '@unifiedtree/sdk'
import type { AuthStatus } from '@unifiedtree/sdk'
import { API_BASE_URL, currentSubdomain, type AuthResponse, type WorkspaceStatus } from '@/core/api/client'
import type { WorkspaceHostState } from '@/core/tenant/workspaceHost'

/** Longer than this and the form shows instead. */
export const SILENT_SIGN_IN_TIMEOUT_MS = 4_000

// ── "Sign out" sticks ───────────────────────────────────────────────────────

/** Per business address (localStorage is per address already; the name says which business anyway). */
const SIGNED_OUT_KEY = 'ut.signed-out:'

/** "Sign out" on this business in this browser: nothing signs in here without the person from now on. */
export function markSignedOut(subdomain: string = currentSubdomain()): void {
  if (!subdomain) return
  try {
    window.localStorage.setItem(SIGNED_OUT_KEY + subdomain, '1')
  } catch {
    /* storage refused: the sign-out still happens, and signedOutHere() reads unreadable storage as signed out */
  }
}

/** The person signed in again: the mark is spent. */
export function clearSignedOut(subdomain: string = currentSubdomain()): void {
  if (!subdomain) return
  try {
    window.localStorage.removeItem(SIGNED_OUT_KEY + subdomain)
  } catch {
    /* ignore */
  }
}

/** Whether a sign-out on this business is the last word in this browser. Storage that can't be read counts as yes. */
export function signedOutHere(subdomain: string = currentSubdomain()): boolean {
  try {
    return window.localStorage.getItem(SIGNED_OUT_KEY + subdomain) !== null
  } catch {
    return true
  }
}

/**
 * Whether a change of the session's status is a sign-in beginning (the mark is then spent): authenticated after
 * anything but authenticated. `settled` is the last status that was not 'loading', so a signed-in page asking /me
 * again (authenticated → loading → authenticated) is not one.
 */
export function isSignInStart(settled: AuthStatus, status: AuthStatus): boolean {
  return status === 'authenticated' && settled !== 'authenticated'
}

// ── Whether to try ──────────────────────────────────────────────────────────

/** This page load's one try (signInFromWebsiteOnce); later callers share it. */
let attempt: Promise<WebsiteSignIn | null> | null = null

/** What the sign-in page knows at its first render: everything here is synchronous, so the form never flashes. */
export interface SilentSignInContext {
  /** This address's business label ('' off a business address). */
  subdomain: string
  /** The address lookup's answer (WorkspaceHostGate), null before it came back. */
  host: WorkspaceHostState | null
  /** The sign-in page's query string. */
  search: URLSearchParams
}

/**
 * Try only on an open business's own address (never UnifiedTree's own: admin., www., the platform's address, and
 * never where the lookup did not answer), only once a page load, never after a sign-out here, and never over a
 * refusal the page is showing (?error=, e.g. a Google sign-in that was turned down).
 */
export function maySignInSilently({ subdomain, host, search }: SilentSignInContext): boolean {
  if (!subdomain || resolveTenantSlug() !== subdomain) return false
  if (host?.kind !== 'open') return false
  if (search.has('error')) return false
  if (attempt !== null) return false
  return !signedOutHere(subdomain)
}

// ── The exchange ────────────────────────────────────────────────────────────

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** A business session from the website's sign-in, with what a password sign-in also has: the business's status. */
export interface WebsiteSignIn {
  auth: AuthResponse
  status: WorkspaceStatus
}

export interface WebsiteSignInOptions {
  /** This business's public status: the sign-in page's own GET /v1/public/workspace-status. */
  workspaceStatus: () => Promise<WorkspaceStatus>
  fetchImpl?: FetchLike
  timeoutMs?: number
  /** Web Locks (navigator.locks) when the browser has them; null: none. */
  locks?: Pick<LockManager, 'request'> | null
}

const LOCK_NAME = 'ut-sign-in-from-website'

function browserLocks(): Pick<LockManager, 'request'> | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null
  } catch {
    return null
  }
}

const browserFetch: FetchLike = (input, init) => fetch(input, init)

/** The account token behind the ut_acct_rt cookie, or null (no account sign-in, or no answer). */
async function accountToken(fetchImpl: FetchLike, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchImpl(`${API_BASE_URL}/v1/accounts/auth/refresh`, {
      method: 'POST',
      // The cookie only travels on a credentialed request, and the answer rotates it.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      cache: 'no-store',
      signal,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { accessToken?: unknown } | null
    return typeof data?.accessToken === 'string' && data.accessToken ? data.accessToken : null
  } catch {
    return null
  }
}

/** This business's session for the account, or null (the server refused, or did not answer). */
async function businessSession(fetchImpl: FetchLike, token: string, tenantId: string, signal: AbortSignal): Promise<AuthResponse | null> {
  try {
    const res = await fetchImpl(`${API_BASE_URL}/v1/accounts/workspaces/session`, {
      method: 'POST',
      // Credentialed: the answer sets this business's sign-in cookie, and a browser keeps a cookie from the
      // API's address only from a credentialed request.
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenantId, silent: true }),
      cache: 'no-store',
      signal,
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as { auth?: Partial<AuthResponse> | null } | null
    const auth = data?.auth
    if (!auth || typeof auth.accessToken !== 'string' || !auth.accessToken) return null
    if (typeof auth.email !== 'string' || !Array.isArray(auth.roles)) return null
    return auth as AuthResponse
  } catch {
    return null
  }
}

const sameId = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/**
 * The exchange described at the top of this file. Never throws: null means "show the form".
 *
 * The account refresh rotates the ut_acct_rt cookie, and the server refuses (and clears) a cookie that has just
 * been rotated. Two tabs of this business opening together (a browser restoring its tabs) would present the same
 * cookie, and the slower one would sign the person out of the website as well, so tabs take turns (a Web Lock).
 */
export async function signInFromWebsite({
  workspaceStatus, fetchImpl = browserFetch, timeoutMs = SILENT_SIGN_IN_TIMEOUT_MS, locks = browserLocks(),
}: WebsiteSignInOptions): Promise<WebsiteSignIn | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => { controller.abort(); resolve(null) }, timeoutMs)
  })
  // The page's own status request can't be cancelled: stop waiting for it at the deadline all the same.
  const untilDeadline = <T,>(p: Promise<T>) => new Promise<T | null>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null), { once: true })
    p.then(resolve, () => resolve(null))
  })
  const exchange = async (): Promise<WebsiteSignIn | null> => {
    const token = await accountToken(fetchImpl, controller.signal)
    if (!token || controller.signal.aborted) return null
    const status = await untilDeadline(workspaceStatus())
    if (!status || status.status !== 'ACTIVE' || !status.tenantId || controller.signal.aborted) return null
    const auth = await businessSession(fetchImpl, token, status.tenantId, controller.signal)
    if (!auth || !sameId(auth.tenantId, status.tenantId) || controller.signal.aborted) return null
    return { auth, status }
  }
  const inTurn = async (): Promise<WebsiteSignIn | null> => locks
    ? await locks.request(LOCK_NAME, { signal: controller.signal }, exchange)
    : exchange()
  try {
    return await Promise.race([inTurn(), deadline])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** This page load's one try; later callers (StrictMode's second effect, the page shown again) share it. */
export function signInFromWebsiteOnce(options: WebsiteSignInOptions): Promise<WebsiteSignIn | null> {
  attempt ??= signInFromWebsite(options)
  return attempt
}
