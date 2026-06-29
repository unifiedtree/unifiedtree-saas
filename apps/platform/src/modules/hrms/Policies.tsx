import React, { useMemo, useState } from 'react'
import { Plus, Archive, Check, FileText, CheckCircle2, Clock, Users, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  usePolicies, useMyAcknowledgements, useAcknowledgePolicy, usePolicyAcknowledgements,
  useCreatePolicy, useUpdatePolicy, useArchivePolicy,
  type Policy, type PolicyStatus,
} from './api/usePolicy'

const STATUS_TONE: Record<PolicyStatus, PillTone> = {
  ACTIVE: 'ok', ARCHIVED: 'gray',
}

type Tab = 'policies' | 'manage'

export const Policies: React.FC = () => {
  const canRead = usePermission('hrms.policy.read')
  const canWrite = usePermission('hrms.policy.write')
  const canAcknowledge = usePermission('hrms.policy.acknowledge.self')
  const [tab, setTab] = useState<Tab>('policies')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'policies', label: 'Policies' },
    ...(canWrite ? [{ key: 'manage' as Tab, label: 'Manage' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="HR Policies" title="Policy Center" subtitle="Read company policies and track acknowledgements" />

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

      {tab === 'policies' && canRead && <PoliciesTab canAcknowledge={canAcknowledge} />}
      {tab === 'manage' && canWrite && <ManageTab />}
    </div>
  )
}

// ── Policies (read + acknowledge) ─────────────────────────────────────────────

function PoliciesTab({ canAcknowledge }: { canAcknowledge: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = usePolicies(0)
  const { data: myAcks = [] } = useMyAcknowledgements()
  const acknowledge = useAcknowledgePolicy()
  const [openId, setOpenId] = useState<string | null>(null)

  const policies = data?.content ?? []
  const ackSet = useMemo(() => new Set(myAcks), [myAcks])

  const stats = useMemo(() => {
    const total = policies.length
    const acknowledged = policies.filter((p) => ackSet.has(p.id)).length
    const pending = total - acknowledged
    return { total, acknowledged, pending }
  }, [policies, ackSet])

  const onAcknowledge = async (id: string) => {
    try {
      await acknowledge.mutateAsync(id)
      toast('Policy acknowledged', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to acknowledge', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <HrStatCard icon={<FileText size={18} />} color="blue" value={stats.total} label="Active Policies" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={stats.acknowledged} label="Acknowledged" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending" loading={isLoading} />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 w-full animate-pulse rounded-2xl bg-bg-base" />)}
        </div>
      ) : policies.length === 0 ? (
        <div className="rounded-2xl border border-border-default bg-white py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-text-secondary">No active policies</p>
          <p className="mt-1 text-xs text-text-tertiary">Published policies will appear here for you to read and acknowledge.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {policies.map((p) => {
            const acked = ackSet.has(p.id)
            const open = openId === p.id
            return (
              <div key={p.id} className="rounded-2xl border border-border-default bg-white shadow-sm">
                <button
                  onClick={() => setOpenId(open ? null : p.id)}
                  className="flex w-full items-start justify-between gap-3 p-5 text-left"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-text-primary">{p.title}</span>
                      {p.category && <HrStatusPill tone="info">{p.category}</HrStatusPill>}
                      {p.version && <span className="text-xs font-medium text-text-tertiary">{p.version}</span>}
                      {acked && <HrStatusPill tone="ok">Acknowledged</HrStatusPill>}
                    </div>
                    <p className="mt-1 text-xs text-text-tertiary">
                      {p.effectiveDate ? `Effective ${format(new Date(p.effectiveDate), 'd MMM yyyy')}` : 'No effective date'}
                    </p>
                  </div>
                  <span className="mt-0.5 text-text-tertiary">{open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </button>

                {open && (
                  <div className="border-t border-border-default px-5 py-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                      {p.content?.trim() || 'No content provided for this policy.'}
                    </p>
                    {canAcknowledge && (
                      <div className="mt-4 flex justify-end">
                        {acked ? (
                          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#15803D]">
                            <CheckCircle2 size={15} /> You acknowledged this policy
                          </span>
                        ) : (
                          <HrButton onClick={() => onAcknowledge(p.id)} disabled={acknowledge.isPending}>
                            <Check size={14} /> Acknowledge
                          </HrButton>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Manage (admin: create / edit / archive) ───────────────────────────────────

interface DraftPolicy {
  title: string
  category: string
  version: string
  effectiveDate: string
  content: string
}

const emptyDraft = (): DraftPolicy => ({
  title: '', category: '', version: '', effectiveDate: new Date().toISOString().slice(0, 10), content: '',
})

function ManageTab() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const { data, isLoading } = usePolicies(0)
  const create = useCreatePolicy()
  const update = useUpdatePolicy()
  const archive = useArchivePolicy()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftPolicy>(emptyDraft())
  const [detailId, setDetailId] = useState<string | null>(null)

  const policies = data?.content ?? []

  const startEdit = (p: Policy) => {
    setEditingId(p.id)
    setDraft({
      title: p.title,
      category: p.category ?? '',
      version: p.version ?? '',
      effectiveDate: p.effectiveDate ?? new Date().toISOString().slice(0, 10),
      content: p.content ?? '',
    })
  }

  const reset = () => { setEditingId(null); setDraft(emptyDraft()) }

  const onSave = async () => {
    if (!draft.title.trim()) { toast('Policy title is required', 'error'); return }
    const body = {
      title: draft.title.trim(),
      category: draft.category.trim() || undefined,
      version: draft.version.trim() || undefined,
      effectiveDate: draft.effectiveDate || undefined,
      content: draft.content.trim() || undefined,
    }
    try {
      if (editingId) {
        await update.mutateAsync({ id: editingId, ...body })
        toast('Policy updated', 'success')
      } else {
        if (!activeCompany) { toast('No company available', 'error'); return }
        await create.mutateAsync({ companyId: activeCompany, ...body })
        toast('Policy published', 'success')
      }
      reset()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save policy', 'error')
    }
  }

  const onArchive = async (id: string) => {
    try {
      await archive.mutateAsync(id)
      toast('Policy archived', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to archive', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'
  const saving = create.isPending || update.isPending

  return (
    <div className="space-y-5">
      {companies.length > 1 && !editingId && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-sm font-bold text-text-primary">{editingId ? 'Edit policy' : 'Publish a policy'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Title *</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Remote Work Policy" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
            <input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="e.g. Workplace" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Version</label>
            <input value={draft.version} onChange={(e) => setDraft({ ...draft, version: e.target.value })} placeholder="e.g. v1.0" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Effective date</label>
            <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} className={inputCls} />
          </div>
          <div className="col-span-2">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Content</label>
            <textarea value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} rows={5} placeholder="The full policy text employees will read and acknowledge" className={inputCls} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          {editingId && <HrButton variant="ghost" onClick={reset}>Cancel</HrButton>}
          <HrButton onClick={onSave} disabled={saving}>
            {editingId ? <Check size={15} /> : <Plus size={15} />} {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Publish Policy'}
          </HrButton>
        </div>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Category</th>
              <th>Version</th>
              <th>Acknowledged</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : policies.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center text-sm text-text-tertiary">No policies published yet.</td></tr>
            ) : policies.map((p) => (
              <React.Fragment key={p.id}>
                <tr>
                  <td className="font-medium text-text-primary">{p.title}</td>
                  <td className="text-text-secondary">{p.category || '—'}</td>
                  <td className="text-text-secondary">{p.version || '—'}</td>
                  <td>
                    <button onClick={() => setDetailId(detailId === p.id ? null : p.id)} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#C16E00] hover:text-[#9A5600]">
                      <Users size={14} /> {p.acknowledgementCount}
                    </button>
                  </td>
                  <td><HrStatusPill tone={STATUS_TONE[p.status]}>{p.status}</HrStatusPill></td>
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      <HrButton size="sm" variant="ghost" onClick={() => startEdit(p)}>Edit</HrButton>
                      {p.status === 'ACTIVE' && (
                        <button onClick={() => onArchive(p.id)} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Archive">
                          <Archive size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
                {detailId === p.id && (
                  <tr>
                    <td colSpan={6} className="bg-bg-base/40 p-0">
                      <AcknowledgementList policyId={p.id} />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

function AcknowledgementList({ policyId }: { policyId: string }) {
  const { data, isLoading } = usePolicyAcknowledgements(policyId, 0)
  const acks = data?.content ?? []

  if (isLoading) {
    return <div className="p-4"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></div>
  }
  if (acks.length === 0) {
    return <p className="p-4 text-center text-xs text-text-tertiary">No acknowledgements yet.</p>
  }
  return (
    <div className="space-y-2 p-4">
      {acks.map((a, i) => (
        <div key={a.id} className="flex items-center justify-between">
          <HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} seed={i} />
          <span className="text-xs text-text-tertiary">
            {a.acknowledgedAt ? format(new Date(a.acknowledgedAt), 'd MMM yyyy, HH:mm') : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
