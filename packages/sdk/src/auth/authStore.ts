import { create } from 'zustand';
import { apiClient } from '../api/client';
import { setAccessToken, clearAccessToken } from './tokenStorage';
import { SCOPE_ORDER } from '../types/auth';
import type { AuthState, AuthMeResponse, AuthUser, AuthTenant, PermissionGrant, Scope, ScopeContext, ModuleInfo, LoginWithCredentialsParams } from '../types/auth';

const EMPTY_SCOPES: ScopeContext = { branches: [], departments: [], directReports: [] };

function buildPermissionMap(permissions: AuthMeResponse['permissions']): Map<string, Scope> {
  const map = new Map<string, Scope>();
  for (const grant of permissions) {
    const existing = map.get(grant.code);
    if (!existing) {
      map.set(grant.code, grant.scope);
    } else {
      // Keep the widest scope (lowest index in SCOPE_ORDER)
      if (SCOPE_ORDER.indexOf(grant.scope) < SCOPE_ORDER.indexOf(existing)) {
        map.set(grant.code, grant.scope);
      }
    }
  }
  return map;
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'idle',
  user: null,
  tenant: null,
  permissions: new Map(),
  modules: [],
  scopes: EMPTY_SCOPES,

  hydrate: async () => {
    set({ status: 'loading' });
    try {
      const res = await apiClient.get<AuthMeResponse>('/v1/canonical-auth/me');
      const data = res.data;
      set({
        status: 'authenticated',
        user: data.user,
        tenant: data.tenant,
        permissions: buildPermissionMap(data.permissions),
        modules: data.modules ?? [],
        scopes: data.scopes ?? EMPTY_SCOPES,
      });
    } catch {
      set({ status: 'unauthenticated', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
    }
  },

  loginWithCredentials: ({ token, userId, email, roles, permissions, tenantId, tenantSlug, tenantName, activeModules }: LoginWithCredentialsParams) => {
    setAccessToken(token);

    const localPart = email.split('@')[0] || 'User';
    const user: AuthUser = {
      id: userId,
      email,
      firstName: localPart.charAt(0).toUpperCase() + localPart.slice(1),
      lastName: '',
      roles,
    };

    const tenant: AuthTenant = {
      id: tenantId,
      slug: tenantSlug,
      displayName: tenantName,
      contactEmail: '',
      status: 'ACTIVE',
      planType: 'PROFESSIONAL',
    };

    // Flat permission codes → PermissionGrant[] with ORG scope.
    // Fall back to wildcard for admin roles when backend returns no explicit codes.
    const grants: PermissionGrant[] = permissions.length > 0
      ? permissions.map(code => ({ code, scope: 'ORG' as Scope }))
      : (roles.some(r => ['SUPER_ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER'].includes(r))
          ? [{ code: '*', scope: 'ORG' as Scope }]
          : []);

    const mods: ModuleInfo[] = activeModules.map(key => ({
      key,
      displayName: key,
      enabled: true,
    }));

    set({
      status: 'authenticated',
      user,
      tenant,
      permissions: buildPermissionMap(grants),
      modules: mods,
      scopes: EMPTY_SCOPES,
    });
  },

  requestOtp: async (email: string, tenantSlug: string) => {
    await apiClient.post('/v1/auth/login/request-otp', { email, tenantSlug });
  },

  loginWithOtp: async (otpToken: string) => {
    const res = await apiClient.post<{ accessToken: string }>('/v1/auth/login/otp', { token: otpToken });
    setAccessToken(res.data.accessToken);
    const { hydrate } = useAuthStore.getState();
    await hydrate();
  },

  logout: async () => {
    try {
      await apiClient.post('/v1/auth/logout');
    } catch {
      // best-effort
    }
    clearAccessToken();
    set({ status: 'unauthenticated', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
  },

  reset: () => {
    clearAccessToken();
    set({ status: 'idle', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
  },
}));
