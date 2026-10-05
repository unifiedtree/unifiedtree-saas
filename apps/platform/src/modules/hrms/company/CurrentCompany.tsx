// The HRMS's one current company (master context §9: the company selector is global). Every HRMS
// page reads it with useCurrentCompany() instead of taking the first company or keeping a picker of
// its own; the top bar's selector (design/shell/CompanySwitcher) changes it.
//
//   - the list: the companies the person may work in (companySource.ts, the one adapter)
//   - the default: the person's home company, else the first one
//   - remembered per person (localStorage; a private window just starts on the default)
//   - a link's ?co=<id> opens that company (master and report links carry it)
//   - a switch drops what was loaded for the other company and shows the page again from scratch
//     (PlatformShell keys its page on `version`), so nothing from the previous company stays on screen
//
// A workspace with one company has no switch: the same company, the same data and no selector.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAnyPermission, useAuthStore } from '@unifiedtree/sdk'
import { setCompanyHeader } from '@/core/api/client'
import { useAccessContext } from '@/shared/navigation/useAccess'
import { COMPANY_LIST_PERMISSIONS, useCompanies } from '../api/useOrg'
import { COMPANY_SOURCE, accessibleCompaniesQuery, isCompanyNeutral, type AccessibleCompany, type CompanySource } from './companySource'

export interface CurrentCompanyValue {
  /** The companies the person may work in. */
  companies: AccessibleCompany[]
  /** The current company (null until the list has loaded, or when there is none). */
  company: AccessibleCompany | null
  /** Its id; '' until known. */
  companyId: string
  /** Switch to another company in the list (ignored for anything else). */
  setCompany: (id: string) => void
  /** Two or more companies: the selector shows. */
  multi: boolean
  isLoading: boolean
  error: unknown
  /** Goes up by one on every switch. */
  version: number
}

const CurrentCompanyContext = createContext<CurrentCompanyValue | null>(null)
const NONE: AccessibleCompany[] = []

/** Where a person's choice is kept: per workspace and per person. */
export const companyStorageKey = (tenantId: string, userId: string) => `ut.hrms.company:${tenantId}:${userId}`

function readStored(key: string): string | null {
  if (!key) return null
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStored(key: string, id: string) {
  if (!key) return
  try { localStorage.setItem(key, id) } catch { /* private window or storage blocked: the choice lasts this visit */ }
}

/** The chosen company if it is in the list, else the home company, else the first. */
export function resolveCompany(list: readonly AccessibleCompany[], chosen: string | null, homeId: string | null): string {
  const ok = (id: string | null): id is string => !!id && list.some((c) => c.id === id)
  if (ok(chosen)) return chosen
  if (ok(homeId)) return homeId
  return list[0]?.id ?? ''
}

export interface CurrentCompanyProviderProps {
  children: ReactNode
  /** Tests: the list's source and a stand-in for the API. */
  source?: CompanySource
  api?: <T>(path: string, init?: RequestInit) => Promise<T>
}

export function CurrentCompanyProvider({ children, source = COMPANY_SOURCE, api }: CurrentCompanyProviderProps) {
  const qc = useQueryClient()
  const signedIn = useAuthStore((s) => s.status === 'authenticated')
  const userId = useAuthStore((s) => s.user?.id ?? '')
  const tenantId = useAuthStore((s) => s.tenant?.id ?? '')
  const hasHrms = useAccessContext().modules.includes('hrms')
  const canList = useAnyPermission(COMPANY_LIST_PERMISSIONS)
  const query = useQuery({ ...accessibleCompaniesQuery(canList, qc, source, api), enabled: signedIn && hasHrms, staleTime: 60_000 })
  const companies = query.data?.companies ?? NONE
  const homeId = query.data?.homeId ?? null

  const key = signedIn && userId ? companyStorageKey(tenantId, userId) : ''
  const [params, setParams] = useSearchParams()
  const urlCo = params.get('co')
  // A link's ?co= wins on arrival; otherwise the person's last choice.
  const [sel, setSel] = useState(() => ({ key, chosen: urlCo || readStored(key) }))
  if (sel.key !== key) setSel({ key, chosen: urlCo || readStored(key) })
  const [version, setVersion] = useState(0)

  const companyId = resolveCompany(companies, sel.chosen, homeId)
  // Every request after this render carries it (when the server knows the header: see client.ts).
  setCompanyHeader(source === 'me-companies' ? companyId : null)

  const switchTo = useCallback((id: string, fromUrl = false) => {
    if (id === companyId || !companies.some((c) => c.id === id)) return
    setCompanyHeader(source === 'me-companies' ? id : null)
    // Nothing loaded for the other company may show while this one's loads.
    qc.removeQueries({ predicate: (q) => !isCompanyNeutral(q.queryKey) })
    writeStored(key, id)
    setSel({ key, chosen: id })
    setVersion((v) => v + 1)
    // A page whose address names the company follows the switch.
    if (!fromUrl && params.has('co')) {
      setParams((cur) => { const next = new URLSearchParams(cur); next.set('co', id); return next }, { replace: true })
    }
  }, [companyId, companies, source, qc, key, params, setParams])

  // A link to another company (?co=) switches to it, and is remembered like a pick in the selector.
  useEffect(() => {
    if (!urlCo || !companies.some((c) => c.id === urlCo)) return
    if (urlCo !== companyId) switchTo(urlCo, true)
    else if (readStored(key) !== urlCo) writeStored(key, urlCo)
  }, [urlCo, companies, companyId, key, switchTo])

  const value = useMemo<CurrentCompanyValue>(() => ({
    companies,
    company: companies.find((c) => c.id === companyId) ?? null,
    companyId,
    setCompany: (id: string) => switchTo(id),
    multi: companies.length > 1,
    isLoading: query.isLoading,
    error: query.error,
    version,
  }), [companies, companyId, switchTo, query.isLoading, query.error, version])

  return <CurrentCompanyContext.Provider value={value}>{children}</CurrentCompanyContext.Provider>
}

const noSwitch = () => {}

/** Pages with unsaved changes for the current company: a switch asks before dropping them. */
const switchGuards = new Set<{ message: string }>()

/** While `message` is set, switching company asks "message" first (and stays put on Cancel). */
export function useCompanySwitchGuard(message: string | null) {
  useEffect(() => {
    if (!message) return
    const g = { message }
    switchGuards.add(g)
    return () => { switchGuards.delete(g) }
  }, [message])
}

/** True when nothing objects to a switch (or the person confirmed it). */
export function mayLeaveCompany(): boolean {
  for (const g of switchGuards) if (!window.confirm(g.message)) return false
  return true
}


/**
 * The current HRMS company. Under CurrentCompanyProvider (the whole app) it is the selector's
 * company; anywhere else (a page rendered on its own in a test) it is the first company of
 * useCompanies, as pages used to take it.
 */
export function useCurrentCompany(): CurrentCompanyValue {
  const ctx = useContext(CurrentCompanyContext)
  const own = useCompanies({ enabled: !ctx })
  if (ctx) return ctx
  const companies = (own.data ?? NONE).map((c) => ({ id: c.id, name: c.name }))
  return {
    companies, company: companies[0] ?? null, companyId: companies[0]?.id ?? '', setCompany: noSwitch,
    multi: companies.length > 1, isLoading: own.isLoading, error: own.error, version: 0,
  }
}
