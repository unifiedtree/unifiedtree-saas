import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Pencil, UserPlus, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrButton, HrDrawer, HrStatusPill, TableCard, HrAvatar, HrSelect, type PillTone,
} from '@/shared/components/hr'
import { ModulePage, Views, useView, StatRow, State, Panel, CARD, HEAD_FONT } from '@/design/module/ModuleKit'
import { OffersTab } from './hiring/OffersTab'
import { useCompanies } from './api/useOrg'
import {
  useRequisitions, useRequisition, useCreateRequisition, useUpdateRequisition, useCloseRequisition,
  useCandidates, useAllCandidates, useAddCandidate, useUpdateCandidateStage, useConvertCandidate,
  inr, CANDIDATE_STAGES, EMPLOYMENT_TYPES,
  type RequisitionStatus, type CandidateStage, type EmploymentType, type JobRequisition, type Candidate,
} from './api/useHiring'

const STATUS_TONE: Record<RequisitionStatus, PillTone> = {
  OPEN: 'ok', ON_HOLD: 'warn', CLOSED: 'gray',
}

const STAGE_TONE: Record<CandidateStage, PillTone> = {
  APPLIED: 'gray', SCREENING: 'info', INTERVIEW: 'purple', OFFER: 'warn', HIRED: 'green', REJECTED: 'red',
}

const fmtEnum = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

type Tab = 'requisitions' | 'pipeline' | 'offers'

// Hiring (/hrms/hiring) in the design language of the redesigned modules
// (design/module/ModuleKit). Requisitions and the pipeline need
// hrms.hiring.read; offers carry salary, so they need hrms.hiring.offer.read
// (the API no longer accepts plain hiring.read for them).
export const Hiring: React.FC = () => {
  const canRead = usePermission('hrms.hiring.read')
  const canWrite = usePermission('hrms.hiring.write')
  const canCandidateWrite = usePermission('hrms.hiring.candidate.write')
  const canOfferRead = usePermission('hrms.hiring.offer.read')
  const views = [
    ...(canRead ? [{ key: 'pipeline', label: 'Pipeline', icon: 'workflow' }, { key: 'requisitions', label: 'Requisitions', icon: 'briefcase' }] : []),
    ...(canOfferRead ? [{ key: 'offers', label: 'Offers', icon: 'fileText' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key), 'tab') as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Recruitment" title="Hiring" subtitle="Open roles, move candidates through the stages, and make offers.">
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 0 ? <Views items={views} active={tab} onChange={setTab} label="Hiring views" />
          : <State kind="empty" icon="lock" title="No hiring access" description="Ask an admin if you should see open roles or candidates." />}
        {tab === 'requisitions' && canRead && <RequisitionsTab canWrite={canWrite} />}
        {tab === 'pipeline' && canRead && <PipelineTab canCandidateWrite={canCandidateWrite} />}
        {tab === 'offers' && canOfferRead && <OffersTab />}
      </div>
    </ModulePage>
  )
}
// ── Requisitions ───────────────────────────────────────────────────────────

function RequisitionsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const { data, isLoading } = useRequisitions(0)
  const create = useCreateRequisition()
  const update = useUpdateRequisition()
  const close = useCloseRequisition()
  // Memoised like PipelineTab's copy below: `data?.content ?? []` is a fresh
  // array every render, which re-ran the stats memo on each keystroke in the
  // create form.
  const requisitions = useMemo(() => data?.content ?? [], [data])

  const [title, setTitle] = useState('')
  const [openings, setOpenings] = useState('1')
  const [location, setLocation] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME')

  // ── Edit one requisition ───────────────────────────────────────────────────
  // The row is re-fetched through GET /v1/hiring/requisitions/{id} rather than
  // reused from the list page, so the drawer edits what the server currently
  // holds (the list is cached for 30s and someone else may have moved it on).
  const [editingId, setEditingId] = useState<string | null>(null)
  const { data: editing, isLoading: editingLoading } = useRequisition(editingId ?? undefined)
  const emptyEdit = { title: '', openings: '1', location: '', employmentType: '', description: '' }
  const [editForm, setEditForm] = useState(emptyEdit)
  // Prefill once per requisition, keyed on the id we've already loaded. Keying
  // the effect on the `editing` OBJECT instead would re-run on every background
  // refetch and wipe whatever the user had typed mid-edit.
  const [prefilledId, setPrefilledId] = useState<string | null>(null)
  useEffect(() => {
    if (!editing || editing.id === prefilledId) return
    setEditForm({
      title: editing.title ?? '',
      openings: String(editing.openings ?? 1),
      location: editing.location ?? '',
      employmentType: editing.employmentType ?? '',
      description: editing.description ?? '',
    })
    setPrefilledId(editing.id)
  }, [editing, prefilledId])

  // employmentType is a free String on the backend (JobRequisitionRequest), not
  // an enum, so a requisition can legitimately carry a value that isn't in
  // EMPLOYMENT_TYPES. Keep it as an option, otherwise opening the drawer would
  // show the wrong type and saving would quietly rewrite it.
  const typeOptions = useMemo(() => {
    const current = editForm.employmentType
    const known = EMPLOYMENT_TYPES as readonly string[]
    return current && !known.includes(current) ? [current, ...known] : [...known]
  }, [editForm.employmentType])

  const closeEdit = () => { setEditingId(null); setPrefilledId(null); setEditForm(emptyEdit) }

  const stats = useMemo(() => {
    const open = requisitions.filter((r) => r.status === 'OPEN').length
    const closed = requisitions.filter((r) => r.status === 'CLOSED').length
    const totalOpenings = requisitions
      .filter((r) => r.status !== 'CLOSED')
      .reduce((s, r) => s + (r.openings ?? 0), 0)
    return { open, closed, totalOpenings }
  }, [requisitions])

  const onCreate = async () => {
    if (!title.trim()) { toast('Give the requisition a title', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companies[0]?.id,
        title: title.trim(),
        openings: Math.max(1, parseInt(openings, 10) || 1),
        location: location.trim() || undefined,
        employmentType,
      })
      toast('Requisition opened', 'success')
      setTitle(''); setOpenings('1'); setLocation('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to open requisition', 'error')
    }
  }

  const onSaveEdit = async () => {
    if (!editing) return
    const nextTitle = editForm.title.trim()
    if (!nextTitle) { toast('Give the requisition a title', 'error'); return }
    try {
      await update.mutateAsync({
        id: editing.id,
        // PUT /requisitions/{id} is a FULL REPLACE: HiringService.updateRequisition
        // calls setDepartmentId / setEmploymentType / setLocation / setDescription /
        // setHiringManagerId unconditionally, so any field left out of this body is
        // written back as NULL. departmentId and hiringManagerId aren't editable on
        // this page, so they're echoed from the loaded record to survive the save.
        // (openings is the one exception — the service ignores null/<=0 — but it is
        // @Positive-validated, so send a clamped value rather than relying on that.)
        companyId: editing.companyId,
        departmentId: editing.departmentId,
        hiringManagerId: editing.hiringManagerId,
        title: nextTitle,
        openings: Math.max(1, parseInt(editForm.openings, 10) || 1),
        location: editForm.location.trim() || undefined,
        employmentType: editForm.employmentType || undefined,
        description: editForm.description.trim() || undefined,
      })
      toast('Requisition updated', 'success')
      closeEdit()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to update requisition', 'error')
    }
  }

  const onClose = async (id: string) => {
    try {
      await close.mutateAsync(id)
      toast('Requisition closed', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'briefcase', color: 'blue', label: 'Requisitions', value: String(requisitions.length), sub: 'On this page' },
        { icon: 'checkCircle', color: 'green', label: 'Open', value: String(stats.open), sub: 'Taking candidates' },
        { icon: 'users', color: 'orange', label: 'Positions to fill', value: String(stats.totalOpenings), sub: 'Across open and on-hold roles' },
        { icon: 'lock', color: 'teal', label: 'Closed', value: String(stats.closed), sub: 'Filled or stopped' },
      ]} />}

      {canWrite && (
        <div className="ut-card flex flex-wrap items-end gap-2 p-4" style={{ borderRadius: 16 }}>
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Job title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" className="ut-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Openings</label>
            <input type="number" min={1} value={openings} onChange={(e) => setOpenings(e.target.value)} className="ut-input w-24" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru" className="ut-input w-40" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Type</label>
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)} className="ut-select w-auto">
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{fmtEnum(t)}</option>)}
            </select>
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Open requisition</HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Type</th>
              <th>Openings</th>
              <th>Candidates</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Opened</th>
              {canWrite && <th className="text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canWrite ? 7 : 6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : requisitions.length === 0 ? (
              <tr><td colSpan={canWrite ? 7 : 6} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No requisitions yet</p><p className="mt-1 text-xs text-text-tertiary">Open your first requisition to start hiring.</p></td></tr>
            ) : requisitions.map((r) => (
              <tr key={r.id}>
                <td className="font-medium text-text-primary">{r.title}{r.location ? <span className="block text-xs text-text-tertiary">{r.location}</span> : null}</td>
                <td className="text-text-secondary">{r.employmentType ? fmtEnum(r.employmentType) : '—'}</td>
                <td className="font-semibold text-text-primary">{r.openings}</td>
                <td className="text-text-secondary"><Link to={`/hrms/hiring?tab=pipeline&role=${r.id}`} className="font-semibold text-accent-fg hover:underline">{r.candidateCount} · Pipeline</Link></td>
                <td><HrStatusPill tone={STATUS_TONE[r.status]}>{fmtEnum(r.status)}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{r.createdAt ? format(new Date(r.createdAt), 'd MMM yyyy') : '—'}</td>
                {canWrite && (
                  <td>
                    {/* canWrite is hrms.hiring.write — the same authority
                        @PreAuthorize'd on PUT /v1/hiring/requisitions/{id} and on
                        the close endpoint. Edit stays available on CLOSED rows:
                        the update endpoint accepts them and never touches status,
                        so a typo in a closed requisition can still be corrected. */}
                    <div className="flex items-center justify-end gap-1.5">
                      <HrButton size="sm" variant="ghost" onClick={() => setEditingId(r.id)}><Pencil size={14} /> Edit</HrButton>
                      {r.status !== 'CLOSED' && (
                        <HrButton size="sm" variant="ghost" onClick={() => onClose(r.id)} disabled={close.isPending}><XCircle size={14} /> Close</HrButton>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>

      {editingId && (
        <HrDrawer
          title="Edit Requisition"
          onClose={closeEdit}
          footer={
            <>
              <HrButton variant="ghost" onClick={closeEdit}>Cancel</HrButton>
              <HrButton onClick={onSaveEdit} disabled={update.isPending || !editing}>
                {update.isPending ? 'Saving…' : 'Save Changes'}
              </HrButton>
            </>
          }
        >
          {editingLoading && !editing ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-9 w-full animate-pulse rounded-xl bg-bg-base" />)}
            </div>
          ) : !editing ? (
            <p className="text-sm text-text-secondary">This requisition could not be loaded. Close and try again.</p>
          ) : (
            <div className="space-y-4">
              {/* Single-requisition view: the fields the list can't show, read-only.
                  hiringManagerName is enriched server-side by HiringController and
                  there is no endpoint to reassign the manager, so it is displayed
                  rather than edited (its id is echoed back on save). */}
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-base px-3 py-2.5">
                <HrStatusPill tone={STATUS_TONE[editing.status]}>{fmtEnum(editing.status)}</HrStatusPill>
                <span className="text-xs text-text-tertiary">
                  {editing.candidateCount} candidate{editing.candidateCount === 1 ? '' : 's'}
                  {editing.hiringManagerName ? ` · Hiring manager: ${editing.hiringManagerName}` : ''}
                  {editing.createdAt ? ` · Opened ${format(new Date(editing.createdAt), 'd MMM yyyy')}` : ''}
                </span>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Job title *</label>
                <input value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Senior Backend Engineer" className="ut-input" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Openings</label>
                  <input type="number" min={1} value={editForm.openings}
                    onChange={(e) => setEditForm((p) => ({ ...p, openings: e.target.value }))} className="ut-input" />
                </div>
                <div>
                  <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Type</label>
                  <select value={editForm.employmentType}
                    onChange={(e) => setEditForm((p) => ({ ...p, employmentType: e.target.value }))} className="ut-select">
                    <option value="">Not set</option>
                    {typeOptions.map((t) => <option key={t} value={t}>{fmtEnum(t)}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Location</label>
                <input value={editForm.location} onChange={(e) => setEditForm((p) => ({ ...p, location: e.target.value }))}
                  placeholder="e.g. Bengaluru" className="ut-input" />
              </div>

              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
                <textarea value={editForm.description} rows={5}
                  onChange={(e) => setEditForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Responsibilities, must-have skills, interview loop…"
                  className="w-full resize-y rounded-xl border border-border-default bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20" />
              </div>
            </div>
          )}
        </HrDrawer>
      )}
    </div>
  )
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

/** The role picker's "All roles" value (?role=all). */
const ALL_ROLES = 'all'

function PipelineTab({ canCandidateWrite }: { canCandidateWrite: boolean }) {
  const { toast } = useToast()
  const { data } = useRequisitions(0)
  const requisitions = useMemo(() => data?.content ?? [], [data])
  // ?role=<requisition id> opens that role's pipeline (the Requisitions list links here).
  // ?role=all shows every role's candidates together; the dashboard's stage
  // counts open it with ?stage=<STAGE> (and ?company=<id>), scrolled to that stage.
  const [params, setParams] = useSearchParams()
  const focusStage = params.get('stage') || ''
  const companyParam = params.get('company') || undefined
  const [requisitionId, setRequisitionIdState] = useState(params.get('role') || (focusStage ? ALL_ROLES : ''))
  const setRequisitionId = (id: string) => { setRequisitionIdState(id); setParams((p) => { const n = new URLSearchParams(p); n.set('role', id); return n }, { replace: true }) }
  const allRoles = requisitionId === ALL_ROLES

  useEffect(() => {
    if (!requisitionId && requisitions.length > 0) {
      const firstOpen = requisitions.find((r) => r.status !== 'CLOSED') ?? requisitions[0]
      setRequisitionIdState(firstOpen.id)
    }
  }, [requisitions, requisitionId])

  const selected: JobRequisition | undefined = requisitions.find((r) => r.id === requisitionId)
  const oneRole = useCandidates(allRoles ? undefined : requisitionId || undefined)
  const everyRole = useAllCandidates(companyParam, allRoles)
  const { data: candidates = [], isLoading } = allRoles ? everyRole : oneRole
  const roleTitle = (id: string) => requisitions.find((r) => r.id === id)?.title
  // Bring the stage the dashboard pointed at into view (the board scrolls sideways on narrow screens).
  const stageRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (focusStage && !isLoading) stageRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [focusStage, isLoading])
  const addCandidate = useAddCandidate()
  const updateStage = useUpdateCandidateStage()
  const convert = useConvertCandidate()
  const confirm = useConfirmDialog()
  const navigate = useNavigate()
  // Converting creates an hrms.employees row, so the server also requires
  // hrms.employee.write (POST /v1/hiring/candidates/{id}/convert).
  const canWriteEmployees = usePermission('hrms.employee.write')
  const canConvert = canCandidateWrite && canWriteEmployees

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [source, setSource] = useState('')
  const [expectedCtc, setExpectedCtc] = useState('')

  const canAdd = canCandidateWrite && !!selected && selected.status !== 'CLOSED'

  const onAdd = async () => {
    if (!requisitionId) { toast('Pick a requisition first', 'error'); return }
    if (!fullName.trim()) { toast('Candidate name is required', 'error'); return }
    try {
      await addCandidate.mutateAsync({
        requisitionId,
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        source: source.trim() || undefined,
        expectedCtc: expectedCtc ? parseFloat(expectedCtc) : undefined,
      })
      toast('Candidate added', 'success')
      setFullName(''); setEmail(''); setSource(''); setExpectedCtc('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to add candidate', 'error')
    }
  }

  const onStage = async (id: string, stage: CandidateStage) => {
    try {
      await updateStage.mutateAsync({ id, stage })
      toast('Stage updated', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const onConvert = async (c: Candidate) => {
    const ok = await confirm({
      title: `Convert ${c.fullName} to an employee?`,
      body: `Creates their employee record in the company of ${roleTitle(c.requisitionId) ? `the "${roleTitle(c.requisitionId)}" requisition` : 'this requisition'}, with the name, email and phone on file, plus the department, role, joining date and CTC from the requisition and accepted offer where recorded. It uses one workspace seat. Complete the rest on their profile.`,
      confirmLabel: 'Create employee',
    })
    if (!ok) return
    try {
      const result = await convert.mutateAsync(c.id)
      toast(`${c.fullName} is now employee ${result.employee.employeeCode}`, 'success')
      navigate(`/hrms/employees/${result.employee.id}`)
    } catch (e) {
      toast((e as Error)?.message ?? 'Could not convert the candidate', 'error')
    }
  }

  const byStage = new Map(CANDIDATE_STAGES.map((st) => [st, candidates.filter((c) => c.stage === st)]))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Role</span>
        <div style={{ minWidth: 280 }}><HrSelect value={requisitionId} onChange={setRequisitionId} size="sm" placeholder={requisitions.length ? 'Choose a role' : 'No requisitions yet'}
          options={[...(requisitions.length ? [{ value: ALL_ROLES, label: 'All roles' }] : []), ...requisitions.map((r) => ({ value: r.id, label: `${r.title} · ${fmtEnum(r.status)}` }))]} /></div>
        {selected && <HrStatusPill tone={STATUS_TONE[selected.status]}>{`${selected.openings} ${selected.openings === 1 ? 'opening' : 'openings'}`}</HrStatusPill>}
        {(selected || allRoles) && <span style={{ fontSize: 12.5, color: '#64748b' }}>{`${candidates.length} ${candidates.length === 1 ? 'candidate' : 'candidates'}${allRoles ? ' across every role' : ''}`}</span>}
      </div>

      {canAdd && (
        <Panel title="Add a candidate" sub={`To ${selected?.title}`}>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Full name</label>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya Sharma" className="ut-input" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Source</label>
              <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. LinkedIn" className="ut-input w-36" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Expected CTC (₹)</label>
              <input type="number" min={0} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} placeholder="Optional" className="ut-input w-32" />
            </div>
            <HrButton onClick={onAdd} disabled={addCandidate.isPending}><Plus size={15} /> Add candidate</HrButton>
          </div>
        </Panel>
      )}

      {!requisitionId ? <State kind="empty" icon="briefcase" title="Choose a role" description="Pick a requisition above to see its candidates by stage." />
        : isLoading ? <State kind="loading" height={220} />
          : (
            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div role="list" aria-label="Pipeline by stage" style={{ display: 'grid', gridTemplateColumns: `repeat(${CANDIDATE_STAGES.length}, minmax(220px, 1fr))`, gap: 12, minWidth: CANDIDATE_STAGES.length * 232 }}>
                {CANDIDATE_STAGES.map((st) => {
                  const list = byStage.get(st) || []
                  return (
                    <section key={st} ref={st === focusStage ? stageRef : undefined} role="listitem" aria-label={`${fmtEnum(st)}: ${list.length}`} aria-current={st === focusStage ? 'true' : undefined} style={{ ...CARD, background: '#f8fafc', padding: 10, display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', alignContent: 'start', gap: 8, minHeight: 180, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 6px' }}>
                        <h3 style={{ margin: 0, flex: 1, fontFamily: HEAD_FONT, fontSize: 14, fontWeight: 800 }}>{fmtEnum(st)}</h3>
                        <HrStatusPill tone={STAGE_TONE[st]}>{String(list.length)}</HrStatusPill>
                      </div>
                      {list.length === 0 && <p style={{ margin: 0, padding: '14px 6px', fontSize: 12.5, color: '#94a3b8', textAlign: 'center', border: '1px dashed #e2e8f0', borderRadius: 10 }}>No one here</p>}
                      {list.map((c, i) => (
                        <article key={c.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 8, minWidth: 0, overflow: 'hidden' }}>
                          <HrAvatar name={c.fullName} sub={c.email} seed={i} />
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontSize: 12, color: '#64748b' }}>
                            {allRoles && roleTitle(c.requisitionId) && <span style={{ fontWeight: 600, color: '#334155' }}>{roleTitle(c.requisitionId)}</span>}
                            {c.source && <span>{c.source}</span>}
                            {c.expectedCtc != null && <span>· expects {inr(c.expectedCtc)}</span>}
                          </div>
                          {canCandidateWrite && (
                            <select value={c.stage} onChange={(e) => onStage(c.id, e.target.value as CandidateStage)} disabled={updateStage.isPending}
                              className="ut-select ut-select-sm" aria-label={`Move ${c.fullName} to stage`}>
                              {CANDIDATE_STAGES.map((x) => <option key={x} value={x}>{`Move to: ${fmtEnum(x)}`}</option>)}
                            </select>
                          )}
                          {c.convertedEmployeeId
                            ? <Link to={`/hrms/employees/${c.convertedEmployeeId}`} className="text-[13px] font-semibold text-accent-fg hover:underline">View employee →</Link>
                            : c.stage === 'HIRED' && canConvert
                              ? <HrButton size="sm" variant="ghost" disabled={convert.isPending} onClick={() => onConvert(c)}><UserPlus size={14} /> Convert to employee</HrButton>
                              : null}
                        </article>
                      ))}
                    </section>
                  )
                })}
              </div>
            </div>
          )}
    </div>
  )
}
