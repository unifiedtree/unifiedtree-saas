import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'TENANT_ADMIN' | 'MANAGER' | 'EMPLOYEE' | 'VIEWER'
  avatarUrl?: string
  tenantId?: string
  tenantName?: string
  subdomain?: string
  plan?: string
  onboardingCompleted?: boolean
  theme?: 'dark' | 'light'
}

interface AuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isLoading: boolean
  tokens: AuthTokens | null
  permissions: string[]
  activeModules: string[]

  // Actions
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  refreshToken: () => Promise<void>
  updateUser: (data: Partial<AuthUser>) => void
  setTheme: (theme: 'dark' | 'light') => void
  updateOnboarding: (completed: boolean) => void
  hasPermission: (permissionCode: string) => boolean
  setActiveModules: (modules: string[]) => void
}

// Mock permission set based on role
function getPermissionsForRole(role: AuthUser['role']): string[] {
  switch (role) {
    case 'SUPER_ADMIN':
    case 'PLATFORM_ADMIN':
      return ['*'] // All permissions
    case 'TENANT_ADMIN':
      return [
        'hrms:employees:read', 'hrms:employees:create', 'hrms:employees:update', 'hrms:employees:delete',
        'hrms:leaves:read', 'hrms:leaves:approve',
        'hrms:payroll:read', 'hrms:payroll:process',
        'crm:leads:read', 'crm:leads:create', 'crm:leads:update', 'crm:leads:delete',
        'crm:deals:read', 'crm:deals:create', 'crm:deals:update',
        'accounts:invoices:read', 'accounts:invoices:create', 'accounts:invoices:update',
        'accounts:expenses:read', 'accounts:expenses:create',
        'settings:read', 'settings:update',
        'users:read', 'users:create', 'users:update', 'users:delete',
      ]
    case 'MANAGER':
      return [
        'hrms:employees:read', 'hrms:employees:create', 'hrms:employees:update',
        'hrms:leaves:read', 'hrms:leaves:approve',
        'crm:leads:read', 'crm:leads:create', 'crm:leads:update',
        'crm:deals:read', 'crm:deals:create', 'crm:deals:update',
        'accounts:invoices:read', 'accounts:invoices:create',
      ]
    case 'EMPLOYEE':
      return [
        'hrms:employees:read',
        'hrms:leaves:read', 'hrms:leaves:create',
        'crm:leads:read',
        'accounts:invoices:read',
      ]
    case 'VIEWER':
      return [
        'hrms:employees:read',
        'crm:leads:read',
        'accounts:invoices:read',
      ]
    default:
      return []
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      tokens: null,
      permissions: [],
      activeModules: [],

      login: async (email: string, _password: string) => {
        set({ isLoading: true })
        // Simulate API delay
        await new Promise((r) => setTimeout(r, 600))

        const mockUser: AuthUser = {
          id: 'user-001',
          name: 'Alex Johnson',
          email,
          role: 'TENANT_ADMIN',
          avatarUrl: undefined,
          tenantId: 'tenant-001',
          tenantName: 'TechCorp Inc',
          subdomain: 'techcorp',
          plan: 'professional',
          onboardingCompleted: true,
          theme: 'dark',
        }

        const mockTokens: AuthTokens = {
          accessToken: 'mock-access-token-' + Date.now(),
          refreshToken: 'mock-refresh-token-' + Date.now(),
          expiresAt: Date.now() + 3600 * 1000,
        }

        set({
          user: mockUser,
          isAuthenticated: true,
          isLoading: false,
          tokens: mockTokens,
          permissions: getPermissionsForRole(mockUser.role),
          activeModules: ['hrms', 'crm', 'accounts', 'payroll', 'inventory'],
        })
      },

      logout: () => {
        set({
          user: null,
          isAuthenticated: false,
          tokens: null,
          permissions: [],
          activeModules: [],
        })
      },

      refreshToken: async () => {
        const { tokens } = get()
        if (!tokens) return
        // In production: call refresh endpoint
        set((state) => ({
          tokens: state.tokens
            ? { ...state.tokens, expiresAt: Date.now() + 3600 * 1000 }
            : null,
        }))
      },

      updateUser: (data) => {
        set((state) => ({
          user: state.user ? { ...state.user, ...data } : null,
        }))
      },

      setTheme: (theme) => {
        set((state) => ({
          user: state.user ? { ...state.user, theme } : null,
        }))
      },

      updateOnboarding: (completed) => {
        set((state) => ({
          user: state.user ? { ...state.user, onboardingCompleted: completed } : null,
        }))
      },

      hasPermission: (permissionCode) => {
        const { user, permissions } = get()
        if (!user) return false
        if (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN') return true
        if (permissions.includes('*')) return true
        return permissions.includes(permissionCode)
      },

      setActiveModules: (modules) => {
        set({ activeModules: modules })
      },
    }),
    {
      name: 'erp-auth-store',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
        tokens: state.tokens,
        permissions: state.permissions,
        activeModules: state.activeModules,
      }),
    }
  )
)
