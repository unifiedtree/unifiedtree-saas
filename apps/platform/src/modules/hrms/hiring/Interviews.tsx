// Interviews and scorecards on the redesign kit (P-HIRE; prototype PgTalent h-pipe tab 2):
//  - ScheduleInterviewPanel: book or change an interview (IST date and time, duration,
//    in person / video / phone, where or the link, interviewers, the criteria they rate).
//    From a candidate, or from the Interviews view with a candidate picker (Screening or
//    Interview). Needs hrms.hiring.interview.write.
//  - ScorecardPanel: an assigned interviewer rates each criterion 1-5, adds strengths and
//    concerns, and recommends strong yes / yes / no / strong no.
//  - CandidateDrawer: one candidate's facts, scorecard summary and interviews.
//  - InterviewsTab (Hiring ?tab=interviews): what's coming up and the interviews you are on,
//    in one table; MyInterviews (/me/interviews): the interviews you were asked to take.
// Hiring roles (hrms.hiring.read) see every scorecard; an interviewer sees only their own.
// Interviewers are notified of every change by the server.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import {
  Button, Callout, CellActions, CellPerson, EmptyState, KeyValueGrid, MiniStat, MiniStatGrid, PageFrame, PageHeader, Section, StatusPill, Table,
  type TableColumn,
} from '@/design/kit/display'
import { DateInput, FieldGrid, Input, Menu, PanelButton, Select, SidePanel, Textarea, useToast, type MenuEntry } from '@/design/kit/overlays'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { PersonSearch, fullName } from '../letters/components/PersonSearch'
import {
  useCandidateBoard, useCandidateInterviews, useUpcomingInterviews, useMyInterviews, useMyInterviewSummary, useScheduleInterview,
  useRescheduleInterview, useCancelInterview, useSubmitScorecard, inr, istWhen,
  DEFAULT_CRITERIA, MODE_LABEL, RECOMMENDATIONS, RECOMMENDATION_LABEL, SCHEDULABLE_STAGES,
  type CandidateCard, type Interview, type InterviewMode, type Recommendation, type ScorecardSummary,
} from '../api/useHiring'
import {
  STAGE_LABEL, dayMon, interviewState, interviewWhen, interviewersLine, istDateOf, istTodayIso, mergeInterviews, type InterviewRow,
} from './hiringModel'
import './hiring.css'

const REC_TONE: Record<Recommendation, 'success' | 'mint' | 'warning' | 'danger'> = { STRONG_YES: 'success', YES: 'mint', NO: 'warning', STRONG_NO: 'danger' }
const RATING_LABEL = ['', '1 · Poor', '2 · Below the bar', '3 · Meets the bar', '4 · Strong', '5 · Exceptional']
const DURATIONS = ['15', '30', '45', '60', '90', '120', '180']
const errMsg = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const tomorrowIst = () => istTodayIso(new Date(Date.now() + 86_400_000))
const durationLabel = (d: string) => (Number(d) < 60 ? `${d} min` : `${Number(d) / 60} h`.replace('.5 h', ' h 30 min'))

/** "3 scorecards · 3.8 / 5 · 2 strong yes, 1 no" — or null when there are none. */
export function scorecardLine(s?: ScorecardSummary | null): string | null {
  if (!s || !s.count) return null
  const recs = RECOMMENDATIONS.filter((r) => s.recommendations?.[r]).map((r) => `${s.recommendations[r]} ${RECOMMENDATION_LABEL[r].toLowerCase()}`)
  return [`${s.count} ${s.count === 1 ? 'scorecard' : 'scorecards'}`, s.averageRating != null ? `${Number(s.averageRating).toFixed(1)} / 5` : null, recs.join(', ') || null].filter(Boolean).join(' · ')
}

function summarise(interviews: Interview[]): ScorecardSummary {
  const cards = interviews.flatMap((i) => i.scorecards)
  const recommendations = Object.fromEntries(RECOMMENDATIONS.map((r) => [r, cards.filter((c) => c.recommendation === r).length])) as Record<Recommendation, number>
  const avg = cards.length ? cards.reduce((n, c) => n + Number(c.overallRating), 0) / cards.length : null
  return { count: cards.length, averageRating: avg, recommendations }
}

// ── Schedule / reschedule ────────────────────────────────────────────────────

/**
 * Book an interview for `candidate`, change `interview`, or (neither given) book one from the
 * Interviews view: the panel then asks which candidate (those in Screening or Interview).
 */
export function ScheduleInterviewPanel({ candidate, interview, onClose }: {
  candidate?: { id: string; name: string } | null; interview?: Interview; onClose: () => void
}) {
  const toast = useToast()
  const schedule = useScheduleInterview()
  const reschedule = useRescheduleInterview()
  const busy = schedule.isPending || reschedule.isPending
  const picking = !candidate && !interview
  // The picker lists everyone who can be interviewed now; the server checks the stage again.
  const pool = useCandidateBoard({}, picking)
  const choices = useMemo(() => (pool.data ?? []).filter((c) => SCHEDULABLE_STAGES.includes(c.stage) && !c.convertedEmployeeId), [pool.data])
  const [candidateId, setCandidateId] = useState(candidate?.id ?? interview?.candidateId ?? '')
  const [title, setTitle] = useState(interview?.title ?? '')
  const [date, setDate] = useState(interview ? interview.scheduledAtIst.slice(0, 10) : tomorrowIst())
  const [time, setTime] = useState(interview ? interview.scheduledAtIst.slice(11, 16) : '10:00')
  const [duration, setDuration] = useState(String(interview?.durationMinutes ?? 45))
  const [mode, setMode] = useState<InterviewMode>(interview?.mode ?? 'VIDEO')
  const [location, setLocation] = useState(interview?.location ?? '')
  const [people, setPeople] = useState<{ id: string; name: string }[]>(interview?.interviewers.map((p) => ({ id: p.employeeId, name: p.name })) ?? [])
  const [criteria, setCriteria] = useState((interview?.criteria ?? DEFAULT_CRITERIA).join(', '))
  const [notes, setNotes] = useState(interview?.notes ?? '')
  const [errors, setErrors] = useState<{ candidate?: string; people?: string; where?: string }>({})
  const durations = DURATIONS.includes(duration) ? DURATIONS : [duration, ...DURATIONS]
  const where = mode === 'VIDEO' ? { l: 'Video call link', ph: 'https://…', hint: 'Interviewers get this link in their notification.' }
    : mode === 'IN_PERSON' ? { l: 'Where', ph: 'e.g. 3rd floor meeting room, Hyderabad office', hint: '' }
      : { l: 'Phone number or note (optional)', ph: 'e.g. The candidate will call on +91…', hint: '' }
  const name = candidate?.name ?? interview?.candidateName ?? choices.find((c) => c.id === candidateId)?.fullName ?? ''

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    const next = {
      candidate: candidateId ? undefined : 'Choose the candidate',
      people: people.length ? undefined : 'Choose at least one interviewer',
      where: mode !== 'PHONE' && !location.trim() ? (mode === 'VIDEO' ? 'Add the video call link' : 'Say where it happens') : undefined,
    }
    setErrors(next)
    if (next.candidate || next.people || next.where) return
    const body = {
      title: title.trim() || undefined, scheduledAt: `${date}T${time}`, durationMinutes: Number(duration), mode,
      location: location.trim() || undefined, interviewerIds: people.map((p) => p.id),
      criteria: criteria.split(',').map((c) => c.trim()).filter(Boolean), notes: notes.trim() || undefined,
    }
    try {
      if (interview) await reschedule.mutateAsync({ id: interview.id, ...body })
      else await schedule.mutateAsync({ candidateId, ...body })
      toast.success(interview ? 'Interview updated. The interviewers were told.' : 'Interview scheduled. The interviewers were told.')
      onClose()
    } catch (err) { toast.error(interview ? 'Couldn’t change the interview' : 'Couldn’t schedule the interview', { detail: errMsg(err) }) }
  }

  return (
    <SidePanel open onClose={onClose} width={620} busy={busy} closeLabel="Close panel"
      title={interview ? 'Change interview' : 'Schedule an interview'}
      sub={name ? `With ${name}. Times are India time (IST).` : 'Times are India time (IST).'}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={busy}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={busy} onClick={() => submit()}>{interview ? 'Save changes' : 'Schedule'}</PanelButton></>}>
      <form id="interview-form" onSubmit={submit} noValidate className="hi-stack">
        <FieldGrid columns={3}>
          {picking && (
            <Select id="iv-candidate" label="Candidate" full value={candidateId} error={errors.candidate}
              placeholder={pool.isLoading ? 'Loading candidates…' : choices.length ? 'Choose a candidate' : 'No one in Screening or Interview'}
              hint="People in Screening or Interview can be interviewed."
              options={choices.map((c) => ({ value: c.id, label: `${c.fullName} · ${c.requisitionTitle || STAGE_LABEL[c.stage]}` }))}
              onChange={(e) => { setCandidateId(e.target.value); setErrors((x) => ({ ...x, candidate: undefined })) }} />
          )}
          <Input id="iv-title" label="Interview name" full value={title} maxLength={120} placeholder="e.g. Technical round" onChange={(e) => setTitle(e.target.value)} />
          <DateInput id="iv-date" label="Date" min={interview ? undefined : istTodayIso()} value={date} onChange={(e) => setDate(e.target.value)} format="short" />
          <Input id="iv-time" label="Time (IST)" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <Select id="iv-dur" label="Duration" value={duration} onChange={(e) => setDuration(e.target.value)} options={durations.map((d) => ({ value: d, label: durationLabel(d) }))} />
        </FieldGrid>
        {interview?.started && <Callout tone="neutral">This interview has already started. Keep its date and time to change only the interviewers (for example to add the person who took it, so they can file a scorecard). A new time must be in the future.</Callout>}
        <FieldGrid columns={3}>
          <Select id="iv-mode" label="How" value={mode} onChange={(e) => { setMode(e.target.value as InterviewMode); setErrors((x) => ({ ...x, where: undefined })) }}
            options={(Object.keys(MODE_LABEL) as InterviewMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
          <Input id="iv-where" label={where.l} fieldClassName="hi-span2" value={location} maxLength={500} type={mode === 'VIDEO' ? 'url' : 'text'}
            placeholder={where.ph} hint={where.hint || undefined} error={errors.where} onChange={(e) => { setLocation(e.target.value); setErrors((x) => ({ ...x, where: undefined })) }} />
        </FieldGrid>
        <div className="hi-field-block">
          {people.length > 0 && <p className="hi-label">Interviewers</p>}
          {people.length > 0 && (
            <div className="hi-chosen">
              {people.map((p) => (
                <span key={p.id} className="hi-chosen__item">
                  {p.name}
                  <button type="button" className="hi-chosen__x" onClick={() => setPeople((x) => x.filter((y) => y.id !== p.id))} aria-label={`Remove ${p.name}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <PersonSearch label="Add an interviewer" hint="Up to 10. Each one is notified and fills in their own scorecard after the interview."
            onPick={(emp) => { setPeople((x) => (x.some((y) => y.id === emp.id) || x.length >= 10 ? x : [...x, { id: emp.id, name: fullName(emp) }])); setErrors((x) => ({ ...x, people: undefined })) }} />
          {errors.people && <p className="hi-small" role="alert" style={{ color: 'var(--u-danger-text, #B4302A)' }}>{errors.people}</p>}
        </div>
        <Input id="iv-criteria" label="What interviewers rate (comma separated)" value={criteria} onChange={(e) => setCriteria(e.target.value)}
          hint="Each criterion is rated from 1 to 5 on the scorecard. Leave empty for the standard four." />
        <Textarea id="iv-notes" label="Notes for the interviewers" value={notes} maxLength={2000} rows={3}
          placeholder="Optional: what to focus on, the candidate's CV link…" onChange={(e) => setNotes(e.target.value)} />
      </form>
    </SidePanel>
  )
}

// ── Scorecard ────────────────────────────────────────────────────────────────

/** `interview` is the interviewer's own copy: its scorecards are only theirs. */
export function ScorecardPanel({ interview, onClose }: { interview: Interview; onClose: () => void }) {
  const toast = useToast()
  const submit = useSubmitScorecard()
  const mine = interview.scorecards[0]
  const [ratings, setRatings] = useState<Record<string, string>>(() => Object.fromEntries(interview.criteria.map((c) => [c, String(mine?.ratings.find((r) => r.criterion === c)?.rating ?? '')])))
  const [strengths, setStrengths] = useState(mine?.strengths ?? '')
  const [concerns, setConcerns] = useState(mine?.concerns ?? '')
  const [rec, setRec] = useState<Recommendation | ''>(mine?.recommendation ?? '')
  const [problem, setProblem] = useState('')
  const save = async (e?: FormEvent) => {
    e?.preventDefault()
    const missing = interview.criteria.filter((c) => !ratings[c])
    if (missing.length) { setProblem(`Rate ${missing.join(', ')}`); return }
    if (!rec) { setProblem('Choose your recommendation'); return }
    setProblem('')
    try {
      await submit.mutateAsync({ id: interview.id, ratings: interview.criteria.map((c) => ({ criterion: c, rating: Number(ratings[c]) })), strengths: strengths.trim() || undefined, concerns: concerns.trim() || undefined, recommendation: rec })
      toast.success(mine ? 'Scorecard updated' : 'Scorecard submitted')
      onClose()
    } catch (err) { toast.error('Couldn’t save the scorecard', { detail: errMsg(err) }) }
  }
  return (
    <SidePanel open onClose={onClose} width={600} busy={submit.isPending} closeLabel="Close panel"
      title={mine ? 'Your scorecard' : 'Submit your scorecard'}
      sub={`${interview.candidateName} · ${interview.roleTitle} · ${interview.title} · ${istWhen(interview.scheduledAt)} IST`}
      footer={<><PanelButton size="lg" onClick={onClose} disabled={submit.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={submit.isPending} disabled={!interview.started} onClick={() => save()}>{mine ? 'Save changes' : 'Submit scorecard'}</PanelButton></>}>
      <form id="scorecard-form" onSubmit={save} noValidate className="hi-stack">
        {!interview.started && <Callout tone="warning">You can fill in the scorecard once the interview has started.</Callout>}
        <Callout tone="neutral">Only the hiring team (HR) sees your scorecard. The other interviewers don’t see what you wrote.</Callout>
        <FieldGrid columns={2}>
          {interview.criteria.map((c, i) => (
            <Select key={c} id={`sc-${i}`} label={c} value={ratings[c]} placeholder="Choose a rating" onChange={(e) => setRatings((r) => ({ ...r, [c]: e.target.value }))}
              options={[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: RATING_LABEL[n] }))} />
          ))}
          <Select id="sc-rec" label="Your recommendation" full value={rec} placeholder="Choose one" onChange={(e) => setRec(e.target.value as Recommendation)}
            options={RECOMMENDATIONS.map((r) => ({ value: r, label: RECOMMENDATION_LABEL[r] }))} />
          <Textarea id="sc-str" label="Strengths" full value={strengths} maxLength={4000} rows={3} placeholder="What stood out" onChange={(e) => setStrengths(e.target.value)} />
          <Textarea id="sc-con" label="Concerns" full value={concerns} maxLength={4000} rows={3} placeholder="Gaps or risks" onChange={(e) => setConcerns(e.target.value)} />
        </FieldGrid>
        {problem && <p className="hi-small" role="alert" style={{ color: 'var(--u-danger-text, #B4302A)' }}>{problem}</p>}
      </form>
    </SidePanel>
  )
}

// ── One interview ────────────────────────────────────────────────────────────

function InterviewCard({ interview, showCandidate, actions, mine }: { interview: Interview; showCandidate?: boolean; actions?: ReactNode; mine?: Interview | null }) {
  const today = istTodayIso()
  const state = interviewState(interview, today, mine)
  const cancelled = interview.status === 'CANCELLED'
  return (
    <article className="hi-iv" aria-label={`${interview.title} with ${interview.candidateName}`}>
      <div className="hi-iv__head">
        <div>
          <h4 className="hi-iv__title">{showCandidate ? `${interview.candidateName} · ${interview.title}` : interview.title}</h4>
          <p className="hi-iv__sub">{`${interviewWhen(interview, today)} · ${MODE_LABEL[interview.mode]}${showCandidate ? ` · ${interview.roleTitle}` : ''}`}</p>
        </div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>
      <KeyValueGrid items={[
        { key: 'where', label: interview.mode === 'VIDEO' ? 'Link' : 'Where', value: interview.location ? (interview.mode === 'VIDEO' ? <a href={interview.location} target="_blank" rel="noopener noreferrer" className="hi-link">Join call</a> : interview.location) : '—' },
        { key: 'who', label: 'Interviewers', value: interviewersLine(interview) || '—' },
        { key: 'rated', label: 'Rated on', value: interview.criteria.join(', ') },
      ]} />
      {interview.notes && <Callout tone="neutral">{interview.notes}</Callout>}
      {cancelled && <Callout tone="neutral">{`Cancelled${interview.cancelReason ? `: ${interview.cancelReason}` : '.'}`}</Callout>}
      {interview.scorecards.map((s) => (
        <div key={s.id} className="hi-score">
          <div className="hi-score__head">
            <span>{`${s.interviewerName || 'Interviewer'} · ${Number(s.overallRating).toFixed(1)} / 5`}</span>
            <StatusPill tone={REC_TONE[s.recommendation]}>{RECOMMENDATION_LABEL[s.recommendation]}</StatusPill>
          </div>
          <p className="hi-score__line">{s.ratings.map((r) => `${r.criterion} ${r.rating}`).join(' · ')}</p>
          {s.strengths && <p className="hi-score__line">{`Strengths: ${s.strengths}`}</p>}
          {s.concerns && <p className="hi-score__line">{`Concerns: ${s.concerns}`}</p>}
        </div>
      ))}
      {actions ? <div className="hi-iv__acts">{actions}</div> : null}
    </article>
  )
}

/** Reschedule / Cancel for HR on an interview that is still open (no feedback yet). */
function useInterviewActions() {
  const canWrite = usePermission('hrms.hiring.interview.write')
  const cancel = useCancelInterview()
  const confirm = useConfirmDialog()
  const toast = useToast()
  const [editing, setEditing] = useState<Interview | null>(null)
  const editable = (i: Interview) => canWrite && i.status === 'SCHEDULED' && i.scorecards.length === 0
  const doCancel = async (i: Interview) => {
    const ok = await confirm({ title: `Cancel “${i.title}” with ${i.candidateName}?`, body: 'Every interviewer is told it is cancelled. This can’t be undone; schedule a new interview if it should happen later.', confirmLabel: 'Cancel interview', cancelLabel: 'Keep it', tone: 'danger' })
    if (!ok) return
    try { await cancel.mutateAsync({ id: i.id }); toast.success('Interview cancelled. The interviewers were told.') } catch (e) { toast.error('Couldn’t cancel the interview', { detail: errMsg(e) }) }
  }
  const buttonsFor = (i: Interview) => (editable(i) ? (
    <>
      <Button size={30} variant="secondary" onClick={() => setEditing(i)}>Reschedule</Button>
      <Button size={30} variant="secondary" disabled={cancel.isPending} onClick={() => doCancel(i)}>Cancel interview</Button>
    </>
  ) : null)
  const menuItemsFor = (i: Interview): MenuEntry[] => (editable(i) ? [
    { key: 'resched', label: 'Reschedule', icon: 'calendarClock', onSelect: () => setEditing(i) },
    { key: 'cancel', label: 'Cancel interview', icon: 'circleX', danger: true, disabled: cancel.isPending, onSelect: () => doCancel(i) },
  ] : [])
  const panel = editing ? <ScheduleInterviewPanel interview={editing} onClose={() => setEditing(null)} /> : null
  return { buttonsFor, menuItemsFor, panel, editing: !!editing }
}

// ── Candidate panel ──────────────────────────────────────────────────────────

export function CandidateDrawer({ card, onClose }: { card: CandidateCard; onClose: () => void }) {
  const canWrite = usePermission('hrms.hiring.interview.write')
  const q = useCandidateInterviews(card.id)
  const [scheduling, setScheduling] = useState(false)
  const { buttonsFor, panel, editing } = useInterviewActions()
  const interviews = useMemo(() => q.data ?? [], [q.data])
  const summary = q.data ? summarise(interviews) : card.scorecards
  const schedulable = SCHEDULABLE_STAGES.includes(card.stage)
  const today = istTodayIso()
  // One panel at a time, as before: booking or changing an interview takes the candidate's place.
  if (scheduling) return <ScheduleInterviewPanel candidate={{ id: card.id, name: card.fullName }} onClose={() => setScheduling(false)} />
  if (editing) return panel
  return (
    <SidePanel open onClose={onClose} width={660} closeLabel="Close panel" title={card.fullName}
      sub={[STAGE_LABEL[card.stage], card.requisitionTitle].filter(Boolean).join(' · ')}
      footer={<PanelButton size="lg" onClick={onClose}>Close</PanelButton>}>
      <div className="hi-stack">
        <KeyValueGrid items={[
          { key: 'stage', label: 'Stage', value: STAGE_LABEL[card.stage] },
          { key: 'role', label: 'Role', value: card.requisitionTitle || '—' },
          { key: 'source', label: 'Source', value: card.source || '—' },
          { key: 'ctc', label: 'Expects', value: card.expectedCtc != null ? inr(card.expectedCtc) : '—' },
          { key: 'email', label: 'Email', value: card.email || '—' },
          { key: 'phone', label: 'Phone', value: card.phone || '—' },
          { key: 'applied', label: 'Applied', value: card.createdAt ? dayMon(istDateOf(card.createdAt), today) : '—' },
        ]} />
        <Section title="Scorecards" level={3} variant="panel" cardClass={false}>
          {summary.count ? (
            <KeyValueGrid items={[
              { key: 'n', label: 'Scorecards', value: String(summary.count) },
              { key: 'avg', label: 'Average', value: summary.averageRating != null ? `${Number(summary.averageRating).toFixed(1)} / 5` : '—' },
              ...RECOMMENDATIONS.map((r) => ({ key: r, label: RECOMMENDATION_LABEL[r], value: String(summary.recommendations?.[r] ?? 0) })),
            ]} />
          ) : <p className="hi-copy">No scorecards yet. Interviewers fill them in after each interview.</p>}
        </Section>
        <Section title="Interviews" level={3} variant="panel" cardClass={false}
          actions={canWrite && schedulable && !card.convertedEmployeeId ? <Button size={32} variant="primary" icon="plus" onClick={() => setScheduling(true)}>Schedule interview</Button> : undefined}
          loading={q.isLoading} error={q.error} onRetry={() => q.refetch()}
          empty={interviews.length === 0 ? { title: 'No interviews yet', hint: canWrite && schedulable ? 'Use “Schedule interview” to book the first one.' : 'None have been scheduled.', icon: 'calendar' } : undefined}>
          <div className="hi-stack">
            {canWrite && !schedulable && <Callout tone="neutral">Interviews can be scheduled while the candidate is in Screening or Interview.</Callout>}
            {interviews.map((i) => <InterviewCard key={i.id} interview={i} actions={buttonsFor(i)} />)}
          </div>
        </Section>
      </div>
    </SidePanel>
  )
}

// ── The interviews table ─────────────────────────────────────────────────────

/** Copy a video link; a toast says whether it worked. */
function useCopyLink() {
  const toast = useToast()
  return async (link: string) => {
    try { await navigator.clipboard.writeText(link); toast.success('Interview link copied') } catch { toast.error('Couldn’t copy the link', { detail: link }) }
  }
}

function InterviewTable({ rows, loading, error, onRetry, retrying, empty, hr }: {
  rows: InterviewRow[]; loading: boolean; error: unknown; onRetry: () => void; retrying: boolean; empty: { title: string; hint: string }; hr: boolean
}) {
  const navigate = useNavigate()
  const copy = useCopyLink()
  const { menuItemsFor, panel } = useInterviewActions()
  const [scoring, setScoring] = useState<Interview | null>(null)
  const [open, setOpen] = useState<InterviewRow | null>(null)
  const today = istTodayIso()
  const scoreButton = (r: InterviewRow) => (r.mine && r.interview.started && r.interview.status === 'SCHEDULED'
    ? <Button size={30} variant={r.mine.scorecards.length ? 'secondary' : 'soft'} onClick={() => setScoring(r.mine)}>{r.mine.scorecards.length ? 'Edit scorecard' : 'Fill scorecard'}</Button>
    : null)
  const columns: TableColumn<InterviewRow>[] = [
    {
      key: 'candidate', header: 'Candidate', primary: true, width: '24%', render: (r) => (
        <button type="button" className="hi-open" onClick={() => setOpen(r)} aria-label={`Open ${r.interview.title} with ${r.interview.candidateName}`}>
          <CellPerson name={r.interview.candidateName} sub={r.interview.roleTitle} />
        </button>
      ),
    },
    { key: 'title', header: 'Interview', render: (r) => r.interview.title },
    { key: 'when', header: 'When (IST)', render: (r) => <span className="hi-num">{interviewWhen(r.interview, today)}</span> },
    { key: 'who', header: 'Interviewers', render: (r) => interviewersLine(r.interview) || '—' },
    { key: 'status', header: 'Status', render: (r) => { const s = interviewState(r.interview, today, r.mine); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => {
        const i = r.interview
        const link = i.mode === 'VIDEO' && i.location && !i.started && i.status === 'SCHEDULED' ? i.location : null
        const items: MenuEntry[] = [
          { key: 'open', label: 'See details', icon: 'eye', onSelect: () => setOpen(r) },
          ...menuItemsFor(i),
          ...(hr ? [{ key: 'pipeline', label: 'Open pipeline', icon: 'workflow', onSelect: () => navigate(`/hrms/hiring?tab=pipeline&role=${i.requisitionId}`) }] : []),
        ]
        return (
          <CellActions>
            {scoreButton(r)}
            {link && <Button size={30} variant="secondary" onClick={() => copy(link)}>Copy link</Button>}
            <Menu label={`More for ${i.title} with ${i.candidateName}`} width={240} placement="bottom-end" items={items}
              trigger={({ props }) => <Button {...props} size={30} variant="plain" icon={<MoreHorizontal size={16} />} aria-label={`More for ${i.title} with ${i.candidateName}`} />} />
          </CellActions>
        )
      },
    },
  ]
  return (
    <>
      <Section title="Coming up" body="flush" loading={loading} skeleton="table" error={error} onRetry={onRetry} retrying={retrying}
        empty={!loading && !error && rows.length === 0 ? { ...empty, icon: 'calendar' } : undefined}>
        <Table label="Interviews coming up" columns={columns} rows={rows} rowKey={(r) => r.id} mobile="cards" onRowClick={(r) => setOpen(r)} />
      </Section>
      {open && (
        <SidePanel open onClose={() => setOpen(null)} width={600} closeLabel="Close panel" title={open.interview.title}
          sub={`${open.interview.candidateName} · ${open.interview.roleTitle}`} footer={<PanelButton size="lg" onClick={() => setOpen(null)}>Close</PanelButton>}>
          <InterviewCard interview={open.interview} mine={open.mine} actions={scoreButton(open)} />
        </SidePanel>
      )}
      {scoring && <ScorecardPanel interview={scoring} onClose={() => { setScoring(null); setOpen(null) }} />}
      {panel}
    </>
  )
}

/** Hiring ?tab=interviews: what's coming up, and the interviews you are on. */
export function InterviewsTab({ scheduling, onScheduleDone }: { scheduling: boolean; onScheduleDone: () => void }) {
  const upcoming = useUpcomingInterviews()
  const mine = useMyInterviews()
  const mySummary = useMyInterviewSummary()
  const today = istTodayIso()
  const list = upcoming.data ?? []
  const rows = useMemo(() => mergeInterviews(upcoming.data ?? [], mine.data ?? []), [upcoming.data, mine.data])
  const todayCount = list.filter((i) => i.scheduledAtIst.slice(0, 10) === today).length
  const due = (mine.data ?? []).filter((i) => i.started && i.status === 'SCHEDULED' && i.scorecards.length === 0).length
  const error = upcoming.error || mine.error
  return (
    <>
      <Section title="Interviews" body="tight" loading={upcoming.isLoading} skeleton="stats" error={upcoming.error} onRetry={() => upcoming.refetch()}>
        <MiniStatGrid>
          <MiniStat label="Coming up" value={list.length} note="Scheduled, not finished" tone="info" />
          <MiniStat label="Today" value={todayCount} note="India time" tone="success" />
          <MiniStat label="Your scorecards due" value={mine.isLoading ? null : due} note="Interviews you took" tone="warning" />
          {mySummary.data && <MiniStat label="Interviews you took" value={mySummary.data.tookThisQuarter} note="This quarter" tone="neutral" />}
        </MiniStatGrid>
      </Section>
      <InterviewTable rows={rows} loading={upcoming.isLoading || mine.isLoading} error={error} retrying={upcoming.isFetching || mine.isFetching}
        onRetry={() => { void upcoming.refetch(); void mine.refetch() }} hr
        empty={{ title: 'No interviews coming up', hint: 'Open a candidate in Screening or Interview on the Pipeline to schedule one.' }} />
      {scheduling && <ScheduleInterviewPanel onClose={onScheduleDone} />}
    </>
  )
}

/** /me/interviews: for every employee who is asked to interview. */
export function MyInterviews() {
  const mine = useMyInterviews()
  const summary = useMyInterviewSummary()
  const rows = useMemo(() => mergeInterviews([], mine.data ?? []), [mine.data])
  const due = (mine.data ?? []).filter((i) => i.started && i.status === 'SCHEDULED' && i.scorecards.length === 0).length
  const upcoming = (mine.data ?? []).filter((i) => !i.started && i.status === 'SCHEDULED').length
  return (
    <PageFrame label="My interviews" width="narrow" className="hi-page">
      <PageHeader eyebrow="My workspace" title="Interviews" sub="Interviews you’ve been asked to take. Fill in your scorecard once each one has started." />
      {mine.isSuccess && rows.length === 0 ? (
        <EmptyState icon="calendar" variant="dashed" title="No interviews for you" hint="When HR adds you as an interviewer, the interview shows up here and you get a notification." />
      ) : (
        <>
          <Section title="Your interviews" body="tight" loading={mine.isLoading} skeleton="stats" error={mine.error} onRetry={() => mine.refetch()}>
            <MiniStatGrid>
              <MiniStat label="Coming up" value={upcoming} note="Scheduled, not started" tone="info" />
              <MiniStat label="Your scorecards due" value={due} note="Interviews you took" tone="warning" />
              {summary.data && <MiniStat label="Interviews you took" value={summary.data.tookThisQuarter} note="This quarter" tone="neutral" />}
            </MiniStatGrid>
          </Section>
          <InterviewTable rows={rows} loading={mine.isLoading} error={mine.error} retrying={mine.isFetching} onRetry={() => mine.refetch()} hr={false}
            empty={{ title: 'No interviews for you', hint: 'When HR adds you as an interviewer, the interview shows up here and you get a notification.' }} />
        </>
      )}
    </PageFrame>
  )
}
