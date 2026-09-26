// Hire details on an onboarding (V143.20): offer accepted date, hiring
// manager, recruiter, source and buddy. Filled from the candidate and the
// accepted offer when the hire came through the hiring pipeline; HR
// (hrms.onboarding.instance.write) can change them. The new hire sees their
// own (who their buddy and hiring manager are).
import { useState, type FormEvent } from 'react'
import { HrButton, HrDrawer, HrStatusPill } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { Panel, Facts, State, Note, dmy, todayIso } from '@/design/module/ModuleKit'
import { PerformanceEmployeePicker as EmployeePicker } from '../performance/PerformanceEmployeePicker'
import { useHireDetails, useUpdateHireDetails, type HireDetails, type HirePerson } from './api/useOnboarding'

type Toast = (msg: string, err?: boolean, detail?: string) => void
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

export function HireDetailsPanel({ instanceId, isHr, toast }: { instanceId: string; isHr: boolean; toast: Toast }) {
  const q = useHireDetails(instanceId)
  const [editing, setEditing] = useState(false)
  const d = q.data
  return (
    <Panel title="Hire details" sub={isHr ? 'Filled from the hiring record when the hire came through the pipeline. You can change them.' : 'Who hired you and who to ask when you’re new.'}
      aside={isHr && d ? <HrButton size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</HrButton> : undefined}>
      {q.isLoading ? <State kind="loading" height={80} />
        : q.error ? <State kind="error" title="Couldn’t load the hire details" description={(q.error as Error).message} onRetry={() => q.refetch()} />
          : d ? <Facts items={[
            { k: 'Offer accepted', v: d.offerAcceptedOn ? dmy(d.offerAcceptedOn) : '—' },
            { k: 'Hiring manager', v: d.hiringManager?.name || '—' },
            { k: 'Recruiter', v: d.recruiter?.name || '—' },
            { k: 'Source', v: d.source || '—' },
            { k: 'Buddy', v: d.buddy?.name || '—' },
          ]} /> : null}
      {editing && d && <HireDetailsDrawer instanceId={instanceId} details={d} onClose={() => setEditing(false)} toast={toast} />}
    </Panel>
  )
}

function PersonField({ id, title, person, onChange, hint }: { id: string; title: string; person: HirePerson | null; onChange: (p: HirePerson | null) => void; hint?: string }) {
  const [picking, setPicking] = useState(false)
  return (
    <div>
      <span className={label} id={id}>{title}</span>
      <div className="flex flex-wrap items-center gap-2" aria-labelledby={id}>
        {person ? <HrStatusPill tone="info">{person.name}</HrStatusPill> : <span className="text-sm text-text-secondary">Not set</span>}
        <HrButton type="button" size="sm" variant="ghost" onClick={() => setPicking((x) => !x)}>{picking ? 'Close' : person ? 'Change' : 'Choose'}</HrButton>
        {person && <HrButton type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Clear</HrButton>}
      </div>
      {hint && <p className="mt-1 text-xs text-text-tertiary">{hint}</p>}
      {picking && <div className="mt-2"><EmployeePicker value={person?.id ?? ''} selectedLabel={person?.name} onChange={(e) => { onChange({ id: e.id, name: `${e.firstName} ${e.lastName || ''}`.trim() }); setPicking(false) }} /></div>}
    </div>
  )
}

function HireDetailsDrawer({ instanceId, details, onClose, toast }: { instanceId: string; details: HireDetails; onClose: () => void; toast: Toast }) {
  const save = useUpdateHireDetails(instanceId)
  const [accepted, setAccepted] = useState(details.offerAcceptedOn ?? '')
  const [source, setSource] = useState(details.source ?? '')
  const [manager, setManager] = useState<HirePerson | null>(details.hiringManager)
  const [recruiter, setRecruiter] = useState<HirePerson | null>(details.recruiter)
  const [buddy, setBuddy] = useState<HirePerson | null>(details.buddy)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await save.mutateAsync({ offerAcceptedOn: accepted || null, source: source.trim() || null, hiringManagerId: manager?.id ?? null, recruiterId: recruiter?.id ?? null, buddyId: buddy?.id ?? null })
      toast('Hire details saved'); onClose()
    } catch (err) { toast('Couldn’t save the hire details', true, (err as Error)?.message) }
  }
  return (
    <HrDrawer title="Hire details" onClose={onClose}
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="hire-form" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save'}</HrButton></>}>
      <form id="hire-form" onSubmit={submit} className="space-y-4">
        {details.candidateId && <Note>This hire came through the hiring pipeline, so these were filled from the candidate and the accepted offer.</Note>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className={label} htmlFor="hire-accepted">Offer accepted on</label><DateField id="hire-accepted" max={todayIso()} value={accepted} onChange={(e) => setAccepted(e.target.value)} className="ut-input" clearable /></div>
          <div><label className={label} htmlFor="hire-source">Source</label><input id="hire-source" value={source} maxLength={80} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Referral, LinkedIn" className="ut-input" /></div>
        </div>
        <PersonField id="hire-manager" title="Hiring manager" person={manager} onChange={setManager} />
        <PersonField id="hire-recruiter" title="Recruiter" person={recruiter} onChange={setRecruiter} />
        <PersonField id="hire-buddy" title="Buddy" person={buddy} onChange={setBuddy} hint="A colleague the new hire can go to with everyday questions in their first weeks." />
      </form>
    </HrDrawer>
  )
}
