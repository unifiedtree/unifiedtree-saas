import React, { useMemo, useState } from 'react'
import { Plus, Check, X, Wallet, Clock, BadgeCheck, Trophy, Banknote, Award } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useAllAwards, useMyIncentives, useCreateAward, usePliDecision, usePayAward,
  inr, type PliStatus,
} from './api/usePli'

const STATUS_TONE: Record<PliStatus, PillTone> = {
  PROPOSED: 'warn', APPROVED: 'ok', PAID: 'teal', REJECTED: 'red',
}

type Tab = 'all' | 'my'

export const Pli: React.FC = () => {
  const canReadAll = usePermission('hrms.pli.read')
  const canWrite = usePermission('hrms.pli.write')
  const canReadSelf = usePermission('hrms.pli.read.self')
  const [tab, setTab] = useState<Tab>(canReadAll ? 'all' : 'my')

  const tabs: { key: Tab; label: string }[] = [
    ...(canReadAll ? [{ key: 'all' as Tab, label: 'All Awards' }] : []),
    ...(canReadSelf ? [{ key: 'my' as Tab, label: 'My Incentives' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Performance-Linked Incentive" title="Incentive Center" subtitle="Propose, approve, and pay out performance-linked incentives" />

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

      {tab === 'all' && canReadAll && <AllAwardsTab canWrite={canWrite} />}
      {tab === 'my' && canReadSelf && <MyIncentivesTab />}
    </div>
  )
}

// ── All Awards (admin) ─────────────────────────────────────────────────────────

function AllAwardsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = useAllAwards(0)
  const decide = usePliDecision()
  const pay = usePayAward()
  const awards = data?.content ?? []

  const onDecide = async (id: string, approved: boolean) => {
    try {
      await decide.mutateAsync({ id, approved })
      toast(approved ? 'Award approved' : 'Award rejected', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const onPay = async (id: string) => {
    try {
      await pay.mutateAsync(id)
      toast('Award marked paid', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {canWrite && <CreateAwardForm />}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Plan</th>
              <th className="hidden sm:table-cell">Period</th>
              <th>Amount</th>
              <th>Status</th>
              {canWrite && <th className="text-right">Action</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={canWrite ? 6 : 5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : awards.length === 0 ? (
              <tr><td colSpan={canWrite ? 6 : 5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No incentive awards yet</p><p className="mt-1 text-xs text-text-tertiary">{canWrite ? 'Use the form above to propose the first award.' : 'Proposed awards will appear here.'}</p></td></tr>
            ) : awards.map((a, i) => (
              <tr key={a.id}>
                <td><HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} seed={i} /></td>
                <td className="text-text-primary">{a.planName}</td>
                <td className="hidden sm:table-cell text-text-secondary">{a.period || '—'}</td>
                <td className="font-semibold text-text-primary">{inr(a.amount)}</td>
                <td><HrStatusPill tone={STATUS_TONE[a.status]}>{a.status}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      {a.status === 'PROPOSED' && (
                        <>
                          <HrButton size="sm" onClick={() => onDecide(a.id, true)} disabled={decide.isPending}><Check size={14} /> Approve</HrButton>
                          <HrButton size="sm" variant="ghost" onClick={() => onDecide(a.id, false)} disabled={decide.isPending}><X size={14} /> Reject</HrButton>
                        </>
                      )}
                      {a.status === 'APPROVED' && (
                        <HrButton size="sm" onClick={() => onPay(a.id)} disabled={pay.isPending}><Banknote size={14} /> Pay</HrButton>
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

// ── Create Award ────────────────────────────────────────────────────────────────

function CreateAwardForm() {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''
  const { data: directory } = useEmployeeDirectory({ companyId: activeCompany, pageSize: 200 }, { enabled: !!activeCompany })
  const employees = directory?.content ?? []
  const create = useCreateAward()

  const [employeeId, setEmployeeId] = useState('')
  const [planName, setPlanName] = useState('')
  const [period, setPeriod] = useState('')
  const [amount, setAmount] = useState('')
  const [ratingBasis, setRatingBasis] = useState('')
  const [notes, setNotes] = useState('')

  const reset = () => { setEmployeeId(''); setPlanName(''); setPeriod(''); setAmount(''); setRatingBasis(''); setNotes('') }

  const onCreate = async () => {
    if (!employeeId) { toast('Select an employee', 'error'); return }
    if (!planName.trim()) { toast('Give the incentive plan a name', 'error'); return }
    const amountNum = parseFloat(amount)
    if (!(amountNum > 0)) { toast('Enter an incentive amount', 'error'); return }
    try {
      await create.mutateAsync({
        employeeId,
        companyId: activeCompany || undefined,
        planName: planName.trim(),
        period: period.trim() || undefined,
        amount: amountNum,
        ratingBasis: ratingBasis ? parseFloat(ratingBasis) : null,
        notes: notes.trim() || undefined,
      })
      toast('Incentive award proposed', 'success')
      reset()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to propose award', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Award size={16} className="text-[#C16E00]" />
        <h3 className="text-sm font-semibold text-text-primary">Propose Incentive Award</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {companies.length > 1 && (
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Company</label>
            <select value={activeCompany} onChange={(e) => { setCompanyId(e.target.value); setEmployeeId('') }} className={inputCls}>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Employee *</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
            <option value="">Select employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {[emp.firstName, emp.lastName].filter(Boolean).join(' ')}{emp.employeeCode ? ` · ${emp.employeeCode}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Plan name *</label>
          <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Q3 Sales Incentive" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Period</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. FY24-Q3" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Amount (₹) *</label>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 25000" className={inputCls} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">Rating basis</label>
          <input type="number" min={0} max={5} step="0.1" value={ratingBasis} onChange={(e) => setRatingBasis(e.target.value)} placeholder="e.g. 4.5" className={inputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for the approver" className={inputCls} />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <HrButton onClick={onCreate} disabled={create.isPending}>
          <Plus size={15} /> {create.isPending ? 'Proposing…' : 'Propose Award'}
        </HrButton>
      </div>
    </div>
  )
}

// ── My Incentives ──────────────────────────────────────────────────────────────

function MyIncentivesTab() {
  const { data, isLoading } = useMyIncentives(0)
  const awards = data?.content ?? []

  const stats = useMemo(() => {
    const proposed = awards.filter((a) => a.status === 'PROPOSED').length
    const approved = awards.filter((a) => a.status === 'APPROVED').length
    const paid = awards.filter((a) => a.status === 'PAID').reduce((s, a) => s + (a.amount ?? 0), 0)
    return { proposed, approved, paid }
  }, [awards])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<Trophy size={18} />} color="blue" value={awards.length} label="Total Awards" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.proposed} label="Proposed" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.paid)} label="Paid Out" loading={isLoading} />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Plan</th>
              <th className="hidden sm:table-cell">Period</th>
              <th>Amount</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Awarded</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : awards.length === 0 ? (
              <tr><td colSpan={5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No incentives yet</p><p className="mt-1 text-xs text-text-tertiary">Performance-linked incentives awarded to you will appear here.</p></td></tr>
            ) : awards.map((a) => (
              <tr key={a.id}>
                <td className="font-medium text-text-primary">{a.planName}</td>
                <td className="hidden sm:table-cell text-text-secondary">{a.period || '—'}</td>
                <td className="font-semibold text-text-primary">{inr(a.amount)}</td>
                <td><HrStatusPill tone={STATUS_TONE[a.status]}>{a.status}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{a.createdAt ? format(new Date(a.createdAt), 'd MMM yyyy') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
