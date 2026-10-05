// Where the HRMS company selector gets its list of companies (the one adapter; CurrentCompany.tsx uses it).
//
// Today: GET /v1/hrms/companies for people who may read it, else the person's own company (useOrg's
// companiesQuery, so it shares that cache entry), with the person's own company as their home company.
// Next: GET /v1/me/companies (the companies the caller may access, their role there and their home
// company). Switching is the one line `COMPANY_SOURCE` below.
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import { CURRENT_USER_KEY, type CurrentUser } from '@/shared/hooks/useCurrentUser'
import { companiesQuery } from '../api/useOrg'

/** A company the signed-in person may work in. */
export interface AccessibleCompany {
  id: string
  name: string
  /** The person's role in this company, when the server says (GET /v1/me/companies). */
  role?: string | null
}

export interface AccessibleCompanies {
  companies: AccessibleCompany[]
  /** The person's own (home) company: the default current company. Null when unknown. */
  homeId: string | null
}

export type CompanySource = 'hrms-companies' | 'me-companies'

/** Which list the selector uses. 'me-companies' once GET /v1/me/companies is live everywhere. */
export const COMPANY_SOURCE: CompanySource = 'hrms-companies'

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

/** One row of GET /v1/me/companies, read leniently (the field names are the contract's). */
interface MeCompanyRow { companyId?: string; id?: string; companyName?: string; name?: string; role?: string | null; roles?: string[] | null; home?: boolean; homeCompany?: boolean }
interface MeCompaniesBody { companies?: MeCompanyRow[]; homeCompanyId?: string | null }

export function readMeCompanies(body: MeCompaniesBody | MeCompanyRow[] | null): AccessibleCompanies {
  const rows = Array.isArray(body) ? body : body?.companies ?? []
  const companies = rows
    .map((r) => ({ id: r.companyId ?? r.id ?? '', name: r.companyName ?? r.name ?? '', role: r.role ?? r.roles?.[0] ?? null }))
    .filter((c) => c.id)
  const flagged = rows.find((r) => r.home || r.homeCompany)
  const homeId = (!Array.isArray(body) && body?.homeCompanyId) || (flagged ? flagged.companyId ?? flagged.id ?? null : null)
  return { companies, homeId: homeId || null }
}

/**
 * The query behind the selector. `canList` = the caller holds a company-list permission
 * (useOrg's COMPANY_LIST_PERMISSIONS); only the 'hrms-companies' source uses it.
 */
export function accessibleCompaniesQuery(
  canList: boolean, qc: QueryClient, source: CompanySource = COMPANY_SOURCE, api: ApiFetch = apiJson,
): { queryKey: QueryKey; queryFn: () => Promise<AccessibleCompanies> } {
  if (source === 'me-companies') {
    return {
      queryKey: [...ACCESSIBLE_COMPANIES_KEY, 'me'],
      queryFn: async () => readMeCompanies(await api<MeCompaniesBody | MeCompanyRow[]>('/v1/me/companies')),
    }
  }
  return {
    queryKey: [...ACCESSIBLE_COMPANIES_KEY, canList ? 'list' : 'own'],
    queryFn: async () => {
      // fetchQuery: the same cache entry as useCompanies, so pages that still read it cost no second call.
      const list = await qc.fetchQuery({ ...companiesQuery(canList, qc, api), staleTime: 30_000 })
      return { companies: list.map((c) => ({ id: c.id, name: c.name })), homeId: await ownCompanyId(qc, api) }
    },
  }
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
