import { create } from 'zustand'
import { setAccessToken, clearAccessToken } from '@unifiedtree/sdk'
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
}))
