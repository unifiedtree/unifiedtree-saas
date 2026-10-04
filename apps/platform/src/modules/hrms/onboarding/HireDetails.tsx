// Hire details on an onboarding (V143.20): offer accepted date, hiring manager, recruiter,
// source and buddy. Filled from the candidate and the accepted offer when the hire came
// through the hiring pipeline; HR (hrms.onboarding.instance.write) can change them. The new
// hire sees their own (who their buddy and hiring manager are).
import { useState, type FormEvent } from 'react'
import { Button, Callout, KeyValueGrid, Section } from '@/design/kit/display'
import { DateInput, FieldGrid, Input, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { PersonSearch, fullName } from '../letters/components/PersonSearch'
import { useHireDetails, useUpdateHireDetails, type HireDetails, type HirePerson } from './api/useOnboarding'
import { dayMon, istTodayIso } from '../hiring/hiringModel'
import '../hiring/hiring.css'

export function HireDetailsPanel({ instanceId, isHr }: { instanceId: string; isHr: boolean }) {
  const q = useHireDetails(instanceId)
  const [editing, setEditing] = useState(false)
  const d = q.data
  const today = istTodayIso()
  return (
    <Section title="Hire details" level={3} sub={isHr ? 'Filled from the hiring record when the hire came through the pipeline. You can change them.' : 'Who hired you and who to ask when you’re new.'}
      actions={isHr && d ? <Button size={32} variant="secondary" icon="pencil" onClick={() => setEditing(true)}>Edit</Button> : undefined}
      loading={q.isLoading} skeleton="text" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}>
      {d && (
        <KeyValueGrid items={[
          { key: 'accepted', label: 'Offer accepted', value: d.offerAcceptedOn ? dayMon(d.offerAcceptedOn, today) : '—' },
          { key: 'manager', label: 'Hiring manager', value: d.hiringManager?.name || '—' },
          { key: 'recruiter', label: 'Recruiter', value: d.recruiter?.name || '—' },
          { key: 'source', label: 'Source', value: d.source || '—' },
          { key: 'buddy', label: 'Buddy', value: d.buddy?.name || '—' },
        ]} />
      )}
      {editing && d && <HireDetailsDrawer instanceId={instanceId} details={d} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function PersonField({ id, title, person, onChange, hint }: { id: string; title: string; person: HirePerson | null; onChange: (p: HirePerson | null) => void; hint?: string }) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="hi-field-block" role="group" aria-labelledby={id}>
      <p className="hi-label" id={id}>{title}</p>
      <div className="hi-pills">
        <span className="hi-copy">{person ? <strong style={{ fontWeight: 500 }}>{person.name}</strong> : 'Not set'}</span>
        <Button type="button" size={30} variant="ghost" onClick={() => setPicking((x) => !x)}>{picking ? 'Close' : person ? 'Change' : 'Choose'}</Button>
        {person && <Button type="button" size={30} variant="ghost" onClick={() => onChange(null)}>Clear</Button>}
      </div>
      {hint && <p className="hi-small">{hint}</p>}
      {picking && <PersonSearch selectedId={person?.id} onPick={(e) => { onChange({ id: e.id, name: fullName(e) }); setPicking(false) }} />}
    </div>
  )
}

function HireDetailsDrawer({ instanceId, details, onClose }: { instanceId: string; details: HireDetails; onClose: () => void }) {
  const toast = useToast()
  const save = useUpdateHireDetails(instanceId)
  const [accepted, setAccepted] = useState(details.offerAcceptedOn ?? '')
  const [source, setSource] = useState(details.source ?? '')
  const [manager, setManager] = useState<HirePerson | null>(details.hiringManager)
  const [recruiter, setRecruiter] = useState<HirePerson | null>(details.recruiter)
  const [buddy, setBuddy] = useState<HirePerson | null>(details.buddy)
  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    try {
      await save.mutateAsync({ offerAcceptedOn: accepted || null, source: source.trim() || null, hiringManagerId: manager?.id ?? null, recruiterId: recruiter?.id ?? null, buddyId: buddy?.id ?? null })
      toast.success('Hire details saved'); onClose()
    } catch (err) { toast.error('Couldn’t save the hire details', { detail: (err as Error)?.message }) }
  }
  return (
    <SidePanel open onClose={onClose} width={560} busy={save.isPending} closeLabel="Close panel" title="Hire details"
      footer={<><PanelButton size="lg" onClick={onClose} disabled={save.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={save.isPending} onClick={() => submit()}>Save</PanelButton></>}>
      <form id="hire-form" onSubmit={submit} noValidate className="hi-stack">
        {details.candidateId && <Callout tone="neutral">This hire came through the hiring pipeline, so these were filled from the candidate and the accepted offer.</Callout>}
        <FieldGrid columns={2}>
          <DateInput id="hire-accepted" label="Offer accepted on" max={istTodayIso()} value={accepted} onChange={(e) => setAccepted(e.target.value)} clearable />
          <Input id="hire-source" label="Source" value={source} maxLength={80} placeholder="e.g. Referral, LinkedIn" onChange={(e) => setSource(e.target.value)} />
        </FieldGrid>
        <PersonField id="hire-manager" title="Hiring manager" person={manager} onChange={setManager} />
        <PersonField id="hire-recruiter" title="Recruiter" person={recruiter} onChange={setRecruiter} />
        <PersonField id="hire-buddy" title="Buddy" person={buddy} onChange={setBuddy} hint="A colleague the new hire can go to with everyday questions in their first weeks." />
      </form>
    </SidePanel>
  )
}
