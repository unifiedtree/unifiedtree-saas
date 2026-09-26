import React, { useMemo, useState } from 'react'
import { Plus, Check, X, Banknote, Award } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { ModulePage, Views, useView, StatRow, State, Note, dmy } from '@/design/module/ModuleKit'
import { useToast } from '@/shared/hooks/useToast'
import { HrButton, HrStatusPill, TableCard, HrAvatar, type PillTone } from '@/shared/components/hr'
import { MonthField } from '@/shared/components/calendar'
import { hrPaginationFooter } from '@/shared/components/HrPagination'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useAllAwards, useMyIncentives, useCreateAward, usePliDecision, usePayAward,
  usePliTargets, useCreatePliTarget, inr, PLI_PAGE_SIZE, type PliStatus, type PliAward,
} from './api/usePli'

const STATUS_TONE: Record<PliStatus, PillTone> = {
  PROPOSED: 'warn', APPROVED: 'ok', PAID: 'teal', REJECTED: 'red',
}
const STATUS_LABEL: Record<PliStatus, string> = { PROPOSED: 'Proposed', APPROVED: 'Approved', PAID: 'Paid', REJECTED: 'Not approved' }
/**
 * Approved awards are paid through payroll (client decision, 25 Sep 2026): a
 * processed run includes them, and locking it marks them paid.
 */
const awardLabel = (a: PliAward) => a.payrollRunId && a.payrollPeriod
  ? (a.status === 'PAID' ? `Paid with ${a.payrollPeriod} payroll` : `In ${a.payrollPeriod} payroll`)
  : STATUS_LABEL[a.status] ?? a.status

type Tab = 'all' | 'my' | 'targets'

export const Pli: React.FC = () => {
  const canReadAll = usePermission('hrms.pli.read')
  const canWrite = usePermission('hrms.pli.write')
  const canReadSelf = usePermission('hrms.pli.read.self')
  // Admins get the designed Payroll → PLI page; this page is mostly people's own incentives.
  const tabs = [
    ...(canReadSelf ? [{ key: 'my', label: 'My incentives', icon: 'rupee' }] : []),
    ...(canReadAll ? [{ key: 'all', label: 'All awards', icon: 'list' }, { key: 'targets', label: 'Monthly targets', icon: 'target' }] : []),
  ]
  const [tab, setTab] = useView(tabs.map((t) => t.key)) as [Tab, (k: string) => void]
  const onlyMine = !canReadAll
  return (
    <ModulePage crumb="Payroll" title={onlyMine ? 'My incentives' : 'Incentives'}
      subtitle={onlyMine ? 'Performance-linked incentives proposed for you, and where each one stands.' : 'Propose and approve performance-linked incentives. Approved ones are paid with salaries in the next payroll run.'}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {tabs.length > 1 && <Views items={tabs} active={tab} onChange={setTab} label="Incentive views" />}
        {tabs.length === 0 && <State kind="empty" icon="lock" title="No incentive access" description="Ask an admin if you should see incentives." />}
        {tab === 'my' && canReadSelf && <MyIncentivesTab />}
        {tab === 'all' && canReadAll && <AllAwardsTab canWrite={canWrite} />}
        {tab === 'targets' && canReadAll && <PliTargetsTab canWrite={canWrite} />}
      </div>
    </ModulePage>
  )
}

// ── All Awards (admin) ─────────────────────────────────────────────────────────

export function AllAwardsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  // Was hard-coded to page 0 with no control, so only the newest
  // PLI_PAGE_SIZE awards in the whole tenant were reachable — every older
  // award was invisible to the approver.
  const [page, setPage] = useState(0)
  const { data, isLoading } = useAllAwards(page)
  const decide = usePliDecision()
  const pay = usePayAward()
  const awards = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

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
      toast('Award marked paid outside payroll', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-5">
      {canWrite && <CreateAwardForm />}

      <TableCard
        footer={hrPaginationFooter({
          page, pageSize: PLI_PAGE_SIZE, totalElements: total, totalPages, onPageChange: setPage,
        })}
      >
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
                <td className="font-semibold tabular-nums text-text-primary">{inr(a.amount)}</td>
                <td><HrStatusPill tone={STATUS_TONE[a.status]}>{awardLabel(a)}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end gap-2">
                      {a.status === 'PROPOSED' && (
                        <>
                          <HrButton size="sm" onClick={() => onDecide(a.id, true)} disabled={decide.isPending}><Check size={14} /> Approve</HrButton>
                          <HrButton size="sm" variant="ghost" onClick={() => onDecide(a.id, false)} disabled={decide.isPending}><X size={14} /> Reject</HrButton>
                        </>
                      )}
                      {a.status === 'APPROVED' && !a.payrollRunId && (
                        <HrButton size="sm" variant="ghost" onClick={() => onPay(a.id)} disabled={pay.isPending}
                          data-tip="Only if you paid it outside payroll (cash, cheque, separate transfer). Otherwise leave it: the next payroll run adds it to salary. Marking it paid here takes it out of payroll for good.">
                          <Banknote size={14} /> Paid outside payroll
                        </HrButton>
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

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'

  return (
    <div className="ut-card ut-card-lg p-5">
      <div className="mb-3 flex items-center gap-2">
        <Award size={16} className="text-[#047857]" />
        <h3 className="text-[15px] font-semibold text-text-primary">Propose Incentive Award</h3>
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
        {companies.length > 1 && (
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Company</label>
            <select value={activeCompany} onChange={(e) => { setCompanyId(e.target.value); setEmployeeId('') }} className="ut-select">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Employee *</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className="ut-select">
            <option value="">Select employee…</option>
            {employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {[emp.firstName, emp.lastName].filter(Boolean).join(' ')}{emp.employeeCode ? ` · ${emp.employeeCode}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Plan name *</label>
          <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="e.g. Q3 Sales Incentive" className="ut-input" />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Period</label>
          <input value={period} onChange={(e) => setPeriod(e.target.value)} placeholder="e.g. FY24-Q3" className="ut-input" />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Amount (₹) *</label>
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 25000" className="ut-input" />
        </div>
        <div>
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Rating basis</label>
          <input type="number" min={0} max={5} step="0.1" value={ratingBasis} onChange={(e) => setRatingBasis(e.target.value)} placeholder="e.g. 4.5" className="ut-input" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Notes</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for the approver" className={inputCls} />
        </div>
      </div>
      <div className="mt-5 flex justify-end border-t border-border-default pt-4">
        <HrButton onClick={onCreate} disabled={create.isPending}>
          <Plus size={15} /> {create.isPending ? 'Proposing…' : 'Propose Award'}
        </HrButton>
      </div>
    </div>
  )
}

// ── My Incentives ──────────────────────────────────────────────────────────────

function MyIncentivesTab() {
  // Was hard-coded to page 0 with no control, so a long-serving employee could
  // not see any incentive older than their most recent PLI_PAGE_SIZE awards.
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, error, refetch } = useMyIncentives(page)
  const awards = useMemo(() => data?.content ?? [], [data])
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1

  const stats = useMemo(() => {
    const proposed = awards.filter((a) => a.status === 'PROPOSED').length
    const approved = awards.filter((a) => a.status === 'APPROVED').length
    const paid = awards.filter((a) => a.status === 'PAID').reduce((s, a) => s + (a.amount ?? 0), 0)
    return { proposed, approved, paid }
  }, [awards])

  // Proposed / Approved / Paid Out are reduced over the rows we hold, so they
  // describe the current page only — /v1/pli exposes no status aggregate to
  // call instead. Label them as such rather than let a partial "Paid Out"
  // figure read as a career total. "Total Awards" is genuinely tenant-wide
  // (totalElements), so it stays unqualified — it used to show awards.length,
  // which never exceeded one page.
  const pageScoped = totalPages > 1 ? 'On this page' : undefined
  if (isError) return <State kind="error" title="Couldn’t load your incentives" description={(error as Error)?.message} onRetry={() => refetch()} />
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'target', color: 'blue', label: 'Incentives', value: String(total), sub: 'Proposed for you so far' },
        { icon: 'clock', color: 'orange', label: 'Waiting for approval', value: String(stats.proposed), sub: pageScoped || 'Proposed' },
        { icon: 'checkCircle', color: 'green', label: 'Approved, to be paid', value: String(stats.approved), sub: pageScoped || 'Not paid yet' },
        { icon: 'rupee', color: 'teal', label: 'Paid to you', value: inr(stats.paid), sub: pageScoped || 'All time' },
      ]} />}
      {isLoading ? <State kind="loading" height={200} />
        : awards.length === 0 ? <State kind="empty" icon="target" title="No incentives yet" description="Performance-linked incentives proposed for you appear here with their status." />
          : (
            <TableCard footer={totalPages > 1 ? hrPaginationFooter({ page, pageSize: PLI_PAGE_SIZE, totalElements: total, totalPages, onPageChange: setPage }) : undefined}>
              <table className="hr-table">
                <thead><tr><th>Plan</th><th className="hidden sm:table-cell">Period</th><th>Amount</th><th>Status</th><th className="hidden sm:table-cell">Proposed on</th></tr></thead>
                <tbody>
                  {awards.map((a) => (
                    <tr key={a.id}>
                      <td className="font-semibold text-text-primary">{a.planName}</td>
                      <td className="hidden sm:table-cell text-text-secondary">{a.period || '—'}</td>
                      <td className="font-semibold tabular-nums text-text-primary">{inr(a.amount)}</td>
                      <td><HrStatusPill tone={STATUS_TONE[a.status]}>{awardLabel(a)}</HrStatusPill></td>
                      <td className="hidden sm:table-cell text-text-secondary">{a.createdAt ? dmy(a.createdAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
      <Note>Approved incentives are paid with your salary in the next payroll run. Ask HR if one looks wrong or is missing.</Note>
    </div>
  )
}

// ── Static Components (Phase 5) ───────────────────────────────────────────────

function PliTargetsTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const [page, setPage] = useState(0)
  const { data, isLoading } = usePliTargets(page)
  const create = useCreatePliTarget()
  const targets = data?.content ?? []
  const [title, setTitle] = useState('')
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7))
  const [metric, setMetric] = useState('Gross Profit')
  const [targetValue, setTargetValue] = useState('')
  const [actualValue, setActualValue] = useState('')
  const [payoutAmount, setPayoutAmount] = useState('')

  const onCreate = async () => {
    if (!title.trim()) { toast('Target title is required', 'error'); return }
    const target = parseFloat(targetValue)
    if (!(target > 0)) { toast('Enter a valid target value', 'error'); return }
    try {
      await create.mutateAsync({ title: title.trim(), period, metric: metric.trim() || 'Target', targetValue: target, actualValue: actualValue ? parseFloat(actualValue) : 0, payoutAmount: payoutAmount ? parseFloat(payoutAmount) : 0, status: 'ACTIVE' })
      toast('PLI target created', 'success')
      setTitle(''); setTargetValue(''); setActualValue(''); setPayoutAmount('')
    } catch (e) { toast((e as Error)?.message ?? 'Failed to create target', 'error') }
  }

  return (
    <div className="space-y-5">
      <div className="ut-card p-4 text-sm text-text-secondary flex items-center gap-2"><span className="text-text-tertiary">?</span>PLI targets below are stored in the backend and can be used while calculating incentive awards.</div>
      {canWrite && <div className="ut-card flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[180px] flex-1"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Team / target name</label><input value={title} onChange={(e) => setTitle(e.target.value)} className="ut-input ut-input-sm" placeholder="Assembly Line A" /></div>
        <div className="w-36"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Period</label><MonthField value={period} onChange={(e) => setPeriod(e.target.value)} className="ut-input ut-input-sm" format="short" aria-label="Period" /></div>
        <div className="w-40"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Metric</label><input value={metric} onChange={(e) => setMetric(e.target.value)} className="ut-input ut-input-sm" /></div>
        <div className="w-32"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Target</label><input type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className="ut-input ut-input-sm" /></div>
        <div className="w-32"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Actual</label><input type="number" value={actualValue} onChange={(e) => setActualValue(e.target.value)} className="ut-input ut-input-sm" /></div>
        <div className="w-36"><label className="mb-1 block text-[13px] font-semibold text-text-secondary">Bonus pool</label><input type="number" value={payoutAmount} onChange={(e) => setPayoutAmount(e.target.value)} className="ut-input ut-input-sm" /></div>
        <HrButton size="sm" onClick={onCreate} disabled={create.isPending}><Plus size={14} /> Set Target</HrButton>
      </div>}
      <TableCard footer={hrPaginationFooter({ page, pageSize: PLI_PAGE_SIZE, totalElements: data?.totalElements ?? 0, totalPages: data?.totalPages ?? 1, onPageChange: setPage })}>
        <table className="hr-table"><thead><tr><th>Department/Team</th><th>Metric</th><th>Period</th><th>Target</th><th>Actual</th><th>Achievement</th><th>Bonus Pool</th><th>Status</th></tr></thead><tbody>
          {isLoading ? [...Array(3)].map((_, i) => <tr key={i}><td colSpan={8} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>) : targets.length === 0 ? <tr><td colSpan={8} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No PLI targets yet</p><p className="mt-1 text-xs text-text-tertiary">Create targets to track incentive eligibility.</p></td></tr> : targets.map((t) => { const pct = t.targetValue > 0 ? Math.round((t.actualValue / t.targetValue) * 100) : 0; return <tr key={t.id}><td className="font-semibold text-text-primary">{t.title}</td><td className="text-text-secondary">{t.metric}</td><td className="text-text-secondary">{t.period}</td><td className="text-text-secondary tabular-nums">{t.targetValue.toLocaleString('en-IN')}</td><td className={pct >= 100 ? 'font-semibold text-[#059669]' : 'font-semibold text-red-600'}>{t.actualValue.toLocaleString('en-IN')}</td><td><HrStatusPill tone={pct >= 100 ? 'ok' : pct >= 80 ? 'warn' : 'gray'}>{pct}%</HrStatusPill></td><td className="font-semibold text-text-primary">{inr(t.payoutAmount)}</td><td><HrStatusPill tone={t.status === 'ACTIVE' ? 'teal' : 'gray'}>{t.status}</HrStatusPill></td></tr> })}
        </tbody></table>
      </TableCard>
    </div>
  )
}
