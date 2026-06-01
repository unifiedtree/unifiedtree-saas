import { useCallback } from 'react'
import { useAuthStore } from '../store/authStore'

interface UseAuthReturn {
  user: ReturnType<typeof useAuthStore>['getState'] extends () => infer S ? (S extends { user: infer U } ? U : never) : never
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasPermission: (permissionCode: string) => boolean
}

export function useAuth() {
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const storeLogin = useAuthStore((s) => s.login)
  const storeLogout = useAuthStore((s) => s.logout)
  const permissions = useAuthStore((s) => s.permissions)

  const login = useCallback(
    async (email: string, password: string) => {
      await storeLogin(email, password)
    },
    [storeLogin]
  )

  const logout = useCallback(() => {
    storeLogout()
  }, [storeLogout])

  const hasPermission = useCallback(
    (permissionCode: string): boolean => {
      if (!user) return false
      if (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN') return true
      return permissions.includes(permissionCode)
    },
    [user, permissions]
  )

  return { user, isAuthenticated, isLoading, login, logout, hasPermission }
}
