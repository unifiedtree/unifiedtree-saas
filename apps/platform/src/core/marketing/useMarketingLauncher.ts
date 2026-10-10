import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore as useSdkStore } from '@unifiedtree/sdk'
import { useCurrentCompany } from '@/modules/hrms/company/CurrentCompany'
import {
  MARKETING_APP_ORIGIN, MarketingLaunchError, createAccountSessionStore, launchPlan, launcherEnabled, loadMarketingChoices,
  marketingCompanies, openMarketing, type FetchLike, type MarketingCompany, type MarketingErrorCode,
} from './marketingLauncher'

const doFetch: FetchLike = (input, init) => fetch(input, init)

/** One account session for the whole page (the launcher grid and the business frame share it). */
export const marketingSessions = createAccountSessionStore(doFetch)

/** Sign-out (AuthProvider): the account session must not outlive the workspace one in this tab. */
export function resetMarketingSession() { marketingSessions.reset() }

export interface MarketingLauncher {
  /** Show the Marketing tile: this build names Marketing and the person has at least one company with it. */
  visible: boolean
  /** This business's companies with Marketing, the current one first. */
  companies: MarketingCompany[]
  /** The company being opened (the page is about to leave). */
  busyId: string | null
  error: MarketingErrorCode | null
  chooserOpen: boolean
  /** The tile: one company opens straight away, several open the chooser. */
  start: () => void
  launch: (companyId: string) => void
  retry: () => void
  dismiss: () => void
}

/**
 * The Marketing tile's state (see marketingLauncher.ts). With VITE_MARKETING_APP_URL unset it makes no call and is
 * never visible. The list is fetched once and kept for 5 minutes; a failure only hides the tile.
 */
export function useMarketingLauncher(): MarketingLauncher {
  const origin = MARKETING_APP_ORIGIN
  const email = useSdkStore((s) => s.user?.email ?? '')
  const tenantId = useSdkStore((s) => s.tenant?.id ?? '')
  const { companyId: currentCompanyId } = useCurrentCompany()
  const enabled = launcherEnabled(origin, email, tenantId)

  const choices = useQuery({
    queryKey: ['marketing-launcher', tenantId, email.trim().toLowerCase()],
    queryFn: () => loadMarketingChoices(marketingSessions, doFetch, email),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  const companies = useMemo(
    () => (enabled && choices.data ? marketingCompanies(choices.data, tenantId, currentCompanyId) : []),
    [enabled, choices.data, tenantId, currentCompanyId],
  )

  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<MarketingErrorCode | null>(null)
  const [chooserOpen, setChooserOpen] = useState(false)
  const [lastId, setLastId] = useState<string | null>(null)

  // Back from Marketing through the browser's back button (page restored from cache): not "opening" any more
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) setBusyId(null) }
    window.addEventListener('pageshow', onShow)
    return () => window.removeEventListener('pageshow', onShow)
  }, [])

  const launch = useCallback((companyId: string) => {
    if (!origin || busyId) return
    setBusyId(companyId)
    setLastId(companyId)
    setError(null)
    openMarketing({
      sessions: marketingSessions, fetchImpl: doFetch, origin, email, tenantId, companyId,
      navigate: (url) => window.location.assign(url),
    }).catch((e: unknown) => {
      setBusyId(null)
      setError(e instanceof MarketingLaunchError ? e.code : 'UNKNOWN')
    })
  }, [origin, busyId, email, tenantId])

  const start = useCallback(() => {
    const plan = launchPlan(companies)
    setError(null)
    if (plan.kind === 'direct') launch(plan.companyId)
    else if (plan.kind === 'choose') setChooserOpen(true)
  }, [companies, launch])

  const retry = useCallback(() => { if (lastId) launch(lastId) }, [lastId, launch])
  const dismiss = useCallback(() => {
    if (busyId) return
    setChooserOpen(false)
    setError(null)
  }, [busyId])

  return { visible: companies.length > 0, companies, busyId, error, chooserOpen, start, launch, retry, dismiss }
}
