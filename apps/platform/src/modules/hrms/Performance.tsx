// Performance (/hrms/performance) on the module kit.
//   - hrms.performance.read: Review cycles, Employee reviews, Goals & KPIs.
//     (The page used to list these three twice under a second set of names.)
//   - hrms.performance.review.self: My goals and My reviews. "My reviews" is
//     what the API returns for /reviews/my: reviews the viewer has to write,
//     and reviews written about them.
//   - People (hrms.performance.read): the performance directory; each person
//     opens their own page (/hrms/performance/employees/:id). Managers see
//     their team only (the API scopes it).
//   - While writing a review the reviewee's goals and KPIs for the cycle are
//     shown; My goals shows each goal's progress history (value, when, who, note).
import React, { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { ModulePage, Views, useView, StatRow, State, Panel, SubHeading, Note, useDesignToast, dmy, CARD, HEAD_FONT } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import {
  useMyReviews, useSubmitReview, useMyGoals, useCreateGoal, useUpdateGoalProgress, useMyGoalHistory,
  type ReviewStatus, type GoalStatus, type PerformanceReview, type Goal,
} from './api/usePerformance'
import { AdminKpis } from './performance/AdminKpis'
import { AdminCycles } from './performance/AdminCycles'
import { AdminReviews } from './performance/AdminReviews'
import { PerformanceDirectory } from './performance/PerformanceDirectory'
import { ReviewGoalsPanel, GoalHistoryList } from './performance/shared'

export const REVIEW_TONE: Record<ReviewStatus, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', MISSED: 'red', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal' }
export const GOAL_TONE: Record<GoalStatus, PillTone> = { ACTIVE: 'info', AT_RISK: 'warn', COMPLETED: 'ok', DROPPED: 'gray' }
/** "AT_RISK" → "At risk" */
export const words = (v?: string | null) => (v || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

type Tab = 'cycles' | 'reviews' | 'kpis' | 'people' | 'my-goals' | 'my-reviews'

export const Performance: React.FC = () => {
  const canSelf = usePermission('hrms.performance.review.self')
  const canRead = usePermission('hrms.performance.read')
  const views = [
    ...(canRead ? [
      { key: 'cycles', label: 'Review cycles', icon: 'calendarDays' },
      { key: 'reviews', label: 'Employee reviews', icon: 'clipboard' },
      { key: 'kpis', label: 'Goals & KPIs', icon: 'target' },
      { key: 'people', label: 'People', icon: 'users' },
    ] : []),
    ...(canSelf ? [{ key: 'my-reviews', label: 'My reviews', icon: 'fileText' }, { key: 'my-goals', label: 'My goals', icon: 'checkCircle' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Performance" title="Performance"
      subtitle={canRead ? 'Run review cycles, read feedback and track company goals.' : 'Your reviews and the goals you’re working towards.'}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Performance views" />}
        {views.length === 0 && <State kind="empty" icon="lock" title="No performance access" description="Ask an admin if you should see reviews or goals." />}
        {tab === 'cycles' && canRead && <AdminCycles />}
        {tab === 'reviews' && canRead && <AdminReviews />}
        {tab === 'kpis' && canRead && <AdminKpis />}
        {tab === 'people' && canRead && <PerformanceDirectory />}
        {tab === 'my-reviews' && canSelf && <MyReviews />}
        {tab === 'my-goals' && canSelf && <MyGoals />}
      </div>
    </ModulePage>
  )
}

function Bar({ pct }: { pct: number }) {
  return (
    <span aria-hidden="true" style={{ display: 'block', height: 8, borderRadius: 999, background: '#eef2f6', overflow: 'hidden' }}>
      <span style={{ display: 'block', height: '100%', width: `${Math.max(0, Math.min(100, pct))}%`, background: '#059669', borderRadius: 999 }} />
    </span>
  )
}

// ── My goals ─────────────────────────────────────────────────────────────────
function MyGoals() {
  const { show, node } = useDesignToast()
  const { data: goals = [], isLoading, isError, error, refetch } = useMyGoals()
  const create = useCreateGoal()
  const updateProgress = useUpdateGoalProgress()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState('')
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [historyOpen, setHistoryOpen] = useState<string | null>(null)
  const stats = useMemo(() => ({
    active: goals.filter((g) => g.status === 'ACTIVE' || g.status === 'AT_RISK').length,
    completed: goals.filter((g) => g.status === 'COMPLETED').length,
    avg: goals.length ? Math.round(goals.reduce((s, g) => s + (g.progress ?? 0), 0) / goals.length) : 0,
  }), [goals])
  const onCreate = async () => {
    if (!title.trim()) { show('Give the goal a title', true); return }
    if (weight && (!Number.isInteger(Number(weight)) || Number(weight) < 0 || Number(weight) > 100)) { show('Weight must be a whole number from 0 to 100', true); return }
    try {
      await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined, weight: weight ? parseInt(weight, 10) : undefined })
      show('Goal added'); setTitle(''); setDescription(''); setWeight('')
    } catch (e) { show('Couldn’t add the goal', true, (e as Error)?.message) }
  }
  const onSave = async (id: string, progress: number) => {
    const note = (notes[id] ?? '').trim()
    if (note.length > 1000) { show('Keep the note under 1,000 characters', true); return }
    try {
      await updateProgress.mutateAsync({ id, progress, note: note || undefined })
      show('Progress saved')
      setDrafts((p) => { const n = { ...p }; delete n[id]; return n })
      setNotes((p) => { const n = { ...p }; delete n[id]; return n })
    } catch (e) { show('Couldn’t save progress', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'target', color: 'blue', label: 'Goals', value: String(goals.length), sub: `${stats.active} in progress` },
        { icon: 'checkCircle', color: 'green', label: 'Completed', value: String(stats.completed), sub: 'Reached' },
        { icon: 'chart', color: 'orange', label: 'Average progress', value: `${stats.avg}%`, sub: 'Across all your goals' },
      ]} />}
      <Panel title="Add a goal" sub="Your own goals. Company KPIs assigned to you appear here too, and are updated by your performance admin.">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1"><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor="goal-title">Goal</label><input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship the billing revamp" className="ut-input" /></div>
          <div className="min-w-[180px] flex-1"><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor="goal-desc">Description</label><input id="goal-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className="ut-input" /></div>
          <div><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor="goal-weight">Weight</label><input id="goal-weight" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0–100" className="ut-input w-24" /></div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add goal</HrButton>
        </div>
      </Panel>
      {isError ? <State kind="error" title="Couldn’t load your goals" description={(error as Error)?.message} onRetry={() => refetch()} />
        : isLoading ? <State kind="loading" />
          : goals.length === 0 ? <State kind="empty" icon="target" title="No goals yet" description="Add your first goal above to start tracking progress." />
            : (
              <div style={{ display: 'grid', gap: 10 }}>
                {goals.map((g) => {
                  const value = drafts[g.id] ?? g.progress
                  const dirty = drafts[g.id] !== undefined && drafts[g.id] !== g.progress
                  const kpi = g.targetValue != null
                  return (
                    <article key={g.id} style={{ ...CARD, padding: '14px 18px', display: 'grid', gap: 10 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 }}>
                        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
                          <h3 style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 15, fontWeight: 700 }}>{g.title}</h3>
                          {g.description && <p style={{ margin: '3px 0 0', fontSize: 13, color: '#64748b' }}>{g.description}</p>}
                        </div>
                        {kpi && <HrStatusPill tone="purple">Company KPI</HrStatusPill>}
                        {g.weight > 0 && <span style={{ fontSize: 12.5, color: '#64748b' }}>{`Weight ${g.weight}`}</span>}
                        <HrStatusPill tone={GOAL_TONE[g.status]}>{words(g.status)}</HrStatusPill>
                        <HrButton size="sm" variant="ghost" aria-expanded={historyOpen === g.id} onClick={() => setHistoryOpen(historyOpen === g.id ? null : g.id)}>{historyOpen === g.id ? 'Hide history' : 'History'}</HrButton>
                      </div>
                      {kpi ? (
                        <div style={{ display: 'grid', gap: 6 }}>
                          <Bar pct={g.progress} />
                          <span style={{ fontSize: 12.5, color: '#475569' }}>{`${g.currentValue ?? 0} of ${g.targetValue} ${g.unit || ''} · ${g.progress}%`.trim()}</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <input type="range" min={0} max={100} value={value} aria-label={`Progress on ${g.title}`} disabled={g.status === 'DROPPED'}
                            onChange={(e) => setDrafts((p) => ({ ...p, [g.id]: parseInt(e.target.value, 10) }))} className="h-2 flex-1 cursor-pointer accent-[#059669]" />
                          <span style={{ width: 44, textAlign: 'right', fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{`${value}%`}</span>
                          <HrButton size="sm" variant={dirty ? 'primary' : 'ghost'} onClick={() => onSave(g.id, value)} disabled={!dirty || updateProgress.isPending || g.status === 'DROPPED'}>Save</HrButton>
                        </div>
                      )}
                      {!kpi && dirty && (
                        <div><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`goal-note-${g.id}`}>Note (optional)</label>
                          <input id={`goal-note-${g.id}`} maxLength={1000} value={notes[g.id] ?? ''} onChange={(e) => setNotes((p) => ({ ...p, [g.id]: e.target.value }))} placeholder="What changed since the last update?" className="ut-input" /></div>
                      )}
                      {historyOpen === g.id && <MyGoalHistory goal={g} />}
                    </article>
                  )
                })}
              </div>
            )}
      {node}
    </div>
  )
}

/** A goal's progress history under My goals: GET /v1/performance/goals/my/{id}/history. */
function MyGoalHistory({ goal }: { goal: Goal }) {
  const q = useMyGoalHistory(goal.id)
  return (
    <div style={{ display: 'grid', gap: 8, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
      <SubHeading>Progress history</SubHeading>
      {q.isLoading ? <State kind="loading" height={60} />
        : q.isError ? <State kind="error" title="Couldn’t load the history" description={(q.error as Error)?.message} onRetry={() => q.refetch()} />
          : <GoalHistoryList entries={q.data ?? []} kpi={goal.targetValue != null} unit={goal.unit} />}
    </div>
  )
}

// ── My reviews ───────────────────────────────────────────────────────────────
function MyReviews() {
  const { data: reviews = [], isLoading, isError, error, refetch } = useMyReviews()
  const me = useCurrentUser().data?.employeeId ?? undefined
  // Mine to write: I'm the reviewer, or it's my self review (no separate reviewer).
  const mineToWrite = (r: PerformanceReview) => !!me && (r.reviewerId || r.employeeId) === me
  const toWrite = reviews.filter((r) => mineToWrite(r) && r.status === 'PENDING')
  const rest = reviews.filter((r) => !toWrite.includes(r))
  if (isError) return <State kind="error" title="Couldn’t load your reviews" description={(error as Error)?.message} onRetry={() => refetch()} />
  if (isLoading) return <State kind="loading" />
  if (!reviews.length) return <State kind="empty" icon="fileText" title="No reviews yet" description="When a review cycle starts, the reviews you need to write and the feedback about you appear here." />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubHeading>{`To write${toWrite.length ? ` · ${toWrite.length}` : ''}`}</SubHeading>
      {toWrite.length === 0 ? <State kind="empty" icon="checkCircle" title="Nothing to write" description="You’ve submitted every review assigned to you." />
        : <div style={{ display: 'grid', gap: 10 }}>{toWrite.map((r) => <ReviewCard key={r.id} review={r} me={me} canWrite />)}</div>}
      {rest.length > 0 && <>
        <SubHeading>Reviews and feedback</SubHeading>
        <div style={{ display: 'grid', gap: 10 }}>{rest.map((r) => <ReviewCard key={r.id} review={r} me={me} canWrite={false} />)}</div>
      </>}
    </div>
  )
}

function ReviewCard({ review, me, canWrite }: { review: PerformanceReview; me?: string; canWrite: boolean }) {
  const { show, node } = useDesignToast()
  const submit = useSubmitReview()
  const [rating, setRating] = useState('')
  const [strengths, setStrengths] = useState('')
  const [improvements, setImprovements] = useState('')
  const aboutMe = review.employeeId === me
  const self = aboutMe && (!review.reviewerId || review.reviewerId === me)
  const who = self ? 'Your self review' : aboutMe ? `Feedback from ${review.reviewerName || 'a reviewer'}` : `Review of ${review.employeeName || 'a colleague'}${review.employeeCode ? ` (${review.employeeCode})` : ''}`
  const onSubmit = async () => {
    const value = parseFloat(rating)
    if (!(value >= 0 && value <= 5)) { show('Enter a rating from 0 to 5', true); return }
    try {
      await submit.mutateAsync({ id: review.id, overallRating: value, strengths: strengths.trim() || undefined, improvements: improvements.trim() || undefined })
      show('Review submitted')
    } catch (e) { show('Couldn’t submit the review', true, (e as Error)?.message) }
  }
  return (
    <article style={{ ...CARD, padding: '16px 18px', display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: '1 1 240px', minWidth: 0, display: 'grid', gap: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0f6e56' }}>{review.cycleName || 'Performance review'}</span>
          <h3 style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 15.5, fontWeight: 700 }}>{who}</h3>
          <span style={{ fontSize: 12.5, color: '#64748b' }}>{`Opened ${dmy(review.createdAt)}${review.submittedAt ? ` · submitted ${dmy(review.submittedAt)}` : ''}`}</span>
        </div>
        <HrStatusPill tone={REVIEW_TONE[review.status]}>{words(review.status)}</HrStatusPill>
      </div>
      {canWrite ? (
        <div style={{ display: 'grid', gap: 12, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
          <ReviewGoalsPanel reviewId={review.id} selfReview={self} />
          <div style={{ maxWidth: 200 }}><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`rating-${review.id}`}>Overall rating (0–5)</label>
            <input id={`rating-${review.id}`} type="number" min={0} max={5} step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} className="ut-input" /></div>
          <div><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`str-${review.id}`}>Strengths</label>
            <textarea id={`str-${review.id}`} value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} placeholder="What went well" className="ut-input resize-y" /></div>
          <div><label className="mb-1.5 block text-[13px] font-semibold text-text-secondary" htmlFor={`imp-${review.id}`}>Areas to improve</label>
            <textarea id={`imp-${review.id}`} value={improvements} onChange={(e) => setImprovements(e.target.value)} rows={2} placeholder="What to focus on next" className="ut-input resize-y" /></div>
          <div className="flex justify-end"><HrButton onClick={onSubmit} disabled={submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit review'}</HrButton></div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 6, borderTop: '1px solid #f1f5f9', paddingTop: 12, fontSize: 13.5 }}>
          {review.status === 'PENDING' && <Note>Waiting for the reviewer’s feedback.</Note>}
          {review.status === 'MISSED' && <Note tone="amber">The cycle closed before this review was submitted.</Note>}
          {review.overallRating != null && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#0f6e56' }}>{dashIcon('target', 15)}{`${review.overallRating} / 5`}</span>}
          {review.strengths && <p style={{ margin: 0, color: '#334155' }}><strong>Strengths: </strong>{review.strengths}</p>}
          {review.improvements && <p style={{ margin: 0, color: '#334155' }}><strong>To improve: </strong>{review.improvements}</p>}
        </div>
      )}
      {node}
    </article>
  )
}
