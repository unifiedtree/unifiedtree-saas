import { apiJson } from '@/core/api/client'

export interface AcceptInviteResponse {
  accessToken: string
  refreshToken?: string
  expiresAt?: string
  userId: string
  employeeId?: string
  tenantId: string
  email: string
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

export async function forgotPassword(email: string, tenantId?: string): Promise<void> {
  await apiJson('/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email, tenantId }),
  })
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiJson('/v1/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  })
}
