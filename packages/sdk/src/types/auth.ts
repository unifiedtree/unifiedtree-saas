// ─── Scope ─────────────────────────────────────────────────────────────────
export type Scope = 'SELF' | 'TEAM' | 'DEPARTMENT' | 'BRANCH' | 'ORG';

/** Wider scope has a lower index. Use to find the widest scope when merging. */
export const SCOPE_ORDER: Scope[] = ['ORG', 'BRANCH', 'DEPARTMENT', 'TEAM', 'SELF'];

// ─── Permission grant ───────────────────────────────────────────────────────
export interface PermissionGrant {
  code: string;
  scope: Scope;
}

// ─── Auth user & tenant ─────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  /** Roles are informational only — always check via permissions, never role string equality. */
  roles: string[];
}

export interface AuthTenant {
  id: string;
  slug: string;
  displayName: string;
  contactEmail: string;
  status: string;
  planType: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  logoUrl?: string;
}

export interface ModuleInfo {
  key: string;
  displayName: string;
  enabled: boolean;
}

export interface ScopeContext {
  branches: string[];
  departments: string[];
  directReports: string[];
}

// ─── /auth/me response ──────────────────────────────────────────────────────
export interface AuthMeResponse {
  user: AuthUser;
  tenant: AuthTenant;
  roles: string[];
  permissions: PermissionGrant[];
  modules: ModuleInfo[];
  scopes: ScopeContext;
}

// ─── Auth store state ───────────────────────────────────────────────────────
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated' | 'error';

export interface LoginWithCredentialsParams {
  token: string;
  userId: string;
  email: string;
  roles: string[];
  /** Flat permission code strings from canonical login response */
  permissions: string[];
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  activeModules: string[];
}

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  tenant: AuthTenant | null;
  /** Map of permissionCode → widest Scope the user holds for that code. */
  permissions: Map<string, Scope>;
  modules: ModuleInfo[];
  scopes: ScopeContext;
  hydrate: () => Promise<void>;
  /** Set authenticated state directly from credential login response — bypasses /auth/me. */
  loginWithCredentials: (params: LoginWithCredentialsParams) => void;
  loginWithOtp: (otpToken: string) => Promise<void>;
  requestOtp: (email: string, tenantSlug: string) => Promise<void>;
  logout: () => Promise<void>;
  reset: () => void;
}

// ─── Resource context for scope-aware permission checks ─────────────────────
export interface ResourceContext {
  /** The employee/user ID who owns the resource */
  employeeId?: string;
  /** Branch the resource belongs to */
  branchId?: string;
  /** Department the resource belongs to */
  departmentId?: string;
}
