import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Briefcase, DoorOpen, Lock, Users, XCircle } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useRequisitions, useCreateRequisition, useCloseRequisition,
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

      {tab === 'requisitions' && <RequisitionsTab canWrite={canWrite} />}
      {tab === 'pipeline' && canRead && <PipelineTab canCandidateWrite={canCandidateWrite} />}
    </div>
  )
}

// ── Requisitions ───────────────────────────────────────────────────────────

function RequisitionsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const { data, isLoading } = useRequisitions(0)
  const create = useCreateRequisition()
  const close = useCloseRequisition()
  const requisitions = data?.content ?? []

  const [title, setTitle] = useState('')
  const [openings, setOpenings] = useState('1')
  const [location, setLocation] = useState('')
  const [employmentType, setEmploymentType] = useState<EmploymentType>('FULL_TIME')

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

  const onClose = async (id: string) => {
    try {
      await close.mutateAsync(id)
      toast('Requisition closed', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const inputCls = 'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<Briefcase size={18} />} color="blue" value={requisitions.length} label="Requisitions" loading={isLoading} />
        <HrStatCard icon={<DoorOpen size={18} />} color="green" value={stats.open} label="Open" loading={isLoading} />
        <HrStatCard icon={<Users size={18} />} color="orange" value={stats.totalOpenings} label="Open Positions" loading={isLoading} />
        <HrStatCard icon={<Lock size={18} />} color="teal" value={stats.closed} label="Closed" loading={isLoading} />
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Job title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Senior Backend Engineer" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Openings</label>
            <input type="number" min={1} value={openings} onChange={(e) => setOpenings(e.target.value)} className={`${inputCls} w-24`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Bengaluru" className={`${inputCls} w-40`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Type</label>
            <select value={employmentType} onChange={(e) => setEmploymentType(e.target.value as EmploymentType)} className={inputCls}>
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
              {canWrite && <th className="text-right">Action</th>}
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
                    <div className="flex items-center justify-end">
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

  const inputCls = 'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-semibold text-text-secondary">Requisition</label>
        <select value={requisitionId} onChange={(e) => setRequisitionId(e.target.value)} className={`${inputCls} min-w-[240px]`}>
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
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Full name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Priya Sharma" className={`${inputCls} w-full`} />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Optional" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Source</label>
            <input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. LinkedIn" className={`${inputCls} w-36`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Expected CTC (₹)</label>
            <input type="number" min={0} value={expectedCtc} onChange={(e) => setExpectedCtc(e.target.value)} placeholder="Optional" className={`${inputCls} w-32`} />
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
                        className={inputCls}
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
