// Performance · Review cycles (PgGrow p-center tab 0). The open cycle's steps (real counts by
// reviewer type and its dates), the manager ratings so far, and every cycle with its reviews
// and submitted counts. A cycle opens in a side panel: its dates and "hold feedback until
// shared" (+ Share), progress, Assign reviews and Close cycle, as before.
//   read hrms.performance.read (managers: their team); new cycle, dates and Share
//   hrms.performance.write; Assign / Close hrms.appraisal.initiate.
import { useEffect, useMemo, useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  BarList, Button, Callout, CellActions, EmptyState, KeyValueGrid, MiniStat, MiniStatGrid, Section, SegmentedControl, StatusPill, StepTrack, Table, errorText,
  type TableColumn,
} from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import { Checkbox, DateInput, Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Toggle, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useCompanies } from '../api/useOrg'
import { useCurrentCompany } from '../company/CurrentCompany'
import { useEmployeesByIds } from '../api/useWorkforce'
import { useCreateCycle, useReviewCycles, type CycleMilestones, type ReviewCycle } from '../api/usePerformance'
import {
  useCloseCycle, useCycleProgress, useCycleRatings, useCycleStages, useCycleSummary, useInitiateReviews, useSaveMilestones, useShareCycle,
  type InitiationResult, type MilestonesPayload,
} from '../api/usePerformanceAdmin'
import { istDay, closesOn, currentCycle, cycleStatus, cycleSteps, dayMon, periodLabel, RATING_WORDS } from './growModel'
import { PersonSearch, personName } from './PersonSearch'

const words = (v: string) => v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

export function CyclesView({ addKey }: { addKey: number }) {
  const canWrite = usePermission('hrms.performance.write')
  const canInitiate = usePermission('hrms.appraisal.initiate')
  const today = istToday()
  const cycles = useReviewCycles()
  const summary = useCycleSummary()
  const all = useMemo(() => cycles.data ?? [], [cycles.data])
  const current = currentCycle(all)
  const stages = useCycleStages(current?.id)
  const ratings = useCycleRatings(current?.id)
  const [creating, setCreating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useEffect(() => { if (addKey) setCreating(true) }, [addKey])
  const counts = useMemo(() => new Map((summary.data ?? []).map((c) => [c.cycleId, c])), [summary.data])
  // Dates arrive with V143.61; until then every cycle's milestones are null and the date fields are hidden.
  const datesReady = all.length === 0 || all.some((c) => c.milestones != null)
  const selected = all.find((c) => c.id === selectedId) ?? null

  const cur = current ? counts.get(current.id) : undefined
  const mgrRow = stages.data?.rows.find((r) => r.reviewerType === 'MANAGER')
  const closes = current ? closesOn(current) : null
  const columns: TableColumn<ReviewCycle>[] = [
    { key: 'name', header: 'Cycle', primary: true, render: (c) => <button type="button" className="grw-link grw-strong" onClick={() => setSelectedId(c.id)}>{c.name}</button> },
    { key: 'period', header: 'Period', render: (c) => periodLabel(c.periodStart, c.periodEnd) },
    { key: 'reviews', header: 'Reviews', numeric: true, render: (c) => (counts.get(c.id)?.reviews ? String(counts.get(c.id)!.reviews) : '—') },
    { key: 'submitted', header: 'Submitted', render: (c) => { const n = counts.get(c.id); return n?.reviews ? <span className="grw-num">{`${n.submitted} of ${n.reviews}`}</span> : '—' } },
    { key: 'status', header: 'Status', render: (c) => { const s = cycleStatus(c, today); return <StatusPill tone={s.tone}>{s.label}</StatusPill> } },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (c) => (
      <CellActions><Button variant="secondary" size={30} onClick={() => setSelectedId(c.id)}>{c.status === 'DRAFT' && canInitiate ? 'Assign reviews' : 'View progress'}</Button></CellActions>
    ) },
  ]

  return (
    <>
      {!canWrite && <Callout tone="neutral">Each cycle’s progress shows your team only: everyone in the departments you head, or your direct reports.</Callout>}
      {current && (
        <SectionGrid>
          <SectionCell width="half">
            <Section title={current.name} loading={stages.isLoading} skeleton="list" error={stages.error} onRetry={() => stages.refetch()}
              sub={[cur?.reviews ? `${cur.submitted} of ${cur.reviews} reviews submitted` : 'No reviews assigned yet', current.status === 'ACTIVE' && closes ? `closes ${dayMon(closes, today)}` : current.status === 'DRAFT' ? 'not started' : null].filter(Boolean).join(' · ')}
              action={{ label: 'Manage', onClick: () => setSelectedId(current.id) }}>
              {stages.data && (
                <div className="grw-stack">
                  <StepTrack label={`${current.name} progress`} steps={cycleSteps(stages.data, today)} />
                  {mgrRow && mgrRow.waiting > 0 && <Callout tone="brand" icon="info">{`${mgrRow.waiting} manager ${mgrRow.waiting === 1 ? 'review is' : 'reviews are'} still to write.`}</Callout>}
                  {stages.data.milestones?.holdUntilShared && !stages.data.milestones.sharedAt && <Callout tone="warning" icon="lock">Feedback waits until the cycle is shared. People see their own self-review meanwhile.</Callout>}
                </div>
              )}
            </Section>
          </SectionCell>
          <SectionCell width="half">
            <Section title="Ratings so far" sub="Manager reviews submitted this cycle" loading={ratings.isLoading} skeleton="list" error={ratings.error} onRetry={() => ratings.refetch()}
              empty={ratings.data && ratings.data.total === 0 ? { title: 'No reviews yet', hint: 'Ratings appear as managers submit their reviews.', icon: 'chart' } : undefined}>
              {ratings.data && ratings.data.total > 0 && (
                <BarList label="Ratings so far" labelWidth="minmax(110px,160px)" valueWidth={40} max={Math.max(...ratings.data.buckets.map((b) => b.count))}
                  items={ratings.data.buckets.map((b) => ({ key: String(b.rating), label: `${b.rating} · ${RATING_WORDS[b.rating]}`, value: b.count, amount: b.count, tone: b.rating === 1 ? 'danger' : b.rating === 2 ? 'warning' : 'brand' }))} />
              )}
            </Section>
          </SectionCell>
        </SectionGrid>
      )}
      <Section title="Review cycles" body="flush" error={cycles.error} onRetry={() => cycles.refetch()}>
        <Table label="Review cycles" columns={columns} rows={all} rowKey={(c) => c.id} loading={cycles.isLoading} mobile="cards"
          empty={<EmptyState variant="plain" icon="calendarDays" title="No review cycles yet" hint={canWrite ? 'Use “New cycle” to start one.' : 'Cycles HR starts appear here.'} />} />
      </Section>
      {creating && <NewCyclePanel datesReady={datesReady} onClose={() => setCreating(false)} />}
      {selected && <CyclePanel cycle={selected} canWrite={canWrite} canInitiate={canInitiate} datesReady={datesReady} onClose={() => setSelectedId(null)} />}
    </>
  )
}

// ── dates (shared by the new-cycle form and the cycle panel) ─────────────────

interface DatesDraft { goalsBy: string; selfReviewBy: string; managerReviewBy: string; shareOn: string; hold: boolean }
const draftOf = (m?: CycleMilestones | null): DatesDraft => ({
  goalsBy: m?.goalsBy ?? '', selfReviewBy: m?.selfReviewBy ?? '', managerReviewBy: m?.managerReviewBy ?? '', shareOn: m?.shareOn ?? '', hold: !!m?.holdUntilShared,
})
const payloadOf = (d: DatesDraft): MilestonesPayload => ({
  goalsBy: d.goalsBy || null, selfReviewBy: d.selfReviewBy || null, managerReviewBy: d.managerReviewBy || null, shareOn: d.shareOn || null, holdUntilShared: d.hold,
})
/** The steps must run in order where two are set (the server checks the same). */
export function datesProblem(d: DatesDraft): string | null {
  const steps: [string, string][] = [['Goals set by', d.goalsBy], ['Self-reviews by', d.selfReviewBy], ['Manager reviews by', d.managerReviewBy], ['Shared on', d.shareOn]]
  let last: [string, string] | null = null
  for (const s of steps) {
    if (!s[1]) continue
    if (last && s[1] < last[1]) return `${s[0]} can’t be before ${last[0].toLowerCase()}.`
    last = s
  }
  return null
}
const hasDates = (d: DatesDraft) => !!(d.goalsBy || d.selfReviewBy || d.managerReviewBy || d.shareOn || d.hold)

function DatesFields({ value, onChange }: { value: DatesDraft; onChange: (d: DatesDraft) => void }) {
  const set = (k: keyof DatesDraft, v: string | boolean) => onChange({ ...value, [k]: v })
  return (
    <div className="grw-form">
      <FieldGrid columns={2}>
        <DateInput label="Goals set by" value={value.goalsBy} onChange={(e) => set('goalsBy', e.target.value)} clearable />
        <DateInput label="Self-reviews by" value={value.selfReviewBy} min={value.goalsBy || undefined} onChange={(e) => set('selfReviewBy', e.target.value)} clearable />
        <DateInput label="Manager reviews by" value={value.managerReviewBy} min={value.selfReviewBy || value.goalsBy || undefined} onChange={(e) => set('managerReviewBy', e.target.value)} clearable />
        <DateInput label="Shared on" value={value.shareOn} min={value.managerReviewBy || undefined} onChange={(e) => set('shareOn', e.target.value)} clearable />
      </FieldGrid>
      <Toggle checked={value.hold} onChange={(v) => set('hold', v)} label="Hold feedback until shared"
        description="Off: people see feedback about them as soon as it’s submitted, as today. On: it waits until you press Share." />
    </div>
  )
}

function NewCyclePanel({ datesReady, onClose }: { datesReady: boolean; onClose: () => void }) {
  const companies = useCompanies()
  const create = useCreateCycle()
  const saveDates = useSaveMilestones()
  const toast = useToast()
  const [companyId, setCompanyId] = useState('')
  const [name, setName] = useState('')
  const [periodStart, setStart] = useState('')
  const [periodEnd, setEnd] = useState('')
  const [dates, setDates] = useState<DatesDraft>(draftOf(null))
  const [error, setError] = useState('')
  const busy = create.isPending || saveDates.isPending
  const list = companies.data ?? []
  // Starts on the company the top bar's selector is on (its only company, with one).
  const { companyId: currentCompanyId } = useCurrentCompany()
  const selectedCompany = companyId || (list.length === 1 ? list[0].id : currentCompanyId)
  const submit = async () => {
    if (!selectedCompany || !name.trim() || !periodStart || !periodEnd) { setError('Choose a company, name the cycle, and set both period dates.'); return }
    if (periodEnd < periodStart) { setError('The period end must be on or after the start.'); return }
    const order = datesProblem(dates)
    if (order) { setError(order); return }
    setError('')
    try {
      const cycle = await create.mutateAsync({ companyId: selectedCompany, name: name.trim(), periodStart, periodEnd })
      if (datesReady && hasDates(dates)) {
        const r = await saveDates.mutateAsync({ id: cycle.id, ...payloadOf(dates) })
        if (!r.available) toast.info('Review cycle created. Its dates aren’t switched on yet.')
        else toast.success('Review cycle created. Assign reviews to begin.')
      } else toast.success('Review cycle created. Assign reviews to begin.')
      onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t create the cycle.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} title="New review cycle" width={560}
      sub="It starts as a draft. Choose people and assign their reviewers once it’s created."
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={busy}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={busy} onClick={submit}>Create cycle</PanelButton>
      </>}>
      <div className="grw-form">
        {list.length > 1 && <Select label="Company" value={selectedCompany} onChange={(e) => setCompanyId(e.target.value)} placeholder={companies.isLoading ? 'Loading companies…' : 'Choose company'}
          options={list.map((c) => ({ value: c.id, label: c.name }))} />}
        <Input label="Cycle name" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. H2 2026 appraisal" />
        <FieldGrid columns={2}>
          <DateInput label="Period start" value={periodStart} onChange={(e) => setStart(e.target.value)} />
          <DateInput label="Period end" value={periodEnd} min={periodStart || undefined} onChange={(e) => setEnd(e.target.value)} />
        </FieldGrid>
        {datesReady && <>
          <h3 className="grw-sub">Dates for each step (optional)</h3>
          <DatesFields value={dates} onChange={setDates} />
        </>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}

function CyclePanel({ cycle, canWrite, canInitiate, datesReady, onClose }: {
  cycle: ReviewCycle; canWrite: boolean; canInitiate: boolean; datesReady: boolean; onClose: () => void
}) {
  const today = istToday()
  const progress = useCycleProgress(cycle.id)
  const initiate = useInitiateReviews()
  const close = useCloseCycle()
  const saveDates = useSaveMilestones()
  const share = useShareCycle()
  const toast = useToast()
  const [reviewerTypes, setReviewerTypes] = useState<string[]>(['SELF'])
  const [peerCount, setPeerCount] = useState(3)
  const [scope, setScope] = useState<'selected' | 'all'>('selected')
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [result, setResult] = useState<InitiationResult | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmShare, setConfirmShare] = useState(false)
  const [editingDates, setEditingDates] = useState(false)
  const [dates, setDates] = useState<DatesDraft>(draftOf(cycle.milestones))
  const [error, setError] = useState('')
  const busy = initiate.isPending || close.isPending || saveDates.isPending || share.isPending
  const status = progress.data?.status || cycle.status
  const m = cycle.milestones
  const assign = async () => {
    if (scope === 'selected' && people.length === 0) { setError('Choose at least one employee.'); return }
    if (!reviewerTypes.length) { setError('Choose at least one reviewer type.'); return }
    setError('')
    try {
      const created = await initiate.mutateAsync({ id: cycle.id, employeeIds: scope === 'selected' ? people.map((p) => p.id) : undefined, reviewerTypes, peerCount })
      setResult(created); setPeople([])
      toast.success(`${created.reviewsCreated} reviews assigned`)
    } catch (e) { setError(errorText(e, 'Couldn’t assign the reviews.')) }
  }
  const saveCycleDates = async () => {
    const order = datesProblem(dates)
    if (order) { setError(order); return }
    setError('')
    try {
      const r = await saveDates.mutateAsync({ id: cycle.id, ...payloadOf(dates) })
      if (!r.available) { toast.info('Cycle dates aren’t switched on yet.'); return }
      toast.success('Cycle dates saved'); setEditingDates(false)
    } catch (e) { setError(errorText(e, 'Couldn’t save the dates.')) }
  }
  const doShare = async () => {
    try {
      const r = await share.mutateAsync(cycle.id)
      if (!r.available) { toast.info('Sharing isn’t switched on yet.'); return }
      toast.success('Feedback shared. People can read their reviews now.'); setConfirmShare(false)
    } catch (e) { toast.error('Couldn’t share the cycle', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const TYPES = [{ key: 'SELF', label: 'Employee self-review' }, { key: 'MANAGER', label: 'Reporting manager' }, { key: 'PEER', label: 'Department peers' }, { key: 'SKIP_LEVEL', label: 'Manager’s manager' }, { key: 'DIRECT_REPORT', label: 'Direct reports (upward review)' }]
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} title={cycle.name} width={640} sub={`Appraisal review cycle · ${periodLabel(cycle.periodStart, cycle.periodEnd)}`}>
      <div className="grw-stack">
        <div className="grw-row grw-row--between">
          <span className="grw-muted">{`${cycle.periodStart ? dayMon(cycle.periodStart) : 'Not set'} – ${cycle.periodEnd ? dayMon(cycle.periodEnd) : 'Not set'}`}</span>
          <StatusPill tone={status === 'ACTIVE' ? 'success' : status === 'CLOSED' ? 'info' : 'neutral'}>{words(status)}</StatusPill>
        </div>

        {datesReady && m !== undefined && (
          <Section title="Dates" level={3} cardClass={false} variant="panel"
            action={canWrite && !editingDates && status !== 'CLOSED' ? { label: 'Edit dates', icon: 'pencil', onClick: () => { setDates(draftOf(m)); setEditingDates(true) } } : undefined}>
            {editingDates ? (
              <div className="grw-form">
                <DatesFields value={dates} onChange={setDates} />
                <div className="grw-row">
                  <Button variant="primary" size={32} loading={saveDates.isPending} onClick={saveCycleDates}>Save dates</Button>
                  <Button size={32} variant="secondary" disabled={saveDates.isPending} onClick={() => setEditingDates(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="grw-stack grw-stack--tight">
                <KeyValueGrid items={[
                  { label: 'Goals set by', value: m?.goalsBy ? dayMon(m.goalsBy, today) : 'Not set' },
                  { label: 'Self-reviews by', value: m?.selfReviewBy ? dayMon(m.selfReviewBy, today) : 'Not set' },
                  { label: 'Manager reviews by', value: m?.managerReviewBy ? dayMon(m.managerReviewBy, today) : 'Not set' },
                  { label: 'Shared on', value: m?.sharedAt ? `Shared ${dayMon(istDay(m.sharedAt), today)}` : m?.shareOn ? dayMon(m.shareOn, today) : 'Not set' },
                  { label: 'Feedback', value: m?.holdUntilShared ? (m.sharedAt ? 'Shared with the people reviewed' : 'Held until shared') : 'Shown as each review is submitted' },
                ]} />
                {canWrite && m?.holdUntilShared && !m.sharedAt && (
                  <div><Button variant="primary" size={32} icon="megaphone" onClick={() => setConfirmShare(true)}>Share feedback</Button></div>
                )}
              </div>
            )}
          </Section>
        )}

        <Section title="Progress" level={3} cardClass={false} variant="panel" loading={progress.isLoading} skeleton="stats" error={progress.error} onRetry={() => progress.refetch()}>
          {progress.data && (
            <div className="grw-stack">
              <MiniStatGrid>
                <MiniStat label="Assigned" value={progress.data.totalAssignments} tone="neutral" />
                <MiniStat label="Completed" value={progress.data.completedAssignments} tone="success" />
                <MiniStat label="Completion" countUp={false} value={`${progress.data.overallPct}%`} tone="info" />
              </MiniStatGrid>
              {!progress.data.reviewees.length ? <p className="grw-muted" style={{ margin: 0 }}>No employee reviews assigned to this cycle yet.</p> : (
                <ul className="grw-list" aria-label="Assigned employees">
                  {progress.data.reviewees.map((r) => (
                    <li key={r.revieweeId}>
                      <span style={{ minWidth: 0 }}>
                        <span className="grw-strong" style={{ display: 'block' }}>{r.revieweeName || 'Employee'}</span>
                        <span className="grw-muted">
                          {r.assignments.map((a, i) => <span key={`${a.reviewerId}-${a.reviewerType}`}>{i > 0 ? ' · ' : ''}{`${a.reviewerName || 'Reviewer'} (${words(a.reviewerType)}) `}<span>{words(a.status)}</span></span>)}
                        </span>
                      </span>
                      <span className="grw-num grw-strong">{`${r.completedAssignments} / ${r.totalAssignments}`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Section>

        {canInitiate && status !== 'CLOSED' && (
          <Section title="Assign reviews" level={3} cardClass={false} variant="panel" sub="Assigned reviewers write these under My reviews. Existing assignments are kept; only new ones are added.">
            <div className="grw-form">
              <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                <legend className="grw-sub" style={{ marginBottom: 8 }}>Reviewer types</legend>
                {TYPES.map((t) => (
                  <Checkbox key={t.key} label={t.label} checked={reviewerTypes.includes(t.key)}
                    onChange={(on) => setReviewerTypes((cur) => (on ? [...cur, t.key] : cur.filter((x) => x !== t.key)))} />
                ))}
              </fieldset>
              {reviewerTypes.includes('PEER') && (
                <Select label="Peers per employee" value={String(peerCount)} onChange={(e) => setPeerCount(Number(e.target.value))}
                  options={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ value: String(n), label: String(n) }))} />
              )}
              <p className="grw-muted" style={{ margin: 0 }}>Employees without eligible reviewers for a type are skipped. Peers come from the same department.</p>
              <SegmentedControl label="Employees to include" semantics="radio" size="sm" value={scope} onChange={setScope}
                options={[{ value: 'selected', label: 'Choose employees' }, { value: 'all', label: 'All active employees' }]} />
              {scope === 'selected' ? (
                <>
                  <PersonSearch value="" companyId={cycle.companyId}
                    disabled={(e) => (people.some((p) => p.id === e.id) ? 'Chosen' : null)}
                    onChange={(e) => setPeople((cur) => (cur.some((p) => p.id === e.id) ? cur : [...cur, { id: e.id, name: personName(e) }]))} />
                  {people.length > 0 && (
                    <div className="grw-picks">
                      {people.map((p) => <Button key={p.id} size={30} variant="soft" trailingIcon="x" aria-label={`Remove ${p.name}`} onClick={() => setPeople((cur) => cur.filter((x) => x.id !== p.id))}>{p.name}</Button>)}
                    </div>
                  )}
                </>
              ) : <Callout tone="brand">Assigns the chosen reviewer types for every active employee in the cycle’s company, and starts a draft cycle.</Callout>}
              {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
              <div>
                <Button variant="primary" loading={initiate.isPending} disabled={busy || !!progress.error} onClick={assign}>
                  {scope === 'all' ? 'Assign to all active employees' : `Assign reviews${people.length ? ` (${people.length})` : ''}`}
                </Button>
              </div>
              {result && (
                <Callout tone="success" live>
                  <span>{`${result.revieweesConsidered} employees considered; ${result.reviewsCreated} new reviews created.`}</span>
                  {result.skips.length > 0 && <SkippedAssignments skips={result.skips} />}
                </Callout>
              )}
            </div>
          </Section>
        )}

        {canInitiate && status === 'ACTIVE' && (
          <div style={{ borderTop: '1px solid var(--u-ln, #E3E9E6)', paddingTop: 16 }}>
            {confirmClose ? (
              <div className="grw-stack grw-stack--tight">
                <h4 className="grw-sub" style={{ fontSize: 14 }}>Close this cycle?</h4>
                <p className="grw-muted" style={{ margin: 0 }}>Reviews still to write are marked missed. The cycle can’t be reopened.</p>
                <div className="grw-row">
                  <Button variant="danger" loading={close.isPending} disabled={busy} onClick={async () => {
                    try { const r = await close.mutateAsync(cycle.id); toast.success(`Cycle closed. ${r.reviewsMissedMarked} pending reviews marked missed.`); setConfirmClose(false) }
                    catch (e) { toast.error('Couldn’t close the cycle', { detail: errorText(e, 'Try again in a moment.') }) }
                  }}>Confirm close cycle</Button>
                  <Button variant="secondary" disabled={busy} onClick={() => setConfirmClose(false)}>Keep open</Button>
                </div>
              </div>
            ) : <Button variant="secondary" onClick={() => setConfirmClose(true)}>Close cycle</Button>}
          </div>
        )}
      </div>
      <Dialog open={confirmShare} onClose={() => setConfirmShare(false)} busy={share.isPending} icon="megaphone" title="Share feedback?"
        sub={`Everyone reviewed in ${cycle.name} can then read the reviews written about them.`}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setConfirmShare(false)}>Cancel</PanelButton>
          <PanelButton variant="primary" busy={share.isPending} onClick={doShare}>Share feedback</PanelButton>
        </>} />
    </SidePanel>
  )
}

function SkippedAssignments({ skips }: { skips: string[] }) {
  const [open, setOpen] = useState(false)
  const canRead = usePermission(P.HRMS_EMPLOYEE_READ)
  const rows = skips.map((s) => ({ id: /reviewee=([a-f0-9-]+)/i.exec(s)?.[1], type: /type=(\w+)/.exec(s)?.[1] }))
  const ids = [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))].slice(0, 50)
  const directory = useEmployeesByIds(ids, { enabled: open && canRead })
  return (
    <div className="grw-stack grw-stack--tight" style={{ marginTop: 6 }}>
      <span>{`${skips.length} assignments skipped because eligible reviewers were unavailable.`}</span>
      <div><Button size={30} variant="secondary" onClick={() => setOpen(!open)}>{open ? 'Hide skipped assignments' : 'View skipped assignments'}</Button></div>
      {open && (!canRead ? <span className="grw-muted">You need access to the employee directory to see who was skipped.</span>
        : directory.isLoading ? <span className="grw-muted" role="status">Loading employee details…</span>
          : (
            <ul className="grw-list">
              {(directory.data ?? []).map((e) => (
                <li key={e.id}><span className="grw-strong">{`${personName(e)} (${e.employeeCode})`}</span>
                  <span className="grw-muted">{`No eligible reviewer: ${rows.filter((r) => r.id === e.id).map((r) => (r.type ?? '').toLowerCase().replace(/_/g, ' ')).join(', ')}`}</span></li>
              ))}
            </ul>
          ))}
    </div>
  )
}
