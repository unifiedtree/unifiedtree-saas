// Company access: which companies a person may work in, and their role(s) in each
// (one login, one employee record in a home company; other companies are grants
// with a role there). The endpoints (contract: company-access-contract.md):
//   GET    /v1/workspace/users/{userId}/company-access                 workspace.users.read
//   POST   /v1/workspace/users/{userId}/company-access {companyId, roleCode}   workspace.users.manage
//   DELETE /v1/workspace/users/{userId}/company-access/{companyId}[?roleCode=]  workspace.users.manage
//   GET    /v1/workspace/company-access[?companyId=]                    workspace.users.read
// The server applies the same levels rules as giving a role (only what you hold,
// critical ones by the owner, never your own access, never the home company, and
// never OWNER / SUPER_ADMIN / ADMIN, which cover every company). On a server
// without these endpoints (not deployed yet) the reads come back "unavailable"
// and the screens hide or explain just that part.
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiJson, HttpError } from '@/core/api/client'

export type CompanyAccessVia = 'WORKSPACE' | 'HOME' | 'GRANT'

export interface CompanyRoleEntry {
  code: string
  name: string
  /** ROLES = the person's normal roles (home company / every company), GRANT = a company grant. */
  source: 'ROLES' | 'GRANT'
  grantedBy: string | null
  grantedAt: string | null
}

export interface CompanyAccessEntry {
  companyId: string
  name: string
  logoUrl: string | null
  /** false only for an archived company (admin view). */
  active: boolean
  home: boolean
  access: CompanyAccessVia
  roles: CompanyRoleEntry[]
}

export interface CompanyAccessView {
  userId: string
  homeCompanyId: string | null
  /** Holds a role that covers every company (Owner, Admin, HR manager…) or has no employee record. */
  allCompanies: boolean
  companies: CompanyAccessEntry[]
}

export interface CompanyGrantRow {
  userId: string
  email: string
  employeeName: string | null
  homeCompanyId: string | null
  companyId: string
  companyName: string
  roleCode: string
  roleName: string
  grantedBy: string | null
  grantedAt: string | null
}

/** Roles that cover the whole business: given as roles, never per company (CompanyAccess.NOT_GRANTABLE_PER_COMPANY). */
export const NOT_PER_COMPANY = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN'])
/** Built-in roles whose holders reach every company (CompanyAccess.WORKSPACE_WIDE_ROLES). */
export const WORKSPACE_WIDE = new Set(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'])

/** A server that doesn't have company access yet (endpoint missing, or its migration not applied). */
export function companyAccessUnavailable(e: unknown): boolean {
  if (!(e instanceof HttpError)) return false
  const code = (e.payload as { errorCode?: string } | undefined)?.errorCode
  return (e.status === 404 && code !== 'USER_NOT_FOUND') || e.status === 405 || code === 'FEATURE_NOT_READY'
}

/** Plain words for a refused change (the server's message, which already says why). */
export function companyAccessError(e: unknown): string {
  if (companyAccessUnavailable(e)) return 'Company access isn’t available on this server yet.'
  return (e as Error)?.message || 'Please try again.'
}

const userKey = (userId: string | null) => ['rbac', 'workspace', 'company-access', userId] as const
const GRANTS_KEY = ['rbac', 'workspace', 'company-grants'] as const

export function useUserCompanyAccess(userId: string | null) {
  return useQuery({
    queryKey: userKey(userId),
    queryFn: () => apiJson<CompanyAccessView>(`/v1/workspace/users/${userId}/company-access`),
    enabled: !!userId,
    retry: (n, e) => !companyAccessUnavailable(e) && !(e instanceof HttpError && e.status === 403) && n < 1,
  })
}

/** Every grant in the workspace (optionally one company). Empty before the migration is applied. */
export function useCompanyGrants(enabled = true) {
  return useQuery({
    queryKey: GRANTS_KEY,
    queryFn: () => apiJson<CompanyGrantRow[]>('/v1/workspace/company-access'),
    enabled,
    retry: (n, e) => !companyAccessUnavailable(e) && !(e instanceof HttpError && e.status === 403) && n < 1,
  })
}

export function useGrantCompanyAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, companyId, roleCode }: { userId: string; companyId: string; roleCode: string }) =>
      apiJson<CompanyAccessView>(`/v1/workspace/users/${userId}/company-access`, {
        method: 'POST',
        body: JSON.stringify({ companyId, roleCode }),
      }),
    onSuccess: (view, { userId }) => {
      qc.setQueryData(userKey(userId), view)
      qc.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}

export function useRevokeCompanyAccess() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, companyId, roleCode }: { userId: string; companyId: string; roleCode?: string }) =>
      apiJson<CompanyAccessView>(
        `/v1/workspace/users/${userId}/company-access/${companyId}${roleCode ? `?roleCode=${encodeURIComponent(roleCode)}` : ''}`,
        { method: 'DELETE' },
      ),
    onSuccess: (view, { userId }) => {
      qc.setQueryData(userKey(userId), view)
      qc.invalidateQueries({ queryKey: GRANTS_KEY })
    },
  })
}

/** After a person's roles change their companies can too (a role that covers every company). */
export function invalidateCompanyAccess(qc: ReturnType<typeof useQueryClient>, userId: string) {
  void qc.invalidateQueries({ queryKey: userKey(userId) })
  void qc.invalidateQueries({ queryKey: GRANTS_KEY })
}

// ── Pure helpers (unit-tested) ─────────────────────────────────────────────────

export interface CompanyOption { id: string; name: string }

/**
 * The companies a person can be given access to from here: active companies of
 * the workspace other than their home company. A company they already have a
 * grant in stays offered (another role there).
 */
export function grantableCompanies(view: CompanyAccessView | undefined, all: CompanyOption[]): CompanyOption[] {
  if (!view || view.allCompanies) return []
  return all.filter((c) => c.id !== view.homeCompanyId)
}

/** Roles that can be given in a company: not the whole-business ones, and not one they already hold there. */
export function rolesForCompany<T extends { roleCode: string }>(roles: T[], view: CompanyAccessView | undefined, companyId: string): T[] {
  const held = new Set((view?.companies.find((c) => c.companyId === companyId)?.roles ?? []).filter((r) => r.source === 'GRANT').map((r) => r.code))
  return roles.filter((r) => !NOT_PER_COMPANY.has(r.roleCode) && !held.has(r.roleCode))
}

/** Plain words for how a person reaches a company. */
export function accessLabel(via: CompanyAccessVia): string {
  return via === 'WORKSPACE' ? 'Every company' : via === 'HOME' ? 'Main company' : 'Given access'
}

/** How a person reaches one company and the roles they have there, or null when they can't open it. */
export interface CompanyRolesLine { via: CompanyAccessVia; roles: string[] }

/**
 * One person's line under a company on Roles & permissions → Who has which role.
 * `homeCompanyId`: their employee record's company; null = no employee record
 * (every company, as the server treats it); undefined = not known (only their
 * grants and whole-business roles count). `grants`: their company grants.
 */
export function rolesInCompany(
  user: { roles: { roleCode: string; displayName: string }[] },
  homeCompanyId: string | null | undefined,
  grants: Pick<CompanyGrantRow, 'companyId' | 'roleName'>[],
  companyId: string,
): CompanyRolesLine | null {
  const names = user.roles.map((r) => r.displayName)
  if (homeCompanyId === null || user.roles.some((r) => WORKSPACE_WIDE.has(r.roleCode))) return { via: 'WORKSPACE', roles: names }
  if (homeCompanyId === companyId) return { via: 'HOME', roles: names }
  const there = grants.filter((g) => g.companyId === companyId).map((g) => g.roleName)
  return there.length ? { via: 'GRANT', roles: there } : null
}

/** Each employee's company (GET /v1/hrms/employees/by-ids, hrms.employee.read), in chunks under the server's cap. */
export function useHomeCompanies(employeeIds: string[], enabled: boolean) {
  const ids = Array.from(new Set(employeeIds)).sort()
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 400) chunks.push(ids.slice(i, i + 400))
  const qs = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: ['hrms', 'employees-by-ids', chunk],
      queryFn: () => apiJson<{ id: string; companyId: string }[]>(`/v1/hrms/employees/by-ids?ids=${chunk.join(',')}`),
      enabled, staleTime: 60_000,
    })),
  })
  const map = new Map<string, string>()
  for (const q of qs) for (const e of q.data ?? []) map.set(e.id, e.companyId)
  return { map, isLoading: qs.some((q) => q.isLoading), error: qs.find((q) => q.error)?.error ?? null }
}
