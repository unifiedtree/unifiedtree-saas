// Letters (/hrms/letters) on the kit (P-DOCS; prototype PgTalent h-letters and
// EmpDocs e-letters): one page with a view per job, as inline pill tabs.
//   - Templates (hrms.letters.template.read): reusable letters with merge fields.
//   - Generated letters (hrms.letters.read): every letter issued in the workspace.
//   - Distributions (hrms.letters.distribute or hrms.letters.read): one letter sent to many people.
//   - My letters (hrms.letters.read.self): letters sent to the signed-in person, as cards to read and sign.
// The view lives in the path, so the old routes keep working and open the right
// view: /hrms/letters/templates, /generated, /distributions, plus /my. Someone
// who can only read their own letters and follows an old /generated link lands
// on My letters. Detail pages (a template, a letter, a distribution) keep their
// own routes. ?employeeId= opens "Generate letter" for that person.
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { usePersonalPages } from '@/shared/hooks/usePersonalPages'
import { Button, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { LetterTemplatesList } from './LetterTemplates'
import { GeneratedLettersList, signaturesReadyFrom } from './GeneratedLetters'
import { DistributionsList } from './Distributions'
import { GenerateLetterDrawer } from './GenerateLetterDrawer'
import { DistributionWizard } from './DistributionWizard'
import { resolveLetterView, type LetterView, type LetterAccess } from './lettersView'
import type { GeneratedLetterDto, PageResponse } from './api/useLetters'
import './components/letters.css'

const SUBTITLE: Record<LetterView, string> = {
  templates: 'Reusable letters with merge fields, like {{employee.fullName}}. Generate a letter from any active template.',
  generated: 'Every letter issued in the workspace. Open one to send, download or void it.',
  distributions: 'One letter sent to many people in a single action, with who received it.',
  my: 'Letters HR has sent you. Sign the ones that need your signature.',
}
const LABEL: Record<LetterView, string> = { templates: 'Templates', generated: 'Generated letters', distributions: 'Distributions', my: 'My letters' }

export function LettersHub() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { view: requested } = useParams()
  const [params, setParams] = useSearchParams()
  // My letters: by default not for owners and admins (the personal pages rule, usePersonalPages: the owner sets it per role).
  const personal = usePersonalPages()
  const access: LetterAccess = {
    templates: usePermission('hrms.letters.template.read'),
    readAll: usePermission('hrms.letters.read'),
    readSelf: usePermission('hrms.letters.read.self') && personal,
    distribute: usePermission('hrms.letters.distribute'),
  }
  const canCreateTemplate = usePermission('hrms.letters.template.create')
  const canGenerate = usePermission('hrms.letters.generate')
  const { views, active } = resolveLetterView(requested, access)

  // Deep link from an employee's Letters tab: ?employeeId=<id> opens "Generate letter" for them.
  const employeeIdParam = params.get('employeeId') ?? ''
  const [generateOpen, setGenerateOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  useEffect(() => { if (employeeIdParam && canGenerate) setGenerateOpen(true) }, [employeeIdParam, canGenerate])
  const closeGenerate = () => {
    setGenerateOpen(false)
    if (employeeIdParam) setParams((p) => { const n = new URLSearchParams(p); n.delete('employeeId'); return n }, { replace: true })
  }
  // Whether signatures are switched on, read from the letters already loaded (their signatureRequested field).
  const firstPage = qc.getQueryData<PageResponse<GeneratedLetterDto>>(['hrms', 'letters', 'generated', 0])

  const onlyMine = views.length === 1 && views[0] === 'my'
  const action = active === 'templates' && canCreateTemplate
    ? <Button variant="primary" icon="plus" onClick={() => navigate('/hrms/letters/templates/new')}>Create template</Button>
    : active === 'generated' && canGenerate
      ? <Button variant="primary" icon="plus" onClick={() => setGenerateOpen(true)}>Generate letter</Button>
      : active === 'distributions' && access.distribute
        ? <Button variant="primary" icon="plus" onClick={() => setWizardOpen(true)}>New distribution</Button>
        : undefined

  return (
    <PageFrame label="Letters" width={onlyMine ? 'narrow' : 'wide'} className="lt-page">
      <PageHeader eyebrow={onlyMine ? undefined : 'Hiring & onboarding'} title={onlyMine ? 'My letters' : 'Letters'}
        sub={active ? SUBTITLE[active] : undefined} actions={action} />
      {views.length > 1 && (
        <PillTabs label="Letter views" semantics="toggle" activeKey={active}
          onSelect={(k) => navigate(`/hrms/letters/${k}`, { replace: true })}
          items={views.map((k) => ({ key: k, label: LABEL[k] }))} />
      )}
      {!active && <EmptyState icon="lock" title="No letters access" hint="Ask an admin if you should see letter templates or issued letters." />}
      {active === 'templates' && <LetterTemplatesList />}
      {active === 'generated' && <GeneratedLettersList mine={false} />}
      {active === 'distributions' && <DistributionsList />}
      {active === 'my' && <GeneratedLettersList mine />}
      {generateOpen && <GenerateLetterDrawer onClose={closeGenerate} initialEmployeeId={employeeIdParam} signaturesReady={signaturesReadyFrom(firstPage?.content)} />}
      {wizardOpen && (
        <DistributionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => { setWizardOpen(false); navigate(`/hrms/letters/distributions/${id}`) }}
        />
      )}
    </PageFrame>
  )
}
