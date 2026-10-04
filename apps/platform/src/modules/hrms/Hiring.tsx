// Hiring (/hrms/hiring) on the redesign kit (P-HIRE; prototype PgTalent h-pipe). Today's
// views, in today's order, as in-page pills kept in ?tab= (the module's pages are the top
// tabs): Pipeline · Requisitions · Interviews · Offers.
//   - Pipeline, Requisitions, Interviews: hrms.hiring.read.
//   - Offers carry salary, so they need hrms.hiring.offer.read (the API no longer
//     accepts plain hiring.read for them).
// Each view's main action sits in the page header, as in the design: Add a candidate
// (candidate.write), Open requisition (hiring.write), Schedule interview
// (interview.write), Create offer (offer.write or hiring.write).
import React, { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { Button, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { useView } from '@/design/module/ModuleKit'
import { PipelineTab } from './hiring/PipelineTab'
import { RequisitionsTab } from './hiring/RequisitionsTab'
import { InterviewsTab } from './hiring/Interviews'
import { OffersTab } from './hiring/OffersTab'
import './hiring/hiring.css'

type Tab = 'pipeline' | 'requisitions' | 'interviews' | 'offers'

const SUB: Record<Tab, string> = {
  pipeline: 'Open roles, move candidates through the stages, and make offers.',
  requisitions: 'Roles you’re hiring for, with how many people each needs.',
  interviews: 'Interviews you’ve been asked to take. Fill in your scorecard once each one has started.',
  offers: 'Track offer drafts, issue status and candidate decisions.',
}

export const Hiring: React.FC = () => {
  const canRead = usePermission('hrms.hiring.read')
  const canWrite = usePermission('hrms.hiring.write')
  const canCandidateWrite = usePermission('hrms.hiring.candidate.write')
  const canInterviewWrite = usePermission('hrms.hiring.interview.write')
  const canOfferRead = usePermission('hrms.hiring.offer.read')
  const canOfferWrite = usePermission('hrms.hiring.offer.write') || canWrite
  const views = [
    ...(canRead ? [{ key: 'pipeline', label: 'Pipeline' }, { key: 'requisitions', label: 'Requisitions' }, { key: 'interviews', label: 'Interviews' }] : []),
    ...(canOfferRead ? [{ key: 'offers', label: 'Offers' }] : []),
  ]
  // The dashboard's older ?tab=candidates links fall back to the first view: the pipeline.
  const [tab, setTab] = useView(views.map((v) => v.key), 'tab') as [Tab, (k: string) => void]
  // Links inside this page (a requisition's candidates, an interview's "Open pipeline")
  // navigate within the same route, and useView only reads the URL when the page
  // loads, so follow ?tab= on every in-app navigation.
  const location = useLocation()
  useEffect(() => {
    const next = new URLSearchParams(location.search).get('tab')
    if (next && next !== tab && views.some((v) => v.key === next)) setTab(next)
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps
  // The header's main action opens the view's panel.
  const [creating, setCreating] = useState<Tab | null>(null)
  const action = tab === 'pipeline' && canCandidateWrite ? 'Add a candidate'
    : tab === 'requisitions' && canWrite ? 'Open requisition'
      : tab === 'interviews' && canInterviewWrite ? 'Schedule interview'
        : tab === 'offers' && canOfferWrite ? 'Create offer' : null
  const done = () => setCreating(null)
  return (
    <PageFrame label="Hiring" className="hi-page">
      <PageHeader eyebrow="Hiring & onboarding" title="Hiring" sub={views.length ? SUB[tab] : undefined}
        actions={action ? <Button variant="primary" size={40} icon="plus" onClick={() => setCreating(tab)}>{action}</Button> : undefined} />
      {views.length > 1 && <PillTabs label="Hiring views" semantics="toggle" activeKey={tab} onSelect={(k) => { setCreating(null); setTab(k) }} items={views} />}
      {views.length === 0 && <EmptyState icon="lock" title="No hiring access" hint="Ask an admin if you should see open roles or candidates." />}
      {tab === 'pipeline' && canRead && <PipelineTab adding={creating === 'pipeline'} onAddDone={done} />}
      {tab === 'requisitions' && canRead && <RequisitionsTab creating={creating === 'requisitions'} onCreateDone={done} />}
      {tab === 'interviews' && canRead && <InterviewsTab scheduling={creating === 'interviews'} onScheduleDone={done} />}
      {tab === 'offers' && canOfferRead && <OffersTab creating={creating === 'offers'} onCreateDone={done} />}
    </PageFrame>
  )
}
