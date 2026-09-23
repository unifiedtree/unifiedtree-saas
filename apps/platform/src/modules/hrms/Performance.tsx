import React, { useMemo, useState } from 'react'
import { Plus, Target, Star, Check, TrendingUp, CheckCircle2 } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import {
  useMyReviews, useSubmitReview,
  useMyGoals, useCreateGoal, useUpdateGoalProgress,
  type ReviewStatus, type GoalStatus, type PerformanceReview,
} from './api/usePerformance'

import { AdminKpis } from './performance/AdminKpis'
import { AdminCycles } from './performance/AdminCycles'
import { AdminReviews } from './performance/AdminReviews'
import { PerformanceError } from './performance/PerformanceEmployeePicker'
const REVIEW_TONE: Record<ReviewStatus, PillTone> = { PENDING: 'warn', IN_PROGRESS: 'info', MISSED: 'red', SUBMITTED: 'ok', ACKNOWLEDGED: 'teal' }
const GOAL_TONE: Record<GoalStatus, PillTone> = { ACTIVE: 'info', AT_RISK: 'warn', COMPLETED: 'ok', DROPPED: 'gray' }

const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'

type Tab = 'goals' | 'reviews' | 'cycles' | 'admin' | 'kpis' | 'emp-performance' | 'appraisals' | 'kpi-tracking'

export const Performance: React.FC = () => {
  const canSelf = usePermission('hrms.performance.review.self')
  const canRead = usePermission('hrms.performance.read')

  const tabs: { key: Tab; label: string }[] = [
    ...(canRead ? [
      { key: 'emp-performance' as Tab, label: 'Employee Performance' },
      { key: 'appraisals' as Tab, label: 'Appraisals & 360 Feedback' },
      { key: 'kpi-tracking' as Tab, label: 'KPI Tracking' },
      { key: 'cycles' as Tab, label: 'Review cycles' },
      { key: 'kpis' as Tab, label: 'Goals & KPIs' },
      { key: 'admin' as Tab, label: 'Employee reviews' }
    ] : []),
    ...(canSelf ? [{ key: 'goals' as Tab, label: 'My Goals' }, { key: 'reviews' as Tab, label: 'My Reviews' }] : []),
  ]

  const [tab, setTab] = useState<Tab>(canRead ? 'cycles' : tabs[0]?.key ?? 'goals')

  return (
    <div className="mx-auto max-w-[1440px] p-4 sm:p-6">
      <HrPageHeader crumb="Performance Management" title="Performance Center" subtitle="Track goals, run review cycles, and manage performance reviews" />

      {tabs.length === 0 && <p className="ut-card p-5 text-sm text-text-secondary">Your role does not have performance access.</p>}
      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === 'goals' && canSelf && <HrTabPanel tabKey="goals"><MyGoalsTab /></HrTabPanel>}
      {tab === 'reviews' && canSelf && <HrTabPanel tabKey="reviews"><MyReviewsTab /></HrTabPanel>}
      {tab === 'cycles' && canRead && <HrTabPanel tabKey="cycles"><AdminCycles /></HrTabPanel>}
      {tab === 'kpis' && canRead && <HrTabPanel tabKey="kpis"><AdminKpis /></HrTabPanel>}
      {tab === 'admin' && canRead && <HrTabPanel tabKey="admin"><AdminReviews /></HrTabPanel>}
      {tab === 'emp-performance' && canRead && <HrTabPanel tabKey="emp-performance"><AdminReviews /></HrTabPanel>}
      {tab === 'appraisals' && canRead && <HrTabPanel tabKey="appraisals"><AdminCycles /></HrTabPanel>}
      {tab === 'kpi-tracking' && canRead && <HrTabPanel tabKey="kpi-tracking"><AdminKpis /></HrTabPanel>}
    </div>
  )
}

// ── My Goals ───────────────────────────────────────────────────────────────

function MyGoalsTab() {
  const { toast } = useToast()
  const { data: goals = [], isLoading, isError, error, refetch } = useMyGoals()
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
    if (weight && (!Number.isInteger(Number(weight)) || Number(weight) < 0 || Number(weight) > 100)) { toast('Weight must be a whole number between 0 and 100', 'error'); return }
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

      <div className="ut-card flex flex-wrap items-end gap-2 p-4">
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Goal title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Ship the billing revamp" className="ut-input" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" className="ut-input" />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Weight</label>
          <input type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0" className="ut-input w-24" />
        </div>
        <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add Goal</HrButton>
      </div>

      <div className="space-y-3">
        {isError ? <PerformanceError error={error} retry={() => refetch()} /> : isLoading ? (
          [...Array(3)].map((_, i) => <div key={i} className="ut-card ut-card-sm h-20 animate-pulse" />)
        ) : goals.length === 0 ? (
          <div className="ut-card py-14 text-center">
            <p className="text-sm font-semibold text-text-secondary">No goals yet</p>
            <p className="mt-1 text-xs text-text-tertiary">Add your first goal above to start tracking progress.</p>
          </div>
        ) : goals.map((g) => {
          const value = drafts[g.id] ?? g.progress
          const dirty = drafts[g.id] !== undefined && drafts[g.id] !== g.progress
          return (
            <div key={g.id} className="ut-card ut-card-sm p-4">
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
              {g.targetValue != null ? <div className="rounded-md bg-[#E6F4F1] p-3 text-sm"><p className="font-semibold text-[#0A5240]">{g.currentValue ?? 0} / {g.targetValue} {g.unit} · {g.progress}%</p><p className="mt-1 text-xs text-text-secondary">Your performance administrator records measured KPI updates.</p></div> : <div className="flex items-center gap-3">
                <input
                  type="range" min={0} max={100} value={value}
                  disabled={g.status === 'DROPPED'}
                  onChange={(e) => setDrafts((p) => ({ ...p, [g.id]: parseInt(e.target.value, 10) }))}
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-bg-base accent-[#059669]"
                />
                <span className="w-10 text-right text-sm font-semibold text-text-primary">{value}%</span>
                <HrButton size="sm" variant={dirty ? 'primary' : 'ghost'} onClick={() => onSaveProgress(g.id, value)} disabled={!dirty || updateProgress.isPending || g.status === 'DROPPED'}>
                  <Check size={14} /> Save
                </HrButton>
              </div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── My Reviews ───────────────────────────────────────────────────────────────

function MyReviewsTab() {
  const { data: reviews = [], isLoading, isError, error, refetch } = useMyReviews()
  const currentUser = useCurrentUser()

  return (
    <div className="space-y-3">
      {isError ? <PerformanceError error={error} retry={() => refetch()} /> : isLoading ? (
        [...Array(3)].map((_, i) => <div key={i} className="ut-card h-24 animate-pulse" />)
      ) : reviews.length === 0 ? (
        <div className="ut-card py-14 text-center">
          <p className="text-sm font-semibold text-text-secondary">No reviews assigned</p>
          <p className="mt-1 text-xs text-text-tertiary">Your performance reviews will appear here once a cycle is opened.</p>
        </div>
      ) : reviews.map((r) => <MyReviewCard key={r.id} review={r} employeeId={currentUser.data?.employeeId ?? undefined} />)}
    </div>
  )
}

function MyReviewCard({ review, employeeId }: { review: PerformanceReview; employeeId?: string }) {
  const { toast } = useToast()
  const submit = useSubmitReview()
  const [rating, setRating] = useState('')
  const [strengths, setStrengths] = useState('')
  const [improvements, setImprovements] = useState('')
  const canSubmit = !!employeeId && (review.reviewerId || review.employeeId) === employeeId

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
    <div className="ut-card p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{review.cycleName || 'Performance review'}</p>
          <p className="font-semibold text-text-primary">
            {review.employeeName || 'Employee review'}{review.employeeCode ? ` (${review.employeeCode})` : ''}
          </p>
          <p className="mt-1 text-sm text-text-secondary">{review.reviewerName ? `Reviewer: ${review.reviewerName}` : 'Self review'}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">Opened {format(new Date(review.createdAt), 'd MMM yyyy')}</p>
        </div>
        <HrStatusPill tone={REVIEW_TONE[review.status]}>{review.status}</HrStatusPill>
      </div>

      {review.status === 'PENDING' && canSubmit ? (
        <div className="space-y-3 border-t border-border-default pt-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Overall rating (0–5)</label>
              <input type="number" min={0} max={5} step="0.1" value={rating} onChange={(e) => setRating(e.target.value)} className="ut-input" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Strengths</label>
            <textarea value={strengths} onChange={(e) => setStrengths(e.target.value)} rows={2} placeholder="What went well" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Areas to improve</label>
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
          {review.status === 'PENDING' && <p className="text-text-secondary">Awaiting the assigned reviewer's feedback.</p>}
          {review.overallRating != null && (
            <p className="flex items-center gap-1.5 font-semibold text-text-primary">
              <Star size={15} className="text-[#059669]" /> {review.overallRating} / 5
            </p>
          )}
          {review.strengths && <p className="text-text-secondary"><span className="font-medium text-text-primary">Strengths: </span>{review.strengths}</p>}
          {review.improvements && <p className="text-text-secondary"><span className="font-medium text-text-primary">Improvements: </span>{review.improvements}</p>}
        </div>
      )}
    </div>
  )
}
