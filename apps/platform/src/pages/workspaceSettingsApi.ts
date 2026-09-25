// API hooks for Workspace Settings -> Profile, Security and Danger zone
// (backend: /v1/me/security, /v1/workspace/profile, /v1/workspace/security,
// /v1/workspace/exports, /v1/workspace/lifecycle-requests).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiBlob, apiJson } from '@/core/api/client'

export type MfaPolicy = 'OFF' | 'ADMINS' | 'EVERYONE'

export interface MfaStatus {
  enabled: boolean
  enabledAt: string | null
  recoveryCodesLeft: number
  workspacePolicy: MfaPolicy
  requiredForYou: boolean
}

export interface MfaSetupInfo { secret: string; otpauthUrl: string; qrSvg: string; issuer: string; account: string }

export interface SessionRow {
  id: string
  device: string
  kind: 'web' | 'app' | 'unknown'
  ipAddress: string | null
  signedInAt: string | null
  lastActiveAt: string | null
  expiresAt: string | null
  current: boolean
}

export interface SecuritySummary { mfaPolicy: MfaPolicy; people: number; withTwoFactor: number; requiredByRule: number; requiredButNotSetUp: number }

export interface SecurityMember {
  userId: string
  email: string
  name: string
  roles: string[]
  mfaEnabled: boolean
  mfaEnabledAt: string | null
  requiredByRule: boolean
  lastSignInAt: string | null
}

export interface WorkspaceProfile {
  tenantId: string
  subdomain: string
  planType: string
  displayName: string
  contactEmail: string | null
  contactPhone: string | null
  addressLine1: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  postalCode: string | null
  gstin: string | null
  pan: string | null
  canEdit: boolean
}

export type WorkspaceProfileInput = Omit<WorkspaceProfile, 'tenantId' | 'subdomain' | 'planType' | 'canEdit'>

export interface ExportRow {
  id: string
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED'
  requestedByEmail: string | null
  createdAt: string
  completedAt: string | null
  expiresAt: string | null
  sizeBytes: number | null
  tableCount: number | null
  rowCount: number | null
  fileName: string | null
  error: string | null
  downloadCount: number
}

export interface LifecycleRequest {
  id: string
  kind: 'RESET' | 'DELETE'
  status: 'SCHEDULED' | 'CANCELLED' | 'DUE' | 'COMPLETED'
  requestedByEmail: string | null
  createdAt: string
  scheduledFor: string
  reason: string | null
  cancelledByEmail: string | null
  cancelledAt: string | null
  dueNotifiedAt: string | null
  completedAt: string | null
}

export interface LifecycleOverview {
  workspaceName: string
  youAreOwner: boolean
  coolingOffDays: number
  requests: LifecycleRequest[]
  resetRemoves: string[]
  resetKeeps: string[]
  deleteRemoves: string[]
}

const K = {
  me: ['me', 'security'] as const,
  sessions: ['me', 'sessions'] as const,
  ws: ['workspace', 'security'] as const,
  members: ['workspace', 'security', 'members'] as const,
  profile: ['workspace', 'profile'] as const,
  exports: ['workspace', 'exports'] as const,
  lifecycle: ['workspace', 'lifecycle'] as const,
}

const post = <T,>(path: string, body?: unknown) => apiJson<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) })

// ── my two-factor + sessions ────────────────────────────────────────────────
export const useMfaStatus = () => useQuery({ queryKey: K.me, queryFn: () => apiJson<MfaStatus>('/v1/me/security') })

export function useMfaActions() {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: K.me }); void qc.invalidateQueries({ queryKey: K.members }); void qc.invalidateQueries({ queryKey: K.ws }) }
  return {
    setup: useMutation({ mutationFn: () => post<MfaSetupInfo>('/v1/me/security/totp/setup') }),
    confirm: useMutation({ mutationFn: (code: string) => post<{ recoveryCodes: string[] }>('/v1/me/security/totp/confirm', { code }), onSuccess: done }),
    disable: useMutation({ mutationFn: (code: string) => post<{ enabled: boolean }>('/v1/me/security/totp/disable', { code }), onSuccess: done }),
    regenerate: useMutation({ mutationFn: (code: string) => post<{ recoveryCodes: string[] }>('/v1/me/security/recovery-codes', { code }), onSuccess: done }),
  }
}

export const useSessions = () => useQuery({ queryKey: K.sessions, queryFn: () => apiJson<SessionRow[]>('/v1/me/security/sessions') })

export function useSessionActions() {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: K.sessions }) }
  return {
    revoke: useMutation({ mutationFn: (id: string) => apiJson<{ signedOut: number }>(`/v1/me/security/sessions/${id}`, { method: 'DELETE' }), onSuccess: done }),
    revokeOthers: useMutation({ mutationFn: () => post<{ signedOut: number }>('/v1/me/security/sessions/sign-out-others'), onSuccess: done }),
  }
}

// ── workspace sign-in rule ──────────────────────────────────────────────────
export const useWorkspaceSecurity = (enabled: boolean) =>
  useQuery({ queryKey: K.ws, queryFn: () => apiJson<SecuritySummary>('/v1/workspace/security'), enabled })

export const useSecurityMembers = (enabled: boolean) =>
  useQuery({ queryKey: K.members, queryFn: () => apiJson<SecurityMember[]>('/v1/workspace/security/members'), enabled })

export function useWorkspaceSecurityActions() {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: K.ws }); void qc.invalidateQueries({ queryKey: K.members }); void qc.invalidateQueries({ queryKey: K.me }) }
  return {
    setPolicy: useMutation({ mutationFn: (mfaPolicy: MfaPolicy) => apiJson<SecuritySummary>('/v1/workspace/security', { method: 'PUT', body: JSON.stringify({ mfaPolicy }) }), onSuccess: done }),
    resetMember: useMutation({ mutationFn: (userId: string) => post<{ reset: boolean; signedOut: number }>(`/v1/workspace/security/members/${userId}/mfa/reset`), onSuccess: done }),
  }
}

// ── workspace profile ─────────────────────────────────────────────────────────
export const useWorkspaceProfile = () => useQuery({ queryKey: K.profile, queryFn: () => apiJson<WorkspaceProfile>('/v1/workspace/profile') })

export function useUpdateWorkspaceProfile() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: WorkspaceProfileInput) => apiJson<WorkspaceProfile>('/v1/workspace/profile', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (data) => { qc.setQueryData(K.profile, data) },
  })
}

// ── danger zone ─────────────────────────────────────────────────────────────
export const useExports = (enabled: boolean) => useQuery({
  queryKey: K.exports,
  queryFn: () => apiJson<ExportRow[]>('/v1/workspace/exports'),
  enabled,
  // Keep checking while one is being prepared.
  refetchInterval: (q) => (q.state.data ?? []).some((e) => e.status === 'QUEUED' || e.status === 'RUNNING') ? 4000 : false,
})

export function useExportActions() {
  const qc = useQueryClient()
  return {
    start: useMutation({ mutationFn: () => post<ExportRow>('/v1/workspace/exports'), onSuccess: () => { void qc.invalidateQueries({ queryKey: K.exports }) } }),
    download: useMutation({
      mutationFn: async (row: ExportRow) => {
        const blob = await apiBlob(`/v1/workspace/exports/${row.id}/download`)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = row.fileName || 'workspace-data-export.zip'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      },
      onSuccess: () => { void qc.invalidateQueries({ queryKey: K.exports }) },
    }),
  }
}

export const useLifecycle = (enabled: boolean) =>
  useQuery({ queryKey: K.lifecycle, queryFn: () => apiJson<LifecycleOverview>('/v1/workspace/lifecycle-requests'), enabled })

export function useLifecycleActions() {
  const qc = useQueryClient()
  const done = () => { void qc.invalidateQueries({ queryKey: K.lifecycle }) }
  return {
    schedule: useMutation({ mutationFn: (b: { kind: 'RESET' | 'DELETE'; confirmName: string; reason?: string }) => post<LifecycleRequest>('/v1/workspace/lifecycle-requests', b), onSuccess: done }),
    cancel: useMutation({ mutationFn: (id: string) => post<LifecycleRequest>(`/v1/workspace/lifecycle-requests/${id}/cancel`), onSuccess: done }),
  }
}

// ── formatting ────────────────────────────────────────────────────────────────
export function whenIst(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function dayIst(iso?: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' })
}

export function ago(iso?: string | null): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 90) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  const d = Math.round(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

export function fileSize(bytes?: number | null): string {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Download a text file (recovery codes). */
export function saveText(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** The server's per-field messages on a 422 from PUT /v1/workspace/profile. */
export function fieldErrors(err: unknown): Record<string, string> {
  const payload = (err as { payload?: { fields?: Record<string, string> } })?.payload
  return payload?.fields ?? {}
}
