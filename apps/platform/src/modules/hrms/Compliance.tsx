import React, { useMemo, useState } from 'react'
import { Plus, Check, ShieldAlert, CalendarClock, FileCheck2, Lock, AlertTriangle, BadgeCheck } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useComplianceItems, useCreateComplianceItem, useMarkComplianceDone,
  useStatutoryFilings, useCreateFiling, useFileFiling,
  usePoshComplaints, useCreatePoshComplaint, useUpdatePoshStatus,
  inr, FILING_TYPES, POSH_STATUSES, POSH_SEVERITIES,
  type ComplianceStatus, type FilingType, type FilingStatus, type PoshStatus,
} from './api/useCompliance'

const ITEM_TONE: Record<ComplianceStatus, PillTone> = { PENDING: 'warn', DONE: 'ok', OVERDUE: 'red' }
const FILING_TONE: Record<FilingStatus, PillTone> = { DUE: 'warn', FILED: 'ok', LATE: 'red' }
const POSH_TONE: Record<PoshStatus, PillTone> = {
  RECEIVED: 'info', UNDER_INQUIRY: 'warn', RESOLVED: 'ok', DISMISSED: 'gray',
}

const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'
const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d?: string) => (d ? format(new Date(d), 'd MMM yyyy') : '—')

type Tab = 'calendar' | 'filings' | 'posh'

export const Compliance: React.FC = () => {
  const canWrite = usePermission('hrms.compliance.write')
  const canPosh = usePermission('hrms.compliance.posh')
  const [tab, setTab] = useState<Tab>('calendar')

  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''

  const tabs: { key: Tab; label: string }[] = [
    { key: 'calendar', label: 'Compliance Calendar' },
    { key: 'filings', label: 'Statutory Filings' },
    { key: 'posh', label: 'POSH' },
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Compliance" title="Statutory Compliance" subtitle="Compliance calendar, statutory filings, and the POSH register" />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 border-b border-border-default">
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
        {companies.length > 1 && (
          <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      {tab === 'calendar' && <CalendarTab companyId={activeCompany} canWrite={canWrite} />}
      {tab === 'filings' && <FilingsTab companyId={activeCompany} canWrite={canWrite} />}
      {tab === 'posh' && (canPosh ? <PoshTab companyId={activeCompany} /> : <PoshDenied />)}
    </div>
  )
}

// ── Compliance calendar ──────────────────────────────────────────────────────

function CalendarTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = useComplianceItems(companyId || undefined)
  const create = useCreateComplianceItem()
  const markDone = useMarkComplianceDone()
  const { data: dir } = useEmployeeDirectory({ companyId, pageSize: 100 }, { enabled: !!companyId })
  const employees = dir?.content ?? []
  const items = data?.content ?? []

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [dueDate, setDueDate] = useState(today())
  const [frequency, setFrequency] = useState('')
  const [ownerId, setOwnerId] = useState('')

  const stats = useMemo(() => {
    const pending = items.filter((i) => i.status === 'PENDING').length
    const overdue = items.filter((i) => i.status === 'OVERDUE').length
    const done = items.filter((i) => i.status === 'DONE').length
    return { pending, overdue, done }
  }, [items])

  const onCreate = async () => {
    if (!title.trim()) { toast('Give the obligation a title', 'error'); return }
    if (!dueDate) { toast('Pick a due date', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        title: title.trim(),
        category: category.trim() || undefined,
        dueDate,
        frequency: frequency.trim() || undefined,
        ownerId: ownerId || undefined,
      })
      toast('Compliance item added', 'success')
      setTitle(''); setCategory(''); setFrequency(''); setOwnerId(''); setDueDate(today())
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to add item', 'error')
    }
  }

  const onDone = async (id: string) => {
    try {
      await markDone.mutateAsync(id)
      toast('Marked done', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <HrStatCard icon={<CalendarClock size={18} />} color="orange" value={stats.pending} label="Pending" loading={isLoading} />
        <HrStatCard icon={<AlertTriangle size={18} />} color="red" value={stats.overdue} label="Overdue" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.done} label="Completed" loading={isLoading} />
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Obligation *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. PF monthly return" className={inputCls} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
            <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Statutory" className={`${inputCls} w-36`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Due date *</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} w-40`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Frequency</label>
            <input value={frequency} onChange={(e) => setFrequency(e.target.value)} placeholder="e.g. Monthly" className={`${inputCls} w-32`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Owner</label>
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={`${inputCls} w-44`}>
              <option value="">Unassigned</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{[e.firstName, e.lastName].filter(Boolean).join(' ')}{e.employeeCode ? ` (${e.employeeCode})` : ''}</option>
              ))}
            </select>
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add</HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Obligation</th>
              <th>Category</th>
              <th>Owner</th>
              <th>Due</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canWrite ? 6 : 5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : items.length === 0 ? (
              <tr><td colSpan={canWrite ? 6 : 5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No compliance items yet</p><p className="mt-1 text-xs text-text-tertiary">Track statutory due dates so nothing is missed.</p></td></tr>
            ) : items.map((i) => (
              <tr key={i.id}>
                <td className="font-medium text-text-primary">{i.title}</td>
                <td className="text-text-secondary">{i.category || '—'}</td>
                <td className="text-text-secondary">{i.ownerName || '—'}</td>
                <td className="text-text-secondary">{fmtDate(i.dueDate)}</td>
                <td><HrStatusPill tone={ITEM_TONE[i.status]}>{i.status}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {i.status !== 'DONE' && (
                        <HrButton size="sm" variant="ghost" onClick={() => onDone(i.id)} disabled={markDone.isPending}><Check size={14} /> Mark done</HrButton>
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

// ── Statutory filings ────────────────────────────────────────────────────────

function FilingsTab({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = useStatutoryFilings(companyId || undefined)
  const create = useCreateFiling()
  const file = useFileFiling()
  const filings = data?.content ?? []

  const [filingType, setFilingType] = useState<FilingType>('PF')
  const [period, setPeriod] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState(today())

  const onCreate = async () => {
    if (!dueDate) { toast('Pick a due date', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        filingType,
        period: period.trim() || undefined,
        amount: amount ? parseFloat(amount) : null,
        dueDate,
      })
      toast('Filing scheduled', 'success')
      setPeriod(''); setAmount(''); setDueDate(today())
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to add filing', 'error')
    }
  }

  const onFile = async (id: string) => {
    const referenceNo = window.prompt('Challan / acknowledgement reference (optional):') ?? undefined
    try {
      await file.mutateAsync({ id, referenceNo: referenceNo?.trim() || undefined })
      toast('Filing recorded', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Type</label>
            <select value={filingType} onChange={(e) => setFilingType(e.target.value as FilingType)} className={`${inputCls} w-32`}>
              {FILING_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Period</label>
            <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. 2026-05" className={`${inputCls} w-32`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Amount (₹)</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Optional" className={`${inputCls} w-32`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Due date *</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={`${inputCls} w-40`} />
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add Filing</HrButton>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Period</th>
              <th>Amount</th>
              <th>Due</th>
              <th>Filed</th>
              <th>Reference</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canWrite ? 8 : 7} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : filings.length === 0 ? (
              <tr><td colSpan={canWrite ? 8 : 7} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No filings recorded</p><p className="mt-1 text-xs text-text-tertiary">Schedule PF / ESI / TDS filings to track deadlines.</p></td></tr>
            ) : filings.map((f) => (
              <tr key={f.id}>
                <td><HrStatusPill tone="info">{f.filingType}</HrStatusPill></td>
                <td className="text-text-secondary">{f.period || '—'}</td>
                <td className="font-semibold text-text-primary">{f.amount != null ? inr(f.amount) : '—'}</td>
                <td className="text-text-secondary">{fmtDate(f.dueDate)}</td>
                <td className="text-text-secondary">{fmtDate(f.filedDate)}</td>
                <td className="text-text-secondary">{f.referenceNo || '—'}</td>
                <td><HrStatusPill tone={FILING_TONE[f.status]}>{f.status}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {f.status === 'DUE' && (
                        <HrButton size="sm" onClick={() => onFile(f.id)} disabled={file.isPending}><FileCheck2 size={14} /> Mark filed</HrButton>
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

// ── POSH register ────────────────────────────────────────────────────────────

function PoshDenied() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border-default bg-white py-16 text-center shadow-sm">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#FEE2E2] text-[#B91C1C]">
        <Lock size={22} />
      </div>
      <p className="text-sm font-semibold text-text-secondary">Restricted area</p>
      <p className="mt-1 max-w-sm text-xs text-text-tertiary">The POSH complaints register holds sensitive information. You need the POSH access permission to view it.</p>
    </div>
  )
}

function PoshTab({ companyId }: { companyId: string }) {
  const { toast } = useToast()
  const { data, isLoading } = usePoshComplaints(companyId || undefined)
  const create = useCreatePoshComplaint()
  const updateStatus = useUpdatePoshStatus()
  const complaints = data?.content ?? []

  const [filedDate, setFiledDate] = useState(today())
  const [severity, setSeverity] = useState(POSH_SEVERITIES[1])
  const [description, setDescription] = useState('')

  const onCreate = async () => {
    if (!filedDate) { toast('Pick the filing date', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companyId || undefined,
        filedDate,
        severity,
        description: description.trim() || undefined,
      })
      toast('Complaint registered', 'success')
      setDescription(''); setFiledDate(today())
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to register complaint', 'error')
    }
  }

  const onAdvance = async (id: string, status: PoshStatus) => {
    let resolution: string | undefined
    if (status === 'RESOLVED' || status === 'DISMISSED') {
      resolution = window.prompt('Resolution / closing note (optional):') ?? undefined
    }
    try {
      await updateStatus.mutateAsync({ id, status, resolution: resolution?.trim() || undefined })
      toast('Status updated', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-2xl border border-[#FFD68A] bg-[#FFF8EC] px-4 py-3">
        <ShieldAlert size={16} className="mt-0.5 text-[#C16E00]" />
        <p className="text-xs text-text-secondary">This register is confidential. Record only what is necessary and handle every entry in line with your POSH policy.</p>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Filed date *</label>
          <input type="date" value={filedDate} onChange={(e) => setFiledDate(e.target.value)} className={`${inputCls} w-40`} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Severity</label>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={`${inputCls} w-32`}>
            {POSH_SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief, factual summary" className={inputCls} />
        </div>
        <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Register</HrButton>
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Complaint #</th>
              <th>Filed</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Resolved</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : complaints.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No complaints on record</p><p className="mt-1 text-xs text-text-tertiary">Registered complaints appear here with their inquiry status.</p></td></tr>
            ) : complaints.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-text-primary">{c.complaintNo}</td>
                <td className="text-text-secondary">{fmtDate(c.filedDate)}</td>
                <td className="text-text-secondary">{c.severity || '—'}</td>
                <td><HrStatusPill tone={POSH_TONE[c.status]}>{c.status.replace(/_/g, ' ')}</HrStatusPill></td>
                <td className="text-text-secondary">{fmtDate(c.resolvedDate)}</td>
                <td>
                  <div className="flex items-center justify-end gap-2">
                    {c.status !== 'RESOLVED' && c.status !== 'DISMISSED' ? (
                      <select
                        value=""
                        onChange={(e) => { if (e.target.value) onAdvance(c.id, e.target.value as PoshStatus) }}
                        disabled={updateStatus.isPending}
                        className="rounded-lg border border-border-default bg-white px-2 py-1.5 text-xs text-text-primary focus:border-[#FF9D00] focus:outline-none"
                      >
                        <option value="">Update status…</option>
                        {POSH_STATUSES.filter((s) => s !== c.status).map((s) => (
                          <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-text-tertiary">Closed</span>
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
