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
  for (const suffix of ['.localhost', '.ionora.app', '.unifiedtree.com']) {
    if (host.endsWith(suffix)) {
      const subdomain = host.slice(0, -suffix.length)
      return subdomain.includes('.') ? '' : subdomain
    }
  }
  return ''
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Token is held in-memory by the SDK — never read from localStorage
  const token = getAccessToken()
  const tenantSubdomain = currentSubdomain()
  // In dev mode (canonical profile) Spring Security doesn't parse the JWT, so
  // TenantContext is populated via the X-Tenant-ID header instead.
  const tenantId = useAuthStore.getState().tenant?.id
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(tenantSubdomain ? { 'X-Tenant-Subdomain': tenantSubdomain } : {}),
      ...(tenantId ? { 'X-Tenant-ID': tenantId } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
