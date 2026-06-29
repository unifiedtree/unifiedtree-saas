import React, { useMemo, useState } from 'react'
import { Plus, Trash2, FileText, Check, Wallet, Clock, BadgeCheck, CircleDollarSign } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useFnfSettlements, useProcessSettlement, useApproveSettlement, usePaySettlement,
  inr,
  type FnfStatus, type FnfComponentType,
} from './api/useFnf'

const STATUS_TONE: Record<FnfStatus, PillTone> = {
  INITIATED: 'gray', PROCESSED: 'warn', APPROVED: 'ok', PAID: 'teal',
}

type Tab = 'settlements' | 'create'

export const FullAndFinal: React.FC = () => {
  const canRead = usePermission('hrms.fnf.read')
  const canProcess = usePermission('hrms.fnf.process')
  const canApprove = usePermission('hrms.fnf.approve')
  const [tab, setTab] = useState<Tab>(canRead ? 'settlements' : 'create')

  const tabs: { key: Tab; label: string }[] = [
    ...(canRead ? [{ key: 'settlements' as Tab, label: 'Settlements' }] : []),
    ...(canProcess ? [{ key: 'create' as Tab, label: 'Create Settlement' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Full & Final" title="Full & Final Settlement" subtitle="Process, approve, and pay out exit settlements" />

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

      {tab === 'settlements' && canRead && <SettlementsTab canApprove={canApprove} />}
      {tab === 'create' && canProcess && <CreateTab onCreated={() => setTab(canRead ? 'settlements' : 'create')} />}
    </div>
  )
}

// ── Settlements ────────────────────────────────────────────────────────────────

function SettlementsTab({ canApprove }: { canApprove: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = useFnfSettlements(0)
  const approve = useApproveSettlement()
  const pay = usePaySettlement()
  const settlements = data?.content ?? []

  const stats = useMemo(() => {
    const processed = settlements.filter((s) => s.status === 'PROCESSED').length
    const approved = settlements.filter((s) => s.status === 'APPROVED').length
    const paid = settlements.filter((s) => s.status === 'PAID')
      .reduce((sum, s) => sum + (s.netSettlement ?? 0), 0)
    return { processed, approved, paid }
  }, [settlements])

  const onApprove = async (id: string) => {
    try {
      await approve.mutateAsync(id)
      toast('Settlement approved', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to approve', 'error')
    }
  }

  const onPay = async (id: string) => {
    try {
      await pay.mutateAsync(id)
      toast('Settlement marked paid', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to pay', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<FileText size={18} />} color="blue" value={settlements.length} label="Total Settlements" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.processed} label="Awaiting Approval" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.paid)} label="Paid Out" loading={isLoading} />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th className="hidden sm:table-cell">Last Working Day</th>
              <th>Net Settlement</th>
              <th>Status</th>
              {canApprove && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canApprove ? 5 : 4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : settlements.length === 0 ? (
              <tr><td colSpan={canApprove ? 5 : 4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No settlements yet</p><p className="mt-1 text-xs text-text-tertiary">Use “Create Settlement” to process a leaver's full &amp; final.</p></td></tr>
            ) : settlements.map((s, i) => (
              <tr key={s.id}>
                <td><HrAvatar name={s.employeeName || 'Employee'} sub={s.employeeCode} seed={i} /></td>
                <td className="hidden sm:table-cell text-text-secondary">{s.lastWorkingDay ? format(new Date(s.lastWorkingDay), 'd MMM yyyy') : '—'}</td>
                <td className="font-semibold text-text-primary">{inr(s.netSettlement)}</td>
                <td><HrStatusPill tone={STATUS_TONE[s.status]}>{s.status}</HrStatusPill></td>
                {canApprove && (
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      {s.status === 'PROCESSED' && (
                        <HrButton size="sm" onClick={() => onApprove(s.id)} disabled={approve.isPending}><Check size={14} /> Approve</HrButton>
                      )}
                      {s.status === 'APPROVED' && (
                        <HrButton size="sm" onClick={() => onPay(s.id)} disabled={pay.isPending}><CircleDollarSign size={14} /> Pay</HrButton>
                      )}
                      {(s.status === 'PAID' || s.status === 'INITIATED') && (
                        <span className="text-xs text-text-tertiary">—</span>
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

// ── Create Settlement ──────────────────────────────────────────────────────────

interface DraftComponent {
  label: string
  type: FnfComponentType
  amount: string
}

const emptyComponent = (type: FnfComponentType = 'EARNING'): DraftComponent => ({
  label: '', type, amount: '',
})

function CreateTab({ onCreated }: { onCreated: () => void }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id || ''
  const { data: dir } = useEmployeeDirectory({ companyId, pageSize: 200 }, { enabled: !!companyId })
  const employees = dir?.content ?? []
  const process = useProcessSettlement()

  const [employeeId, setEmployeeId] = useState('')
  const [lastWorkingDay, setLastWorkingDay] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [components, setComponents] = useState<DraftComponent[]>([emptyComponent('EARNING'), emptyComponent('DEDUCTION')])

  const totals = useMemo(() => {
    const gross = components.filter((c) => c.type === 'EARNING').reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
    const deductions = components.filter((c) => c.type === 'DEDUCTION').reduce((s, c) => s + (parseFloat(c.amount) || 0), 0)
    return { gross, deductions, net: gross - deductions }
  }, [components])

  const setComponent = (i: number, patch: Partial<DraftComponent>) =>
    setComponents((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const handleSubmit = async () => {
    if (!employeeId) { toast('Select an employee', 'error'); return }
    if (!lastWorkingDay) { toast('Set the last working day', 'error'); return }
    const valid = components.filter((c) => c.label.trim() && parseFloat(c.amount) >= 0 && c.amount !== '')
    if (valid.length === 0) { toast('Add at least one component with a label and amount', 'error'); return }
    try {
      await process.mutateAsync({
        employeeId,
        companyId: companyId || undefined,
        lastWorkingDay,
        notes: notes.trim() || undefined,
        components: valid.map((c) => ({
          label: c.label.trim(),
          type: c.type,
          amount: parseFloat(c.amount),
        })),
      })
      toast('Settlement processed', 'success')
      onCreated()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to process settlement', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Employee *</label>
            <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
              <option value="">Select employee…</option>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {`${emp.firstName}${emp.lastName ? ' ' + emp.lastName : ''}${emp.employeeCode ? ' (' + emp.employeeCode + ')' : ''}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Last Working Day *</label>
            <input type="date" value={lastWorkingDay} onChange={(e) => setLastWorkingDay(e.target.value)} className={inputCls} />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {components.map((c, i) => (
          <div key={i} className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Component {i + 1}</span>
              {components.length > 1 && (
                <button onClick={() => setComponents((p) => p.filter((_, idx) => idx !== i))} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" aria-label="Remove component">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1 block text-xs font-medium text-text-secondary">Label</label>
                <input value={c.label} onChange={(e) => setComponent(i, { label: e.target.value })} placeholder="e.g. Leave encashment" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Type</label>
                <select value={c.type} onChange={(e) => setComponent(i, { type: e.target.value as FnfComponentType })} className={inputCls}>
                  <option value="EARNING">Earning</option>
                  <option value="DEDUCTION">Deduction</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Amount (₹)</label>
                <input type="number" min={0} step="0.01" value={c.amount} onChange={(e) => setComponent(i, { amount: e.target.value })} className={inputCls} />
              </div>
            </div>
          </div>
        ))}
        <div className="flex gap-4">
          <button onClick={() => setComponents((p) => [...p, emptyComponent('EARNING')])} className="flex items-center gap-1.5 text-sm font-semibold text-[#C16E00] hover:text-[#9A5600]">
            <Plus size={15} /> Add earning
          </button>
          <button onClick={() => setComponents((p) => [...p, emptyComponent('DEDUCTION')])} className="flex items-center gap-1.5 text-sm font-semibold text-[#C16E00] hover:text-[#9A5600]">
            <Plus size={15} /> Add deduction
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for the approver" className={inputCls} />
      </div>

      <div className="rounded-2xl border border-[#FFD68A] bg-[#FFF8EC] px-5 py-4">
        <div className="grid grid-cols-3 gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Gross Payable</p>
            <p className="text-lg font-bold text-text-primary">{inr(totals.gross)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Deductions</p>
            <p className="text-lg font-bold text-[#B91C1C]">{inr(totals.deductions)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Net Settlement</p>
            <p className="text-lg font-bold text-text-primary">{inr(totals.net)}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <HrButton onClick={handleSubmit} disabled={process.isPending}>
            {process.isPending ? 'Processing…' : 'Process Settlement'}
          </HrButton>
        </div>
      </div>
    </div>
  )
}
