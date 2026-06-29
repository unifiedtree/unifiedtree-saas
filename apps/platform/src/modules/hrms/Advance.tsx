import React, { useMemo, useState } from 'react'
import { Check, X, Wallet, Clock, BadgeCheck, HandCoins, Banknote } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import {
  useMyAdvances, usePendingAdvanceApprovals, useRequestAdvance, useAdvanceDecision, useDisburseAdvance,
  inr, type AdvanceStatus,
} from './api/useAdvance'

const STATUS_TONE: Record<AdvanceStatus, PillTone> = {
  REQUESTED: 'warn', APPROVED: 'ok', REJECTED: 'red', DISBURSED: 'teal', CLOSED: 'gray',
}

type Tab = 'my' | 'request' | 'approvals'

export const Advance: React.FC = () => {
  const canRequest = usePermission('hrms.advance.request.self')
  const canApprove = usePermission('hrms.advance.approve')
  const canDisburse = usePermission('hrms.advance.disburse')
  const [tab, setTab] = useState<Tab>('my')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Advances' },
    ...(canRequest ? [{ key: 'request' as Tab, label: 'Request Advance' }] : []),
    ...(canApprove || canDisburse ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Advance Management" title="Salary Advances" subtitle="Request, approve, and disburse employee salary advances" />

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

      {tab === 'my' && <MyAdvancesTab />}
      {tab === 'request' && canRequest && <RequestTab onSubmitted={() => setTab('my')} />}
      {tab === 'approvals' && (canApprove || canDisburse) && <ApprovalsTab canApprove={canApprove} canDisburse={canDisburse} />}
    </div>
  )
}

// ── My Advances ────────────────────────────────────────────────────────────────

function MyAdvancesTab() {
  const { data, isLoading } = useMyAdvances(0)
  const advances = data?.content ?? []

  const stats = useMemo(() => {
    const pending = advances.filter((a) => a.status === 'REQUESTED').length
    const approved = advances.filter((a) => a.status === 'APPROVED').length
    const outstanding = advances
      .filter((a) => a.status === 'DISBURSED')
      .reduce((s, a) => s + (a.outstandingAmount ?? 0), 0)
    return { pending, approved, outstanding }
  }, [advances])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<HandCoins size={18} />} color="blue" value={advances.length} label="Total Requests" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.outstanding)} label="Outstanding" loading={isLoading} />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Amount</th>
              <th>Monthly</th>
              <th>Months</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Requested</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : advances.length === 0 ? (
              <tr><td colSpan={5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No advance requests yet</p><p className="mt-1 text-xs text-text-tertiary">Use “Request Advance” to raise your first request.</p></td></tr>
            ) : advances.map((a) => (
              <tr key={a.id}>
                <td className="font-semibold text-text-primary">{inr(a.amount)}</td>
                <td className="text-text-secondary">{inr(a.monthlyDeduction)}</td>
                <td className="text-text-secondary">{a.repaymentMonths}</td>
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

// ── Request Advance ───────────────────────────────────────────────────────────

function RequestTab({ onSubmitted }: { onSubmitted: () => void }) {
  const { toast } = useToast()
  const request = useRequestAdvance()
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('6')
  const [reason, setReason] = useState('')

  const amountNum = parseFloat(amount) || 0
  const monthsNum = parseInt(months, 10) || 0
  const monthlyDeduction = monthsNum > 0 ? amountNum / monthsNum : 0

  const handleSubmit = async () => {
    if (amountNum <= 0) { toast('Enter an advance amount', 'error'); return }
    if (monthsNum < 1) { toast('Repayment must be at least 1 month', 'error'); return }
    try {
      await request.mutateAsync({
        amount: amountNum,
        repaymentMonths: monthsNum,
        reason: reason.trim() || undefined,
      })
      toast('Advance request submitted', 'success')
      onSubmitted()
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to submit request', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Advance Amount (₹) *</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50000" className={inputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Repayment (months) *</label>
            <input type="number" min={1} max={60} step="1" value={months} onChange={(e) => setMonths(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Reason</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why do you need this advance?" className={inputCls} />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-[#FFD68A] bg-[#FFF8EC] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Monthly Deduction</p>
          <p className="text-2xl font-bold text-text-primary">{inr(monthlyDeduction)}</p>
          <p className="mt-0.5 text-xs text-text-tertiary">{monthsNum > 0 ? `${inr(amountNum)} recovered over ${monthsNum} month${monthsNum > 1 ? 's' : ''}` : 'Set an amount and term'}</p>
        </div>
        <HrButton onClick={handleSubmit} disabled={request.isPending}>
          {request.isPending ? 'Submitting…' : 'Submit Request'}
        </HrButton>
      </div>
    </div>
  )
}

// ── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsTab({ canApprove, canDisburse }: { canApprove: boolean; canDisburse: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = usePendingAdvanceApprovals(0)
  const decide = useAdvanceDecision()
  const disburse = useDisburseAdvance()
  const advances = data?.content ?? []

  const onDecide = async (id: string, approved: boolean) => {
    let comment: string | undefined
    if (!approved) {
      comment = window.prompt('Reason for rejection (optional):') ?? undefined
    }
    try {
      await decide.mutateAsync({ id, approved, comment })
      toast(approved ? 'Advance approved' : 'Advance rejected', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const onDisburse = async (id: string) => {
    try {
      await disburse.mutateAsync(id)
      toast('Advance disbursed', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <TableCard>
      <table className="hr-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Amount</th>
            <th>Monthly</th>
            <th>Status</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            [...Array(3)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
          ) : advances.length === 0 ? (
            <tr><td colSpan={5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">Nothing awaiting approval</p><p className="mt-1 text-xs text-text-tertiary">Requested advances will appear here.</p></td></tr>
          ) : advances.map((a, i) => (
            <tr key={a.id}>
              <td><HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} seed={i} /></td>
              <td className="font-semibold text-text-primary">{inr(a.amount)}</td>
              <td className="text-text-secondary">{inr(a.monthlyDeduction)}</td>
              <td><HrStatusPill tone={STATUS_TONE[a.status]}>{a.status}</HrStatusPill></td>
              <td>
                <div className="flex items-center justify-end gap-2">
                  {a.status === 'REQUESTED' && canApprove && (
                    <>
                      <HrButton size="sm" onClick={() => onDecide(a.id, true)} disabled={decide.isPending}><Check size={14} /> Approve</HrButton>
                      <HrButton size="sm" variant="ghost" onClick={() => onDecide(a.id, false)} disabled={decide.isPending}><X size={14} /> Reject</HrButton>
                    </>
                  )}
                  {a.status === 'APPROVED' && canDisburse && (
                    <HrButton size="sm" onClick={() => onDisburse(a.id)} disabled={disburse.isPending}><Banknote size={14} /> Disburse</HrButton>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
  )
}
