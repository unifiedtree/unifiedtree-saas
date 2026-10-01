// Generate letter, as a kit side panel (P-DOCS; prototype PgTalent `lgen`):
// the template, the employee (searched in the template's company), the issue
// date, whether to email it now or keep it as a draft, and whether to ask for a
// signature. Below, the letter exactly as it will be generated for that person
// on that date (the client's preview before saving). Generating opens the
// letter's own page, as before.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button, Callout } from '@/design/kit/display'
import { FieldGrid, Input, PanelButton, Select, SidePanel, Toggle, useToast } from '@/design/kit/overlays'
import { todayIso } from '@/design/module/ModuleKit'
import { isFeatureNotReady } from '@/core/api/featureNotReady'
import { useWorkforceEmployee, type WorkforceEmployee } from '../api/useWorkforce'
import { useGenerateLetter, useLetterTemplates, type LetterTemplateDto } from './api/useLetters'
import { LETTER_TYPE_LABEL } from './lettersModel'
import { PersonSearch, fullName } from './components/PersonSearch'
import { LetterPreviewPane } from './components/LetterPreviewPane'

export function GenerateLetterDrawer({ onClose, initialEmployeeId = '', signaturesReady = true }: {
  onClose: () => void
  initialEmployeeId?: string
  /** False while signatures aren't switched on: the switch is hidden. */
  signaturesReady?: boolean
}) {
  const navigate = useNavigate()
  const toast = useToast()
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const canReadTemplates = usePermission(P.HRMS_LETTERS_TEMPLATE_READ)
  const canCreateTemplate = usePermission(P.HRMS_LETTERS_TEMPLATE_CREATE)
  const canSend = usePermission(P.HRMS_LETTERS_SEND)
  const [templatePage, setTemplatePage] = useState(0)
  const templates = useLetterTemplates(templatePage, { enabled: canReadTemplates })
  const active = (templates.data?.content ?? []).filter((t) => t.active)
  const [template, setTemplate] = useState<LetterTemplateDto | null>(null)
  const [employee, setEmployee] = useState<WorkforceEmployee | null>(null)
  const initialEmployee = useWorkforceEmployee(canReadEmployees ? initialEmployeeId : undefined)
  const person = employee || initialEmployee.data || null
  const [issueDate, setIssueDate] = useState(todayIso())
  const [sendNow, setSendNow] = useState(false)
  const [ask, setAsk] = useState(false)
  const [tried, setTried] = useState(false)
  const generate = useGenerateLetter()
  const sameCompany = !person || !template || person.companyId === template.companyId

  const problems = {
    template: !template ? 'Choose a template.' : null,
    person: !person ? 'Choose the employee.' : !sameCompany ? 'This person belongs to a different company. Choose someone listed, or another template.' : null,
    date: !issueDate ? 'Choose the issue date.' : null,
  }
  const blocked = problems.template || problems.person || problems.date

  const submit = async () => {
    setTried(true)
    if (blocked || !template || !person) return
    try {
      const result = await generate.mutateAsync({
        templateId: template.id, employeeId: person.id, issueDate,
        sendImmediately: canSend && sendNow, ...(ask ? { requestSignature: true } : {}),
      })
      toast.success(sendNow && canSend ? `Letter generated and sent to ${fullName(person)}` : 'Letter generated')
      onClose()
      navigate(`/hrms/letters/generated/${result.id}`)
    } catch (e) {
      if (isFeatureNotReady(e)) toast.info('Asking for a signature isn’t switched on yet. Nothing was generated.')
      else toast.error('Couldn’t generate the letter', { detail: (e as Error)?.message })
    }
  }

  const templateOptions = [{ value: '', label: templates.isLoading ? 'Loading templates…' : active.length ? 'Choose a template' : 'No active templates' },
    ...active.map((t) => ({ value: t.id, label: `${t.name}${t.variantName ? ` · ${t.variantName}` : ''}` }))]

  return (
    <SidePanel open onClose={() => { if (!generate.isPending) onClose() }} width={760} busy={generate.isPending} closeLabel="Close panel"
      title="Generate letter" sub="Pick a template and a person. You can send it now or keep it as a draft."
      footer={<>
        <PanelButton size="lg" onClick={onClose} disabled={generate.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={generate.isPending} blockedReason={blocked} tipAlign="end" onBlockedClick={() => setTried(true)} onClick={submit}>
          Generate letter</PanelButton>
      </>}>
      <div className="lt-stack">
        {!canReadTemplates ? <Callout tone="neutral">You need access to letter templates to generate a letter.</Callout>
          : templates.isError ? <Callout tone="danger">{(templates.error as Error)?.message || 'Couldn’t load the templates.'}{' '}
            <button type="button" className="lt-link" onClick={() => templates.refetch()}>Try again</button></Callout> : null}
        <FieldGrid columns={2}>
          <Select label="Template" full value={template?.id ?? ''} options={templateOptions} error={tried ? problems.template ?? undefined : undefined}
            onChange={(e) => setTemplate(active.find((t) => t.id === e.target.value) ?? null)}
            hint={template ? `${LETTER_TYPE_LABEL[template.type] ?? template.type} · ${template.subject}` : undefined} />
        </FieldGrid>
        {(templates.data?.totalPages ?? 0) > 1 && (
          <div className="lt-row-end">
            <Button size={30} variant="ghost" disabled={templatePage === 0} onClick={() => setTemplatePage((p) => p - 1)}>Earlier templates</Button>
            <Button size={30} variant="ghost" disabled={templatePage >= (templates.data?.totalPages ?? 1) - 1} onClick={() => setTemplatePage((p) => p + 1)}>More templates</Button>
          </div>
        )}
        {!active.length && !templates.isLoading && canCreateTemplate && (
          <Callout tone="neutral">No active templates on this page. <button type="button" className="lt-link" onClick={() => navigate('/hrms/letters/templates/new')}>Create a template</button></Callout>
        )}

        <div className="lt-field-block">
          <p className="lt-label">Employee</p>
          {person && <p className="lt-chosen"><strong>{fullName(person)}</strong><span className="lt-muted"> {person.employeeCode}</span></p>}
          {initialEmployee.isError && <Callout tone="danger">{(initialEmployee.error as Error)?.message}</Callout>}
          {!template ? <p className="lt-muted lt-small">Choose a template first to find people in its company.</p>
            : <PersonSearch selectedId={person?.id} companyId={template.companyId} onPick={setEmployee} />}
          {tried && problems.person && <p role="alert" className="lt-error">{problems.person}</p>}
          {!tried && !sameCompany && <p role="alert" className="lt-error">{problems.person}</p>}
        </div>

        <FieldGrid columns={2}>
          <Input label="Issue date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)}
            hint="Letters print this date wherever they say today’s date." error={tried ? problems.date ?? undefined : undefined} />
          {canSend && <Select label="Send by email" value={sendNow ? 'yes' : 'no'} onChange={(e) => setSendNow(e.target.value === 'yes')}
            options={[{ value: 'no', label: 'No, keep as draft' }, { value: 'yes', label: 'Yes, email it now' }]} />}
        </FieldGrid>
        {signaturesReady && <Toggle checked={ask} onChange={setAsk} label="Ask for a signature"
          description={sendNow ? 'They’re told now, and sign in My letters by typing their name.' : 'They’re asked once you send it. They sign in My letters by typing their name.'} />}

        <LetterPreviewPane title="Preview" employeeLocked
          sub="The letter as it will be generated for this person, on this date. Nothing is saved until you generate it."
          request={{ templateId: template?.id, employeeId: person?.id, issueDate }}
          ready={!!template && !!person && sameCompany}
          emptyHint="Choose a template and a person to see the letter." />
      </div>
    </SidePanel>
  )
}
