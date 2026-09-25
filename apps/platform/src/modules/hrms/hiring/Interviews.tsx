// Interviews and scorecards (V143.20), built from the module kit:
//  - ScheduleInterviewDrawer: book or change an interview (IST date and time,
//    duration, in person / video / phone, where or the link, interviewers,
//    the criteria they rate). Needs hrms.hiring.interview.write.
//  - ScorecardDrawer: an assigned interviewer rates each criterion 1-5, adds
//    strengths and concerns, and recommends strong yes / yes / no / strong no.
//  - CandidateDrawer: one candidate's facts, scorecard summary and interviews.
//  - InterviewsTab (Hiring ?tab=interviews) and MyInterviews (/me/interviews).
// Hiring roles (hrms.hiring.read) see every scorecard; an interviewer sees only
// their own. Interviewers are notified of every change by the server.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrDrawer, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { ModulePage, Panel, Facts, Note, RowList, Row, State, StatRow, SubHeading, todayIso } from '@/design/module/ModuleKit'
import { PerformanceEmployeePicker as EmployeePicker } from '../performance/PerformanceEmployeePicker'
import {
  useCandidateInterviews, useUpcomingInterviews, useMyInterviews, useScheduleInterview, useRescheduleInterview,
  useCancelInterview, useSubmitScorecard, inr, istWhen,
  DEFAULT_CRITERIA, MODE_LABEL, RECOMMENDATIONS, RECOMMENDATION_LABEL, SCHEDULABLE_STAGES,
  type CandidateCard, type Interview, type InterviewMode, type Recommendation, type ScorecardSummary,
} from '../api/useHiring'

const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'
const fmtEnum = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())
const REC_TONE: Record<Recommendation, PillTone> = { STRONG_YES: 'green', YES: 'ok', NO: 'orange', STRONG_NO: 'red' }
const RATING_LABEL = ['', '1 · Poor', '2 · Below the bar', '3 · Meets the bar', '4 · Strong', '5 · Exceptional']
const errMsg = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
const tomorrowIso = () => { const d = new Date(Date.now() + 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

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

export function ScheduleInterviewDrawer({ candidateId, candidateName, interview, onClose }: {
  candidateId: string; candidateName: string; interview?: Interview; onClose: () => void
}) {
  const { toast } = useToast()
  const schedule = useScheduleInterview()
  const reschedule = useRescheduleInterview()
  const busy = schedule.isPending || reschedule.isPending
  const [title, setTitle] = useState(interview?.title ?? '')
  const [date, setDate] = useState(interview ? interview.scheduledAtIst.slice(0, 10) : tomorrowIso())
  const [time, setTime] = useState(interview ? interview.scheduledAtIst.slice(11, 16) : '10:00')
  const [duration, setDuration] = useState(String(interview?.durationMinutes ?? 45))
  const [mode, setMode] = useState<InterviewMode>(interview?.mode ?? 'VIDEO')
  const [location, setLocation] = useState(interview?.location ?? '')
  const [people, setPeople] = useState<{ id: string; name: string }[]>(interview?.interviewers.map((p) => ({ id: p.employeeId, name: p.name })) ?? [])
  const [criteria, setCriteria] = useState((interview?.criteria ?? DEFAULT_CRITERIA).join(', '))
  const [notes, setNotes] = useState(interview?.notes ?? '')
  const durations = ['15', '30', '45', '60', '90', '120', '180'].includes(duration) ? ['15', '30', '45', '60', '90', '120', '180'] : [duration, '15', '30', '45', '60', '90', '120', '180']
  const where = mode === 'VIDEO' ? { l: 'Video call link', ph: 'https://…', hint: 'Interviewers get this link in their notification.' }
    : mode === 'IN_PERSON' ? { l: 'Where', ph: 'e.g. 3rd floor meeting room, Hyderabad office', hint: '' }
      : { l: 'Phone number or note (optional)', ph: 'e.g. The candidate will call on +91…', hint: '' }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!people.length) { toast('Choose at least one interviewer', 'error'); return }
    const body = {
      title: title.trim() || undefined, scheduledAt: `${date}T${time}`, durationMinutes: Number(duration), mode,
      location: location.trim() || undefined, interviewerIds: people.map((p) => p.id),
      criteria: criteria.split(',').map((c) => c.trim()).filter(Boolean), notes: notes.trim() || undefined,
    }
    try {
      if (interview) await reschedule.mutateAsync({ id: interview.id, ...body })
      else await schedule.mutateAsync({ candidateId, ...body })
      toast(interview ? 'Interview updated. The interviewers were told.' : 'Interview scheduled. The interviewers were told.', 'success')
      onClose()
    } catch (err) { toast(errMsg(err), 'error') }
  }

  return (
    <HrDrawer title={interview ? 'Change interview' : 'Schedule an interview'} onClose={onClose} width="max-w-xl"
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="interview-form" disabled={busy}>{busy ? 'Saving…' : interview ? 'Save changes' : 'Schedule'}</HrButton></>}>
      <form id="interview-form" onSubmit={submit} className="space-y-4">
        <p className="text-sm text-text-secondary">{`With ${candidateName}. Times are India time (IST).`}</p>
        <div><label className={label} htmlFor="iv-title">Interview name</label><input id="iv-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Technical round" className="ut-input" /></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={label} htmlFor="iv-date">Date</label><input id="iv-date" type="date" required min={interview ? undefined : todayIso()} value={date} onChange={(e) => setDate(e.target.value)} className="ut-input" /></div>
          <div><label className={label} htmlFor="iv-time">Time (IST)</label><input id="iv-time" type="time" required value={time} onChange={(e) => setTime(e.target.value)} className="ut-input" /></div>
          <div><label className={label} htmlFor="iv-dur">Duration</label>
            <select id="iv-dur" value={duration} onChange={(e) => setDuration(e.target.value)} className="ut-select">
              {durations.map((d) => <option key={d} value={d}>{Number(d) < 60 ? `${d} min` : `${Number(d) / 60} h`.replace('.5 h', ' h 30 min')}</option>)}
            </select>
          </div>
        </div>
        {interview?.started && <p className="text-xs text-text-tertiary">This interview has already started. Keep its date and time to change only the interviewers (for example to add the person who took it, so they can file a scorecard). A new time must be in the future.</p>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label className={label} htmlFor="iv-mode">How</label>
            <select id="iv-mode" value={mode} onChange={(e) => setMode(e.target.value as InterviewMode)} className="ut-select">
              {(Object.keys(MODE_LABEL) as InterviewMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2"><label className={label} htmlFor="iv-where">{where.l}</label>
            <input id="iv-where" value={location} maxLength={500} required={mode !== 'PHONE'} type={mode === 'VIDEO' ? 'url' : 'text'} onChange={(e) => setLocation(e.target.value)} placeholder={where.ph} className="ut-input" />
            {where.hint && <p className="mt-1 text-xs text-text-tertiary">{where.hint}</p>}
          </div>
        </div>
        <div>
          <span className={label}>Interviewers</span>
          {people.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {people.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1">
                  <HrStatusPill tone="info">{p.name}</HrStatusPill>
                  <HrButton type="button" size="sm" variant="ghost" onClick={() => setPeople((x) => x.filter((y) => y.id !== p.id))} aria-label={`Remove ${p.name}`}>Remove</HrButton>
                </span>
              ))}
            </div>
          )}
          <EmployeePicker value="" onChange={(emp) => setPeople((x) => (x.some((y) => y.id === emp.id) || x.length >= 10 ? x : [...x, { id: emp.id, name: `${emp.firstName} ${emp.lastName || ''}`.trim() }]))} />
          <p className="mt-1 text-xs text-text-tertiary">Up to 10. Each one is notified and fills in their own scorecard after the interview.</p>
        </div>
        <div><label className={label} htmlFor="iv-criteria">What interviewers rate (comma separated)</label>
          <input id="iv-criteria" value={criteria} onChange={(e) => setCriteria(e.target.value)} className="ut-input" />
          <p className="mt-1 text-xs text-text-tertiary">Each criterion is rated from 1 to 5 on the scorecard. Leave empty for the standard four.</p>
        </div>
        <div><label className={label} htmlFor="iv-notes">Notes for the interviewers</label><textarea id="iv-notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Optional: what to focus on, the candidate's CV link…" className="ut-input resize-none" /></div>
      </form>
    </HrDrawer>
  )
}

// ── Scorecard ────────────────────────────────────────────────────────────────

export function ScorecardDrawer({ interview, onClose }: { interview: Interview; onClose: () => void }) {
  const { toast } = useToast()
  const submit = useSubmitScorecard()
  const mine = interview.scorecards[0]
  const [ratings, setRatings] = useState<Record<string, string>>(() => Object.fromEntries(interview.criteria.map((c) => [c, String(mine?.ratings.find((r) => r.criterion === c)?.rating ?? '')])))
  const [strengths, setStrengths] = useState(mine?.strengths ?? '')
  const [concerns, setConcerns] = useState(mine?.concerns ?? '')
  const [rec, setRec] = useState<Recommendation | ''>(mine?.recommendation ?? '')
  const save = async (e: FormEvent) => {
    e.preventDefault()
    const missing = interview.criteria.filter((c) => !ratings[c])
    if (missing.length) { toast(`Rate ${missing.join(', ')}`, 'error'); return }
    if (!rec) { toast('Choose your recommendation', 'error'); return }
    try {
      await submit.mutateAsync({ id: interview.id, ratings: interview.criteria.map((c) => ({ criterion: c, rating: Number(ratings[c]) })), strengths: strengths.trim() || undefined, concerns: concerns.trim() || undefined, recommendation: rec })
      toast(mine ? 'Scorecard updated' : 'Scorecard submitted', 'success')
      onClose()
    } catch (err) { toast(errMsg(err), 'error') }
  }
  return (
    <HrDrawer title={mine ? 'Your scorecard' : 'Submit your scorecard'} onClose={onClose}
      footer={<><HrButton variant="ghost" onClick={onClose}>Cancel</HrButton><HrButton type="submit" form="scorecard-form" disabled={submit.isPending || !interview.started}>{submit.isPending ? 'Saving…' : mine ? 'Save changes' : 'Submit scorecard'}</HrButton></>}>
      <form id="scorecard-form" onSubmit={save} className="space-y-4">
        <p className="text-sm text-text-secondary">{`${interview.candidateName} · ${interview.roleTitle} · ${interview.title} · ${istWhen(interview.scheduledAt)} IST`}</p>
        {!interview.started && <Note tone="amber">You can fill in the scorecard once the interview has started.</Note>}
        <Note>Only the hiring team (HR) sees your scorecard. The other interviewers don't see what you wrote.</Note>
        {interview.criteria.map((c, i) => (
          <div key={c}><label className={label} htmlFor={`sc-${i}`}>{c}</label>
            <select id={`sc-${i}`} value={ratings[c]} onChange={(e) => setRatings((r) => ({ ...r, [c]: e.target.value }))} className="ut-select">
              <option value="">Choose a rating</option>
              {[5, 4, 3, 2, 1].map((n) => <option key={n} value={String(n)}>{RATING_LABEL[n]}</option>)}
            </select>
          </div>
        ))}
        <div><label className={label} htmlFor="sc-str">Strengths</label><textarea id="sc-str" value={strengths} maxLength={4000} onChange={(e) => setStrengths(e.target.value)} rows={3} placeholder="What stood out" className="ut-input resize-none" /></div>
        <div><label className={label} htmlFor="sc-con">Concerns</label><textarea id="sc-con" value={concerns} maxLength={4000} onChange={(e) => setConcerns(e.target.value)} rows={3} placeholder="Gaps or risks" className="ut-input resize-none" /></div>
        <div><label className={label} htmlFor="sc-rec">Your recommendation</label>
          <select id="sc-rec" value={rec} onChange={(e) => setRec(e.target.value as Recommendation)} className="ut-select">
            <option value="">Choose one</option>
            {RECOMMENDATIONS.map((r) => <option key={r} value={r}>{RECOMMENDATION_LABEL[r]}</option>)}
          </select>
        </div>
      </form>
    </HrDrawer>
  )
}

// ── One interview ────────────────────────────────────────────────────────────

function InterviewBlock({ interview, showCandidate, actions }: { interview: Interview; showCandidate?: boolean; actions?: ReactNode }) {
  const cancelled = interview.status === 'CANCELLED'
  const pending = interview.interviewers.filter((p) => !p.submitted).length
  const [pill, tone]: [string, PillTone] = cancelled ? ['Cancelled', 'gray'] : !interview.started ? ['Scheduled', 'info'] : pending ? ['Awaiting scorecards', 'warn'] : ['Scorecards in', 'ok']
  return (
    <Panel pad={16} title={showCandidate ? `${interview.candidateName} · ${interview.title}` : interview.title}
      sub={`${istWhen(interview.scheduledAt)} IST · ${interview.durationMinutes} min · ${MODE_LABEL[interview.mode]}${showCandidate ? ` · ${interview.roleTitle}` : ''}`}
      aside={<HrStatusPill tone={tone}>{pill}</HrStatusPill>}>
      <Facts min={170} items={[
        { k: interview.mode === 'VIDEO' ? 'Link' : 'Where', v: interview.location ? (interview.mode === 'VIDEO' ? <a href={interview.location} target="_blank" rel="noopener noreferrer" className="text-accent-fg hover:underline">Join call</a> : interview.location) : '—' },
        { k: 'Interviewers', v: interview.interviewers.map((p) => `${p.name}${p.submitted ? ' ✓' : ''}`).join(', ') || '—' },
        { k: 'Rated on', v: interview.criteria.join(', ') },
      ]} />
      {interview.notes && <Note>{interview.notes}</Note>}
      {cancelled && <Note>{`Cancelled${interview.cancelReason ? `: ${interview.cancelReason}` : '.'}`}</Note>}
      {interview.scorecards.length > 0 && (
        <RowList>
          {interview.scorecards.map((s) => (
            <Row key={s.id} title={`${s.interviewerName || 'Interviewer'} · ${Number(s.overallRating).toFixed(1)} / 5`}
              meta={s.ratings.map((r) => `${r.criterion} ${r.rating}`).join(' · ')}
              note={[s.strengths ? `Strengths: ${s.strengths}` : '', s.concerns ? `Concerns: ${s.concerns}` : ''].filter(Boolean).join('  ·  ') || undefined}
              trail={<HrStatusPill tone={REC_TONE[s.recommendation]}>{RECOMMENDATION_LABEL[s.recommendation]}</HrStatusPill>} />
          ))}
        </RowList>
      )}
      {actions ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div> : null}
    </Panel>
  )
}

/** Reschedule / Cancel for HR on an interview that is still open (no feedback yet). */
function useInterviewActions() {
  const canWrite = usePermission('hrms.hiring.interview.write')
  const cancel = useCancelInterview()
  const confirm = useConfirmDialog()
  const { toast } = useToast()
  const [editing, setEditing] = useState<Interview | null>(null)
  const actionsFor = (i: Interview) => (canWrite && i.status === 'SCHEDULED' && i.scorecards.length === 0 ? (
    <>
      <HrButton size="sm" variant="ghost" onClick={() => setEditing(i)}>Reschedule</HrButton>
      <HrButton size="sm" variant="ghost" disabled={cancel.isPending} onClick={async () => {
        const ok = await confirm({ title: `Cancel “${i.title}” with ${i.candidateName}?`, body: 'Every interviewer is told it is cancelled. This can’t be undone; schedule a new interview if it should happen later.', confirmLabel: 'Cancel interview', cancelLabel: 'Keep it', tone: 'danger' })
        if (!ok) return
        try { await cancel.mutateAsync({ id: i.id }); toast('Interview cancelled. The interviewers were told.', 'success') } catch (e) { toast(errMsg(e), 'error') }
      }}>Cancel interview</HrButton>
    </>
  ) : null)
  const drawer = editing ? <ScheduleInterviewDrawer candidateId={editing.candidateId} candidateName={editing.candidateName} interview={editing} onClose={() => setEditing(null)} /> : null
  return { actionsFor, drawer, editing: !!editing }
}

// ── Candidate drawer ─────────────────────────────────────────────────────────

export function CandidateDrawer({ card, onClose }: { card: CandidateCard; onClose: () => void }) {
  const canWrite = usePermission('hrms.hiring.interview.write')
  const q = useCandidateInterviews(card.id)
  const [scheduling, setScheduling] = useState(false)
  const { actionsFor, drawer, editing } = useInterviewActions()
  const interviews = useMemo(() => q.data ?? [], [q.data])
  const summary = q.data ? summarise(interviews) : card.scorecards
  const schedulable = SCHEDULABLE_STAGES.includes(card.stage)
  if (scheduling) return <ScheduleInterviewDrawer candidateId={card.id} candidateName={card.fullName} onClose={() => setScheduling(false)} />
  if (editing) return drawer
  return (
    <HrDrawer title={card.fullName} onClose={onClose} width="max-w-2xl">
      <div style={{ display: 'grid', gap: 16 }}>
        <Facts items={[
          { k: 'Stage', v: fmtEnum(card.stage) },
          { k: 'Role', v: card.requisitionTitle || '—' },
          { k: 'Source', v: card.source || '—' },
          { k: 'Expects', v: card.expectedCtc != null ? inr(card.expectedCtc) : '—' },
          { k: 'Email', v: card.email || '—' },
          { k: 'Phone', v: card.phone || '—' },
        ]} />
        <SubHeading>Scorecards</SubHeading>
        {summary.count ? (
          <Facts items={[
            { k: 'Scorecards', v: String(summary.count) },
            { k: 'Average', v: summary.averageRating != null ? `${Number(summary.averageRating).toFixed(1)} / 5` : '—' },
            ...RECOMMENDATIONS.map((r) => ({ k: RECOMMENDATION_LABEL[r], v: String(summary.recommendations?.[r] ?? 0) })),
          ]} />
        ) : <Note>No scorecards yet. Interviewers fill them in after each interview.</Note>}
        <SubHeading aside={canWrite && schedulable && !card.convertedEmployeeId ? <HrButton size="sm" onClick={() => setScheduling(true)}>Schedule interview</HrButton> : undefined}>Interviews</SubHeading>
        {canWrite && !schedulable && <Note>Interviews can be scheduled while the candidate is in Screening or Interview.</Note>}
        {q.isLoading ? <State kind="loading" height={120} />
          : q.error ? <State kind="error" title="Couldn’t load the interviews" description={errMsg(q.error)} onRetry={() => q.refetch()} />
            : interviews.length === 0 ? <State kind="empty" icon="calendar" title="No interviews yet" description={canWrite && schedulable ? 'Use “Schedule interview” to book the first one.' : 'None have been scheduled.'} />
              : interviews.map((i) => <InterviewBlock key={i.id} interview={i} actions={actionsFor(i)} />)}
      </div>
    </HrDrawer>
  )
}

// ── Lists ────────────────────────────────────────────────────────────────────

/** The interviews the signed-in person is on, with their scorecard. */
function MyInterviewList({ emptyText }: { emptyText: string }) {
  const q = useMyInterviews()
  const [scoring, setScoring] = useState<Interview | null>(null)
  const list = q.data ?? []
  if (q.isLoading) return <State kind="loading" height={120} />
  if (q.error) return <State kind="error" title="Couldn’t load your interviews" description={errMsg(q.error)} onRetry={() => q.refetch()} />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {list.length === 0 ? <State kind="empty" icon="calendar" title="No interviews for you" description={emptyText} />
        : list.map((i) => (
          <InterviewBlock key={i.id} interview={i} showCandidate actions={
            i.started ? <HrButton size="sm" variant={i.scorecards.length ? 'ghost' : undefined} onClick={() => setScoring(i)}>{i.scorecards.length ? 'Edit your scorecard' : 'Submit your scorecard'}</HrButton>
              : <span style={{ fontSize: 12.5, color: '#64748b' }}>Your scorecard opens when the interview starts.</span>
          } />
        ))}
      {scoring && <ScorecardDrawer interview={scoring} onClose={() => setScoring(null)} />}
    </div>
  )
}

/** Hiring ?tab=interviews: what's coming up, and the interviews you are on. */
export function InterviewsTab() {
  const upcoming = useUpcomingInterviews()
  const mine = useMyInterviews()
  const { actionsFor, drawer } = useInterviewActions()
  const list = upcoming.data ?? []
  const today = todayIso()
  const todayCount = list.filter((i) => i.scheduledAtIst.slice(0, 10) === today).length
  const awaiting = (mine.data ?? []).filter((i) => i.started && i.scorecards.length === 0).length
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {upcoming.isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'calendarClock', color: 'blue', label: 'Coming up', value: String(list.length), sub: 'Scheduled, not finished' },
        { icon: 'calendar', color: 'green', label: 'Today', value: String(todayCount), sub: 'India time' },
        { icon: 'clipboard', color: 'orange', label: 'Your scorecards due', value: String(awaiting), sub: 'Interviews you took' },
      ]} />}
      <SubHeading>Your interviews</SubHeading>
      <MyInterviewList emptyText="When HR adds you as an interviewer, the interview shows up here." />
      <SubHeading>Upcoming interviews</SubHeading>
      {upcoming.isLoading ? <State kind="loading" height={160} />
        : upcoming.error ? <State kind="error" title="Couldn’t load the interviews" description={errMsg(upcoming.error)} onRetry={() => upcoming.refetch()} />
          : list.length === 0 ? <State kind="empty" icon="calendar" title="No interviews coming up" description="Open a candidate in Screening or Interview on the Pipeline to schedule one." />
            : list.map((i) => <InterviewBlock key={i.id} interview={i} showCandidate actions={<>
              {actionsFor(i)}
              <Link to={`/hrms/hiring?tab=pipeline&role=${i.requisitionId}`} className="text-[13px] font-semibold text-accent-fg hover:underline" style={{ alignSelf: 'center' }}>Open pipeline →</Link>
            </>} />)}
      {drawer}
    </div>
  )
}

/** /me/interviews: for every employee who is asked to interview. */
export function MyInterviews() {
  return (
    <ModulePage crumb="My workspace" title="Interviews" subtitle="Interviews you’ve been asked to take. Fill in your scorecard once each one has started.">
      <MyInterviewList emptyText="When HR adds you as an interviewer, the interview shows up here and you get a notification." />
    </ModulePage>
  )
}
