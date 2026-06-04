import { TENANT_ID, TENANT_SUBDOMAIN } from '../auth/users'

const BACKEND = process.env.PLAYWRIGHT_BACKEND_URL ?? 'http://localhost:8080'

/** Log in via the backend and return the access token (used by globalSetup + ad-hoc helpers). */
export async function loginViaApi(email: string, password: string): Promise<string> {
  const res = await fetch(`${BACKEND}/api/v1/canonical-auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, email, password }),
  })
  if (!res.ok) throw new Error(`login ${email} failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const token = data.accessToken ?? data.token
  if (!token) throw new Error(`login ${email} returned no token`)
  return token
}

/** Authenticated backend request with the tenant header pre-set. */
export async function api(token: string, apiPath: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${token}`)
  headers.set('X-Tenant-Subdomain', TENANT_SUBDOMAIN)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${BACKEND}${apiPath}`, { ...init, headers })
}
