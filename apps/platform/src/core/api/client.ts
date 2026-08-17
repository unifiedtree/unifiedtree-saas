import { getAccessToken, setAccessToken, useAuthStore } from '@unifiedtree/sdk'

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  '/api'

/**
 * Typed error thrown by {@link apiJson} for non-2xx responses. Carries the HTTP
 * status and the parsed JSON body so callers can branch on status code (e.g.
 * 401 → sign out, 409 → show merge banner) or surface field-level backend
 * errors without re-parsing the response. `.message` stays populated for
 * compat with any `catch (e) { toast((e as Error).message) }` sites.
 */
export class HttpError extends Error {
  readonly status: number
  readonly payload?: unknown
  constructor(message: string, status: number, payload?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.payload = payload
  }
}

export type AuthResponse = {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt?: string
  /**
   * Canonical-auth returns `userId`. Legacy `/v1/auth/login` returned
   * `employeeId`. Treat them as the same logical user identifier.
   */
  userId?: string
  employeeId?: string
  tenantId: string
  email: string
  /**
   * The signed-in person's real name, resolved server-side from
   * hrms.employees (AuthService reads first_name/last_name via
   * credentials.employee_id). These were missing from this type, so the login
   * page could not pass them on and every session fell back to the email
   * local-part — "Chakri Chikkala" displayed as "Shurya.kumar063".
   */
  firstName?: string
  lastName?: string
  roles: string[]
  permissions?: string[]
}

export type WorkspaceStatus = {
  tenantId: string
  tenantName: string
  subdomain: string
  status: string
  activeModules: string[]
  requestedModules: string[]
  /** Custom logo the workspace admin uploaded via /settings/branding.
   *  Null / missing = fall back to the UnifiedTree default. */
  logoUrl?: string | null
}

export function currentSubdomain() {
  const host = window.location.hostname.toLowerCase()
  for (const suffix of ['.localhost', '.unifiedtree.com']) {
    if (host.endsWith(suffix)) {
      const subdomain = host.slice(0, -suffix.length)
      return subdomain.includes('.') ? '' : subdomain
    }
  }
  return ''
}

/**
 * Auth + tenant headers shared by every request helper.
 * Token is held in-memory by the SDK — never read from localStorage. In dev
 * mode (canonical profile) Spring Security doesn't parse the JWT, so
 * TenantContext is populated via the X-Tenant-ID header instead.
 */
/**
 * Single-flight refresh coordinator.
 *
 * Every helper below (apiJson, apiText, apiBlob) funnels 401s through
 * {@link refreshOnce}, which shares one in-flight promise across all callers.
 * Before this, four concurrent requests hitting a rotated access token each
 * fired their own POST /canonical-auth/refresh — only the first succeeded
 * (rotation invalidates the previous refresh cookie), the other three saw a
 * refresh-401 and threw, and the AuthProvider flipped the user to
 * unauthenticated one query at a time. Coalescing them here means the four
 * calls await the same refresh, then all four retry with the same new token.
 *
 * Refresh failures are terminal: we clear the access token so the SDK's next
 * hydrate reflects reality, and we resolve the shared promise as `false` so
 * every waiter throws its original 401 instead of retrying into a loop.
 */
let inFlightRefresh: Promise<boolean> | null = null

async function refreshOnce(): Promise<boolean> {
  if (inFlightRefresh) return inFlightRefresh
  inFlightRefresh = (async () => {
    try {
      const resp = await fetch(`${API_BASE_URL}/v1/canonical-auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!resp.ok) return false
      const data = await resp.json().catch(() => null) as { accessToken?: string } | null
      const token = data?.accessToken
      if (!token) return false
      setAccessToken(token)
      return true
    } catch {
      return false
    } finally {
      // Release the lock in a microtask so waiters that are still awaiting
      // this promise resolve first — otherwise a very fast follow-up 401
      // could start a second refresh before the first waiter retried.
      queueMicrotask(() => { inFlightRefresh = null })
    }
  })()
  return inFlightRefresh
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  const tenantSubdomain = currentSubdomain()
  const tenantId = useAuthStore.getState().tenant?.id
  return {
    ...(tenantSubdomain ? { 'X-Tenant-Subdomain': tenantSubdomain } : {}),
    ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return jsonRequest<T>(path, init, /* alreadyRetried */ false)
}

async function jsonRequest<T>(path: string, init: RequestInit, alreadyRetried: boolean): Promise<T> {
  // Hard cap every request at 60s. Without this, a backend stall (Kafka
  // metadata fetch, slow upstream, accidental sync I/O) leaves the UI on
  // "Submitting…" forever with no way out except closing the tab. 60s
  // absorbs a Railway cold start while still surfacing a clear error in a
  // reasonable time.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      // Required for the httpOnly refresh cookie to work AT ALL. On a
      // cross-origin request (app on <workspace>.unifiedtree.com, API on
      // api.unifiedtree.com) the browser DISCARDS the response's Set-Cookie
      // unless the request itself was credentialed — and refuses to send the
      // cookie back for the same reason. The backend was setting the cookie
      // correctly and curl stored it, while browsers silently dropped it, so
      // every reload still logged the user out.
      //
      // Safe now that CORS no longer allows wildcard public-hosting origins:
      // allowed origins are unifiedtree.com and its subdomains only, so no
      // attacker-controlled page can make a credentialed call here.
      credentials: 'include',
      signal: init.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(init.headers || {}),
      },
    })
  } catch (err) {
    clearTimeout(timer)
    if ((err as Error).name === 'AbortError') {
      // Keep the AbortError as `cause` — the friendly copy is for the user, but
      // the original is what makes a timeout debuggable in error reporting.
      throw new Error('The server took too long to respond. Please try again.', { cause: err })
    }
    throw err
  }
  clearTimeout(timer)

  // Single-flight 401 recovery: if the access token expired between the
  // check and the request, or four concurrent requests raced through with a
  // stale token, we refresh ONCE and retry. Refresh endpoint itself is
  // never retried (path check) and we never retry twice for the same call.
  if (response.status === 401 && !alreadyRetried && !path.includes('/canonical-auth/refresh')) {
    const ok = await refreshOnce()
    if (ok) return jsonRequest<T>(path, init, true)
  }

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail || `Request failed with status ${response.status}`
    throw new HttpError(message, response.status, data)
  }

  return data as T
}

/**
 * Like {@link apiJson} but returns the raw response body as text — for endpoints
 * that return non-JSON (e.g. the letter preview, which returns rendered HTML).
 */
export async function apiText(path: string, init: RequestInit = {}): Promise<string> {
  return textRequest(path, init, false)
}

async function textRequest(path: string, init: RequestInit, alreadyRetried: boolean): Promise<string> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  })

  if (response.status === 401 && !alreadyRetried && !path.includes('/canonical-auth/refresh')) {
    const ok = await refreshOnce()
    if (ok) return textRequest(path, init, true)
  }

  const text = await response.text()

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`
    if (text) {
      try {
        const data = JSON.parse(text)
        message = data?.message || data?.error || data?.detail || message
      } catch {
        /* non-JSON error body — keep the status message */
      }
    }
    throw new Error(message)
  }

  return text
}

/**
 * Like {@link apiJson} but returns a Blob — for binary downloads (e.g. letter PDFs).
 * Carries the same auth + tenant headers; no JSON Content-Type is forced.
 */
export async function apiBlob(path: string, init: RequestInit = {}): Promise<Blob> {
  return blobRequest(path, init, false)
}

async function blobRequest(path: string, init: RequestInit, alreadyRetried: boolean): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...authHeaders(),
      ...(init.headers || {}),
    },
  })

  if (response.status === 401 && !alreadyRetried && !path.includes('/canonical-auth/refresh')) {
    const ok = await refreshOnce()
    if (ok) return blobRequest(path, init, true)
  }

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.blob()
}
