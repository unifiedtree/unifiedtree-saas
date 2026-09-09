import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Briefcase, DoorOpen, Lock, Pencil, Users, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrDrawer, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useRequisitions, useRequisition, useCreateRequisition, useUpdateRequisition, useCloseRequisition,
  useCandidates, useAddCandidate, useUpdateCandidateStage,
  inr, CANDIDATE_STAGES, EMPLOYMENT_TYPES,
  type RequisitionStatus, type CandidateStage, type EmploymentType, type JobRequisition,
} from './api/useHiring'

const STATUS_TONE: Record<RequisitionStatus, PillTone> = {
  OPEN: 'ok', ON_HOLD: 'warn', CLOSED: 'gray',
}

const STAGE_TONE: Record<CandidateStage, PillTone> = {
  APPLIED: 'gray', SCREENING: 'info', INTERVIEW: 'purple', OFFER: 'warn', HIRED: 'green', REJECTED: 'red',
}

const fmtEnum = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

type Tab = 'requisitions' | 'pipeline'

export const Hiring: React.FC = () => {
  const canRead = usePermission('hrms.hiring.read')
  const canWrite = usePermission('hrms.hiring.write')
  const canCandidateWrite = usePermission('hrms.hiring.candidate.write')
  const [tab, setTab] = useState<Tab>('requisitions')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'requisitions', label: 'Requisitions' },
    ...(canRead ? [{ key: 'pipeline' as Tab, label: 'Pipeline' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Recruitment" title="Hiring Center" subtitle="Open requisitions and move candidates through the pipeline" />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === 'requisitions' && <HrTabPanel tabKey="requisitions"><RequisitionsTab canWrite={canWrite} /></HrTabPanel>}
      {tab === 'pipeline' && canRead && <HrTabPanel tabKey="pipeline"><PipelineTab canCandidateWrite={canCandidateWrite} /></HrTabPanel>}
    </div>
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
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<Briefcase size={18} />} color="blue" value={requisitions.length} label="Requisitions" loading={isLoading} />
        <HrStatCard icon={<DoorOpen size={18} />} color="green" value={stats.open} label="Open" loading={isLoading} />
        <HrStatCard icon={<Users size={18} />} color="orange" value={stats.totalOpenings} label="Open Positions" loading={isLoading} />
        <HrStatCard icon={<Lock size={18} />} color="teal" value={stats.closed} label="Closed" loading={isLoading} />
      </div>

      {canWrite && (
        <div className="ut-card flex flex-wrap items-end gap-2 p-4">
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
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Open Requisition</HrButton>
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
                <td className="text-text-secondary">{r.candidateCount}</td>
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

function PipelineTab({ canCandidateWrite }: { canCandidateWrite: boolean }) {
  const { toast } = useToast()
  const { data } = useRequisitions(0)
  const requisitions = useMemo(() => data?.content ?? [], [data])
  const [requisitionId, setRequisitionId] = useState('')

  useEffect(() => {
    if (!requisitionId && requisitions.length > 0) {
      const firstOpen = requisitions.find((r) => r.status !== 'CLOSED') ?? requisitions[0]
      setRequisitionId(firstOpen.id)
    }
  }, [requisitions, requisitionId])

  const selected: JobRequisition | undefined = requisitions.find((r) => r.id === requisitionId)
  const { data: candidates = [], isLoading } = useCandidates(requisitionId || undefined)
  const addCandidate = useAddCandidate()
  const updateStage = useUpdateCandidateStage()

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[13px] font-semibold text-text-secondary">Requisition</label>
        <select value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)} className="ut-select ut-select-sm w-auto min-w-[240px]">
          {requisitions.length === 0 && <option value="">No requisitions</option>}
          {requisitions.map((r) => (
            <option key={r.id} value={r.id}>{r.title} ({fmtEnum(r.status)})</option>
          ))}
        </select>
        {selected && (
          <HrStatusPill tone={STATUS_TONE[selected.status]}>{selected.openings} opening{selected.openings === 1 ? '' : 's'}</HrStatusPill>
        )}
      </div>

      {canAdd && (
        <div className="ut-card flex flex-wrap items-end gap-2 p-4">
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
          <HrButton onClick={onAdd} disabled={addCandidate.isPending}><Plus size={15} /> Add Candidate</HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Source</th>
              <th>Expected CTC</th>
              <th>Stage</th>
              {canCandidateWrite && <th className="text-right">Advance</th>}
            </tr>
          </thead>
          <tbody>
            {!requisitionId ? (
              <tr><td colSpan={canCandidateWrite ? 5 : 4} className="py-14 text-center text-sm text-text-tertiary">Pick a requisition to view its pipeline.</td></tr>
            ) : isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={canCandidateWrite ? 5 : 4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : candidates.length === 0 ? (
              <tr><td colSpan={canCandidateWrite ? 5 : 4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No candidates yet</p><p className="mt-1 text-xs text-text-tertiary">Add candidates to start the pipeline.</p></td></tr>
            ) : candidates.map((c, i) => (
              <tr key={c.id}>
                <td><HrAvatar name={c.fullName} sub={c.email} seed={i} /></td>
                <td className="text-text-secondary">{c.source || '—'}</td>
                <td className="text-text-secondary">{c.expectedCtc != null ? inr(c.expectedCtc) : '—'}</td>
                <td><HrStatusPill tone={STAGE_TONE[c.stage]}>{fmtEnum(c.stage)}</HrStatusPill></td>
                {canCandidateWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      <select
                        value={c.stage}
                        onChange={(e) => onStage(c.id, e.target.value as CandidateStage)}
                        disabled={updateStage.isPending}
                        className="ut-select ut-select-sm w-auto"
                        aria-label="Advance candidate stage"
                      >
                        {CANDIDATE_STAGES.map((s) => <option key={s} value={s}>{fmtEnum(s)}</option>)}
                      </select>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
