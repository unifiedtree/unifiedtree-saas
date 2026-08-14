import { getAccessToken, useAuthStore } from '@unifiedtree/sdk'

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  })

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init.headers || {}),
    },
  })

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`)
  }

  return response.blob()
}
