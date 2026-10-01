// New distribution, as a kit side panel with steps (P-DOCS; prototype PgTalent
// `ldist`): one letter to many people.
//   1 Letter      the template, and a preview of it (the client's preview before saving)
//   2 Recipients  everyone, or by department, branch (BW-72), designation, employment type, or picked people
//   3 Message     the name, the email subject and a message above the attachment
//   4 Send        now, or on a later date (BW-73: it starts at 9:00 India time that day)
// The count of people is worked out here from the directory; the server picks the
// recipients again when it sends (and refuses none or more than 500).
import { useMemo, useState } from 'react'
import { Callout, FilterPills, KeyValueGrid, SegmentedControl } from '@/design/kit/display'
import { FieldGrid, Input, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { todayIso } from '@/design/module/ModuleKit'
import { useLetterTemplates } from './api/useLetters'
import { useBranches, useCompanies, useDepartments, useDesignations } from '../api/useOrg'
import { useEmployeeDirectory } from '../api/useWorkforce'
import {
  useCreateDistribution, useScheduleDistribution, useScheduledDistributions,
  type CreateDistributionRequest, type RecipientFilterType,
} from './api/useDistribution'
import { RecipientPicker } from './components/RecipientPicker'
import { LetterPreviewPane } from './components/LetterPreviewPane'
import { RECIPIENT_FILTERS, dayText, nextDay, recipientsText } from './lettersModel'

// The backend BY_EMPLOYMENT_TYPE filter resolves values via the WorkforceEmployee
// EmploymentType enum, so offer exactly those values.
const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'] as const
const typeLabel = (t: string) => t.replace('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())

function Chips({ options, selected, onToggle, empty, label }: {
  options: { value: string; label: string }[]; selected: Set<string>; onToggle: (v: string) => void; empty: string; label: string
}) {
  if (!options.length) return <p className="lt-muted lt-small">{empty}</p>
  return (
    <div className="lt-chips" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="lt-chip" aria-pressed={selected.has(o.value)} onClick={() => onToggle(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function DistributionWizard({ onClose, onCreated, onScheduled }: {
  onClose: () => void
  onCreated: (jobId: string) => void
  /** A send kept for a later date (stays on the list, as Scheduled). */
  onScheduled?: () => void
}) {
  const toast = useToast()
  const create = useCreateDistribution()
  const schedule = useScheduleDistribution()
  const scheduled = useScheduledDistributions()
  const canSchedule = !scheduled.notAvailable

  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id ?? ''
  const { data: templatesPage } = useLetterTemplates()
  const templates = (templatesPage?.content ?? []).filter((t) => t.active)
  const { data: departments = [] } = useDepartments(companyId)
  const { data: designations = [] } = useDesignations(companyId)
  const { data: branches = [] } = useBranches(companyId)
  // Tenant-wide, as the backend resolves ALL_EMPLOYEES / BY_EMPLOYMENT_TYPE across the
  // whole workspace; department, designation and branch narrow by the ids picked.
  const { data: empPage } = useEmployeeDirectory({ pageSize: 500 })
  const employees = useMemo(() => empPage?.content ?? [], [empPage])

  const [step, setStep] = useState(0)
  const [templateId, setTemplateId] = useState('')
  const [filterType, setFilterType] = useState<RecipientFilterType>('ALL_EMPLOYEES')
  const [picked, setPicked] = useState<Record<string, Set<string>>>({})
  const [customIds, setCustomIds] = useState<Set<string>>(new Set())
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const today = todayIso()
  const [sendOn, setSendOn] = useState(nextDay(today))

  const selected = useMemo(() => picked[filterType] ?? new Set<string>(), [picked, filterType])
  const toggle = (v: string) => setPicked((all) => {
    const next = new Set(all[filterType] ?? [])
    if (next.has(v)) next.delete(v); else next.add(v)
    return { ...all, [filterType]: next }
  })
  const template = templates.find((t) => t.id === templateId)

  const optionsFor: Record<string, { value: string; label: string }[]> = {
    BY_DEPARTMENT: departments.map((d) => ({ value: d.id, label: d.name })),
    BY_DESIGNATION: designations.map((d) => ({ value: d.id, label: d.title })),
    BY_BRANCH: branches.filter((b) => b.active !== false).map((b) => ({ value: b.id, label: b.name })),
    BY_EMPLOYMENT_TYPE: EMPLOYMENT_TYPES.map((t) => ({ value: t, label: typeLabel(t) })),
  }

  // Who it reaches, worked out from the directory for the count and the no-email warning.
  const targeted = useMemo(() => {
    switch (filterType) {
      case 'ALL_EMPLOYEES': return employees
      case 'BY_DEPARTMENT': return employees.filter((e) => e.departmentId && selected.has(e.departmentId))
      case 'BY_DESIGNATION': return employees.filter((e) => e.designationId && selected.has(e.designationId))
      case 'BY_BRANCH': return employees.filter((e) => e.branchId && selected.has(e.branchId))
      case 'BY_EMPLOYMENT_TYPE': return employees.filter((e) => e.employmentType && selected.has(e.employmentType))
      case 'CUSTOM_LIST': return employees.filter((e) => customIds.has(e.id))
      default: return []
    }
  }, [filterType, employees, selected, customIds])
  const noEmail = targeted.filter((e) => !e.email).length
  const sendable = targeted.length - noEmail

  const buildFilter = (): CreateDistributionRequest['recipientFilter'] => {
    if (filterType === 'ALL_EMPLOYEES') return { type: 'ALL_EMPLOYEES' }
    if (filterType === 'CUSTOM_LIST') return { type: 'CUSTOM_LIST', employeeIds: [...customIds] }
    return { type: filterType, values: [...selected] }
  }
  const pickedNames = filterType === 'CUSTOM_LIST' ? [...customIds]
    : (optionsFor[filterType] ?? []).filter((o) => selected.has(o.value)).map((o) => o.label)

  const busy = create.isPending || schedule.isPending
  const later = canSchedule && when === 'later'
  const finish = async () => {
    const req = { templateId, title: title.trim(), customMessage: message || undefined, subjectOverride: subject.trim() || undefined, recipientFilter: buildFilter() }
    try {
      if (later) {
        await schedule.mutateAsync({ ...req, sendOn })
        toast.success(`Scheduled for ${dayText(sendOn)}, 9:00`)
        onScheduled?.()
        onClose()
      } else {
        const job = await create.mutateAsync(req)
        toast.success('Distribution started')
        onCreated(job.id)
      }
    } catch (e) {
      toast.error(later ? 'Couldn’t schedule it' : 'Failed to start distribution', { detail: (e as Error)?.message })
    }
  }

  const steps = [
    {
      label: 'Letter', title: 'Which letter', sub: 'Each person gets their own copy, with their details filled in.', icon: 'fileText',
      blocker: !templateId ? 'Choose a letter template' : null,
      content: (
        <div className="lt-stack">
          <FieldGrid columns={1}>
            <Select label="Letter template" full value={templateId} onChange={(e) => setTemplateId(e.target.value)}
              options={[{ value: '', label: templates.length === 0 ? 'No active templates — create one first' : 'Choose a template…' },
                ...templates.map((t) => ({ value: t.id, label: t.name }))]}
              hint={template ? `Subject: ${template.subject}` : undefined} />
          </FieldGrid>
          {template && <LetterPreviewPane title="Preview" request={{ templateId: template.id }} ready
            sub="How one copy will look, filled in for you (or for someone you pick). Nothing is sent yet." />}
        </div>
      ),
    },
    {
      label: 'Recipients', title: 'Who gets it', sub: 'Only active employees. People without an email are skipped.', icon: 'users',
      blocker: targeted.length === 0 ? 'Choose who gets it' : null,
      content: (
        <div className="lt-stack">
          <FilterPills label="Recipients" value={filterType} onChange={(v) => setFilterType(v as RecipientFilterType)}
            options={RECIPIENT_FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
          {filterType !== 'ALL_EMPLOYEES' && filterType !== 'CUSTOM_LIST' && (
            <Chips label={RECIPIENT_FILTERS.find((f) => f.value === filterType)?.label ?? ''} options={optionsFor[filterType] ?? []} selected={selected} onToggle={toggle}
              empty={filterType === 'BY_BRANCH' ? 'No branches.' : filterType === 'BY_DEPARTMENT' ? 'No departments.' : 'No designations.'} />
          )}
          {filterType === 'CUSTOM_LIST' && <RecipientPicker employees={employees} selected={customIds} onChange={setCustomIds} />}
          <Callout tone={targeted.length ? 'brand' : 'neutral'}>
            {`This goes to ${targeted.length} ${targeted.length === 1 ? 'employee' : 'employees'}.`}
            {noEmail > 0 && ` ${noEmail} have no email on file and will be skipped.`}
          </Callout>
        </div>
      ),
    },
    {
      label: 'Message', title: 'The email', sub: 'The letter goes as a PDF attachment.', icon: 'mail',
      blocker: !title.trim() ? 'Give it a name' : null,
      content: (
        <FieldGrid columns={1}>
          <Input label="Name" required value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Diwali bonus 2026" />
          <Input label="Email subject (optional)" value={subject} maxLength={500} onChange={(e) => setSubject(e.target.value)} placeholder="Defaults to a standard subject" />
          <Textarea label="Message to recipients" rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
            placeholder="e.g. Please find attached your letter." hint="Shown in the email above the attached letter." />
        </FieldGrid>
      ),
    },
    {
      label: 'Send', title: later ? 'Schedule it' : 'Send it', sub: 'Check it, then send it now or on a later date.', icon: 'calendarClock',
      blocker: sendable < 1 ? 'No one with an email to send to' : later && (!sendOn || sendOn <= today) ? 'Pick a date after today' : null,
      content: (
        <div className="lt-stack">
          <KeyValueGrid items={[
            { label: 'Letter', value: template?.name },
            { label: 'Recipients', value: `${recipientsText(filterType, pickedNames)} · ${targeted.length} ${targeted.length === 1 ? 'person' : 'people'}${noEmail ? ` (${noEmail} without email, skipped)` : ''}` },
            { label: 'Name', value: title },
            { label: 'Message', value: message ? (message.length > 80 ? `${message.slice(0, 80)}…` : message) : '' },
          ]} />
          {canSchedule && (
            <SegmentedControl label="When" semantics="radio" value={when} onChange={(v) => setWhen(v as 'now' | 'later')}
              options={[{ value: 'now', label: 'Send now' }, { value: 'later', label: 'Send on a date' }]} />
          )}
          {later
            ? <>
              <Input label="Send on" type="date" value={sendOn} min={nextDay(today)} onChange={(e) => setSendOn(e.target.value)}
                hint="It starts at 9:00 India time that day, to the people who match then." />
              <Callout tone="info">{`Nothing is sent before ${dayText(sendOn)}. You can cancel it until then.`}</Callout>
            </>
            : <Callout tone="warning" icon="alertTriangle">{`This sends ${sendable} ${sendable === 1 ? 'email' : 'emails'} now. It can’t be undone.`}</Callout>}
        </div>
      ),
    },
  ]

  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} title="New distribution" sub="One letter to many people in a single action."
      width={760} steps={steps} step={step} onStepChange={setStep} busy={busy} closeLabel="Close panel"
      onFinish={finish} finishLabel={later ? `Schedule for ${dayText(sendOn)}` : `Send to ${sendable} ${sendable === 1 ? 'employee' : 'employees'}`} />
  )
}
