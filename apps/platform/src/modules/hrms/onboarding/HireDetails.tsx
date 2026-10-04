// Hire details on an onboarding (V143.20), on the redesign kit: offer accepted date, hiring
// manager, recruiter, source and buddy. Filled from the candidate and the accepted offer when the
// hire came through the hiring pipeline; HR (hrms.onboarding.instance.write) can change them. The
// new hire sees their own (who their buddy and hiring manager are).
import { useEffect, useState } from 'react'
import { Button, Callout, KeyValueGrid, Section, StatusPill, errorText } from '@/design/kit/display'
import { DateInput, Input, PanelButton, SidePanel, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { PersonSearch, personName } from '../performance/PersonSearch'
import { useHireDetails, useUpdateHireDetails, type HireDetails, type HirePerson } from './api/useOnboarding'
import { fullDate } from './onboardingModel'
import '../performance/grow.css'
import './onboarding.css'

export function HireDetailsPanel({ instanceId, isHr }: { instanceId: string; isHr: boolean }) {
  const q = useHireDetails(instanceId)
  const [editing, setEditing] = useState(false)
  const d = q.data
  return (
    <Section title="Hire details" sub={isHr ? 'Filled from the hiring record when the hire came through the pipeline. You can change them.' : 'Who hired you and who to ask when you’re new.'}
      loading={q.isLoading} skeleton="text" error={q.error} onRetry={() => q.refetch()} retrying={q.isRefetching}
      actions={isHr && d ? <Button variant="secondary" size={32} icon="pencil" onClick={() => setEditing(true)}>Edit</Button> : undefined}>
      {d && (
        <KeyValueGrid items={[
          { key: 'accepted', label: 'Offer accepted', value: d.offerAcceptedOn ? fullDate(d.offerAcceptedOn) : '—' },
          { key: 'manager', label: 'Hiring manager', value: d.hiringManager?.name || '—' },
          { key: 'recruiter', label: 'Recruiter', value: d.recruiter?.name || '—' },
          { key: 'source', label: 'Source', value: d.source || '—' },
          { key: 'buddy', label: 'Buddy', value: d.buddy?.name || '—' },
        ]} />
      )}
      {d && <HireDetailsEditor instanceId={instanceId} details={d} open={editing} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function PersonField({ title, person, onChange, hint }: { title: string; person: HirePerson | null; onChange: (p: HirePerson | null) => void; hint?: string }) {
  const [picking, setPicking] = useState(false)
  return (
    <div role="group" aria-label={title} className="grw-stack grw-stack--tight">
      <span className="onb-wiz-label" style={{ marginBottom: 0 }}>{title}</span>
      <div className="onb-row">
        {person ? <StatusPill tone="info" size="md">{person.name}</StatusPill> : <span className="onb-muted">Not set</span>}
        <Button variant="secondary" size={30} onClick={() => setPicking((x) => !x)}>{picking ? 'Close' : person ? 'Change' : 'Choose'}</Button>
        {person && <Button variant="secondary" size={30} onClick={() => onChange(null)}>Clear</Button>}
      </div>
      {hint && <span className="onb-muted">{hint}</span>}
      {picking && (
        <PersonSearch label={`Find the ${title.toLowerCase()}`} value={person?.id ?? ''} selectedLabel={person?.name}
          onChange={(e) => { onChange({ id: e.id, name: personName(e) }); setPicking(false) }} />
      )}
    </div>
  )
}

function HireDetailsEditor({ instanceId, details, open, onClose }: { instanceId: string; details: HireDetails; open: boolean; onClose: () => void }) {
  const save = useUpdateHireDetails(instanceId)
  const toast = useToast()
  const [accepted, setAccepted] = useState(details.offerAcceptedOn ?? '')
  const [source, setSource] = useState(details.source ?? '')
  const [manager, setManager] = useState<HirePerson | null>(details.hiringManager)
  const [recruiter, setRecruiter] = useState<HirePerson | null>(details.recruiter)
  const [buddy, setBuddy] = useState<HirePerson | null>(details.buddy)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    setAccepted(details.offerAcceptedOn ?? ''); setSource(details.source ?? ''); setManager(details.hiringManager)
    setRecruiter(details.recruiter); setBuddy(details.buddy); setError('')
  }, [open, details])
  const close = () => { if (!save.isPending) onClose() }
  const submit = async () => {
    setError('')
    try {
      await save.mutateAsync({ offerAcceptedOn: accepted || null, source: source.trim() || null, hiringManagerId: manager?.id ?? null, recruiterId: recruiter?.id ?? null, buddyId: buddy?.id ?? null })
      toast.success('Hire details saved'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t save the hire details.')) }
  }
  return (
    <SidePanel open={open} onClose={close} busy={save.isPending} width={520} closeLabel="Close panel" title="Hire details"
      sub="Offer date, who hired them, where they came from, and the buddy they can ask."
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={save.isPending} onClick={close}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={save.isPending} onClick={submit}>Save</PanelButton>
      </>}>
      <form className="onb-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        {details.candidateId && <Callout tone="info">This hire came through the hiring pipeline, so these were filled from the candidate and the accepted offer.</Callout>}
        <div className="onb-wiz-grid">
          <DateInput id="hire-accepted" label="Offer accepted on" max={istToday()} value={accepted} onChange={(e) => setAccepted(e.target.value)} clearable />
          <Input id="hire-source" label="Source" value={source} maxLength={80} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Referral, LinkedIn" />
        </div>
        <PersonField title="Hiring manager" person={manager} onChange={setManager} />
        <PersonField title="Recruiter" person={recruiter} onChange={setRecruiter} />
        <PersonField title="Buddy" person={buddy} onChange={setBuddy} hint="A colleague the new hire can go to with everyday questions in their first weeks." />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </form>
    </SidePanel>
  )
}
