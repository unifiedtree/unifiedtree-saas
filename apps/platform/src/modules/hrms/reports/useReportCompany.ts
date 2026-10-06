// The company filter every report page and Workforce Analytics share. The
// choice lives in the URL (?co=) so links between reports keep it. People
// whose role can't list companies (no org.company.read) get their own company,
// locked, instead of a dropdown that can only fail. With two or more companies the report is on the
// company the top bar's selector is on (`global`), and the page shows no company dropdown of its own.
import { useSearchParams } from 'react-router-dom'
import { useCompanies } from '@/modules/hrms/api/useOrg'
import { useCurrentCompany } from '@/modules/hrms/company/CurrentCompany'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'

export function useReportCompany() {
  const [params, setParams] = useSearchParams()
  const list = useCompanies()
  const status = (list.error as { status?: number } | null)?.status
  const locked = !!list.error && (status === 403 || /403|forbidden|access/i.test((list.error as Error).message || ''))
  const me = useCurrentUser()
  const options = locked
    ? (me.data?.companyId ? [{ value: me.data.companyId, label: me.data.companyName || 'Your company' }] : [])
    : (list.data ?? []).map((c) => ({ value: c.id, label: c.name }))
  // ?co= (and the older ?company= links) pick the company.
  const fromUrl = params.get('co') || params.get('company') || ''
  const current = useCurrentCompany()
  const global = current.multi && !locked && options.some((o) => o.value === current.companyId)
  const company = global ? current.companyId : fromUrl && options.some((o) => o.value === fromUrl) ? fromUrl : options[0]?.value || ''
  const setCompany = (v: string) => setParams((p) => { const n = new URLSearchParams(p); n.set('co', v); n.delete('company'); return n }, { replace: true })
  const companyName = options.find((o) => o.value === company)?.label || ''
  return { options, company, companyName, setCompany, locked, global, loading: list.isLoading || (locked && me.isLoading) }
}

/** "Acme Retail Pvt Ltd" → "acme-retail-pvt-ltd", for file names. */
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'
