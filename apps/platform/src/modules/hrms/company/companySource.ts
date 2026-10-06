// Where the HRMS company selector gets its list of companies (the one adapter; CurrentCompany.tsx uses it).
//
// GET /v1/me/companies (company-access contract §2): the companies the caller may access, their role
// there and their home company. Only a list from there turns on the X-Company-Id header (`fromMe`).
// A server without it (the web app deployed before the backend) is answered from the older list:
// GET /v1/hrms/companies for people who may read it, else the person's own company (useOrg's
// companiesQuery, so it shares that cache entry), narrowed as the server narrows it — only
// workspace-wide people (and logins with no employee record) get every company.
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { CURRENT_USER_KEY, type CurrentUser } from '@/shared/hooks/useCurrentUser'
import { companiesQuery } from '../api/useOrg'

/** A company the signed-in person may work in. */
export interface AccessibleCompany {
  id: string
  name: string
  /** The person's role(s) in this company by name, when the server says (GET /v1/me/companies). */
  role?: string | null
}

export interface AccessibleCompanies {
  companies: AccessibleCompany[]
  /** The person's own (home) company: the default current company. Null when unknown. */
  homeId: string | null
  /** The list came from GET /v1/me/companies: the server knows X-Company-Id (and its CORS allows it). */
  fromMe?: boolean
}

export type CompanySource = 'hrms-companies' | 'me-companies'

/** Which list the selector uses: GET /v1/me/companies ('hrms-companies': the older list only). */
export const COMPANY_SOURCE: CompanySource = 'me-companies'

/** Roles that work across every company (company-access contract §2, "allCompanies"). */
export const WORKSPACE_WIDE_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'COMPANY_ADMIN', 'HR_MANAGER', 'FINANCE_LEAD'] as const
export const isWorkspaceWide = (roles: readonly string[] | null | undefined) =>
  (roles ?? []).some((r) => (WORKSPACE_WIDE_ROLES as readonly string[]).includes(r))

/** The selector's list sits under ['hrms', 'companies'], so saving a company refreshes it too. */
export const ACCESSIBLE_COMPANIES_KEY = ['hrms', 'companies', 'accessible'] as const

type ApiFetch = <T>(path: string, init?: RequestInit) => Promise<T>

/** The person's own company id from /v1/users/me (shared with useCurrentUser); null if that can't be read. */
async function ownCompanyId(qc: QueryClient, api: ApiFetch): Promise<string | null> {
  try {
    const me = await qc.fetchQuery<CurrentUser>({ queryKey: CURRENT_USER_KEY, queryFn: () => api<CurrentUser>('/v1/users/me'), staleTime: 60_000 })
    return me?.companyId ?? null
  } catch {
    return null
  }
}

/**
 * GET /v1/me/companies (_results/company-access-contract.md §2): active companies, home first, each
 * with the person's roles there. Workspace-wide people ("allCompanies") get no role line: their roles
 * are the same everywhere.
 */
interface MeCompanyRole { code?: string; name?: string | null; source?: string }
interface MeCompanyRow { companyId?: string; id?: string; name?: string; companyName?: string; home?: boolean; access?: string; roles?: (MeCompanyRole | string)[] | null }
interface MeCompaniesBody { homeCompanyId?: string | null; allCompanies?: boolean; companies?: MeCompanyRow[] }

const roleNames = (roles: MeCompanyRow['roles']): string | null =>
  (roles ?? []).map((r) => (typeof r === 'string' ? r : r.name || r.code || '')).filter(Boolean).join(', ') || null

export function readMeCompanies(body: MeCompaniesBody | MeCompanyRow[] | null): AccessibleCompanies {
  const rows = Array.isArray(body) ? body : body?.companies ?? []
  const everywhere = !Array.isArray(body) && !!body?.allCompanies
  const companies = rows
    .map((r) => ({ id: r.companyId ?? r.id ?? '', name: r.name ?? r.companyName ?? '', role: everywhere || r.access === 'WORKSPACE' ? null : roleNames(r.roles) }))
    .filter((c) => c.id)
  const flagged = rows.find((r) => r.home)
  const homeId = (!Array.isArray(body) && body?.homeCompanyId) || (flagged ? flagged.companyId ?? flagged.id ?? null : null)
  return { companies, homeId: homeId || null }
}

/**
 * The query behind the selector. `canList` = the caller holds a company-list permission
 * (useOrg's COMPANY_LIST_PERMISSIONS) and `wide` = a workspace-wide role (isWorkspaceWide); only the
 * older list uses them (the server decides for GET /v1/me/companies).
 */
export function accessibleCompaniesQuery(
  canList: boolean, qc: QueryClient, source: CompanySource = COMPANY_SOURCE, api: ApiFetch = apiJson, wide = true,
): { queryKey: QueryKey; queryFn: () => Promise<AccessibleCompanies> } {
  const older = async (): Promise<AccessibleCompanies> => {
    // fetchQuery: the same cache entry as useCompanies, so pages that still read it cost no second call.
    const list = await qc.fetchQuery({ ...companiesQuery(canList, qc, api), staleTime: 30_000 })
    const homeId = await ownCompanyId(qc, api)
    const companies = list.map((c) => ({ id: c.id, name: c.name }))
    const own = companies.filter((c) => c.id === homeId)
    return { companies: !wide && own.length ? own : companies, homeId }
  }
  if (source === 'me-companies') {
    return {
      queryKey: [...ACCESSIBLE_COMPANIES_KEY, 'me', canList ? 'list' : 'own', wide ? 'all' : 'mine'],
      queryFn: async () => {
        let body: MeCompaniesBody | MeCompanyRow[]
        try {
          body = await api<MeCompaniesBody | MeCompanyRow[]>('/v1/me/companies')
        } catch {
          // Not on this server yet (or failing): the older list, and no X-Company-Id.
          return older()
        }
        const read = readMeCompanies(body)
        // An empty answer is no answer: keep the pages working on the older list.
        return read.companies.length ? { ...read, fromMe: true } : older()
      },
    }
  }
  return { queryKey: [...ACCESSIBLE_COMPANIES_KEY, canList ? 'list' : 'own', wide ? 'all' : 'mine'], queryFn: older }
}

/**
 * Cached data that does not depend on the company and survives a switch: the signed-in person,
 * the company lists, workspace-wide settings and roles. Everything else is dropped on a switch.
 */
export function isCompanyNeutral(key: QueryKey): boolean {
  const [root, second] = key as readonly unknown[]
  if (root === 'hrms') return second === 'companies'
  if (root === 'employee') return second === 'me'
  return root === 'user' || root === 'module-plans' || root === 'workspace' || root === 'rbac'
}
