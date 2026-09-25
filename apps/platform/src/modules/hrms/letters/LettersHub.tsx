// Letters (/hrms/letters) on the module kit: one page with a view per job.
//   - Templates (hrms.letters.template.read): reusable letters with merge fields.
//   - Generated letters (hrms.letters.read): every letter issued in the workspace.
//   - Distributions (hrms.letters.distribute or hrms.letters.read): one letter sent to many people.
//   - My letters (hrms.letters.read.self): letters issued to the signed-in person.
// The view lives in the path, so the old routes keep working and open the right
// view: /hrms/letters/templates, /generated, /distributions, plus /my. Someone
// who can only read their own letters and follows an old /generated link lands
// on My letters, as the old page did. Detail pages (a template, a letter, a
// distribution) keep their own routes.
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton } from '@/shared/components/hr'
import { ModulePage, Views, State, type ViewTab } from '@/design/module/ModuleKit'
import { LetterTemplatesList } from './LetterTemplates'
import { GeneratedLettersList } from './GeneratedLetters'
import { DistributionsList } from './Distributions'
import { GenerateLetterDrawer } from './GenerateLetterDrawer'
import { DistributionWizard } from './DistributionWizard'
import { resolveLetterView, type LetterView, type LetterAccess } from './lettersView'

const SUBTITLE: Record<LetterView, string> = {
  templates: 'Reusable letters with merge fields, like {{employee.fullName}}. Generate a letter from any active template.',
  generated: 'Every letter issued in the workspace. Open one to send, download or void it.',
  distributions: 'One letter sent to many people in a single action, with who received it.',
  my: 'Letters HR has issued to you, like offer, appointment and experience letters.',
}

export function LettersHub() {
  const navigate = useNavigate()
  const { view: requested } = useParams()
  const [params, setParams] = useSearchParams()
  const access: LetterAccess = {
    templates: usePermission('hrms.letters.template.read'),
    readAll: usePermission('hrms.letters.read'),
    readSelf: usePermission('hrms.letters.read.self'),
    distribute: usePermission('hrms.letters.distribute'),
  }
  const canCreateTemplate = usePermission('hrms.letters.template.create')
  const canGenerate = usePermission('hrms.letters.generate')
  const { views, active } = resolveLetterView(requested, access)
  const items: ViewTab[] = views.map((k) => ({
    templates: { key: k, label: 'Templates', icon: 'filePen', tip: 'Reusable letters with merge fields' },
    generated: { key: k, label: 'Generated letters', icon: 'fileText', tip: 'Every letter issued in the workspace' },
    distributions: { key: k, label: 'Distributions', icon: 'megaphone', tip: 'One letter sent to many people' },
    my: { key: k, label: 'My letters', icon: 'inbox', tip: 'Letters issued to you' },
  }[k]))

  // Deep link from an employee's Letters tab: ?employeeId=<id> opens "Generate letter" for them.
  const employeeIdParam = params.get('employeeId') ?? ''
  const [generateOpen, setGenerateOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  useEffect(() => { if (employeeIdParam && canGenerate) setGenerateOpen(true) }, [employeeIdParam, canGenerate])
  const closeGenerate = () => {
    setGenerateOpen(false)
    if (employeeIdParam) setParams((p) => { const n = new URLSearchParams(p); n.delete('employeeId'); return n }, { replace: true })
  }

  const onlyMine = views.length === 1 && views[0] === 'my'
  const action = active === 'templates' && canCreateTemplate
    ? <HrButton onClick={() => navigate('/hrms/letters/templates/new')}><Plus size={15} /> Create template</HrButton>
    : active === 'generated' && canGenerate
      ? <HrButton onClick={() => setGenerateOpen(true)}><Plus size={15} /> Generate letter</HrButton>
      : active === 'distributions' && access.distribute
        ? <HrButton onClick={() => setWizardOpen(true)}><Plus size={15} /> New distribution</HrButton>
        : undefined

  return (
    <ModulePage crumb={onlyMine ? 'My workspace' : 'Recruitment'} title={onlyMine ? 'My letters' : 'Letters'}
      subtitle={active ? SUBTITLE[active] : undefined} actions={action}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={items} active={active ?? ''} label="Letter views"
          onChange={(k) => navigate(`/hrms/letters/${k}`, { replace: true })} />}
        {!active && <State kind="empty" icon="lock" title="No letters access" description="Ask an admin if you should see letter templates or issued letters." />}
        {active === 'templates' && <LetterTemplatesList />}
        {active === 'generated' && <GeneratedLettersList mine={false} />}
        {active === 'distributions' && <DistributionsList />}
        {active === 'my' && <GeneratedLettersList mine />}
      </div>
      {generateOpen && <GenerateLetterDrawer onClose={closeGenerate} initialEmployeeId={employeeIdParam} />}
      {wizardOpen && (
        <DistributionWizard
          onClose={() => setWizardOpen(false)}
          onCreated={(id) => { setWizardOpen(false); navigate(`/hrms/letters/distributions/${id}`) }}
        />
      )}
    </ModulePage>
  )
}
