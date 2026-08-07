import { create } from 'zustand'
import { setAccessToken, clearAccessToken } from '@unifiedtree/sdk'
import { apiJson, currentSubdomain, type WorkspaceStatus } from '@/core/api/client'
import type { User, Tenant } from '@/types'

interface AuthState {
  user: User | null
  tenant: Tenant | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (token: string, user: User, tenant: Tenant) => void
  logout: () => void
  hasPermission: (permission: string) => boolean
  hasModule: (moduleKey: string) => boolean
  setLoading: (loading: boolean) => void
  /** Re-fetch this workspace's status (activeModules, tenant status) from
   *  the backend and merge into the cached Tenant. Used after in-workspace
   *  autopay activation so the launcher grid reflects the newly-unlocked
   *  modules without a full page reload. Idempotent; no-op if not signed in. */
  refreshTenant: () => Promise<void>
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  tenant: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,

  login: (token, user, tenant) => {
    // Store token in-memory via SDK — never in localStorage
    if (token) setAccessToken(token)
    set({ token, user, tenant, isAuthenticated: true, isLoading: false })
  },

  logout: () => {
    clearAccessToken()
    set({ user: null, tenant: null, token: null, isAuthenticated: false })
  },

  hasPermission: (permission) => {
    const { user } = get()
    if (!user) return false
    return user.permissions.includes(permission) || user.permissions.includes('*')
  },

  hasModule: (moduleKey) => {
    const { tenant } = get()
    if (!tenant) return false
    return tenant.activeModules.includes(moduleKey)
  },

  setLoading: (loading) => set({ isLoading: loading }),

  refreshTenant: async () => {
    const { tenant } = get()
    if (!tenant) return
    const subdomain = currentSubdomain() || tenant.subdomain
    try {
      const status = await apiJson<WorkspaceStatus>('/v1/public/workspace-status', {
        headers: subdomain ? { 'X-Tenant-Subdomain': subdomain } : {},
      })
      // Merge — keep id/name/subdomain/planType/etc. from the cached Tenant
      // (they don't change on a plan activation) but replace activeModules
      // with the freshly-fetched list so the launcher grid flips locked→active
      // without a full page reload.
      set({
        tenant: {
          ...tenant,
          activeModules: status.activeModules ?? tenant.activeModules,
        },
      })
    } catch {
      // Best-effort — a network blip should NOT log the user out. The next
      // reload picks up the fresh state anyway.
    }
  },
}))
