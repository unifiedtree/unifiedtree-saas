import React, { useMemo, useState } from 'react'
import {
  Plus, Trash2, Receipt, Check, X, Wallet, Clock, BadgeCheck,
  ChevronDown, ChevronRight, AlertTriangle, ExternalLink,
} from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useMyClaims, usePendingExpenseApprovals, useExpenseClaim, useSubmitClaim, useExpenseDecision, useReimburseClaim,
  useExpensePolicies, useCreatePolicy, useDeletePolicy,
  inr, EXPENSE_CATEGORIES,
  type ExpenseStatus, type ExpenseCategory, type ExpensePolicy,
} from './api/useExpense'

const STATUS_TONE: Record<ExpenseStatus, PillTone> = {
  DRAFT: 'gray', SUBMITTED: 'warn', APPROVED: 'ok', REJECTED: 'red', REIMBURSED: 'teal',
}

const fmtCat = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())

type Tab = 'my' | 'submit' | 'approvals' | 'policies'

export const Expense: React.FC = () => {
  const canApprove = usePermission('hrms.expense.claim.approve')
  const canReimburse = usePermission('hrms.expense.reimbursement')
  const canPolicyRead = usePermission('hrms.expense.policy.read')
  const canPolicyWrite = usePermission('hrms.expense.policy.write')
  const [tab, setTab] = useState<Tab>('my')

  const tabs: { key: Tab; label: string }[] = [
    { key: 'my', label: 'My Claims' },
    { key: 'submit', label: 'Submit Claim' },
    // Reimbursement-only roles (finance) need this tab too — it's where
    // APPROVED claims are marked paid (2026-09-08 audit).
    ...(canApprove || canReimburse ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    ...(canPolicyRead ? [{ key: 'policies' as Tab, label: 'Policies' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Expense Management" title="Expense Center" subtitle="Submit, approve, and reimburse employee expenses" />

      <HrTabs tabs={tabs} active={tab} onChange={(k) => setTab(k as Tab)} />

      {tab === 'my' && <HrTabPanel tabKey="my"><MyClaimsTab /></HrTabPanel>}
      {/* canPolicyRead is threaded into the submit form so it can show the
          category cap that will be enforced on save. GET /v1/expense/policies
          is gated on hrms.expense.policy.read, so without it the form must not
          fire the request at all — see SubmitTab. */}
      {tab === 'submit' && <HrTabPanel tabKey="submit"><SubmitTab canPolicyRead={canPolicyRead} onSubmitted={() => setTab('my')} /></HrTabPanel>}
      {tab === 'approvals' && (canApprove || canReimburse) && <HrTabPanel tabKey="approvals"><ApprovalsTab canApprove={canApprove} canReimburse={canReimburse} /></HrTabPanel>}
      {tab === 'policies' && canPolicyRead && <HrTabPanel tabKey="policies"><PoliciesTab canWrite={canPolicyWrite} /></HrTabPanel>}
    </div>
  )
}

// ── My Claims ────────────────────────────────────────────────────────────────

function MyClaimsTab() {
  const { data, isLoading, isError, refetch } = useMyClaims(0, 200)
  const claims = data?.content ?? []
  const total = data?.totalElements ?? claims.length

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
        <HrStatCard icon={<Clock size={18} />} color="orange" value={stats.pending} label="Pending" loading={isLoading} />
        <HrStatCard icon={<BadgeCheck size={18} />} color="green" value={stats.approved} label="Approved" loading={isLoading} />
        <HrStatCard icon={<Wallet size={18} />} color="teal" value={inr(stats.reimbursed)} label="Reimbursed" loading={isLoading} />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Amount</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : claims.length === 0 ? (
              <tr><td colSpan={4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No expense claims yet</p><p className="mt-1 text-xs text-text-tertiary">Use “Submit Claim” to file your first reimbursement.</p></td></tr>
            ) : claims.map((c) => (
              <tr key={c.id}>
                <td className="font-medium text-text-primary">{c.title}</td>
                <td className="font-semibold text-text-primary">{inr(c.totalAmount)}</td>
                <td><HrStatusPill tone={STATUS_TONE[c.status]}>{c.status}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{c.submittedAt ? format(new Date(c.submittedAt), 'd MMM yyyy') : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
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

  // Same companyId the submit payload below sends, so the cap we show is the
  // cap the server will actually evaluate the claim against. (Both use
  // companies[0] — if that ever becomes the employee's own company, change
  // both together or the hint silently starts describing a different company.)
  const claimCompanyId = companies[0]?.id
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
  const { data, isLoading, isError, refetch } = usePendingExpenseApprovals(0)
  const decide = useExpenseDecision()
  const reimburse = useReimburseClaim()
  const claims = data?.content ?? []
  const [expandedId, setExpandedId] = useState<string | null>(null)

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
    <TableCard>
      <table className="hr-table">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Claim</th>
            <th>Amount</th>
            <th>Status</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            [...Array(3)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
          ) : isError ? (
            <tr><td colSpan={5} className="py-10 text-center"><p className="text-sm font-semibold text-red-700">Couldn&rsquo;t load the approvals queue</p><button type="button" onClick={() => refetch()} className="mt-2 text-xs font-medium text-[#047857] underline underline-offset-2">Try again</button></td></tr>
          ) : claims.length === 0 ? (
            <tr><td colSpan={5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">Nothing awaiting action</p><p className="mt-1 text-xs text-text-tertiary">Submitted claims wait here for approval; approved claims wait here to be reimbursed.</p></td></tr>
          ) : claims.map((c, i) => (
            <React.Fragment key={c.id}>
              <tr>
                <td><HrAvatar name={c.employeeName || 'Employee'} sub={c.employeeCode} seed={i} /></td>
                <td className="text-text-primary">
                  {/* The list payload has no line items at all: ExpenseService.toPage
                      maps every row with toResponse(c, null). Approvers were
                      authorising a bare total with no idea what it was made of.
                      Expanding pulls the real breakdown from the per-claim
                      endpoint. */}
                  {canReadClaim ? (
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
                  ) : c.title}
                </td>
                <td className="font-semibold text-text-primary">{inr(c.totalAmount)}</td>
                <td><HrStatusPill tone={STATUS_TONE[c.status]}>{c.status}</HrStatusPill></td>
                <td>
                  <div className="flex items-center justify-end gap-2">
                    {/* The queue now carries SUBMITTED (to approve) and APPROVED
                        (to reimburse). Before, approved claims vanished from every
                        screen and the reimburse endpoint was unreachable — nobody
                        was ever paid through the product (2026-09-08 audit). */}
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
                </td>
              </tr>
              {expandedId === c.id && (
                <tr>
                  <td colSpan={5} className="bg-bg-base/40 p-0">
                    <ClaimDetailPanel claimId={c.id} />
                  </td>
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
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
  const remove = useDeletePolicy()

  const [name, setName] = useState('')
  const [category, setCategory] = useState<ExpenseCategory>('TRAVEL')
  const [maxAmount, setMaxAmount] = useState('')

  const onCreate = async () => {
    if (!name.trim()) { toast('Policy name is required', 'error'); return }
    try {
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
        <table className="hr-table">
          <thead>
            <tr>
              <th>Policy</th>
              <th>Category</th>
              <th>Max / Claim</th>
              <th>Receipt</th>
              <th>Status</th>
              {canWrite && <th></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : policies.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center text-sm text-text-tertiary">No expense policies defined yet.</td></tr>
            ) : policies.map((p) => (
              <tr key={p.id}>
                <td className="font-medium text-text-primary">{p.name}</td>
                <td><HrStatusPill tone="info">{fmtCat(p.category)}</HrStatusPill></td>
                <td className="text-text-secondary">{p.maxAmountPerClaim != null ? inr(p.maxAmountPerClaim) : 'No cap'}</td>
                <td className="text-text-secondary">{p.requiresReceipt ? 'Required' : 'Optional'}</td>
                <td><HrStatusPill tone={p.active ? 'ok' : 'gray'}>{p.active ? 'Active' : 'Inactive'}</HrStatusPill></td>
                {canWrite && (
                  <td>
                    <div className="flex items-center justify-end">
                      {p.active && (
                        <button onClick={() => remove.mutate(p.id, { onSuccess: () => toast('Policy deactivated', 'success') })} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Deactivate" aria-label="Deactivate policy">
                          <Trash2 size={14} />
                        </button>
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
