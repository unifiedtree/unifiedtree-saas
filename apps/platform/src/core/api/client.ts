import { getAccessToken, useAuthStore } from '@unifiedtree/sdk'

export const API_BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ||
  '/api'

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
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init.headers || {}),
    },
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message = data?.message || data?.error || data?.detail || `Request failed with status ${response.status}`
    throw new Error(message)
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
