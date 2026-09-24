import React, { useMemo, useState } from 'react'
import { Wallet, Clock, BadgeCheck, HandCoins } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { AdvanceAdmin, AdvanceDecisionActions, AdvanceError, advanceLabel } from './advance/AdvanceAdmin'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import {
  useMyAdvances, usePendingAdvanceApprovals, useRequestAdvance,
  inr, type AdvanceStatus, type AdvanceRequest,
} from './api/useAdvance'

const STATUS_TONE: Record<AdvanceStatus, PillTone> = {
  REQUESTED: 'warn', APPROVED: 'ok', REJECTED: 'red', DISBURSED: 'teal', CLOSED: 'gray',
}

type Tab = 'my' | 'request' | 'approvals' | 'company'

export const Advance: React.FC = () => {
  const canRead = usePermission('hrms.advance.read')
  const canRequest = usePermission('hrms.advance.request.self')
  const canApprove = usePermission('hrms.advance.approve')
  const canDisburse = usePermission('hrms.advance.disburse')
  const [tab, setTab] = useState<Tab>(canRead ? 'company' : canApprove || canDisburse ? 'approvals' : 'my')

  const tabs: { key: Tab; label: string }[] = [
    ...(canRead ? [{ key: 'company' as Tab, label: canDisburse ? 'Company Advances' : 'Assigned Advances' }] : []),
    ...(canRequest ? [{ key: 'my' as Tab, label: 'My Advances' }] : []),
    ...(canRequest ? [{ key: 'request' as Tab, label: 'Request Advance' }] : []),
    ...(canApprove || canDisburse ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
  ]

  return (
    <div className="mx-auto max-w-7xl p-6 sm:p-8">
      <HrPageHeader crumb="Advance Management" title="Salary Advances" subtitle="Request, approve, and disburse employee salary advances" />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === 'company' && canRead && <HrTabPanel tabKey="company"><AdvanceAdmin companyWide={canDisburse} /></HrTabPanel>}
      {tab === 'my' && canRequest && <HrTabPanel tabKey="my"><MyAdvancesTab /></HrTabPanel>}
      {tab === 'request' && canRequest && <HrTabPanel tabKey="request"><RequestTab onSubmitted={() => setTab('my')} /></HrTabPanel>}
      {tab === 'approvals' && (canApprove || canDisburse) && <HrTabPanel tabKey="approvals"><ApprovalsTab /></HrTabPanel>}
    </div>
  )
}

// ── My Advances ────────────────────────────────────────────────────────────────

function MyAdvancesTab() {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useMyAdvances(page, 20)
  useClampedPage(page, data?.totalPages, setPage)
  const advances = data?.content ?? []
  const total = data?.totalElements ?? advances.length

  const stats = useMemo(() => {
    const pending = advances.filter((a) => a.status === 'REQUESTED').length
    const approved = advances.filter((a) => a.status === 'APPROVED').length
    const outstanding = advances
      .filter((a) => a.status === 'DISBURSED')
      .reduce((s, a) => s + (a.outstandingAmount ?? 0), 0)
    return { pending, approved, outstanding }
  }, [advances])

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        Couldn't load your advances.{' '}
        <button onClick={() => refetch()} className="font-semibold underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<HandCoins size={18} />} color="blue" value={total} label="Total Requests" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending on this page" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved on this page" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.outstanding)} label="Outstanding on this page" loading={isLoading} />
      </div>

      <TableCard footer={data && hrPaginationFooter({ page, pageSize: 20, totalElements: data.totalElements, totalPages: data.totalPages, onPageChange: setPage })}>
        <DataTable
          columns={[
            { key: 'amount', header: 'Amount', render: (a: any) => <span className="font-semibold text-text-primary">{inr(a.amount)}</span> },
            { key: 'monthly', header: 'Monthly', render: (a: any) => <span className="text-text-secondary">{inr(a.monthlyDeduction)}</span> },
            { key: 'months', header: 'Months', render: (a: any) => <span className="text-text-secondary">{a.repaymentMonths}</span> },
            { key: 'status', header: 'Status', render: (a: any) => <HrStatusPill tone={STATUS_TONE[a.status as AdvanceStatus]}>{advanceLabel(a)}</HrStatusPill> },
            { key: 'requested', header: 'Requested', render: (a: any) => <span className="text-text-secondary">{a.createdAt ? format(new Date(a.createdAt), 'd MMM yyyy') : '—'}</span> }
          ]}
          data={advances}
          keyField="id"
          loading={isLoading}
          emptyMessage="No advance requests yet. Use 'Request Advance' to raise your first request."
        />
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
    if (!Number.isInteger(Number(months)) || monthsNum < 1 || monthsNum > 60) { toast('Repayment must be between 1 and 60 whole months', 'error'); return }
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

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'

  return (
    <div className="max-w-2xl">
      <div className="ut-card p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-text-primary">Request Advance</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Advance Amount (₹) *</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 50000" className="ut-input" />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Repayment (months) *</label>
            <input type="number" min={1} max={60} step="1" value={months} onChange={(e) => setMonths(e.target.value)} className="ut-input" />
          </div>
        </div>
        <div className="mt-4">
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Reason</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why do you need this advance?" className={inputCls} />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-border-default pt-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Monthly Deduction</p>
            <p className="text-2xl font-bold tabular-nums text-text-primary">{inr(monthlyDeduction)}</p>
            <p className="mt-0.5 text-[12px] text-[var(--text-tertiary)]">{monthsNum > 0 ? `${inr(amountNum)} recovered over ${monthsNum} month${monthsNum > 1 ? 's' : ''}` : 'Set an amount and term'}</p>
          </div>
          <HrButton onClick={handleSubmit} disabled={request.isPending}>
            {request.isPending ? 'Submitting…' : 'Submit Request'}
          </HrButton>
        </div>
      </div>
    </div>
  )
}

// ── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsTab() {
  const [page, setPage] = useState(0)
  const query = usePendingAdvanceApprovals(page)
  useClampedPage(page, query.data?.totalPages, setPage)
  if (query.isError) return <AdvanceError message="Unable to load advances awaiting action." retry={() => query.refetch()} />
  return <div className="space-y-4">
    <p className="text-sm text-text-secondary">Requested advances wait for approval. Approved advances remain here until their payment is recorded.</p>
    <TableCard footer={query.data && hrPaginationFooter({ page, pageSize: 20, totalElements: query.data.totalElements, totalPages: query.data.totalPages, onPageChange: setPage })}>
      <DataTable<AdvanceRequest> columns={[
        { key: 'employee', header: 'Employee', render: a => <HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} /> },
        { key: 'amount', header: 'Amount', render: a => <span className="font-semibold">{inr(a.amount)}</span> },
        { key: 'reason', header: 'Reason', render: a => <p className="max-w-xs whitespace-pre-wrap text-sm text-text-secondary">{a.reason || 'No reason provided'}</p> },
        { key: 'monthly', header: 'Monthly', render: a => <span>{inr(a.monthlyDeduction)}</span> },
        { key: 'status', header: 'Status', render: a => <HrStatusPill tone={STATUS_TONE[a.status]}>{advanceLabel(a)}</HrStatusPill> },
        { key: 'action', header: 'Action', render: a => <AdvanceDecisionActions advance={a} /> },
      ]} data={query.data?.content ?? []} keyField="id" loading={query.isPending} emptyMessage="No advances awaiting action." />
    </TableCard>
  </div>
}
