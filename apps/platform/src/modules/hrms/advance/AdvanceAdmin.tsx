import { useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { Banknote, Check, ChevronRight, X } from 'lucide-react'
import { getAccessToken, usePermission } from '@unifiedtree/sdk'
import { jwtDecode } from 'jwt-decode'
import { HrAvatar, HrButton, HrDrawer, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useToast } from '@/shared/hooks/useToast'
import {
  inr, useAdvance, useAdvanceDecision, useAdvanceRecovery, useAdvanceRecoveryAction, useCompanyAdvances, useDisburseAdvance,
  type AdvanceRequest, type AdvanceStatus, type RecoveryAction,
} from '../api/useAdvance'

export const ADVANCE_STATUS_TONE: Record<AdvanceStatus, PillTone> = {
  REQUESTED: 'warn', APPROVED: 'ok', REJECTED: 'red', DISBURSED: 'teal', CLOSED: 'gray',
}
const date = (value?: string, pattern = 'd MMM yyyy') => value ? format(new Date(value.length === 10 ? `${value}T00:00:00` : value), pattern) : '—'
const statusLabel = (value: string) => value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ')
const advanceLabel = (advance: AdvanceRequest) => advance.status === 'DISBURSED' && Number(advance.outstandingAmount) === 0 ? 'Repaid' : statusLabel(advance.status)

export function AdvanceAdmin({ companyWide }: { companyWide: boolean }) {
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<AdvanceStatus | ''>('')
  const [selected, setSelected] = useState<string>()
  const query = useCompanyAdvances(page, status || undefined)
  useClampedPage(page, query.data?.totalPages, setPage)
  const rows = query.data?.content ?? []
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold text-text-primary">{companyWide ? 'Company advances' : 'Assigned advances'}</h2>
        <p className="mt-1 text-sm text-text-secondary">{companyWide ? 'Track each request from approval to its final recovery.' : 'Requests routed to you, including completed requests.'}</p></div>
      <label className="flex items-center gap-2 text-sm text-text-secondary">Status
        <select aria-label="Advance status" className="ut-select min-w-[170px]" value={status} onChange={e => { setStatus(e.target.value as AdvanceStatus | ''); setPage(0) }}>
          <option value="">All statuses</option>{Object.keys(ADVANCE_STATUS_TONE).map(s => <option key={s} value={s}>{s === 'DISBURSED' ? 'Disbursed / repaid' : statusLabel(s)}</option>)}
        </select></label>
    </div>
    {query.isError ? <AdvanceError message="Unable to load advances." retry={() => query.refetch()} /> : <TableCard
      footer={query.data && hrPaginationFooter({ page, pageSize: 20, totalElements: query.data.totalElements, totalPages: query.data.totalPages, onPageChange: setPage })}>
      <div className="border-b border-border-default px-5 py-3 text-xs text-text-secondary">{query.isPending ? 'Loading requests…' : `${query.data?.totalElements ?? 0} matching requests`}</div>
      <DataTable<AdvanceRequest> data={rows} keyField="id" loading={query.isPending} emptyMessage="No advances match this status."
        columns={[
          { key: 'employee', header: 'Employee', render: a => <Link to={`/hrms/employees/${a.employeeId}`} className="hover:underline"><HrAvatar name={a.employeeName || 'Employee'} sub={a.employeeCode} /></Link> },
          { key: 'amount', header: 'Advance', render: a => <div><p className="font-semibold tabular-nums">{inr(a.amount)}</p><p className="mt-1 text-xs text-text-secondary">{a.repaymentMonths} monthly installments</p></div> },
          { key: 'outstanding', header: 'Outstanding', render: a => <span className="tabular-nums">{['DISBURSED', 'CLOSED'].includes(a.status) ? inr(a.outstandingAmount) : 'Not disbursed'}</span> },
          { key: 'status', header: 'Status', render: a => <HrStatusPill tone={ADVANCE_STATUS_TONE[a.status]}>{advanceLabel(a)}</HrStatusPill> },
          { key: 'createdAt', header: 'Requested', render: a => date(a.createdAt) },
          { key: 'details', header: 'Details', render: a => <HrButton size="sm" variant="ghost" aria-label={`View advance for ${a.employeeName || a.employeeCode || 'employee'}`} onClick={() => setSelected(a.id)}>View <ChevronRight size={14} /></HrButton> },
        ]} />
    </TableCard>}
    {selected && <AdvanceDetail id={selected} onClose={() => setSelected(undefined)} />}
  </div>
}

export function AdvanceError({ message, retry }: { message: string; retry: () => void }) {
  return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message} <button className="ml-2 font-semibold underline" onClick={retry}>Try again</button></div>
}

export function AdvanceDecisionActions({ advance }: { advance: AdvanceRequest }) {
  const canApprove = usePermission('hrms.advance.approve')
  const canDisburse = usePermission('hrms.advance.disburse')
  let employeeId: string | undefined
  try { employeeId = jwtDecode<{ employee_id?: string }>(getAccessToken() || '').employee_id } catch { /* Server retains the identity check. */ }
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  const decide = useAdvanceDecision()
  const disburse = useDisburseAdvance()
  const [rejecting, setRejecting] = useState(false)
  const [comment, setComment] = useState('')
  const isOwn = employeeId === advance.employeeId
  const busy = decide.isPending || disburse.isPending
  const act = async (approved: boolean) => {
    try {
      await decide.mutateAsync({ id: advance.id, approved, comment: comment.trim() || undefined })
      setRejecting(false); setComment(''); toast(approved ? 'Advance approved' : 'Advance rejected', 'success')
    } catch (e) { toast(e instanceof Error ? e.message : 'Unable to save decision', 'error') }
  }
  const markDisbursed = async () => {
    if (!await confirm({ title: `Record ${inr(advance.amount)} as disbursed?`, body: `Confirm the payment to ${advance.employeeName || 'this employee'} has already been made. This records the payment and starts recovery next month; it does not transfer money.`, confirmLabel: 'Record disbursement', tone: 'danger' })) return
    try { await disburse.mutateAsync(advance.id); toast('Disbursement and recovery schedule saved', 'success') }
    catch (e) { toast(e instanceof Error ? e.message : 'Unable to record disbursement', 'error') }
  }
  return <>
    <div className="flex flex-wrap items-center gap-2">
      {advance.status === 'REQUESTED' && canApprove && <><HrButton size="sm" disabled={busy || isOwn} onClick={() => act(true)}><Check size={14} />Approve</HrButton><HrButton size="sm" variant="ghost" disabled={busy || isOwn} onClick={() => setRejecting(true)}><X size={14} />Reject</HrButton></>}
      {advance.status === 'APPROVED' && canDisburse && <HrButton size="sm" disabled={busy || isOwn} onClick={markDisbursed}><Banknote size={14} />Record disbursement</HrButton>}
      {isOwn && ['REQUESTED', 'APPROVED'].includes(advance.status) && <p className="text-xs text-text-secondary">Another approver must process your request.</p>}
    </div>
    {rejecting && <HrDrawer title="Reject advance" onClose={() => { if (!busy) setRejecting(false) }} footer={<><HrButton variant="ghost" disabled={busy} onClick={() => setRejecting(false)}>Cancel</HrButton><HrButton disabled={busy} onClick={() => act(false)}>{busy ? 'Saving…' : 'Confirm rejection'}</HrButton></>}>
      <p className="mb-4 text-sm text-text-secondary">{advance.employeeName || 'Employee'} · {inr(advance.amount)}</p>
      <label className="text-sm font-medium">Reason (optional)<textarea className="ut-input mt-2" rows={4} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></label>
    </HrDrawer>}
  </>
}

function AdvanceDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useAdvance(id)
  return <HrDrawer title="Advance details" width="max-w-3xl" onClose={onClose}>
    {query.isPending ? <p role="status">Loading advance…</p> : query.isError ? <AdvanceError message="Unable to load this advance." retry={() => query.refetch()} /> : query.data && <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><Link className="hover:underline" to={`/hrms/employees/${query.data.employeeId}`}><HrAvatar name={query.data.employeeName || 'Employee'} sub={query.data.employeeCode} /></Link><HrStatusPill tone={ADVANCE_STATUS_TONE[query.data.status]}>{advanceLabel(query.data)}</HrStatusPill></div>
      <dl className="grid grid-cols-2 gap-4 rounded-lg border border-border-default bg-bg-base p-4 text-sm">
        {[['Requested amount', inr(query.data.amount)], ['Monthly deduction', inr(query.data.monthlyDeduction)], ['Repayment term', `${query.data.repaymentMonths} months`], ['Requested on', date(query.data.createdAt)], ['Decision date', date(query.data.approvedAt)], ['Disbursed on', date(query.data.disbursedAt)]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>)}
      </dl>
      <div><h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Employee reason</h4><p className="mt-2 whitespace-pre-wrap text-sm">{query.data.reason || 'No reason provided.'}</p></div>
      {query.data.approverComment && <div><h4 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">Decision note</h4><p className="mt-2 whitespace-pre-wrap text-sm">{query.data.approverComment}</p></div>}
      <AdvanceDecisionActions advance={query.data} />
      {['DISBURSED', 'CLOSED'].includes(query.data.status) ? <RecoveryDetails advance={query.data} /> : <p className="rounded-lg bg-bg-base p-4 text-sm text-text-secondary">Recovery begins after an approved advance is recorded as disbursed.</p>}
    </div>}
  </HrDrawer>
}

function RecoveryDetails({ advance }: { advance: AdvanceRequest }) {
  const query = useAdvanceRecovery(advance.id)
  const mutate = useAdvanceRecoveryAction()
  const canApprove = usePermission('hrms.advance.approve')
  const canClose = usePermission('hrms.advance.foreclose')
  const [action, setAction] = useState<'foreclose' | 'write-off' | 'skip-month'>()
  const [installment, setInstallment] = useState<number>()
  const [reason, setReason] = useState('')
  const { toast } = useToast()
  const confirm = useConfirmDialog()
  if (query.isPending) return <p role="status">Loading recovery schedule…</p>
  if (query.isError) return <AdvanceError message="Unable to load recovery details." retry={() => query.refetch()} />
  const { summary, schedule, ledger } = query.data
  const active = advance.status === 'DISBURSED' && summary.outstandingAmount > 0
  const begin = (kind: typeof action, installmentNo?: number) => { setAction(kind); setInstallment(installmentNo); setReason(''); mutate.reset() }
  const submit = async () => {
    if (!action || !reason.trim()) return
    if (!await confirm({ title: action === 'foreclose' ? `Close with ${inr(summary.outstandingAmount)} received?` : action === 'write-off' ? `Write off ${inr(summary.outstandingAmount)}?` : `Defer installment ${installment}?`, body: action === 'foreclose' ? 'Confirm the full outstanding payment has already been received. The remaining payroll installments will be cancelled and the advance closed.' : action === 'write-off' ? 'This closes the advance without collecting the outstanding balance. The reason is saved in its ledger.' : 'This installment moves to the end of the schedule. The outstanding balance stays the same.', confirmLabel: action === 'skip-month' ? 'Defer installment' : 'Confirm closure', tone: 'danger' })) return
    const common = { id: advance.id, reason: reason.trim() }
    const payload: RecoveryAction = action === 'foreclose' ? { ...common, action, lumpSumAmount: summary.outstandingAmount } : action === 'skip-month' ? { ...common, action, installmentNo: installment! } : { ...common, action }
    try { await mutate.mutateAsync(payload); setAction(undefined); toast('Recovery details updated', 'success') }
    catch { /* Retain the form and show the server error below. */ }
  }
  return <section className="space-y-5 border-t border-border-default pt-5">
    <div><h4 className="font-semibold text-text-primary">Salary recovery</h4><p className="mt-1 text-sm text-text-secondary">Installments are recovered through payroll. Deferrals keep the total amount unchanged.</p></div>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[['Outstanding', inr(summary.outstandingAmount)], ['Installments remaining', String(summary.installmentsPending)], ['Next recovery', date(summary.nextScheduledMonth, 'MMM yyyy')]].map(([label, value]) => <div key={label} className="rounded-lg border border-border-default p-3"><p className="text-xs text-text-secondary">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></div>)}</div>
    {active && schedule.length === 0 && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">This advance has no recovery schedule. Payroll cannot recover it until the schedule is repaired.</p>}
    <TableCard><DataTable data={schedule} keyField="id" emptyMessage="No recovery installments." columns={[
      { key: 'installmentNo', header: '#', render: row => row.installmentNo },
      { key: 'scheduledMonth', header: 'Month', render: row => date(row.scheduledMonth, 'MMM yyyy') },
      { key: 'scheduledAmount', header: 'Amount', render: row => inr(row.scheduledAmount) },
      { key: 'status', header: 'Status', render: row => <HrStatusPill tone={row.status === 'RECOVERED' ? 'ok' : row.status === 'PENDING' ? 'warn' : 'gray'}>{statusLabel(row.status)}</HrStatusPill> },
      { key: 'recovery', header: 'Recovery', render: row => row.status === 'RECOVERED' ? <div className="text-xs">{inr(row.recoveredAmount)}<p className="mt-1 text-text-secondary">{date(row.recoveredAt)}</p></div> : active && row.status === 'PENDING' && canApprove ? <button className="text-xs font-semibold text-primary underline" onClick={() => begin('skip-month', row.installmentNo)}>Defer month</button> : '—' },
    ]} /></TableCard>
    {active && canClose && <div className="flex flex-wrap gap-2"><HrButton variant="ghost" onClick={() => begin('foreclose')}>Record full repayment</HrButton><HrButton variant="ghost" onClick={() => begin('write-off')}>Write off balance</HrButton></div>}
    {action && <div className="space-y-3 rounded-lg border border-border-default bg-bg-base p-4">
      <h5 className="font-semibold">{action === 'foreclose' ? `Full repayment · ${inr(summary.outstandingAmount)}` : action === 'write-off' ? `Write off · ${inr(summary.outstandingAmount)}` : `Defer installment ${installment}`}</h5>
      <label className="block text-sm font-medium">Reason / payment reference<textarea className="ut-input mt-2" maxLength={2000} rows={3} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {mutate.isError && <p role="alert" className="text-sm text-danger">{mutate.error instanceof Error ? mutate.error.message : 'Unable to save recovery action.'}</p>}
      <div className="flex gap-2"><HrButton disabled={!reason.trim() || mutate.isPending} onClick={submit}>{mutate.isPending ? 'Saving…' : 'Review and confirm'}</HrButton><HrButton variant="ghost" disabled={mutate.isPending} onClick={() => setAction(undefined)}>Cancel</HrButton></div>
    </div>}
    <div><h4 className="mb-3 font-semibold">Payment and recovery history</h4>{ledger.length === 0 ? <p className="text-sm text-text-secondary">No ledger entries yet.</p> : <ol className="divide-y divide-border-default rounded-lg border border-border-default">{ledger.map(row => <li key={row.id} className="p-4"><div className="flex flex-wrap justify-between gap-2"><span className="text-sm font-semibold">{statusLabel(row.entryType)}</span><span className="text-sm tabular-nums">{inr(row.amount)}</span></div><p className="mt-1 text-xs text-text-secondary">{date(row.createdAt, 'd MMM yyyy, h:mm a')} · Balance {inr(row.balanceAfter)}</p>{row.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{row.notes}</p>}{row.payrollRunId && <p className="mt-1 break-all text-xs text-text-secondary">Payroll reference: {row.payrollRunId}</p>}</li>)}</ol>}</div>
  </section>
}
