import { apiJson } from '@/core/api/client'

export interface AcceptInviteResponse {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  userId: string
  employeeId?: string
  tenantId: string
  email: string
  /** Resolved server-side from hrms.employees — pass through to the auth
   *  store or the session falls back to showing the email local-part. */
  firstName?: string
  lastName?: string
  roles: string[]
  permissions: string[]
  tenantSlug: string
  tenantName: string
  activeModules: string[]
}

export async function sendInvite(employeeId: string): Promise<{ sent: boolean; expiresAt: string }> {
  return apiJson(`/v1/employees/${employeeId}/invite`, { method: 'POST', body: '{}' })
}

export async function resendInvite(employeeId: string): Promise<{ sent: boolean; expiresAt: string }> {
  return apiJson(`/v1/employees/${employeeId}/invite/resend`, { method: 'POST', body: '{}' })
}

export async function acceptInvite(token: string, password: string): Promise<AcceptInviteResponse> {
  return apiJson('/v1/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}

/**
 * Request a password-reset email. Tenant is NOT sent in the body: apiJson's
 * authHeaders() already sends X-Tenant-Subdomain from the current host, and
 * the backend falls back to resolving the tenant from the email when there
 * is no header (mobile / root domain).
 *
 * 2026-09-09: this used to take a second `tenantId` arg and the only caller
 * passed the SUBDOMAIN STRING into it. The backend field was typed UUID, so
 * Jackson 400'd the request before the controller ran — no token, no email,
 * and the page still showed "sent". Removing the parameter makes the mistake
 * impossible at the call site.
 */
export async function forgotPassword(email: string): Promise<void> {
  await apiJson('/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiJson('/v1/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}
