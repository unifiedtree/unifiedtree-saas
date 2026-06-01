import React from 'react';
import { useAuthStore } from '../auth/authStore';
import { SCOPE_ORDER } from '../types/auth';
import type { Scope, ResourceContext } from '../types/auth';

// ─── Core permission resolution ─────────────────────────────────────────────

function scopeCoversResource(
  scope: Scope,
  resource: ResourceContext | undefined,
  scopes: { branches: string[]; departments: string[]; directReports: string[] },
  userId: string | undefined,
): boolean {
  if (!resource) return true; // no resource context → just check code exists
  switch (scope) {
    case 'ORG':
      return true;
    case 'BRANCH':
      return resource.branchId ? scopes.branches.includes(resource.branchId) : true;
    case 'DEPARTMENT':
      return resource.departmentId ? scopes.departments.includes(resource.departmentId) : true;
    case 'TEAM':
      return resource.employeeId ? scopes.directReports.includes(resource.employeeId) : true;
    case 'SELF':
      return resource.employeeId ? resource.employeeId === userId : false;
    default:
      return false;
  }
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/**
 * Returns true if the current user has `code` permission covering `resource`.
 * When `resource` is omitted, only checks if the permission code is granted at all.
 */
export function usePermission(code: string, resource?: ResourceContext): boolean {
  return useAuthStore(state => {
    const scope = state.permissions.get(code);
    if (!scope) return false;
    return scopeCoversResource(scope, resource, state.scopes, state.user?.id);
  });
}

/** Returns true if the user has ANY of the given permission codes. */
export function useAnyPermission(codes: string[], resource?: ResourceContext): boolean {
  return useAuthStore(state =>
    codes.some(code => {
      const scope = state.permissions.get(code);
      if (!scope) return false;
      return scopeCoversResource(scope, resource, state.scopes, state.user?.id);
    }),
  );
}

/** Returns true if the user has ALL of the given permission codes. */
export function useAllPermissions(codes: string[], resource?: ResourceContext): boolean {
  return useAuthStore(state =>
    codes.every(code => {
      const scope = state.permissions.get(code);
      if (!scope) return false;
      return scopeCoversResource(scope, resource, state.scopes, state.user?.id);
    }),
  );
}

// ─── Components ─────────────────────────────────────────────────────────────

interface CanProps {
  code: string;
  resource?: ResourceContext;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Renders children only if the user has the given permission. */
export function Can({ code, resource, fallback = null, children }: CanProps) {
  const allowed = usePermission(code, resource);
  return <>{allowed ? children : fallback}</>;
}

interface CanAnyProps {
  codes: string[];
  resource?: ResourceContext;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Renders children if the user has ANY of the given permissions. */
export function CanAny({ codes, resource, fallback = null, children }: CanAnyProps) {
  const allowed = useAnyPermission(codes, resource);
  return <>{allowed ? children : fallback}</>;
}

interface CanAllProps {
  codes: string[];
  resource?: ResourceContext;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/** Renders children only if the user has ALL of the given permissions. */
export function CanAll({ codes, resource, fallback = null, children }: CanAllProps) {
  const allowed = useAllPermissions(codes, resource);
  return <>{allowed ? children : fallback}</>;
}

export type { Scope, ResourceContext };
