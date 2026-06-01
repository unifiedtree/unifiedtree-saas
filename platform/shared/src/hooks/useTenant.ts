import { useAuthStore } from '../store/authStore'

interface UseTenantReturn {
  tenant: { id: string; name: string; subdomain: string; plan: string } | null
  tenantId: string | null
  subdomain: string | null
  isLoaded: boolean
}

export function useTenant(): UseTenantReturn {
  const user = useAuthStore((s) => s.user)
  const isLoaded = useAuthStore((s) => !s.isLoading)

  if (!user?.tenantId) {
    return { tenant: null, tenantId: null, subdomain: null, isLoaded }
  }

  const tenant = {
    id: user.tenantId,
    name: user.tenantName ?? '',
    subdomain: user.subdomain ?? '',
    plan: user.plan ?? 'starter',
  }

  return {
    tenant,
    tenantId: user.tenantId,
    subdomain: user.subdomain ?? null,
    isLoaded,
  }
}
