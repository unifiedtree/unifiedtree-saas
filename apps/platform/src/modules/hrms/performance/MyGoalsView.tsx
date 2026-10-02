// Performance · My goals (EmpGrowth e-rev goal cards; PgGrow p-center tab 5): my goals with
// their progress, weight, due date and last note (BW-84), the company KPI they count towards
// (BW-83), Add a goal, and Update progress with the history. Company KPIs assigned to me by HR
// (goals with a target) are updated by the performance admin, so they stay read-only here.
import { useEffect, useMemo, useState } from 'react'
import { Button, Callout, EmptyState, MiniStat, MiniStatGrid, ProgressBar, Section, SkeletonList, StatusPill, errorText } from '@/design/kit/display'
import { DateInput, FieldGrid, Input, PanelButton, Select, SidePanel, Slider, Textarea, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useCreateGoal, useMyGoalHistory, useMyGoals, useUpdateGoalProgress, type Goal } from '../api/usePerformance'
import { useCompanyKpis } from '../api/usePerformanceAdmin'
import { dateLong, dayMon, goalStatus } from './growModel'
import { GoalHistoryList } from './shared'

export function MyGoalsView({ addKey }: { addKey: number }) {
  const today = istToday()
  const { data: goals = [], isLoading, error, refetch } = useMyGoals()
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState<Goal | null>(null)
  useEffect(() => { if (addKey) setAdding(true) }, [addKey])
  const live = goals.filter((g) => g.status !== 'DROPPED')
  const done = live.filter((g) => g.status === 'COMPLETED')
  const avg = live.length ? Math.round(live.reduce((s, g) => s + Math.min(100, g.progress ?? 0), 0) / live.length) : 0
  return (
    <>
      <Section title="Your goals" loading={isLoading} skeleton="stats" error={error} onRetry={() => refetch()}>
        <MiniStatGrid>
          <MiniStat label="Goals" value={live.length} note={`${live.length - done.length} in progress`} tone="neutral" />
          <MiniStat label="Completed" value={done.length} note={done[0]?.title} tone="success" />
          <MiniStat label="Average progress" countUp={false} value={`${avg}%`} note="Across all your goals" tone="info" />
        </MiniStatGrid>
      </Section>
      <section aria-label="Goals" className="grw-stack">
        <h2 className="grw-h2">{live.length ? `Goals · ${done.length} of ${live.length} done` : 'Goals'}</h2>
        {isLoading ? <SkeletonList rows={3} /> : goals.length === 0 ? (
          <EmptyState icon="target" title="No goals yet" hint="Add your first goal to start tracking progress." action={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add a goal</Button>} />
        ) : (
          <div className="grw-cards">
            {goals.map((g) => {
              const st = goalStatus(g.status)
              const kpi = g.targetValue != null
              const line = g.lastNote || (kpi ? `${g.currentValue ?? 0} of ${g.targetValue}${g.unit ? ` ${g.unit}` : ''}` : g.description) || null
              return (
                <article key={g.id} className="grw-card" data-rise="">
                  <div className="grw-card__head">
                    <h3 className="grw-card__title">{g.title}</h3>
                    {g.weight > 0 && <span className="grw-muted" style={{ flexShrink: 0 }}>{`Weight ${g.weight}`}</span>}
                  </div>
                  <div className="grw-row grw-row--between" style={{ alignItems: 'baseline' }}>
                    <span className="grw-card__pct">{`${Math.min(100, g.progress ?? 0)}%`}</span>
                    <StatusPill tone={st.tone} size="sm">{st.label}</StatusPill>
                  </div>
                  <ProgressBar value={Math.min(100, g.progress ?? 0)} tone={g.status === 'AT_RISK' ? 'warning' : 'brand'} height={6} />
                  <div className="grw-stack grw-stack--tight" style={{ gap: 2 }}>
                    {line && <span className="grw-muted">{line}</span>}
                    <span className="grw-muted">{[g.companyKpiTitle ? `Counts towards ${g.companyKpiTitle}` : kpi ? 'Company KPI · updated by your performance admin' : null, g.dueDate ? `due ${dayMon(g.dueDate, today)}` : null].filter(Boolean).join(' · ')}</span>
                  </div>
                  <div className="grw-row">
                    <Button variant="secondary" size={32} onClick={() => setOpen(g)}>{kpi || g.status === 'DROPPED' ? 'History' : 'Update progress'}</Button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
      {adding && <AddGoalPanel onClose={() => setAdding(false)} />}
      {open && <ProgressPanel goal={goals.find((g) => g.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </>
  )
}

function AddGoalPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const create = useCreateGoal()
  const kpis = useCompanyKpis()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [weight, setWeight] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [kpiId, setKpiId] = useState('')
  const [error, setError] = useState('')
  const open = useMemo(() => (kpis.data ?? []).filter((k) => k.status === 'ACTIVE'), [kpis.data])
  const submit = async () => {
    if (!title.trim()) { setError('Give the goal a title.'); return }
    if (weight && (!Number.isInteger(Number(weight)) || Number(weight) < 0 || Number(weight) > 100)) { setError('Weight must be a whole number from 0 to 100.'); return }
    setError('')
    try {
      await create.mutateAsync({ title: title.trim(), description: description.trim() || undefined, weight: weight ? parseInt(weight, 10) : undefined, dueDate: dueDate || undefined, companyKpiId: kpiId || undefined })
      toast.success('Goal added'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t add the goal.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!create.isPending) onClose() }} busy={create.isPending} width={520} title="Add a goal"
      sub={kpis.notAvailable || open.length === 0 ? 'Your own goal. You update its progress here.' : 'Link it to a company KPI so progress rolls up.'}
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={create.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={create.isPending} onClick={submit}>Add goal</PanelButton>
      </>}>
      <div className="grw-form">
        <Input id="goal-title" label="Goal" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Give the goal a title" />
        <Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
        <FieldGrid columns={2}>
          <Input label="Weight" type="number" min={0} max={100} value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="0–100" hint="A whole number from 0 to 100" />
          <DateInput label="Due date" value={dueDate} min={istToday()} onChange={(e) => setDueDate(e.target.value)} clearable />
        </FieldGrid>
        {!kpis.notAvailable && open.length > 0 && (
          <Select label="Company KPI" value={kpiId} onChange={(e) => setKpiId(e.target.value)} options={[{ value: '', label: 'None' }, ...open.map((k) => ({ value: k.id, label: k.title }))]} />
        )}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}

function ProgressPanel({ goal, onClose }: { goal: Goal; onClose: () => void }) {
  const toast = useToast()
  const update = useUpdateGoalProgress()
  const history = useMyGoalHistory(goal.id)
  const kpi = goal.targetValue != null
  const editable = !kpi && goal.status !== 'DROPPED'
  const [value, setValue] = useState(goal.progress ?? 0)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const dirty = value !== goal.progress || note.trim() !== ''
  const save = async () => {
    if (note.trim().length > 1000) { setError('Keep the note under 1,000 characters.'); return }
    setError('')
    try { await update.mutateAsync({ id: goal.id, progress: value, note: note.trim() || undefined }); toast.success('Progress saved'); setNote('') }
    catch (e) { setError(errorText(e, 'Couldn’t save the progress.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!update.isPending) onClose() }} busy={update.isPending} width={560}
      title={editable ? 'Update progress' : 'Goal history'} sub={goal.title}
      footer={editable ? <>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={update.isPending}>Done</PanelButton>
        <PanelButton variant="primary" size="lg" busy={update.isPending} blockedReason={dirty ? null : 'Move the slider or add a note first'} onClick={save}>Save</PanelButton>
      </> : undefined}>
      <div className="grw-form">
        {editable ? (
          <>
            <Slider label="Progress (%)" min={0} max={100} step={5} value={value} onChange={setValue} format={(n) => `${n}%`} />
            <Textarea label="What changed since the last update?" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </>
        ) : (
          <Callout tone="neutral">{kpi ? `A company KPI: ${goal.currentValue ?? 0} of ${goal.targetValue}${goal.unit ? ` ${goal.unit}` : ''}. Your performance admin records its value.` : 'This goal was dropped.'}</Callout>
        )}
        {goal.dueDate && <p className="grw-muted" style={{ margin: 0 }}>{`Due ${dateLong(goal.dueDate)}`}</p>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
        <h3 className="grw-sub">Progress history</h3>
        {history.isLoading ? <SkeletonList rows={2} />
          : history.isError ? <Callout tone="danger">{`Couldn’t load the history. ${errorText(history.error, '')}`}</Callout>
            : <GoalHistoryList entries={history.data ?? []} kpi={kpi} unit={goal.unit} />}
      </div>
    </SidePanel>
  )
}
