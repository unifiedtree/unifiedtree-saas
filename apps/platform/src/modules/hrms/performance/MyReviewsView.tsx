// Performance · My reviews (EmpGrowth e-rev; PgGrow p-center tab 4). From real data only:
//   - my open cycle (GET /cycles/my-current, BW-84): its steps and my due date;
//   - my self-review: write, Save draft (BW-84) and Send to my manager;
//   - kind words: the strengths colleagues wrote in submitted reviews about me (no kudos feature);
//   - reviews I write for others (and other self-reviews), with the reviewee's goals;
//   - feedback about me (hidden while a cycle holds feedback until shared, BW-78).
import { useEffect, useMemo, useState } from 'react'
import {
  Button, Callout, Card, CellActions, CellPerson, EmptyState, KeyValueGrid, MiniStat, MiniStatGrid, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { Input, PanelButton, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { useMyCurrentCycles, useMyReviews, useSaveReviewDraft, useSubmitReview, type MyCycle, type PerformanceReview } from '../api/usePerformance'
import { RATING_WORDS, dayMon, isSubmitted, isWaiting, kindWords, myCycleSteps, ratingText, ratingWord, reviewStatus } from './growModel'
import { ReviewGoalsPanel } from './shared'

export function MyReviewsView() {
  const today = istToday()
  const me = useCurrentUser().data?.employeeId ?? undefined
  const reviews = useMyReviews()
  const cycles = useMyCurrentCycles()
  const [writing, setWriting] = useState<PerformanceReview | null>(null)
  const all = useMemo(() => reviews.data ?? [], [reviews.data])
  const cycle: MyCycle | undefined = cycles.data?.[0]
  const selfReview = cycle?.selfReview ? all.find((r) => r.id === cycle.selfReview!.reviewId) : undefined
  // Mine to write: I'm the reviewer, or it's my self review (no separate reviewer).
  const mineToWrite = (r: PerformanceReview) => !!me && (r.reviewerId || r.employeeId) === me
  const toWrite = all.filter((r) => mineToWrite(r) && isWaiting(r.status) && r.id !== selfReview?.id)
  const written = all.filter((r) => mineToWrite(r) && isSubmitted(r.status))
  const aboutMe = all.filter((r) => r.employeeId === me && r.reviewerId && r.reviewerId !== me)
  const words = kindWords(all, me)

  const columns: TableColumn<PerformanceReview>[] = [
    { key: 'employee', header: 'Employee', primary: true, render: (r) => r.employeeId === me
      ? <CellPerson name="Your self-review" sub={r.cycleName || undefined} />
      : <CellPerson name={r.employeeName || 'A colleague'} sub={r.department || r.employeeCode || undefined} /> },
    { key: 'cycle', header: 'Cycle', render: (r) => r.cycleName || 'Review cycle' },
    { key: 'due', header: 'Due', render: (r) => (r.dueDate ? dayMon(r.dueDate, today) : '—') },
    { key: 'status', header: 'Status', render: (r) => <StatusPill tone={r.status === 'IN_PROGRESS' ? 'info' : 'warning'}>{r.status === 'IN_PROGRESS' ? 'Draft saved' : 'To write'}</StatusPill> },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (r) => (
      <CellActions><Button size={30} onClick={() => setWriting(r)}>Write review</Button></CellActions>
    ) },
  ]

  return (
    <>
      {cycles.isLoading ? null : cycle && <CycleCard cycle={cycle} today={today} />}
      {cycle?.selfReview && selfReview && (
        <div className="grw-split">
          <SelfReviewCard review={selfReview} cycle={cycle} today={today} />
          <KindWords words={words} today={today} />
        </div>
      )}
      <Section title="Your reviews" loading={reviews.isLoading} skeleton="stats" error={reviews.error} onRetry={() => reviews.refetch()}>
        <MiniStatGrid>
          <MiniStat label="To write" value={toWrite.length + (selfReview && isWaiting(selfReview.status) ? 1 : 0)} tone="warning"
            note={cycle?.milestones?.managerReviewBy && toWrite.length ? `Due ${dayMon(cycle.milestones.managerReviewBy, today)}` : 'Reviews assigned to you'} />
          <MiniStat label="Submitted" value={written.length} note="By you" tone="success" />
          <MiniStat label="About you" value={aboutMe.filter((r) => isSubmitted(r.status)).length} note="Reviews and feedback" tone="info" />
        </MiniStatGrid>
      </Section>
      {!(cycle?.selfReview && selfReview) && words.length > 0 && <KindWords words={words} today={today} />}
      <Section title="Reviews to write" body="flush" error={reviews.error} onRetry={() => reviews.refetch()}>
        <Table label="Reviews to write" columns={columns} rows={toWrite} rowKey={(r) => r.id} loading={reviews.isLoading} mobile="cards"
          empty={<EmptyState variant="success" title="Nothing to write" hint="You’ve submitted every review assigned to you." />} />
      </Section>
      {aboutMe.length > 0 && (
        <div className="grw-stack">
          {aboutMe.map((r) => isSubmitted(r.status) ? (
            <Section key={r.id} title={`${r.cycleName || 'Review'} · about you`} sub={`By ${r.reviewerName || 'a reviewer'}${r.overallRating != null ? ` · ${r.overallRating} of 5` : ''}`}>
              <KeyValueGrid items={[
                { label: 'Strengths', value: r.strengths || '—' },
                { label: 'Areas to improve', value: r.improvements || '—' },
                { label: 'Rating', value: ratingText(r.overallRating, 'Not rated') },
              ]} />
            </Section>
          ) : (
            <Section key={r.id} title={`${r.cycleName || 'Review'} · about you`} sub={`By ${r.reviewerName || 'a reviewer'}`}>
              {r.status === 'MISSED' ? <Callout tone="warning">The cycle closed before this review was submitted.</Callout> : <Callout tone="neutral">Waiting for the reviewer’s feedback.</Callout>}
            </Section>
          ))}
        </div>
      )}
      {!reviews.isLoading && !all.length && !cycle && (
        <EmptyState icon="fileText" title="No reviews yet" hint="When a review cycle starts, the reviews you need to write and the feedback about you appear here." />
      )}
      {writing && <WriteReviewPanel review={writing} self={writing.employeeId === me} today={today} onClose={() => setWriting(null)} />}
    </>
  )
}

function CycleCard({ cycle, today }: { cycle: MyCycle; today: string }) {
  const steps = myCycleSteps(cycle, today)
  const self = cycle.selfReview
  const waiting = !!self && isWaiting(self.status)
  const head = !self ? 'Your review cycle' : waiting ? 'Your self-review is next' : 'Your part is done'
  const due = waiting && cycle.milestones?.selfReviewBy
  return (
    <Card as="section" label={cycle.name}>
      <div className="grw-stack">
        <div className="grw-cyclehead">
          <div>
            <div className="grw-cyclehead__name">{cycle.name}</div>
            <div className="grw-cyclehead__title">{head}</div>
          </div>
          {due && <StatusPill tone="amber">{`Due ${dayMon(due, today)}`}</StatusPill>}
        </div>
        <ol className="grw-bars" aria-label={`${cycle.name} steps`}>
          {steps.map((s) => (
            <li key={s.key} aria-current={s.state === 'current' ? 'step' : undefined}>
              <span className="grw-bars__bar" data-state={s.state} aria-hidden="true" />
              <span className="grw-bars__label">{s.label}</span>
              <span className="grw-bars__meta">{s.meta}</span>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  )
}

/** The rating buttons: 1 to 5 with the admin words (AUDIT §5.11). */
function RatingPicker({ value, onChange, label }: { value: number | null; onChange: (n: number) => void; label: string }) {
  return (
    <div className="grw-stack grw-stack--tight">
      <span className="grw-sub" id="grw-rate-label">{label}</span>
      <div className="grw-rates" role="group" aria-labelledby="grw-rate-label">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="grw-rate" aria-pressed={value != null && Math.floor(value) === n} onClick={() => onChange(n)}>
            <span className="grw-rate__n">{n}</span><span className="grw-rate__t">{RATING_WORDS[n]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SelfReviewCard({ review, cycle, today }: { review: PerformanceReview; cycle: MyCycle; today: string }) {
  const toast = useToast()
  const draft = useSaveReviewDraft()
  const submit = useSubmitReview()
  const [strengths, setStrengths] = useState(review.strengths ?? '')
  const [improvements, setImprovements] = useState(review.improvements ?? '')
  const [rating, setRating] = useState<number | null>(review.overallRating ?? null)
  const [error, setError] = useState('')
  useEffect(() => { setStrengths(review.strengths ?? ''); setImprovements(review.improvements ?? ''); setRating(review.overallRating ?? null) }, [review.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const manager = cycle.managerReview?.reviewerName
  const first = manager ? manager.split(' ')[0] : null
  const sent = isSubmitted(review.status)
  const busy = draft.isPending || submit.isPending
  const save = async () => {
    setError('')
    try { await draft.mutateAsync({ id: review.id, strengths, improvements, overallRating: rating }); toast.success('Draft saved') }
    catch (e) { setError(errorText(e, 'Couldn’t save the draft.')) }
  }
  const send = async () => {
    if (rating == null) { setError('Pick how the period went overall, from 1 to 5.'); return }
    setError('')
    try {
      await submit.mutateAsync({ id: review.id, overallRating: rating, strengths: strengths.trim() || undefined, improvements: improvements.trim() || undefined })
      toast.success(first ? `Self-review sent to ${manager}` : 'Self-review sent')
    } catch (e) { setError(errorText(e, 'Couldn’t send the self-review.')) }
  }
  return (
    <Section title="Your self-review">
      {sent ? (
        <Callout tone="success" icon="check">{sentLine(manager, first, cycle, today)}</Callout>
      ) : (
        <div className="grw-form">
          <ReviewGoalsPanel reviewId={review.id} selfReview />
          <Textarea label="What went well this period?" rows={3} maxLength={5000} value={strengths} onChange={(e) => setStrengths(e.target.value)} />
          <Textarea label="What would you do differently?" rows={3} maxLength={5000} value={improvements} onChange={(e) => setImprovements(e.target.value)}
            placeholder={first ? `Be honest. ${first} reads this before your chat.` : undefined} />
          <RatingPicker label="How did the period go overall?" value={rating} onChange={setRating} />
          {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
          <div className="grw-row" style={{ justifyContent: 'flex-end' }}>
            <Button variant="secondary" loading={draft.isPending} disabled={busy} onClick={save}>Save draft</Button>
            <Button loading={submit.isPending} disabled={busy} onClick={send}>{first ? `Send to ${first}` : 'Send'}</Button>
          </div>
        </div>
      )}
    </Section>
  )
}

/** "Sent to Dept Manager. Dept writes their part by Fri, 9 Oct. You’ll see the feedback once HR shares it." */
function sentLine(manager: string | null | undefined, first: string | null, cycle: MyCycle, today: string): string {
  const m = cycle.milestones
  const parts = [manager ? `Sent to ${manager}.` : 'Sent.']
  if (cycle.managerReview && !isSubmitted(cycle.managerReview.status)) {
    parts.push(`${first ?? 'Your manager'} writes their part${m?.managerReviewBy ? ` by ${dayMon(m.managerReviewBy, today)}` : ''}.`)
  }
  if (cycle.feedbackHeld) parts.push(`You’ll see the feedback once HR shares it${m?.shareOn ? ` (planned ${dayMon(m.shareOn, today)})` : ''}.`)
  return parts.join(' ')
}

function KindWords({ words, today }: { words: { id: string; quote: string; who: string; date: string | null }[]; today: string }) {
  return (
    <Section title="Kind words" sub="Strengths colleagues wrote in reviews about you."
      empty={words.length === 0 ? { title: 'Nothing yet', hint: 'What colleagues write under strengths shows here once it’s shared with you.', icon: 'star', variant: 'plain' } : undefined}>
      {words.length > 0 && (
        <div className="grw-quotes">
          {words.map((w) => (
            <figure key={w.id} className="grw-quote">
              <blockquote>{`“${w.quote}”`}</blockquote>
              <figcaption>{[w.who, w.date ? dayMon(w.date, today) : null].filter(Boolean).join(' · ')}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </Section>
  )
}

/** Write a review for someone (or another self-review): rating 0–5 (decimals kept), what went well, what next. */
function WriteReviewPanel({ review, self, today, onClose }: { review: PerformanceReview; self: boolean; today: string; onClose: () => void }) {
  const toast = useToast()
  const draft = useSaveReviewDraft()
  const submit = useSubmitReview()
  const [rating, setRating] = useState(review.overallRating != null ? String(review.overallRating) : '')
  const [strengths, setStrengths] = useState(review.strengths ?? '')
  const [improvements, setImprovements] = useState(review.improvements ?? '')
  const [error, setError] = useState('')
  const busy = draft.isPending || submit.isPending
  const value = rating.trim() === '' ? null : Number(rating)
  const valid = value != null && Number.isFinite(value) && value >= 0 && value <= 5
  const who = self ? 'your self-review' : review.employeeName || 'a colleague'
  const st = reviewStatus(review.status)
  const doDraft = async () => {
    if (value != null && !valid) { setError('Enter a rating from 0 to 5.'); return }
    setError('')
    try { await draft.mutateAsync({ id: review.id, overallRating: value, strengths, improvements }); toast.success('Draft saved') }
    catch (e) { setError(errorText(e, 'Couldn’t save the draft.')) }
  }
  const doSubmit = async () => {
    if (!valid) { setError('Enter a rating from 0 to 5.'); return }
    setError('')
    try {
      await submit.mutateAsync({ id: review.id, overallRating: value!, strengths: strengths.trim() || undefined, improvements: improvements.trim() || undefined })
      toast.success('Review submitted'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t submit the review.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} width={600} title={self ? 'Write your self-review' : `Write review · ${review.employeeName || 'Colleague'}`}
      sub={[review.cycleName, review.dueDate ? `due ${dayMon(review.dueDate, today)}` : null].filter(Boolean).join(' · ')}
      footer={<>
        <PanelButton variant="secondary" size="lg" disabled={busy} onClick={doDraft}>Save draft</PanelButton>
        <PanelButton variant="primary" size="lg" busy={submit.isPending} onClick={doSubmit}>Submit review</PanelButton>
      </>}>
      <div className="grw-form">
        <div className="grw-row grw-row--between"><span className="grw-muted">{`Writing ${who}`}</span><StatusPill tone={st.tone} size="sm">{st.label}</StatusPill></div>
        <ReviewGoalsPanel reviewId={review.id} selfReview={self} />
        <Input label="Overall rating (0–5)" type="number" min={0} max={5} step={0.1} value={rating} onChange={(e) => setRating(e.target.value)}
          hint={valid ? `${value} · ${ratingWord(value)}` : '5 Outstanding · 4 Exceeds · 3 Meets · 2 Needs support · 1 Below'} />
        <Textarea label="What went well" rows={3} maxLength={5000} value={strengths} onChange={(e) => setStrengths(e.target.value)} placeholder="Specific examples from this period" />
        <Textarea label="What to focus on next" rows={3} maxLength={5000} value={improvements} onChange={(e) => setImprovements(e.target.value)} placeholder="One or two things for next period" />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}
