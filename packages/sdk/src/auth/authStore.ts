import { create } from 'zustand';
import { apiClient } from '../api/client';
import { getAccessToken, setAccessToken, clearAccessToken } from './tokenStorage';
import { resolveTenantSlug } from './tenant';
import { SCOPE_ORDER } from '../types/auth';
import type { AuthState, AuthMeResponse, AuthUser, AuthTenant, PermissionGrant, Scope, ScopeContext, ModuleInfo, LoginWithCredentialsParams } from '../types/auth';

const EMPTY_SCOPES: ScopeContext = { branches: [], departments: [], directReports: [] };

/**
 * Mint a fresh access token from the httpOnly refresh cookie set at login.
 *
 * <p>Called on cold load, when there is no in-memory access token but the
 * browser may still hold a valid refresh cookie. Uses `withCredentials` so the
 * cookie is sent cross-origin (the app is on a workspace subdomain, the API on
 * api.unifiedtree.com), and `_skipAuth` because there is no Bearer token to
 * attach yet.
 *
 * <p>A 4xx here is the ordinary "not signed in" case, not an error worth
 * surfacing — the caller simply shows the login page.
 *
 * @returns true when a session was restored
 */
async function tryRestoreSession(): Promise<boolean> {
  try {
    const res = await apiClient.post<{ accessToken?: string }>(
      '/v1/canonical-auth/refresh',
      {},
      { withCredentials: true, _skipAuth: true } as never,
    );
    const token = res.data?.accessToken;
    if (!token) return false;
    setAccessToken(token);
    return true;
  } catch {
    return false;
  }
}

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
    // Stay in 'loading' for the whole attempt. RouteGuard renders nothing
    // while idle/loading and only redirects to /login on 'unauthenticated',
    // so flipping to unauthenticated early — as this used to do the instant
    // it saw no in-memory token — is what turned every page reload into a
    // logout, before the refresh below ever had a chance to run.
    set({ status: 'loading' });

    // The access token lives in memory only (deliberate: an XSS bug cannot
    // read it), so a reload always starts without one. That is NOT the same
    // as being signed out — the httpOnly refresh cookie set at login can mint
    // a fresh access token. Try that before concluding anything.
    if (!getAccessToken()) {
      const restored = await tryRestoreSession();
      if (!restored) {
        set({ status: 'unauthenticated', user: null, tenant: null, permissions: new Map(), modules: [], scopes: EMPTY_SCOPES });
        return;
      }
    }
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
      // Canonical path (/v1/auth/logout does not exist under the profile
      // production runs). withCredentials so the refresh cookie is sent and
      // can actually be revoked and cleared server-side — dropping only the
      // in-memory access token would leave a live refresh cookie behind, and
      // the next page load would sign the user straight back in. On a shared
      // machine that is a real problem, not a cosmetic one.
      await apiClient.post('/v1/canonical-auth/logout', {},
        { withCredentials: true, _skipAuth: true } as never);
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
