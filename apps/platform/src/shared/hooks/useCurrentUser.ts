import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getAccessToken } from '@unifiedtree/sdk'
import { apiJson, API_BASE_URL } from '@/core/api/client'

/**
 * The signed-in user, as the backend describes them at /v1/users/me.
 *
 * Written as its own hook (not a slice of the auth store) because:
 *   - the auth store is populated once at login and never refreshed — a name
 *     change made on the Profile page would not be reflected in the sidebar
 *     until the next logout, which is exactly the bug this indirection fixes;
 *   - TanStack Query gives us invalidation on save, background revalidation on
 *     window focus, and a single cached row every consumer reads from;
 *   - the same key {@code ['user', 'me']} is what the Profile page invalidates
 *     after PUT /v1/users/me — one string to keep in sync.
 *
 * The response shape is intentionally lenient — the backend has been rolling
 * out fields (avatarUrl, displayName, phone, preferences) in stages and this
 * shouldn't 500 the whole component if one is missing on the live rev.
 */
export interface CurrentUser {
  id: string
  email: string
  firstName?: string
  lastName?: string
  /** Preferred display name — takes precedence over first+last when present. */
  displayName?: string
  /** Public avatar URL (R2/CDN). Missing/null = show initials. */
  avatarUrl?: string | null
  phone?: string | null
  /** In-app notification preferences (leave-request / payroll / mentions …).
   *  Kept as a free-form record so the backend can add flags without us
   *  cutting a matching FE release. */
  notificationPreferences?: {
    emailEnabled?: boolean
    pushEnabled?: boolean
    [k: string]: unknown
  }
  roles?: string[]
}

export const CURRENT_USER_KEY = ['user', 'me'] as const

/** GET /v1/users/me — cached, background-refreshed on window focus. */
export function useCurrentUser() {
  return useQuery({
    queryKey: CURRENT_USER_KEY,
    queryFn: () => apiJson<CurrentUser>('/v1/users/me'),
    // The row rarely changes mid-session — a minute of freshness saves a
    // request on every tab switch, and mutations invalidate explicitly.
    staleTime: 60_000,
  })
}

/** Patch a subset of the current user. Invalidates {@link CURRENT_USER_KEY}. */
export function useUpdateCurrentUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: Partial<CurrentUser>) =>
      apiJson<CurrentUser>('/v1/users/me', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    // Optimistic update: paint the change immediately, roll back on error.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: CURRENT_USER_KEY })
      const prev = qc.getQueryData<CurrentUser>(CURRENT_USER_KEY)
      if (prev) qc.setQueryData<CurrentUser>(CURRENT_USER_KEY, { ...prev, ...patch })
      return { prev }
    },
    onError: (_err, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(CURRENT_USER_KEY, ctx.prev)
    },
    onSuccess: (fresh) => {
      // Trust the server's echo — normalises any casing/whitespace it fixed.
      qc.setQueryData(CURRENT_USER_KEY, fresh)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CURRENT_USER_KEY })
    },
  })
}

/**
 * Upload a new avatar as multipart/form-data. Optimistically flips the cached
 * avatarUrl to a local object-URL so the preview updates before the server
 * responds, and rolls back on any non-2xx. The server-returned URL then
 * replaces the object-URL and revokes it so we don't leak memory.
 *
 * We deliberately bypass {@link apiJson} — that helper stringifies bodies as
 * JSON, but a multipart request must NOT set Content-Type manually (the
 * browser needs to add the boundary).
 */
export function useUploadAvatar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData()
      form.append('file', file)
      const bearer = getAccessToken()
      const resp = await fetch(`${API_BASE_URL}/v1/users/me/avatar`, {
        method: 'POST',
        credentials: 'include',
        headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
        body: form,
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        // Preserve the status so callers can render targeted copy for 413/415.
        const err = new Error(body || `Upload failed (${resp.status})`) as Error & { status: number }
        err.status = resp.status
        throw err
      }
      return resp.json() as Promise<{ avatarUrl: string | null }>
    },
    onMutate: async (file) => {
      await qc.cancelQueries({ queryKey: CURRENT_USER_KEY })
      const prev = qc.getQueryData<CurrentUser>(CURRENT_USER_KEY)
      const preview = URL.createObjectURL(file)
      if (prev) qc.setQueryData<CurrentUser>(CURRENT_USER_KEY, { ...prev, avatarUrl: preview })
      return { prev, preview }
    },
    onError: (_err, _file, ctx) => {
      if (ctx?.preview) URL.revokeObjectURL(ctx.preview)
      if (ctx?.prev) qc.setQueryData(CURRENT_USER_KEY, ctx.prev)
    },
    onSuccess: (res, _file, ctx) => {
      if (ctx?.preview) URL.revokeObjectURL(ctx.preview)
      const cur = qc.getQueryData<CurrentUser>(CURRENT_USER_KEY)
      if (cur) qc.setQueryData<CurrentUser>(CURRENT_USER_KEY, { ...cur, avatarUrl: res.avatarUrl ?? null })
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: CURRENT_USER_KEY })
    },
  })
}
