// Types
export type {
  Scope, PermissionGrant, AuthUser, AuthTenant, AuthMeResponse,
  AuthState, AuthStatus, ResourceContext, ModuleInfo, ScopeContext,
  LoginWithCredentialsParams,
} from './types/auth';
export { SCOPE_ORDER } from './types/auth';

// Tenant
export { resolveTenantSlug, tenantUrl } from './auth/tenant';

// Token storage
export { setAccessToken, getAccessToken, isAccessTokenExpired, clearAccessToken } from './auth/tokenStorage';

// API Client
export { apiClient, apiEvents, ApiError, createApiClient } from './api/client';

// Auth Store
export { useAuthStore } from './auth/authStore';

// Permissions
export { usePermission, useAnyPermission, useAllPermissions, Can, CanAny, CanAll } from './permissions/usePermission';

// Permission codes
export { P } from './permissions/codes';
export type { PermissionCode } from './permissions/codes';
