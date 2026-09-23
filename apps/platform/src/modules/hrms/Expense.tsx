import React, { useMemo, useState } from 'react'
import {
  Plus, Trash2, Receipt, Check, X, Wallet, Clock, BadgeCheck,
  ChevronDown, ChevronRight, AlertTriangle, ExternalLink, Pencil, RotateCcw,
} from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { DataTable } from '@/shared/components/DataTable'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useCompanies } from './api/useOrg'
import { ReimbursementBatches } from './expense/ReimbursementBatches'
import {
  useMyClaims, usePendingExpenseApprovals, useExpenseClaim, useSubmitClaim, useExpenseDecision, useReimburseClaim,
  useExpensePolicies, useCreatePolicy, useUpdatePolicy, useDeletePolicy, useExpenseDashboardStats,
  inr, EXPENSE_CATEGORIES, EXPENSE_APPROVALS_PAGE_SIZE,
  type ExpenseStatus, type ExpenseCategory, type ExpensePolicy,
} from './api/useExpense'

const STATUS_TONE: Record<ExpenseStatus, PillTone> = {
  DRAFT: 'gray', SUBMITTED: 'warn', APPROVED: 'ok', APPROVED_FOR_PAY: 'info', REJECTED: 'red', REIMBURSED: 'teal',
}

const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

type Tab = 'my' | 'submit' | 'approvals' | 'policies' | 'batches'

export const Expense: React.FC = () => {
  const canApprove = usePermission('hrms.expense.claim.approve')
  const canReimburse = usePermission('hrms.expense.reimbursement')
  const canPolicyRead = usePermission('hrms.expense.policy.read')
  const canPolicyWrite = usePermission('hrms.expense.policy.write')
  const canSelf = usePermission('hrms.expense.claim.self')
  const canBatches = usePermission('hrms.reimb_batch.read')
  const [tab, setTab] = useState<Tab>(canApprove || canReimburse ? 'approvals' : canBatches ? 'batches' : canSelf ? 'my' : canPolicyRead ? 'policies' : 'my')

  const tabs: { key: Tab; label: string }[] = [
    ...(canSelf ? [{ key: 'my' as Tab, label: 'My Claims' }, { key: 'submit' as Tab, label: 'Submit Claim' }] : []),
    // Reimbursement-only roles (finance) need this tab too — it's where
    // APPROVED claims are marked paid (2026-09-08 audit).
    ...(canApprove || canReimburse ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    ...(canBatches ? [{ key: 'batches' as Tab, label: 'Reimbursement batches' }] : []),
    ...(canPolicyRead ? [{ key: 'policies' as Tab, label: 'Policies' }] : []),
  ]

  return (
    <div className="mx-auto max-w-[1440px] p-4 sm:p-6">
      <HrPageHeader crumb="Expense Management" title="Expense Center" subtitle="Submit, approve, and reimburse employee expenses" />
      <ExpenseDashboardCards enabled={canApprove || canReimburse} />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />
      {tabs.length === 0 && <p className="ut-card p-5 text-sm text-text-secondary">Your role does not have expense access.</p>}

      {tab === 'my' && canSelf && <HrTabPanel tabKey="my"><MyClaimsTab /></HrTabPanel>}
      {/* canPolicyRead is threaded into the submit form so it can show the
          category cap that will be enforced on save. GET /v1/expense/policies
          is gated on hrms.expense.policy.read, so without it the form must not
          fire the request at all — see SubmitTab. */}
      {tab === 'submit' && canSelf && <HrTabPanel tabKey="submit"><SubmitTab canPolicyRead={canPolicyRead} onSubmitted={() => setTab('my')} /></HrTabPanel>}
      {tab === 'approvals' && (canApprove || canReimburse) && <HrTabPanel tabKey="approvals"><ApprovalsTab canApprove={canApprove} canReimburse={canReimburse} /></HrTabPanel>}
      {tab === 'policies' && canPolicyRead && <HrTabPanel tabKey="policies"><PoliciesTab canWrite={canPolicyWrite} /></HrTabPanel>}
      {tab === 'batches' && canBatches && <HrTabPanel tabKey="batches"><ReimbursementBatches /></HrTabPanel>}
    </div>
  )
}

// ── My Claims ────────────────────────────────────────────────────────────────


function ExpenseDashboardCards({ enabled }: { enabled: boolean }) {
  const { data, isLoading } = useExpenseDashboardStats(enabled)
  if (!enabled) return null
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 mb-5">
      <div className="ut-card p-5 m-0">
        <div className="text-[13px] font-semibold uppercase text-text-secondary mb-2">Pending Approvals</div>
        <div className="text-[32px] font-bold text-text-primary mb-1">{isLoading ? '?' : data?.pendingApprovals ?? 0}</div>
        <div className="text-[13px] text-orange-500">{isLoading ? 'Loading' : `${inr(data?.pendingApprovalAmount ?? 0)} awaiting decision`}</div>
      </div>
      <div className="ut-card p-5 m-0">
        <div className="text-[13px] font-semibold uppercase text-text-secondary mb-2">To Be Reimbursed</div>
        <div className="text-[32px] font-bold text-text-primary mb-1">{isLoading ? '?' : inr(data?.toBeReimbursedAmount ?? 0)}</div>
        <div className="text-[13px] text-text-secondary">{data?.toBeReimbursed ?? 0} approved claim{(data?.toBeReimbursed ?? 0) === 1 ? '' : 's'}</div>
      </div>
    </div>
  )
}

function MyClaimsTab() {
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, refetch } = useMyClaims(page, 20)
  useClampedPage(page, data?.totalPages, setPage)
  const claims = data?.content ?? []
  const total = data?.totalElements ?? claims.length
  // Which row's detail panel is open. One at a time — the detail fetches per
  // claim, so expanding every row at once would be a needless N fan-out.
  const [expandedMyId, setExpandedMyId] = useState<string | null>(null)

  const stats = useMemo(() => {
    const pending = claims.filter((c) => c.status === 'SUBMITTED').length
    const approved = claims.filter((c) => c.status === 'APPROVED').length
    const reimbursed = claims.filter((c) => c.status === 'REIMBURSED')
      .reduce((s, c) => s + (c.totalAmount ?? 0), 0)
    const claimed = claims.reduce((s, c) => s + (c.totalAmount ?? 0), 0)
    return { pending, approved, reimbursed, claimed }
  }, [claims])

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
        Couldn't load your expense claims.{' '}
        <button onClick={() => refetch()} className="font-semibold underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<Receipt size={18} />} color="blue" value={total} label="Total Claims" loading={isLoading} />
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending on this page" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved on this page" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.reimbursed)} label="Reimbursed on this page" loading={isLoading} />
      </div>

      <TableCard footer={hrPaginationFooter({ page, pageSize: 20, totalElements: total, totalPages: data?.totalPages ?? 0, onPageChange: setPage })}>
        <DataTable
          columns={[
            { key: 'title', header: 'Title', render: (c: any) => (
              <button
                type="button"
                onClick={() => setExpandedMyId(expandedMyId === c.id ? null : c.id)}
                aria-expanded={expandedMyId === c.id}
                aria-label={`${expandedMyId === c.id ? 'Hide' : 'Show'} details for ${c.title}`}
                className="inline-flex items-center gap-1.5 text-left font-medium text-[#047857] hover:text-[#064E3B]"
              >
                {expandedMyId === c.id ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                {c.title}
              </button>
            ) },
            { key: 'amount', header: 'Amount', render: (c: any) => <span className="font-semibold text-text-primary">{inr(c.totalAmount)}</span> },
            { key: 'status', header: 'Status', render: (c: any) => <HrStatusPill tone={STATUS_TONE[c.status as ExpenseStatus] || 'gray'}>{c.status}</HrStatusPill> },
            { key: 'submitted', header: 'Submitted', render: (c: any) => <span className="text-text-secondary">{c.submittedAt ? format(new Date(c.submittedAt), 'd MMM yyyy') : '—'}</span> }
          ]}
          data={claims}
          keyField="id"
          loading={isLoading}
          emptyMessage="No expense claims yet. Use “Submit Claim” to file your first reimbursement."
          expandedRowIds={expandedMyId ? [expandedMyId] : []}
          renderSubRow={(c: any) => (
            <div className="bg-bg-base/40 p-4">
              <ClaimDetailPanel claimId={c.id} />
            </div>
          )}
        />
      </TableCard>
    </div>
  )
}

// ── Submit Claim ──────────────────────────────────────────────────────────────

interface DraftItem {
  category: ExpenseCategory
  amount: string
  expenseDate: string
  description: string
  merchantName: string
}

const emptyItem = (): DraftItem => ({
  category: 'TRAVEL', amount: '', expenseDate: new Date().toISOString().slice(0, 10), description: '', merchantName: '',
})

/**
 * Tightest active cap per category, mirroring ExpenseService.enforceCategoryCaps.
 *
 * Two rules have to match the server exactly or the hint lies to the employee:
 *  1. ACTIVE ONLY. listPolicies returns deactivated rows too (the Policies tab
 *     renders them as "Inactive"), but enforcement reads
 *     findByCompanyIdAndActiveTrueOrderByName. Without this filter a retired
 *     ₹500 cap would raise a warning the server would never act on.
 *  2. TIGHTEST WINS. Several active policies may cover one category; the
 *     server merges them with min(), so we do too.
 * A policy with a null maxAmountPerClaim does not constrain the amount.
 */
function buildCapByCategory(policies: ExpensePolicy[]) {
  const caps = new Map<ExpenseCategory, number>()
  for (const p of policies) {
    if (!p.active || p.maxAmountPerClaim == null) continue
    const existing = caps.get(p.category)
    caps.set(p.category, existing == null ? p.maxAmountPerClaim : Math.min(existing, p.maxAmountPerClaim))
  }
  return caps
}

function SubmitTab({ canPolicyRead, onSubmitted }: { canPolicyRead: boolean; onSubmitted: () => void }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const submit = useSubmitClaim()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])

  // 2026-09-10: was hardcoded to companies[0]?.id, which in a multi-company
  // tenant booked every claim to whichever company sorted first — and worse,
  // ExpenseController.submit falls back to the employee's own companyId when
  // companyId is omitted, so the SPA was actively overriding a correct
  // default with a wrong value. Multi-company tenants get a picker; single
  // -company tenants pass undefined and let the server pick.
  const [companyId, setCompanyId] = useState('')
  const claimCompanyId = companies.length > 1
    ? (companyId || undefined)  // let user pick; undefined => server uses employee's company
    : undefined                  // let server derive from employee — no override
  // Gated: GET /v1/expense/policies requires hrms.expense.policy.read, which
  // the seeded EMPLOYEE role does NOT hold. Firing it regardless would 403 on
  // every visit for exactly the people who submit the most claims, so we skip
  // the request and fall back to the server's verbatim rejection message.
  const { data: policies = [] } = useExpensePolicies(claimCompanyId, canPolicyRead)

  const capByCategory = useMemo(() => buildCapByCategory(policies), [policies])

  // The cap applies to the claim's per-category SUBTOTAL, not to each line —
  // otherwise one dinner split across twenty rows would slip under it. Sum the
  // draft the same way the server does before comparing.
  const subtotalByCategory = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>()
    for (const it of items) {
      const amount = parseFloat(it.amount)
      if (!Number.isFinite(amount) || amount <= 0) continue
      totals.set(it.category, (totals.get(it.category) ?? 0) + amount)
    }
    return totals
  }, [items])

  const capBreaches = useMemo(() => {
    const breaches: { category: ExpenseCategory; subtotal: number; cap: number }[] = []
    subtotalByCategory.forEach((subtotal, category) => {
      const cap = capByCategory.get(category)
      if (cap != null && subtotal > cap) breaches.push({ category, subtotal, cap })
    })
    return breaches
  }, [subtotalByCategory, capByCategory])

  const total = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

  const handleSubmit = async () => {
    if (!title.trim()) { toast('Give the claim a title', 'error'); return }
    const valid = items.filter((it) => parseFloat(it.amount) > 0 && it.expenseDate)
    if (valid.length === 0) { toast('Add at least one line item with an amount', 'error'); return }
    try {
      await submit.mutateAsync({
        companyId: claimCompanyId,
        title: title.trim(),
        notes: notes.trim() || undefined,
        items: valid.map((it) => ({
          category: it.category,
          amount: parseFloat(it.amount),
          expenseDate: it.expenseDate,
          description: it.description.trim() || undefined,
          merchantName: it.merchantName.trim() || undefined,
        })),
      })
      toast('Expense claim submitted', 'success')
      onSubmitted()
    } catch (e) {
      // Surface the server message verbatim. A policy rejection
      // (EXPENSE_POLICY_CAP_EXCEEDED, 422) names the category, the claimed
      // subtotal and the limit — collapsing that to "Failed to submit claim"
      // leaves the employee with nothing to act on. apiJson already lifts
      // ErrorResponse.message onto the thrown HttpError; `||` rather than `??`
      // so a blank message still falls back instead of toasting an empty bar.
      const message = (e as Error)?.message?.trim()
      toast(message || 'Failed to submit claim', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20'

  return (
    <div className="max-w-2xl space-y-5">
      <div className="ut-card p-5">
        <h3 className="mb-4 text-[15px] font-semibold text-text-primary">Submit Claim</h3>
        {/* Multi-company tenants get an explicit picker. Single-company
            tenants don't need one — the server falls back to the employee's
            own company when companyId is omitted. */}
        {companies.length > 1 && (
          <div className="mb-4">
            <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Company</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className="ut-select">
              <option value="">My company (default)</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Claim Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client visit — Mumbai" className="ut-input" />
      </div>

      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="ut-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Line item {i + 1}</span>
              {items.length > 1 && (
                <button onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]" aria-label="Remove item">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Category</label>
                <select value={it.category} onChange={(e) => setItem(i, { category: e.target.value as ExpenseCategory })} className="ut-select">
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}
                </select>
                {/* Show the cap BEFORE the employee submits. It used to be
                    invisible until the server rejected the whole claim. */}
                {capByCategory.get(it.category) != null && (
                  <p className={`mt-1.5 text-xs ${
                    (subtotalByCategory.get(it.category) ?? 0) > capByCategory.get(it.category)!
                      ? 'font-semibold text-[#B91C1C]'
                      : 'text-text-tertiary'
                  }`}>
                    {fmtCat(it.category)} limit: {inr(capByCategory.get(it.category)!)} per claim
                  </p>
                )}
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Amount (₹)</label>
                <input type="number" min={0} step="0.01" value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} className="ut-input" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Date</label>
                <input type="date" value={it.expenseDate} onChange={(e) => setItem(i, { expenseDate: e.target.value })} className="ut-input" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Merchant</label>
                <input value={it.merchantName} onChange={(e) => setItem(i, { merchantName: e.target.value })} placeholder="Optional" className="ut-input" />
              </div>
              <div className="col-span-2">
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
                <input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Optional" className="ut-input" />
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => setItems((p) => [...p, emptyItem()])} className="flex items-center gap-1.5 text-sm font-semibold text-[#047857] hover:text-[#064E3B]">
          <Plus size={15} /> Add line item
        </button>
      </div>

      <div className="ut-card p-5">
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for the approver" className={inputCls} />
      </div>

      {capBreaches.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-[#FCA5A5] bg-[#FEF2F2] px-5 py-4">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#B91C1C]" />
          <div>
            <p className="text-sm font-semibold text-[#B91C1C]">Over the company expense limit</p>
            <ul className="mt-1 space-y-0.5 text-xs text-[#B91C1C]">
              {capBreaches.map((b) => (
                <li key={b.category}>
                  {fmtCat(b.category)}: {inr(b.subtotal)} claimed against a {inr(b.cap)} per-claim limit.
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-xs text-[#B91C1C]">
              Reduce the amount or split it into a separate claim — the server will reject this one otherwise.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between rounded-2xl border border-[#6EE7B7] bg-[#ECFDF5] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Total</p>
          <p className="text-2xl font-bold text-text-primary">{inr(total)}</p>
        </div>
        {/* Deliberately NOT disabled on a cap breach: the warning is advisory
            and the server is the authority. The hint is computed from
            companies[0]'s policies while the backend falls back to the
            employee's own company when companyId is absent, so in a
            multi-company tenant the two can disagree — a hard block would then
            stop a claim the server would have accepted. Warn, submit, and show
            the server's verbatim reason if it does reject. */}
        <HrButton onClick={handleSubmit} disabled={submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit Claim'}
        </HrButton>
      </div>
    </div>
  )
}

// ── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsTab({ canApprove, canReimburse }: { canApprove: boolean; canReimburse: boolean }) {
  const { toast } = useToast()
  // GET /v1/expense/claims/{id} is gated on
  // hasAnyAuthority('hrms.expense.claim.read','hrms.expense.claim.self') and
  // then object-checked: a caller holding only claim.self may read ONLY their
  // own claim. Every seeded role that can reach this tab (OWNER, SUPER_ADMIN,
  // HR_MANAGER, FINANCE_LEAD, DEPT_MANAGER) also holds claim.read, but a
  // hand-built custom role need not — so gate the expander rather than offer
  // a control that 403s.
  const canReadClaim = usePermission('hrms.expense.claim.read')
  // Was hard-coded to page 0 with no control. On a busy month-end the queue
  // runs well past EXPENSE_APPROVALS_PAGE_SIZE and every claim below the cut
  // was unreachable — not merely hidden, but impossible to approve or
  // reimburse through the product at all.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(EXPENSE_APPROVALS_PAGE_SIZE)
  const { data, isLoading, isError, refetch } = usePendingExpenseApprovals(page, true, pageSize)
  const decide = useExpenseDecision()
  const reimburse = useReimburseClaim()
  const claims = data?.content ?? []
  const total = data?.totalElements ?? 0
  const totalPages = data?.totalPages ?? 1
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // Rejecting or reimbursing removes rows from this queue, so the last page can
  // vanish while the user is standing on it. Pass the RAW data?.totalPages, not
  // the `?? 1` fallback — that fallback is 1 while a page change is in flight
  // and would bounce every navigation straight back to page 1.
  useClampedPage(page, data?.totalPages, setPage)

  // Collapse the expander when the page changes: expandedId holds a claim id
  // that is no longer on screen, and leaving it set would re-expand that row if
  // the user paged back.
  const goToPage = (next: number) => { setExpandedId(null); setPage(next) }

  const onDecide = async (id: string, approved: boolean) => {
    let comment: string | undefined
    if (!approved) {
      // Cancel must abort the rejection, not fall through to it. `?? undefined`
      // collapsed null (Cancel) and '' (empty submit) into the same value, so
      // dismissing the prompt still rejected the claim (2026-09-08 audit).
      const answer = window.prompt('Reason for rejection (optional):')
      if (answer === null) return
      comment = answer
    }
    try {
      await decide.mutateAsync({ id, approved, comment })
      toast(approved ? 'Claim approved' : 'Claim rejected', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  const onReimburse = async (id: string) => {
    try {
      await reimburse.mutateAsync(id)
      toast('Marked reimbursed', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <TableCard
      footer={hrPaginationFooter({
        page, pageSize, totalElements: total, totalPages, onPageChange: goToPage,
        onPageSizeChange: setPageSize,
      })}
    >
      <DataTable
        columns={[
          { key: 'employee', header: 'Employee', render: (c: any) => <HrAvatar name={c.employeeName || 'Employee'} sub={c.employeeCode} seed={c.id} /> },
          { key: 'claim', header: 'Claim', render: (c: any) => (
            canReadClaim ? (
              <button
                type="button"
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                aria-expanded={expandedId === c.id}
                aria-label={`${expandedId === c.id ? 'Hide' : 'Show'} line items for ${c.title}`}
                className="inline-flex items-center gap-1.5 text-left font-medium text-[#047857] hover:text-[#064E3B]"
              >
                {expandedId === c.id ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                {c.title}
              </button>
            ) : c.title
          ) },
          { key: 'amount', header: 'Amount', render: (c: any) => <span className="font-semibold text-text-primary">{inr(c.totalAmount)}</span> },
          { key: 'status', header: 'Status', render: (c: any) => <HrStatusPill tone={STATUS_TONE[c.status as ExpenseStatus] || 'gray'}>{c.status}</HrStatusPill> },
          { key: 'action', header: 'Action', render: (c: any) => (
            <div className="flex items-center justify-end gap-2 w-full text-right">
              {c.status === 'SUBMITTED' && canApprove && (
                <>
                  <HrButton size="sm" onClick={() => onDecide(c.id, true)} disabled={decide.isPending}><Check size={14} /> Approve</HrButton>
                  <HrButton size="sm" variant="ghost" onClick={() => onDecide(c.id, false)} disabled={decide.isPending}><X size={14} /> Reject</HrButton>
                </>
              )}
              {c.status === 'APPROVED' && canReimburse && (
                <HrButton size="sm" onClick={() => onReimburse(c.id)} disabled={reimburse.isPending}><Wallet size={14} /> Mark Reimbursed</HrButton>
              )}
              {((c.status === 'SUBMITTED' && !canApprove) || (c.status === 'APPROVED' && !canReimburse)) && (
                <span className="text-xs text-text-tertiary">—</span>
              )}
            </div>
          ) }
        ]}
        data={claims}
        keyField="id"
        loading={isLoading}
        emptyMessage={isError ? "Couldn't load the approvals queue. Try again" : "Nothing awaiting action. Submitted claims wait here for approval; approved claims wait here to be reimbursed."}
        expandedRowIds={expandedId ? [expandedId] : []}
        renderSubRow={(c: any) => (
          <div className="bg-bg-base/40 p-4">
            <ClaimDetailPanel claimId={c.id} />
          </div>
        )}
      />
    </TableCard>
  )
}

/**
 * Line-item breakdown for one claim, fetched only when its row is expanded.
 *
 * Why fetch rather than read it off the row: the approvals list carries no
 * items at all — ExpenseService.toPage maps every page row with
 * toResponse(c, null), so `items` is null on every list response. The
 * per-claim endpoint (GET /v1/expense/claims/{id}, mapped by getClaim with
 * real items) is the only source. Loading every claim's items into the list
 * payload would be an N+1 on a page whose rows are collapsed by default, so
 * the detail is pulled on demand instead. react-query caches it, so
 * collapsing and re-expanding the same row does not refetch.
 */
function ClaimDetailPanel({ claimId }: { claimId: string }) {
  const { data: claim, isLoading, isError, refetch } = useExpenseClaim(claimId)
  const items = claim?.items ?? []

  if (isLoading) {
    return <div className="p-4"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></div>
  }
  if (isError) {
    return (
      <p className="p-4 text-center text-xs text-red-700">
        Couldn&rsquo;t load the line items.{' '}
        <button type="button" onClick={() => refetch()} className="font-semibold underline underline-offset-2">Try again</button>
      </p>
    )
  }
  if (items.length === 0) {
    return <p className="p-4 text-center text-xs text-text-tertiary">This claim has no line items.</p>
  }

  return (
    <div className="space-y-3 p-4">
      <table className="hr-table [&_tbody_td]:!py-2">
        <thead>
          <tr>
            <th>Category</th>
            <th>Description</th>
            <th className="hidden sm:table-cell">Merchant</th>
            <th>Date</th>
            <th className="text-right">Amount</th>
            <th>Receipt</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => (
            <tr key={it.id ?? idx}>
              <td><HrStatusPill tone="info">{fmtCat(it.category)}</HrStatusPill></td>
              <td className="text-text-secondary">{it.description || '—'}</td>
              <td className="hidden sm:table-cell text-text-secondary">{it.merchantName || '—'}</td>
              {/* expenseDate is a LocalDate ("2026-09-09"). Parsed bare it is
                  read as UTC midnight and renders as the previous day in any
                  timezone behind UTC — pin it to local midnight instead. */}
              <td className="text-text-secondary">{format(new Date(it.expenseDate + 'T00:00:00'), 'd MMM yyyy')}</td>
              <td className="text-right font-semibold text-text-primary">{inr(it.amount)}</td>
              <td>
                {/* receiptUrl is NULL on every claim today — there is no upload
                    control in the product yet — so this renders "—" until that
                    ships, at which point the link starts working with no change
                    here. */}
                {it.receiptUrl ? (
                  <a href={it.receiptUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-[#047857] hover:text-[#064E3B]">
                    <ExternalLink size={13} /> View
                  </a>
                ) : <span className="text-text-tertiary">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {claim?.notes && (
        <p className="text-xs text-text-secondary">
          <span className="font-semibold text-text-tertiary">Notes: </span>{claim.notes}
        </p>
      )}
    </div>
  )
}

// ── Policies ───────────────────────────────────────────────────────────────

function PoliciesTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const activeCompany = companyId || companies[0]?.id || ''
  const { data: policies = [], isLoading } = useExpensePolicies(activeCompany)
  const create = useCreatePolicy()
  const update = useUpdatePolicy()
  const remove = useDeletePolicy()

  const [name, setName] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('TRAVEL')
  const [maxAmount, setMaxAmount] = useState('')
  // null = the form is creating; an id = editing that policy. One form serves
  // both so a field cannot exist on one path and be missing from the other.
  const [editingId, setEditingId] = useState<string | null>(null)

  const onStartEdit = (p: ExpensePolicy) => {
    setEditingId(p.id)
    setName(p.name)
    setCategory(p.category)
    setMaxAmount(p.maxAmountPerClaim != null ? String(p.maxAmountPerClaim) : '')
  }

  const onCancelEdit = () => {
    setEditingId(null); setName(''); setMaxAmount(''); setCategory('TRAVEL')
  }

  /** Restore sends ONLY isActive — the server treats omitted fields as
   *  "leave alone" on update, so this cannot disturb the cap or approval
   *  rules the policy was retired with. */
  const onRestore = async (p: ExpensePolicy) => {
    try {
      await update.mutateAsync({ id: p.id, name: p.name, category: p.category, isActive: true })
      toast('Policy restored', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to restore policy', 'error')
    }
  }

  const onDeactivate = (p: ExpensePolicy) => {
    if (!window.confirm(`Deactivate “${p.name}”? Claims will stop being checked against this cap. You can restore it from this table afterwards.`)) return
    remove.mutate(p.id, {
      onSuccess: () => toast('Policy deactivated', 'success'),
      onError: (e) => toast((e as Error)?.message ?? 'Failed to deactivate policy', 'error'),
    })
  }

  const onCreate = async () => {
    if (!name.trim()) { toast('Policy name is required', 'error'); return }
    try {
      if (editingId) {
        await update.mutateAsync({
          id: editingId,
          name: name.trim(),
          category,
          maxAmountPerClaim: maxAmount ? parseFloat(maxAmount) : null,
        })
        toast('Policy updated', 'success')
        onCancelEdit()
        return
      }
      await create.mutateAsync({
        companyId: activeCompany,
        name: name.trim(),
        category,
        maxAmountPerClaim: maxAmount ? parseFloat(maxAmount) : null,
      })
      toast('Policy created', 'success')
      setName(''); setMaxAmount('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed', 'error')
    }
  }

  return (
    <div className="space-y-4">
      {companies.length > 1 && (
        <div className="w-56">
          <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className="ut-select ut-select-sm">
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}

      {canWrite && (
        <div className="ut-card flex flex-wrap items-end gap-2 p-4">
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-[13px] font-semibold text-text-secondary">Policy name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Domestic travel cap" className="ut-input ut-input-sm" />
          </div>
          <div className="w-40">
            <label className="mb-1 block text-[13px] font-semibold text-text-secondary">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className="ut-select ut-select-sm">
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="mb-1 block text-[13px] font-semibold text-text-secondary">Max / claim (₹)</label>
            <input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="No cap" className="ut-input ut-input-sm" />
          </div>
          <HrButton onClick={onCreate} disabled={create.isPending}><Plus size={15} /> Add Policy</HrButton>
        </div>
      )}

      <TableCard>
        <DataTable
          columns={[
            { key: 'policy', header: 'Policy', render: (p: any) => <span className="font-medium text-text-primary">{p.name}</span> },
            { key: 'category', header: 'Category', render: (p: any) => <HrStatusPill tone="info">{fmtCat(p.category)}</HrStatusPill> },
            { key: 'max', header: 'Max / Claim', render: (p: any) => <span className="text-text-secondary">{p.maxAmountPerClaim != null ? inr(p.maxAmountPerClaim) : 'No cap'}</span> },
            { key: 'receipt', header: 'Receipt', render: (p: any) => <span className="text-text-secondary">{p.requiresReceipt ? 'Required' : 'Optional'}</span> },
            { key: 'status', header: 'Status', render: (p: any) => <HrStatusPill tone={p.active ? 'ok' : 'gray'}>{p.active ? 'Active' : 'Inactive'}</HrStatusPill> },
            ...(canWrite ? [{
              key: 'action', header: '', render: (p: any) => (
                <div className="flex items-center justify-end gap-1 w-full text-right">
                  <button
                    onClick={() => onStartEdit(p)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-bg-base hover:text-text-primary"
                    title="Edit policy"
                    aria-label={`${p.name}`}
                  >
                    <Pencil size={14} />
                  </button>
                  {p.active ? (
                    <button
                      onClick={() => onDeactivate(p)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]"
                      title="Deactivate"
                      aria-label={`${p.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : (
                    <button
                      onClick={() => onRestore(p)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#ECFDF5] hover:text-[#047857]"
                      title="Restore policy"
                      aria-label={`${p.name}`}
                      disabled={update.isPending}
                    >
                      <RotateCcw size={14} />
                    </button>
                  )}
                </div>
              )
            }] : [])
          ]}
          data={policies}
          keyField="id"
          loading={isLoading}
          emptyMessage="No expense policies defined yet."
        />
      </TableCard>
    </div>
  )
}
