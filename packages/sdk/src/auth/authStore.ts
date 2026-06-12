import { create } from 'zustand';
import { apiClient } from '../api/client';
import { getAccessToken, setAccessToken, clearAccessToken } from './tokenStorage';
import { resolveTenantSlug } from './tenant';
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

// The canonical `/v1/canonical-auth/me` endpoint returns a FLAT payload:
//   { userId, tenantId, email, roles: string[], permissions: string[] }
// This is the shape used on page-reload / deep-link / SSO hydration (loginWithCredentials,
// by contrast, receives an already-mapped login response). The older nested AuthMeResponse
// shape ({ user, tenant, permissions: {code,scope}[], … }) is also tolerated. Normalizing
// both here is what keeps a reload from dropping an authenticated user into a roles-less /
// permission-less state (→ /no-access, "Access restricted", and locked ModuleGates).
interface CanonicalMeResponse {
  userId?: string;
  tenantId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  roles?: string[];
  permissions?: Array<string | PermissionGrant>;
  // tolerated nested form
  user?: AuthUser;
  tenant?: AuthTenant;
  modules?: ModuleInfo[];
  // Real active-module set for the workspace, as returned by /me (string keys).
  // When present, this is the authoritative source of modules; deriveModulesFromGrants
  // is only used as a backward-compat fallback when this is absent.
  activeModules?: string[];
  scopes?: ScopeContext;
}

// /me carries no module list, but the app gates module pages (e.g. HRMS) on the
// active-module set. Derive it from the permission codes the user actually holds — a
// user with hrms/attendance/leave/payroll permissions has the HRMS module active.
const MODULE_BY_PERMISSION_PREFIX: Record<string, string> = {
  hrms: 'hrms', attendance: 'hrms', leave: 'hrms', payroll: 'hrms',
  onboarding: 'hrms', letters: 'hrms',
  crm: 'crm', accounts: 'accounts', projects: 'projects',
  inventory: 'inventory', procurement: 'procurement', helpdesk: 'helpdesk',
};
const ALL_MODULE_KEYS = [...new Set(Object.values(MODULE_BY_PERMISSION_PREFIX))];

function deriveModulesFromGrants(grants: PermissionGrant[]): ModuleInfo[] {
  const keys = new Set<string>();
  for (const g of grants) {
    if (g.code === '*') { ALL_MODULE_KEYS.forEach((k) => keys.add(k)); break; }
    const mod = MODULE_BY_PERMISSION_PREFIX[g.code.split('.')[0]];
    if (mod) keys.add(mod);
  }
  return [...keys].map((key) => ({ key, displayName: key, enabled: true }));
}

function meToAuthState(data: CanonicalMeResponse) {
  const rawPerms = data.permissions ?? [];
  const grants: PermissionGrant[] = rawPerms.map((p) =>
    typeof p === 'string' ? { code: p, scope: 'ORG' as Scope } : p,
  );

  const roles = data.user?.roles ?? data.roles ?? [];
  const email = data.user?.email ?? data.email ?? '';
  const localPart = email.split('@')[0] || 'User';
  const user: AuthUser = data.user ?? {
    id: data.userId ?? '',
    email,
    firstName: data.firstName || (localPart.charAt(0).toUpperCase() + localPart.slice(1)),
    lastName: data.lastName || '',
    roles,
  };

  // Prefer the workspace's real active-module set from /me when provided.
  // Fall back to deriving modules from RBAC grants only for backward compat.
  const modules: ModuleInfo[] = data.modules
    ?? (data.activeModules != null
      ? data.activeModules.map((key) => ({ key, displayName: key, enabled: true }))
      : deriveModulesFromGrants(grants));

  const slug = resolveTenantSlug() ?? '';
  const tenant: AuthTenant = data.tenant ?? {
    id: data.tenantId ?? '',
    slug,
    displayName: slug ? slug.charAt(0).toUpperCase() + slug.slice(1) : 'Workspace',
    contactEmail: '',
    status: 'ACTIVE',
    planType: 'PROFESSIONAL',
  };

  return {
    status: 'authenticated' as const,
    user,
    tenant,
    permissions: buildPermissionMap(grants),
    modules,
    scopes: data.scopes ?? EMPTY_SCOPES,
  };
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: 'idle',
  user: null,
  tenant: null,
  permissions: new Map(),
  modules: [],
  scopes: EMPTY_SCOPES,

  hydrate: async () => {
    // No token yet (e.g. on the login page) → don't call /me; it would 401.
    if (!getAccessToken()) {
      set({ status: 'unauthenticated', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
      return;
    }
    set({ status: 'loading' });
    try {
      const res = await apiClient.get<CanonicalMeResponse>('/v1/canonical-auth/me');
      set(meToAuthState(res.data));
    } catch {
      set({ status: 'unauthenticated', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
    }
  },

  loginWithCredentials: ({ token, userId, email, firstName, lastName, roles, permissions, tenantId, tenantSlug, tenantName, activeModules }: LoginWithCredentialsParams) => {
    setAccessToken(token);

    const localPart = email.split('@')[0] || 'User';
    const user: AuthUser = {
      id: userId,
      email,
      firstName: firstName || (localPart.charAt(0).toUpperCase() + localPart.slice(1)),
      lastName: lastName || '',
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
