// The org chart's own page, for every role (route /hrms/org-chart; the lead
// wires the route and the registry entry). Also shown as the "Org chart"
// sub-tab of Organization Setup (master/MasterContainer).
//   ?co=<companyId>     the company to show (people with hrms.employee.read)
//   ?focus=<employeeId> open the chart on this person ("View in org chart" links)
import { useCallback, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageFrame, PageHeader } from '@/design/kit/display'
import { OrgChartView } from './OrgChartView'
import { plural } from './orgTree'
import type { OrgChartData } from './useOrgChart'

/** The one line under the title, from what the chart shows. */
export function orgChartSubline(data: OrgChartData | null): string {
  if (!data) return 'Who reports to whom, from the top person down.'
  if (data.scope === 'COMPANY') {
    return `${plural(data.people.length, 'person', 'people')} in ${data.companyName ?? 'this company'}, from the top person down.`
  }
  const above = data.people.filter((p) => p.relation === 'ABOVE').length
  const below = data.people.filter((p) => p.relation === 'BELOW').length
  if (!above && !below) return 'Your reporting line: no one above or below you on the chart yet.'
  const parts = [above ? `${plural(above, 'person', 'people')} above you` : '', below ? `${plural(below, 'person', 'people')} below you` : ''].filter(Boolean)
  return `Your reporting line: ${parts.join(' and ')}.`
}

/** The chart with the page's own address: the company and the person to open on. */
export function useOrgChartParams() {
  const [params, setParams] = useSearchParams()
  const companyId = params.get('co') || null
  const focusId = params.get('focus') || null
  const setCompany = useCallback((id: string) => setParams((cur) => {
    const n = new URLSearchParams(cur)
    n.set('co', id)
    n.delete('focus')
    return n
  }, { replace: true }), [setParams])
  return { companyId, focusId, setCompany }
}

export function OrgChartPage() {
  const { companyId, focusId, setCompany } = useOrgChartParams()
  const [data, setData] = useState<OrgChartData | null>(null)
  return (
    <PageFrame width="wide" label="Org chart" gap={18}>
      <PageHeader eyebrow="Organization" title="Org chart" sub={orgChartSubline(data)} />
      <OrgChartView companyId={companyId} onCompanyChange={setCompany} focusId={focusId} onLoaded={setData} />
    </PageFrame>
  )
}

/**
 * The "Org chart" sub-tab of Organization Setup: the Master page's own header
 * (title and the section's tabs, drawn by `renderHero`) and the chart.
 */
export function OrgChartSection({ renderHero }: { renderHero: (sub: string) => ReactNode }) {
  const { companyId, focusId, setCompany } = useOrgChartParams()
  const [data, setData] = useState<OrgChartData | null>(null)
  return (
    <>
      {renderHero(orgChartSubline(data))}
      <OrgChartView embedded companyId={companyId} onCompanyChange={setCompany} focusId={focusId} onLoaded={setData} />
    </>
  )
}

export default OrgChartPage
