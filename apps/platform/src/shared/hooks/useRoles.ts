import { useAuthStore } from '@unifiedtree/sdk'

/**
 * Role-bucket helper for role-based UI gating that doesn't map 1:1 to a
 * permission code — for example the client rule "admins don't see their own
 * attendance summary on the HRMS dashboard", which is presentational and has
 * no backend counterpart to gate on.
 *
 * Rules of thumb:
 *  - Use `usePermission(P.X)` / `<Can>` whenever the gate maps to what the
 *    backend endpoint would allow. That is the default.
 *  - Reach for these buckets only when the rule is role-string based
 *    (payroll-cost card, attendance-tile visibility, KPI-row composition)
 *    or when the label needs to swap by role bucket.
 *
 * Role bucket map (matches the JWT roles the backend emits):
 *  ADMIN     — OWNER, SUPER_ADMIN, COMPANY_ADMIN, ADMIN
 *  HR        — HR_MANAGER, HR
 *  MANAGER   — DEPT_MANAGER, MANAGER
 *  EMPLOYEE  — anything else (bare EMPLOYEE, or no elevated role at all)
 *
 * A single principal can hold roles from multiple buckets; the boolean flags
 * return true whenever ANY held role belongs to that bucket, and `isEmployee`
 * is defined as "none of the elevated buckets" so the four flags never all
 * fire together (except for the empty state where isEmployee is true alone).
 */
export interface RoleBuckets {
  /** OWNER / SUPER_ADMIN / COMPANY_ADMIN / ADMIN */
  isAdmin: boolean
  /** HR_MANAGER / HR */
  isHR: boolean
  /** DEPT_MANAGER / MANAGER (not HR, not admin) */
  isManager: boolean
  /** No elevated role — bare EMPLOYEE, or a principal with no roles at all */
  isEmployee: boolean
  /** Raw roles array from the JWT (may be empty) */
  roles: string[]
}

/**
 * CANONICAL role bucket lists — the single source of truth for every
 * role-string check in the app. Do NOT redeclare these anywhere else
 * (App.tsx's ComingSoonRoute and PlatformShell's local list previously
 * kept their own disagreeing copies — an OWNER opening /accounts got
 * bounced to /dashboard because the local list omitted OWNER; the
 * shell's local copy dropped OWNER and pulled HR_MANAGER in).
 */
export const ADMIN_ROLES   = ['OWNER', 'SUPER_ADMIN', 'COMPANY_ADMIN', 'ADMIN'] as const
export const HR_ROLES      = ['HR_MANAGER', 'HR'] as const
export const MANAGER_ROLES = ['DEPT_MANAGER', 'MANAGER'] as const

export function useRoles(): RoleBuckets {
  // Read the roles array reference directly. Allocating `[]` inside the
  // selector on every render would break zustand's equality check and refire
  // every subscriber on every store tick. Fall back once outside.
  const roles = useAuthStore((s) => s.user?.roles) ?? []
  const has = (list: readonly string[]) => list.some((r) => roles.includes(r))

  const isAdmin   = has(ADMIN_ROLES)
  const isHR      = has(HR_ROLES)
  const isManager = has(MANAGER_ROLES)
  // "Employee" = no elevated bucket. Keeps the four flags mutually exclusive
  // for the common case where the JWT carries exactly one role string.
  const isEmployee = !isAdmin && !isHR && !isManager

  return { isAdmin, isHR, isManager, isEmployee, roles }
}
