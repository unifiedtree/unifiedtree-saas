// Salary advances for people without the payroll admin view (/hrms/advances;
// admins get the designed PayAdvances). Module kit style. Views by permission:
// My advances + Request (hrms.advance.request.self), Approvals (advance.approve
// or advance.disburse), Company advances (advance.read).
import React, { useMemo, useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Field, Input } from '@unifiedtree/ui-kit'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { HrPagination, useClampedPage } from '@/shared/components/HrPagination'
import { dashIcon } from '@/design/dc/icons'
import { ModulePage, Views, useView, StatRow, State, RowList, Row, Panel, Note, DecisionCard, SubHeading, useDesignToast, dmy } from '@/design/module/ModuleKit'
import { AdvanceAdmin, AdvanceDecisionActions, advanceLabel } from './advance/AdvanceAdmin'
import { useMyAdvances, usePendingAdvanceApprovals, useRequestAdvance, inr, type AdvanceStatus } from './api/useAdvance'

const TONE: Record<AdvanceStatus, PillTone> = { REQUESTED: 'warn', APPROVED: 'ok', REJECTED: 'red', DISBURSED: 'teal', CLOSED: 'gray' }

export const Advance: React.FC = () => {
  const canRead = usePermission('hrms.advance.read')
  const canRequest = usePermission('hrms.advance.request.self')
  const canApprove = usePermission('hrms.advance.approve')
  const canDisburse = usePermission('hrms.advance.disburse')
  const { show, node } = useDesignToast()
  const views = [
    ...(canApprove || canDisburse ? [{ key: 'approvals', label: 'Approvals', icon: 'inbox' }] : []),
    ...(canRequest ? [{ key: 'my', label: 'My advances', icon: 'banknote' }, { key: 'request', label: 'Request an advance', icon: 'plus' }] : []),
    ...(canRead ? [{ key: 'company', label: canDisburse ? 'Company advances' : 'Assigned advances', icon: 'users' }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key), 'tab')
  return (
    <ModulePage crumb="Payroll" title="Salary advances" subtitle={canRequest ? 'Borrow against your salary and repay it in monthly deductions.' : 'Approve advances and record their payment.'}
      actions={canRequest && tab !== 'request' ? <HrButton onClick={() => setTab('request')}>{dashIcon('plus', 15)} Request an advance</HrButton> : undefined}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Advance views" />}
        {views.length === 0 && <State kind="empty" icon="lock" title="No advance access" description="Your role can’t request or review salary advances." />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'my' && <MyAdvancesTab />}
        {tab === 'request' && <RequestTab onSubmitted={() => setTab('my')} toast={show} />}
        {tab === 'company' && <AdvanceAdmin companyWide={canDisburse} />}
      </div>
      {node}
    </ModulePage>
  )
}

function MyAdvancesTab() {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useMyAdvances(page, 20)
  useClampedPage(page, data?.totalPages, setPage)
  const list = useMemo(() => data?.content ?? [], [data])
  const total = data?.totalElements ?? list.length
  const s = useMemo(() => ({
    pending: list.filter((a) => a.status === 'REQUESTED').length,
    approved: list.filter((a) => a.status === 'APPROVED').length,
    outstanding: list.filter((a) => a.status === 'DISBURSED').reduce((n, a) => n + (a.outstandingAmount ?? 0), 0),
  }), [list])
  if (isError) return <State kind="error" title="Couldn’t load your advances" onRetry={() => refetch()} />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'banknote', color: 'blue', label: 'Requests', value: String(total), sub: 'All time' },
        { icon: 'clock', color: 'orange', label: 'Waiting', value: String(s.pending), sub: 'Not decided yet (this page)' },
        { icon: 'checkCircle', color: 'green', label: 'Approved', value: String(s.approved), sub: 'Waiting to be paid (this page)' },
        { icon: 'creditCard', color: 'teal', label: 'Still to repay', value: inr(s.outstanding), sub: 'Deducted from salary (this page)' },
      ]} />}
      <SubHeading>Your requests</SubHeading>
      {isLoading ? <State kind="loading" />
        : list.length === 0 ? <State kind="empty" icon="banknote" title="No advance requests yet" description="Requests you make appear here with how much is left to repay." />
          : (
            <RowList>
              {list.map((a) => (
                <Row key={a.id} title={`${inr(a.amount)} · ${a.repaymentMonths} ${a.repaymentMonths === 1 ? 'month' : 'months'}`}
                  meta={`${inr(a.monthlyDeduction)} a month${a.status === 'DISBURSED' && a.outstandingAmount != null ? ` · ${inr(a.outstandingAmount)} left to repay` : ''} · asked ${dmy(a.createdAt?.slice(0, 10))}`}
                  note={a.reason ? `“${a.reason}”` : undefined}
                  trail={<HrStatusPill tone={TONE[a.status]}>{advanceLabel(a)}</HrStatusPill>} />
              ))}
            </RowList>
          )}
      {data && data.totalPages > 1 && <HrPagination page={page} pageSize={20} totalElements={data.totalElements} totalPages={data.totalPages} onPageChange={setPage} />}
    </div>
  )
}

function RequestTab({ onSubmitted, toast }: { onSubmitted: () => void; toast: (m: string, err?: boolean, d?: string) => void }) {
  const request = useRequestAdvance()
  const [amount, setAmount] = useState('')
  const [months, setMonths] = useState('6')
  const [reason, setReason] = useState('')
  const amt = parseFloat(amount) || 0, m = parseInt(months, 10) || 0
  const monthly = m > 0 ? amt / m : 0
  const problem = amt <= 0 ? 'Enter how much you need.' : !Number.isInteger(Number(months)) || m < 1 || m > 60 ? 'Repay over 1 to 60 whole months.' : null
  const submit = async () => {
    if (problem) return
    try { await request.mutateAsync({ amount: amt, repaymentMonths: m, reason: reason.trim() || undefined }); toast('Advance request sent'); onSubmitted() } catch (e) { toast('Couldn’t send the request', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,340px),1fr))', gap: 16, alignItems: 'start' }}>
      <Panel title="Request an advance" sub="Your approver is notified as soon as you send it.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,150px),1fr))', gap: 12 }}>
          <Field label="Amount (₹) *"><Input type="number" min={0} step="0.01" value={amount} onChange={(e: any) => setAmount(e.target.value)} placeholder="e.g. 50000" /></Field>
          <Field label="Repay over (months) *"><Input type="number" min={1} max={60} step="1" value={months} onChange={(e: any) => setMonths(e.target.value)} /></Field>
        </div>
        <label style={{ display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Reason</span>
          <textarea value={reason} rows={3} onChange={(e) => setReason(e.target.value)} placeholder="Why do you need it? (optional)"
            style={{ font: 'inherit', fontSize: 14, padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 10, outline: 'none', resize: 'vertical' }} />
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 4, borderTop: '1px solid #f1f5f9' }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: problem ? '#64748b' : '#0f6e56' }}>{problem || `${inr(monthly)} a month for ${m} ${m === 1 ? 'month' : 'months'}`}</span>
          <HrButton onClick={submit} disabled={!!problem || request.isPending}>{request.isPending ? 'Sending…' : 'Send request'}</HrButton>
        </div>
      </Panel>
      <Panel title="How it’s repaid" sub="From your salary, a little each month">
        <Note>Once it’s approved and paid to you, the monthly amount is deducted from your salary until the advance is cleared.</Note>
      </Panel>
    </div>
  )
}

function ApprovalsTab() {
  const [page, setPage] = useState(0)
  const q = usePendingAdvanceApprovals(page)
  useClampedPage(page, q.data?.totalPages, setPage)
  const list = q.data?.content ?? []
  if (q.isError) return <State kind="error" title="Couldn’t load advances waiting for action" onRetry={() => q.refetch()} />
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Note>Requested advances wait here for approval; approved ones stay until their payment is recorded.</Note>
      {q.isPending ? <State kind="loading" />
        : list.length === 0 ? <State kind="empty" icon="checkCircle" title="Nothing waiting" description="No advances need your approval or a payment record." />
          : list.map((a) => (
            <DecisionCard key={a.id} name={a.employeeName || 'Employee'} sub={a.employeeCode}
              status={[advanceLabel(a), TONE[a.status]]}
              facts={[{ k: 'Amount', v: inr(a.amount) }, { k: 'Repay over', v: `${a.repaymentMonths} months` }, { k: 'A month', v: inr(a.monthlyDeduction) }]}
              reason={<><span style={{ color: '#64748b' }}>Reason:</span> {a.reason || 'None given'}</>}
              raised={a.createdAt ? dmy(a.createdAt.slice(0, 10)) : undefined}
              actions={<AdvanceDecisionActions advance={a} />} />
          ))}
      {q.data && q.data.totalPages > 1 && <HrPagination page={page} pageSize={20} totalElements={q.data.totalElements} totalPages={q.data.totalPages} onPageChange={setPage} />}
    </div>
  )
}
