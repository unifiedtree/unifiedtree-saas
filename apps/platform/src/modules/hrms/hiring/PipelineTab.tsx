// Hiring › Pipeline (P-HIRE; prototype PgTalent h-pipe tab 0).
//   - Recruitment: open, on-hold and closed requisitions, positions to fill and candidates
//     this quarter, counted on the server (BW-65).
//   - Pipeline by stage: candidates on open roles by their stage (BW-65).
//   - Conversion and time to hire, from the stage history (BW-66): "—" until there is any.
//   - Candidates: a table by default, or the board (a column per stage, cards you drag
//     between stages). ?role=<requisition id | all> and ?stage=<STAGE> filter it (the
//     dashboard and the Requisitions list link here). Each row moves one step on, or out
//     to Rejected / Withdrawn (the server's rule), opens the candidate's interviews and
//     scorecards, and a Hired candidate becomes an employee (candidate.write +
//     employee.write).
import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import {
  BarList, Button, CellActions, CellPerson, KeyValueGrid, MiniStat, MiniStatGrid, Section, SegmentedControl, StatusPill, Table,
  type TableColumn,
} from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import { FieldGrid, Input, Menu, PanelButton, Select, SidePanel, useToast, type MenuEntry } from '@/design/kit/overlays'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import {
  useAddCandidate, useCandidateBoard, useConvertCandidate, useHiringFunnel, useHiringSummary, useRequisitionOptions, useUpdateCandidateStage,
  canMoveStage, inr, istWhen, CANDIDATE_STAGES, type CandidateCard, type CandidateStage, type JobRequisition,
} from '../api/useHiring'
import { CandidateDrawer, scorecardLine } from './Interviews'
import {
  FUNNEL, REQUISITION_LABEL, STAGE_LABEL, STAGE_TONE, dayMon, hireDaysLabel, istDateOf, istTodayIso, nextStage, pctLabel,
} from './hiringModel'

const ALL = 'all'
const LAYOUT_KEY = 'ut.hiring.pipeline.layout'
type Layout = 'table' | 'board'
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message) || fallback
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

function readLayout(): Layout {
  try { return localStorage.getItem(LAYOUT_KEY) === 'board' ? 'board' : 'table' } catch { return 'table' }
}
function saveLayout(l: Layout) {
  try { localStorage.setItem(LAYOUT_KEY, l) } catch { /* private mode: the table it is */ }
}

export function PipelineTab({ adding, onAddDone }: { adding: boolean; onAddDone: () => void }) {
  const canCandidateWrite = usePermission('hrms.hiring.candidate.write')
  // Converting creates an employee, so the server also requires hrms.employee.write.
  const canWriteEmployees = usePermission('hrms.employee.write')
  const canConvert = canCandidateWrite && canWriteEmployees
  const toast = useToast()
  const confirm = useConfirmDialog()
  const navigate = useNavigate()
  const today = istTodayIso()
  const options = useRequisitionOptions()
  const requisitions = useMemo(() => options.data?.content ?? [], [options.data])

  // ?role= (a requisition, or "all") and ?stage= come from the address, so links land filtered.
  const [params, setParams] = useSearchParams()
  const stageParam = (params.get('stage') || '').toUpperCase()
  const stage = (CANDIDATE_STAGES as string[]).includes(stageParam) ? (stageParam as CandidateStage) : ''
  const role = params.get('role') || ALL
  // Starts from the address bar, not the router's copy: the view pills change ?tab= outside
  // the router, and a stale tab here would switch the view back.
  const setParam = (key: string, value: string) => setParams(() => {
    const n = new URLSearchParams(window.location.search)
    if (value) n.set(key, value); else n.delete(key)
    return n
  }, { replace: true })

  const allRoles = role === ALL
  const selected: JobRequisition | undefined = allRoles ? undefined : requisitions.find((r) => r.id === role)
  const board = useCandidateBoard({ requisitionId: allRoles ? undefined : role, stage: stage || undefined })
  const candidates = useMemo(() => board.data ?? [], [board.data])
  const [layout, setLayoutState] = useState<Layout>(readLayout)
  const setLayout = (l: Layout) => { setLayoutState(l); saveLayout(l) }
  const [openId, setOpenId] = useState<string | null>(null)
  const openCard = candidates.find((c) => c.id === openId) ?? null
  useEffect(() => { if (openId && board.isSuccess && !openCard) setOpenId(null) }, [openId, board.isSuccess, openCard])

  const updateStage = useUpdateCandidateStage()
  const convert = useConvertCandidate()

  const move = async (c: CandidateCard, to: CandidateStage) => {
    if (to === 'REJECTED' || to === 'WITHDRAWN') {
      const ok = await confirm({
        title: to === 'REJECTED' ? `Reject ${c.fullName}?` : `Mark ${c.fullName} as withdrawn?`,
        body: to === 'REJECTED'
          ? 'They leave the pipeline for this role. A rejected candidate can’t be moved back.'
          : 'Use this when the candidate pulled out. A withdrawn candidate can’t be moved back.',
        confirmLabel: to === 'REJECTED' ? 'Reject' : 'Mark withdrawn', tone: 'danger',
      })
      if (!ok) return
    }
    try {
      await updateStage.mutateAsync({ id: c.id, stage: to })
      toast.success(`Stage updated · ${firstName(c.fullName)} is now in ${STAGE_LABEL[to]}`)
    } catch (e) { toast.error('Couldn’t move the candidate', { detail: errText(e, 'Please try again.') }) }
  }

  const onConvert = async (c: CandidateCard) => {
    const roleTitle = selected?.title || c.requisitionTitle
    const ok = await confirm({
      title: `Convert ${c.fullName} to an employee?`,
      body: `Creates their employee record in the company of ${roleTitle ? `the "${roleTitle}" requisition` : 'this requisition'}, with the name, email and phone on file, plus the department, role, joining date and CTC from the requisition and accepted offer where recorded. It uses one workspace seat. If a checklist template fits their department, their onboarding starts too, with the offer accepted date, hiring manager, recruiter and source filled in. Complete the rest on their profile.`,
      confirmLabel: 'Create employee',
    })
    if (!ok) return
    try {
      const result = await convert.mutateAsync(c.id)
      toast.success(result.onboardingInstanceId
        ? `${c.fullName} is now employee ${result.employee.employeeCode}. Onboarding started with “${result.onboardingTemplateName}”.`
        : `${c.fullName} is now employee ${result.employee.employeeCode}`)
      navigate(`/hrms/employees/${result.employee.id}`)
    } catch (e) { toast.error('Couldn’t convert the candidate', { detail: errText(e, 'Please try again.') }) }
  }

  /** The row's or card's main action, the "more" menu and the employee link. */
  const actions = (c: CandidateCard) => {
    const next = nextStage(c.stage)
    const exited = c.stage === 'REJECTED' || c.stage === 'WITHDRAWN'
    const items: MenuEntry[] = [
      { key: 'open', label: 'Interviews & scorecards', icon: 'calendarClock', onSelect: () => setOpenId(c.id) },
      ...(canCandidateWrite && !exited && canMoveStage(c.stage, 'REJECTED') ? [{ key: 'reject', label: 'Reject', icon: 'circleX', danger: true, onSelect: () => move(c, 'REJECTED') }] : []),
      ...(canCandidateWrite && !exited && canMoveStage(c.stage, 'WITHDRAWN') ? [{ key: 'withdraw', label: 'Withdrawn', sub: 'The candidate pulled out', icon: 'logOut', onSelect: () => move(c, 'WITHDRAWN') }] : []),
    ]
    return {
      main: c.convertedEmployeeId
        ? <Link to={`/hrms/employees/${c.convertedEmployeeId}`} className="hi-link">View employee →</Link>
        : c.stage === 'HIRED' && canConvert
          ? <Button size={30} variant="soft" disabled={convert.isPending} onClick={() => onConvert(c)}>Create employee</Button>
          : next && canCandidateWrite
            ? <Button size={30} variant="soft" disabled={updateStage.isPending} onClick={() => move(c, next)}>{`Move to ${STAGE_LABEL[next]}`}</Button>
            : null,
      more: (
        <Menu label={`More for ${c.fullName}`} width={250} placement="bottom-end" items={items}
          trigger={({ props }) => <Button {...props} size={30} variant="plain" icon={<MoreHorizontal size={16} />} aria-label={`More for ${c.fullName}`} />} />
      ),
    }
  }

  const columns: TableColumn<CandidateCard>[] = [
    {
      key: 'candidate', header: 'Candidate', primary: true, width: '28%', render: (c) => (
        <button type="button" className="hi-open" onClick={() => setOpenId(c.id)} aria-label={`Open ${c.fullName}: interviews and scorecards`}>
          <CellPerson name={c.fullName} sub={c.requisitionTitle || c.email} />
        </button>
      ),
    },
    { key: 'stage', header: 'Stage', render: (c) => <StatusPill tone={STAGE_TONE[c.stage]}>{STAGE_LABEL[c.stage]}</StatusPill> },
    { key: 'source', header: 'Source', render: (c) => c.source || '—' },
    { key: 'ctc', header: 'Expected CTC', render: (c) => <span className="hi-num">{c.expectedCtc != null ? inr(c.expectedCtc) : '—'}</span> },
    { key: 'applied', header: 'Applied', render: (c) => <span className="hi-num">{c.createdAt ? dayMon(istDateOf(c.createdAt), today) : '—'}</span> },
    {
      key: 'actions', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (c) => {
        const a = actions(c)
        return <CellActions>{a.main}{a.more}</CellActions>
      },
    },
  ]

  const roleOptions = [
    { value: ALL, label: 'All roles' },
    ...requisitions.map((r) => ({ value: r.id, label: `${r.title} · ${REQUISITION_LABEL[r.status]}` })),
    // A role from a link that isn't in the first 200: keep it chosen rather than drop the filter.
    ...(!allRoles && !selected ? [{ value: role, label: options.isLoading ? 'Loading roles…' : 'This role' }] : []),
  ]
  const stageOptions = [{ value: ALL, label: 'All stages' }, ...CANDIDATE_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))]
  const sources = useMemo(() => [...new Set(candidates.map((c) => c.source?.trim()).filter((s): s is string => !!s))].sort(), [candidates])

  return (
    <>
      <RecruitmentFigures requisitions={requisitions} requisitionsLoading={options.isLoading} />
      <SectionGrid>
        <SectionCell width="half"><StageBars /></SectionCell>
        <SectionCell width="half"><Conversion /></SectionCell>
      </SectionGrid>
      <Section title="Candidates" body="flush" error={board.error} onRetry={() => board.refetch()} retrying={board.isFetching}
        actions={<SegmentedControl label="Filter candidates by stage" semantics="toggle" size="sm" options={stageOptions} value={stage || ALL}
          onChange={(v) => setParam('stage', v === ALL ? '' : v)} />}>
        <div className="hi-toolbar">
          <div className="hi-filter">
            <span aria-hidden="true">Role</span>
            <Select aria-label="Role" size="md" fieldClassName="hi-filter__sel" value={role} options={roleOptions}
              onChange={(e) => setParam('role', e.target.value === ALL ? '' : e.target.value)} />
          </div>
          {selected && <StatusPill tone="neutral">{`${selected.openings} ${selected.openings === 1 ? 'opening' : 'openings'}`}</StatusPill>}
          <span className="hi-toolbar__count" aria-live="polite">{board.isLoading ? 'Loading candidates…' : `${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'}`}</span>
          <span className="hi-toolbar__grow" />
          <SegmentedControl<Layout> label="Show candidates as" semantics="toggle" size="sm" value={layout} onChange={setLayout}
            options={[{ value: 'table', label: 'Table' }, { value: 'board', label: 'Board' }]} />
        </div>
        {layout === 'board'
          ? <Board candidates={candidates} loading={board.isLoading} stage={stage} allRoles={allRoles} canMove={canCandidateWrite}
            onMove={move} actions={actions} onOpen={(c) => setOpenId(c.id)} />
          : <Table label="Candidates" columns={columns} rows={candidates} rowKey={(c) => c.id} loading={board.isLoading} mobile="cards"
            onRowClick={(c) => setOpenId(c.id)}
            empty={<span className="hi-muted">{requisitions.length === 0 && !options.isLoading ? 'No one here. Open your first requisition to start hiring.' : stage ? `No one in ${STAGE_LABEL[stage]} right now.` : 'No one here yet.'}</span>} />}
      </Section>
      {openCard && <CandidateDrawer card={openCard} onClose={() => setOpenId(null)} />}
      {adding && <AddCandidatePanel requisitions={requisitions} preferred={selected} sources={sources} onClose={onAddDone} />}
    </>
  )
}

/** The four Recruitment figures (BW-65). An older server without the summary: counted from the requisitions, no quarter figure. */
function RecruitmentFigures({ requisitions, requisitionsLoading }: { requisitions: readonly JobRequisition[]; requisitionsLoading: boolean }) {
  const q = useHiringSummary()
  const s = q.data
  const local = useMemo(() => ({
    open: requisitions.filter((r) => r.status === 'OPEN').length,
    closed: requisitions.filter((r) => r.status === 'CLOSED').length,
    toFill: requisitions.filter((r) => r.status !== 'CLOSED').reduce((n, r) => n + (r.openings ?? 0), 0),
  }), [requisitions])
  const fallback = q.notAvailable
  return (
    <Section title="Recruitment" body="tight" loading={q.isLoading || (fallback && requisitionsLoading)} skeleton="stats" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}>
      <MiniStatGrid>
        <MiniStat label="Open" value={fallback ? local.open : s?.requisitions.open} note="Taking candidates" tone="success" />
        <MiniStat label="Positions to fill" value={fallback ? local.toFill : s?.positionsToFill} note="Across open and on-hold roles" tone="info" />
        {!fallback && <MiniStat label="Candidates" value={s?.candidatesThisQuarter} note="This quarter" tone="neutral" />}
        <MiniStat label="Closed" value={fallback ? local.closed : s?.requisitions.closed} note="Filled or stopped" tone="neutral" />
      </MiniStatGrid>
    </Section>
  )
}

/** Candidates on open roles by their current stage (BW-65). */
function StageBars() {
  const q = useHiringSummary()
  const counts = new Map((q.data?.openRoleStages ?? []).map((s) => [s.stage, s.count]))
  const items = FUNNEL.map((s) => ({ key: s, label: STAGE_LABEL[s], value: counts.get(s) ?? 0, amount: counts.get(s) ?? 0 }))
  const none = items.every((i) => !i.amount)
  return (
    <Section title="Pipeline by stage" sub="Every open role" loading={q.isLoading} skeleton="list" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching}
      empty={q.notAvailable ? { title: 'Not available yet', hint: 'Stage counts appear once the server is updated.' } : none ? { title: 'No candidates yet', hint: 'Candidates on open roles show here by stage.' } : undefined}
      style={{ height: '100%' }}>
      <BarList label="Candidates on open roles by stage" items={items} labelWidth="minmax(90px,150px)" />
    </Section>
  )
}

/** Conversion between stages and time to hire this quarter, from the stage history (BW-66). */
function Conversion() {
  const q = useHiringFunnel()
  const f = q.data
  const rate = (from: CandidateStage) => f?.conversions.find((c) => c.from === from)?.rate ?? null
  const since = f && !f.exact && f.trackedFrom ? dayMon(istDateOf(f.trackedFrom), istTodayIso()) : null
  return (
    <Section title="Conversion" sub={since ? `This quarter · counted from ${since}, when stage history started` : f ? 'This quarter' : undefined}
      loading={q.isLoading} skeleton="text" error={q.error} onRetry={() => q.refetch()} retrying={q.isFetching} style={{ height: '100%' }}>
      <KeyValueGrid items={[
        { key: 'as', label: 'Applied → Screening', value: pctLabel(rate('APPLIED')) },
        { key: 'si', label: 'Screening → Interview', value: pctLabel(rate('SCREENING')) },
        { key: 'io', label: 'Interview → Offer', value: pctLabel(rate('INTERVIEW')) },
        { key: 'oh', label: 'Offer → Hired', value: pctLabel(rate('OFFER')) },
        { key: 'tth', label: 'Time to hire', value: hireDaysLabel(f?.timeToHire.averageDays) },
      ]} />
    </Section>
  )
}

/** The board: a column per stage; cards are dragged one step on, or out to Rejected / Withdrawn. */
function Board({ candidates, loading, stage, allRoles, canMove, onMove, actions, onOpen }: {
  candidates: CandidateCard[]; loading: boolean; stage: CandidateStage | ''; allRoles: boolean; canMove: boolean
  onMove: (c: CandidateCard, to: CandidateStage) => void
  actions: (c: CandidateCard) => { main: ReactNode; more: ReactNode }
  onOpen: (c: CandidateCard) => void
}) {
  const [dragging, setDragging] = useState<CandidateCard | null>(null)
  const [over, setOver] = useState<CandidateStage | null>(null)
  if (loading) return <p className="hi-small" role="status" style={{ padding: '0 20px 20px' }}>Loading candidates…</p>
  const columns = stage ? [stage] : CANDIDATE_STAGES
  const byStage = new Map(CANDIDATE_STAGES.map((st) => [st, candidates.filter((c) => c.stage === st)]))
  const drop = (to: CandidateStage) => {
    const c = dragging
    setDragging(null); setOver(null)
    if (c && c.stage !== to && canMoveStage(c.stage, to)) onMove(c, to)
  }
  return (
    <div className="hi-board">
      <div role="list" aria-label="Pipeline by stage" className="hi-board__cols"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(220px, 1fr))`, minWidth: columns.length * 232 }}>
        {columns.map((st) => {
          const list = byStage.get(st) || []
          const dropOk = !!dragging && canMoveStage(dragging.stage, st)
          return (
            <section key={st} role="listitem" aria-label={`${STAGE_LABEL[st]}: ${list.length}`}
              className={`hi-col${dropOk ? ' is-drop' : ''}${dropOk && over === st ? ' is-over' : ''}`}
              onDragOver={(e: DragEvent) => { if (!dropOk) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== st) setOver(st) }}
              onDragLeave={(e: DragEvent<HTMLElement>) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && over === st) setOver(null) }}
              onDrop={(e: DragEvent) => { e.preventDefault(); drop(st) }}>
              <div className="hi-col__head">
                <h3 className="hi-col__title">{STAGE_LABEL[st]}</h3>
                <StatusPill tone={STAGE_TONE[st]}>{String(list.length)}</StatusPill>
              </div>
              {list.length === 0 && <p className="hi-col__empty">No one here</p>}
              {list.map((c) => {
                const movable = canMove && c.stage !== 'REJECTED' && c.stage !== 'WITHDRAWN'
                const cards = scorecardLine(c.scorecards)
                const a = actions(c)
                return (
                  <article key={c.id} draggable={movable} className={`hi-card${dragging?.id === c.id ? ' is-dragging' : ''}`}
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); setDragging(c) }}
                    onDragEnd={() => { setDragging(null); setOver(null) }}>
                    <button type="button" className="hi-open" onClick={() => onOpen(c)} aria-label={`Open ${c.fullName}: interviews and scorecards`}>
                      <CellPerson name={c.fullName} sub={c.email} />
                    </button>
                    <div className="hi-card__meta">
                      {(allRoles && c.requisitionTitle) || c.source || c.expectedCtc != null
                        ? <span>{[allRoles ? c.requisitionTitle : null, c.source, c.expectedCtc != null ? `expects ${inr(c.expectedCtc)}` : null].filter(Boolean).join(' · ')}</span> : null}
                      {c.nextInterviewAt && <span>{`Interview ${istWhen(c.nextInterviewAt)} IST${c.upcomingInterviews > 1 ? ` (+${c.upcomingInterviews - 1} more)` : ''}`}</span>}
                      {cards && <span>{cards}</span>}
                    </div>
                    <div className="hi-card__acts">{a.main}{a.more}</div>
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Add a candidate to a role that is still hiring. New candidates start in Applied (the server's no-skip rule). */
function AddCandidatePanel({ requisitions, preferred, sources, onClose }: {
  requisitions: readonly JobRequisition[]; preferred?: JobRequisition; sources: string[]; onClose: () => void
}) {
  const toast = useToast()
  const add = useAddCandidate()
  const open = requisitions.filter((r) => r.status !== 'CLOSED')
  const [requisitionId, setRequisitionId] = useState(preferred && preferred.status !== 'CLOSED' ? preferred.id : '')
  const [form, setForm] = useState({ fullName: '', email: '', source: '', expectedCtc: '' })
  const [errors, setErrors] = useState<{ role?: string; fullName?: string }>({})
  const submit = async () => {
    const next = { role: requisitionId ? undefined : 'Choose the role they applied for', fullName: form.fullName.trim() ? undefined : 'Candidate name is required' }
    setErrors(next)
    if (next.role || next.fullName) return
    try {
      await add.mutateAsync({
        requisitionId, fullName: form.fullName.trim(), email: form.email.trim() || undefined, source: form.source.trim() || undefined,
        expectedCtc: form.expectedCtc ? parseFloat(form.expectedCtc) : undefined,
      })
      toast.success('Candidate added', { detail: `${form.fullName.trim()} starts in Applied.` })
      onClose()
    } catch (e) { toast.error('Couldn’t add the candidate', { detail: errText(e, 'Please try again.') }) }
  }
  return (
    <SidePanel open onClose={onClose} width={560} busy={add.isPending} closeLabel="Close panel"
      title="Add a candidate" sub="New candidates start in Applied. Move them on from the pipeline."
      footer={<><PanelButton size="lg" onClick={onClose} disabled={add.isPending}>Cancel</PanelButton>
        <PanelButton size="lg" variant="primary" busy={add.isPending} onClick={submit}>Add candidate</PanelButton></>}>
      <form id="candidate-form" onSubmit={(e) => { e.preventDefault(); void submit() }} noValidate>
        <FieldGrid columns={2}>
          <Select id="cand-role" label="Role" full value={requisitionId} error={errors.role}
            placeholder={open.length ? 'Choose a role' : 'No open requisitions yet'}
            options={open.map((r) => ({ value: r.id, label: `${r.title} · ${REQUISITION_LABEL[r.status]}` }))}
            onChange={(e) => { setRequisitionId(e.target.value); setErrors((x) => ({ ...x, role: undefined })) }} />
          <Input id="cand-name" label="Full name" full value={form.fullName} maxLength={200} placeholder="e.g. Priya Sharma" error={errors.fullName}
            onChange={(e) => { setForm((f) => ({ ...f, fullName: e.target.value })); setErrors((x) => ({ ...x, fullName: undefined })) }} />
          <Input id="cand-email" label="Email" type="email" value={form.email} maxLength={254} placeholder="name@email.com"
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <Input id="cand-source" label="Source" value={form.source} maxLength={80} placeholder="e.g. LinkedIn" list="cand-source-options"
            onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          <Input id="cand-ctc" label="Expected CTC (₹)" type="number" min={0} value={form.expectedCtc} placeholder="Optional"
            onChange={(e) => setForm((f) => ({ ...f, expectedCtc: e.target.value }))} />
        </FieldGrid>
        <datalist id="cand-source-options">{sources.map((s) => <option key={s} value={s} />)}</datalist>
      </form>
    </SidePanel>
  )
}
