import React, { useMemo, useState } from 'react'
import { Plus, Target, Star, CalendarRange, Check, TrendingUp, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useReviewCycles, useCreateCycle, useActivateCycle,
  useMyReviews, useReviews, useCreateReview, useSubmitReview,
  useMyGoals, useCreateGoal, useUpdateGoalProgress,
  type CycleStatus, type ReviewStatus, type GoalStatus, type PerformanceReview,
} from './api/usePerformance'

const CYCLE_TONE: Record<CycleStatus, PillTone> = { DRAFT: 'gray', ACTIVE: 'ok', CLOSED: 'info' }
const REVIEW_TONE: Record<ReviewStatus, PillTone> = { PENDING: 'warn', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal' }
const GOAL_TONE: Record<GoalStatus, PillTone> = { ACTIVE: 'info', COMPLETED: 'ok', DROPPED: 'gray' }

const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

type Tab = 'goals' | 'reviews' | 'cycles' | 'admin'

export const Performance: React.FC = () => {
  const canSelf = usePermission('hrms.performance.review.self')
  const canRead = usePermission('hrms.performance.read')
  const canWrite = usePermission('hrms.performance.write')

  const tabs: { key: Tab; label: string }[] = [
    ...(canSelf ? [{ key: 'goals' as Tab, label: 'My Goals' }] : []),
    ...(canSelf ? [{ key: 'reviews' as Tab, label: 'My Reviews' }] : []),
    ...(canWrite ? [{ key: 'cycles' as Tab, label: 'Cycles' }] : []),
    ...(canRead ? [{ key: 'admin' as Tab, label: 'Reviews' }] : []),
  ]

  const [tab, setTab] = useState<Tab>(tabs[0]?.key ?? 'goals')

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Performance Management" title="Performance Center" subtitle="Track goals, run review cycles, and manage performance reviews" />

      <div className="mb-5 flex gap-1 border-b border-border-default">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'border-[#FF9D00] text-[#C16E00]' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'goals' && canSelf && <MyGoalsTab />}
      {tab === 'reviews' && canSelf && <MyReviewsTab />}
      {tab === 'cycles' && canWrite && <CyclesTab />}
      {tab === 'admin' && canRead && <AdminReviewsTab canWrite={canWrite} />}
    </div>
  )
}

// ── My Goals ───────────────────────────────────────────────────────────────

function MyGoalsTab() {
  const { toast } = useToast()
  const { data: goals = [], isLoading } = useMyGoals()
  const create = useCreateGoal()
  const updateProgress = useUpdateGoalProgress()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState('')
  const [drafts, setDrafts] = useState<Record<string, number>>({})

  const stats = useMemo(() => {
    const active = goals.filter((g) => g.status === 'ACTIVE').length
    const completed = goals.filter((g) => g.status === 'COMPLETED').length
    const avg = goals.length ? Math.round(goals.reduce((s, g) => s + (g.progress ?? 0), 0) / goals.length) : 0
    return { active, completed, avg }
  }, [goals])

  const onCreate = async () => {
    if (!title.trim()) { toast('Give the goal a title', 'error'); return }
    try {
      await create.mutateAsync({
        title: title.trim(),
        description: description.trim() || undefined,
        weight: weight ? parseInt(weight, 10) : undefined,
      })
      toast('Goal added', 'success')
      setTitle(''); setDescription(''); setWeight('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to add goal', 'error')
    }
  }

  const onSaveProgress = async (id: string, progress: number) => {
    try {
      await updateProgress.mutateAsync({ id, progress })
      toast('Progress updated', 'success')
      setDrafts((p) => { const n = { ...p }; delete n[id]; return n })
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <HrStatCard icon={<Target size={18} />} color="blue" value={goals.length} label="Total Goals" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={stats.completed} label="Completed" loading={isLoading} />
        <HrStatCard icon={<TrendingUp size={18} />} color="orange" value={`${stats.avg}%`} label="Avg Progress" loading={isLoading} />
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Goal title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship the billing revamp" className={inputCls} />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Weight</label>
          <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" className={`${inputCls} w-24`} />
        </div>
        <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add Goal</HrButton>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-bg-base" />)
        ) : goals.length === 0 ? (
          <div className="rounded-2xl border border-border-default bg-white py-14 text-center shadow-sm">
            <p className="text-sm font-semibold text-text-secondary">No goals yet</p>
            <p className="mt-1 text-xs text-text-tertiary">Add your first goal above to start tracking progress.</p>
          </div>
        ) : goals.map((g) => {
          const value = drafts[g.id] ?? g.progress
          const dirty = drafts[g.id] !== undefined && drafts[g.id] !== g.progress
          return (
            <div key={g.id} className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-text-primary">{g.title}</p>
                  {g.description && <p className="mt-0.5 text-sm text-text-secondary">{g.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {g.weight > 0 && <span className="text-xs font-medium text-text-tertiary">Weight {g.weight}</span>}
                  <HrStatusPill tone={GOAL_TONE[g.status]}>{g.status}</HrStatusPill>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} value={value}
                  onChange={(e) => setDrafts((p) => ({ ...p, [g.id]: parseInt(e.target.value, 10) }))}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-bg-base accent-[#FF9D00]"
                />
                <span className="w-10 text-right text-sm font-semibold text-text-primary">{value}%</span>
                <HrButton size="sm" variant={dirty ? 'primary' : 'ghost'} onClick={() => onSaveProgress(g.id, value)} disabled={!dirty || updateProgress.isPending}>
                  <Check size={14} /> Save
                </HrButton>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── My Reviews ───────────────────────────────────────────────────────────────

function MyReviewsTab() {
  const { data: reviews = [], isLoading } = useMyReviews()

  return (
    <div className="space-y-3">
      {isLoading ? (
        [...Array(3)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-base" />)
      ) : reviews.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-white py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-text-secondary">No reviews assigned</p>
          <p className="mt-1 text-xs text-text-tertiary">Your performance reviews will appear here once a cycle is opened.</p>
        </div>
      ) : reviews.map((r) => <MyReviewCard key={r.id} review={r} />)}
    </div>
  )
}

function MyReviewCard({ review }: { review: PerformanceReview }) {
  const { toast } = useToast()
  const submit = useSubmitReview()
  const [rating, setRating] = useState('')
  const [strengths, setStrengths] = useState('')
  const [improvements, setImprovements] = useState('')

  const onSubmit = async () => {
    const value = parseFloat(rating)
    if (!(value >= 0 && value <= 5)) { toast('Enter a rating between 0 and 5', 'error'); return }
    try {
      await submit.mutateAsync({
        id: review.id,
        overallRating: value,
        strengths: strengths.trim() || undefined,
        improvements: improvements.trim() || undefined,
      })
      toast('Review submitted', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to submit review', 'error')
    }
  }

  return (
    <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Review</p>
          <p className="font-semibold text-text-primary">
            {review.reviewerName ? `Reviewer: ${review.reviewerName}` : 'Self review'}
          </p>
          <p className="mt-0.5 text-xs text-text-tertiary">Opened {format(new Date(review.createdAt), 'd MMM yyyy')}</p>
        </div>
        <HrStatusPill tone={REVIEW_TONE[review.status]}>{review.status}</HrStatusPill>
      </div>

      {review.status === 'PENDING' ? (
        <div className="space-y-3 border-t border-border-default pt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Overall rating (0–5)</label>
              <input type="number" min={0} max={5} step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Strengths</label>
            <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} placeholder="What went well" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Areas to improve</label>
            <textarea value={improvements} onChange={(e) => setImprovements(e.target.value)} rows={2} placeholder="What to focus on next" className={inputCls} />
          </div>
          <div className="flex justify-end">
            <HrButton onClick={onSubmit} disabled={submit.isPending}>
              {submit.isPending ? 'Submitting…' : 'Submit Review'}
            </HrButton>
          </div>
        </div>
      ) : (
        <div className="space-y-2 border-t border-border-default pt-3 text-sm">
          {review.overallRating != null && (
            <p className="flex items-center gap-1.5 font-semibold text-text-primary">
              <Star size={15} className="text-[#FF9D00]" /> {review.overallRating} / 5
            </p>
          )}
          {review.strengths && <p className="text-text-secondary"><span className="font-medium text-text-primary">Strengths: </span>{review.strengths}</p>}
          {review.improvements && <p className="text-text-secondary"><span className="font-medium text-text-primary">Improvements: </span>{review.improvements}</p>}
        </div>
      )}
    </div>
  )
}

// ── Cycles (admin) ───────────────────────────────────────────────────────────

function CyclesTab() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const { data: cycles = [], isLoading } = useReviewCycles()
  const create = useCreateCycle()
  const activate = useActivateCycle()

  const [name, setName] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')

  const onCreate = async () => {
    if (!name.trim()) { toast('Cycle name is required', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companies[0]?.id,
        name: name.trim(),
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined,
      })
      toast('Review cycle created', 'success')
      setName(''); setPeriodStart(''); setPeriodEnd('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to create cycle', 'error')
    }
  }

  const onActivate = async (id: string) => {
    try {
      await activate.mutateAsync(id)
      toast('Cycle activated', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Cycle name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. H1 2026 Appraisal" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Period start</label>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Period end</label>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={inputCls} />
        </div>
        <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Create Cycle</HrButton>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Cycle</th>
              <th>Period</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : cycles.length === 0 ? (
              <tr><td colSpan={4} className="py-14 text-center text-sm text-text-tertiary">No review cycles defined yet.</td></tr>
            ) : cycles.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-text-primary">
                  <span className="inline-flex items-center gap-2"><CalendarRange size={15} className="text-text-tertiary" />{c.name}</span>
                </td>
                <td className="text-text-secondary">
                  {c.periodStart ? format(new Date(c.periodStart), 'd MMM yyyy') : '—'}
                  {' – '}
                  {c.periodEnd ? format(new Date(c.periodEnd), 'd MMM yyyy') : '—'}
                </td>
                <td><HrStatusPill tone={CYCLE_TONE[c.status]}>{c.status}</HrStatusPill></td>
                <td>
                  <div className="flex items-center justify-end">
                    {c.status === 'DRAFT' && (
                      <HrButton size="sm" onClick={() => onActivate(c.id)} disabled={activate.isPending}><Check size={14} /> Activate</HrButton>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

// ── Reviews (admin) ──────────────────────────────────────────────────────────

function AdminReviewsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const { data: cycles = [] } = useReviewCycles()
  const [cycleId, setCycleId] = useState('')
  const activeCycle = cycleId || cycles[0]?.id || ''
  const { data: page, isLoading } = useReviews(activeCycle || undefined, 0, !!activeCycle)
  const reviews = page?.content ?? []

  const { data: empPage } = useEmployeeDirectory({ companyId: companies[0]?.id, pageSize: 200 }, { enabled: canWrite && !!companies[0]?.id })
  const employees = empPage?.content ?? []
  const create = useCreateReview()
  const [employeeId, setEmployeeId] = useState('')

  const onCreate = async () => {
    if (!activeCycle) { toast('Select a review cycle first', 'error'); return }
    if (!employeeId) { toast('Select an employee', 'error'); return }
    try {
      await create.mutateAsync({ cycleId: activeCycle, employeeId })
      toast('Review created', 'success')
      setEmployeeId('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to create review', 'error')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Review cycle</label>
          <select value={activeCycle} onChange={(e) => setCycleId(e.target.value)} className={`${inputCls} w-auto min-w-[220px]`}>
            {cycles.length === 0 && <option value="">No cycles</option>}
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Add review for employee</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
              <option value="">Select employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName ?? ''}`.trim()} ({e.employeeCode})</option>
              ))}
            </select>
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add Review</HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Reviewer</th>
              <th>Rating</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : reviews.length === 0 ? (
              <tr><td colSpan={4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No reviews in this cycle</p><p className="mt-1 text-xs text-text-tertiary">Add a review above to get started.</p></td></tr>
            ) : reviews.map((r, i) => (
              <tr key={r.id}>
                <td><HrAvatar name={r.employeeName || 'Employee'} sub={r.employeeCode} seed={i} /></td>
                <td className="text-text-secondary">{r.reviewerName || '—'}</td>
                <td className="font-semibold text-text-primary">
                  {r.overallRating != null ? (
                    <span className="inline-flex items-center gap-1"><Star size={14} className="text-[#FF9D00]" />{r.overallRating}</span>
                  ) : '—'}
                </td>
                <td><HrStatusPill tone={REVIEW_TONE[r.status]}>{r.status}</HrStatusPill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
