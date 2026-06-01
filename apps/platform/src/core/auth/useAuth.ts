import { useAuthStore } from './authStore'

export const useAuth = () => {
  const user = useAuthStore((s) => s.user)
  const tenant = useAuthStore((s) => s.tenant)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const isLoading = useAuthStore((s) => s.isLoading)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const hasModule = useAuthStore((s) => s.hasModule)

  return { user, tenant, isAuthenticated, isLoading, login, logout, hasPermission, hasModule }
}
