import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Receipt, Check, X, Wallet, Clock, BadgeCheck } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import {
  useMyClaims, usePendingExpenseApprovals, useSubmitClaim, useExpenseDecision, useReimburseClaim,
  useExpensePolicies, useCreatePolicy, useDeletePolicy,
  inr, EXPENSE_CATEGORIES,
  type ExpenseStatus, type ExpenseCategory,
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
    ...(canApprove ? [{ key: 'approvals' as Tab, label: 'Approvals' }] : []),
    ...(canPolicyRead ? [{ key: 'policies' as Tab, label: 'Policies' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Expense Management" title="Expense Center" subtitle="Submit, approve, and reimburse employee expenses" />

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

      {tab === 'my' && <MyClaimsTab />}
      {tab === 'submit' && <SubmitTab onSubmitted={() => setTab('my')} />}
      {tab === 'approvals' && canApprove && <ApprovalsTab canReimburse={canReimburse} />}
      {tab === 'policies' && canPolicyRead && <PoliciesTab canWrite={canPolicyWrite} />}
    </div>
  )
}

// ── My Claims ────────────────────────────────────────────────────────────────

function MyClaimsTab() {
  const { data, isLoading } = useMyClaims(0)
  const claims = data?.content ?? []

  const stats = useMemo(() => {
    const pending = claims.filter((c) => c.status === 'SUBMITTED').length
    const approved = claims.filter((c) => c.status === 'APPROVED').length
    const reimbursed = claims.filter((c) => c.status === 'REIMBURSED')
      .reduce((s, c) => s + (c.totalAmount ?? 0), 0)
    const claimed = claims.reduce((s, c) => s + (c.totalAmount ?? 0), 0)
    return { pending, approved, reimbursed, claimed }
  }, [claims])

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<Receipt size={18} />} color="blue" value={claims.length} label="Total Claims" loading={isLoading} />
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

function SubmitTab({ onSubmitted }: { onSubmitted: () => void }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const submit = useSubmitClaim()
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<DraftItem[]>([emptyItem()])

  const total = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0)
  const setItem = (i: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)))

  const handleSubmit = async () => {
    if (!title.trim()) { toast('Give the claim a title', 'error'); return }
    const valid = items.filter((it) => parseFloat(it.amount) > 0 && it.expenseDate)
    if (valid.length === 0) { toast('Add at least one line item with an amount', 'error'); return }
    try {
      await submit.mutateAsync({
        companyId: companies[0]?.id,
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
      toast((e as Error)?.message ?? 'Failed to submit claim', 'error')
    }
  }

  const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

  return (
    <div className="max-w-2xl space-y-5">
      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Claim Title *</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Client visit — Mumbai" className={inputCls} />
      </div>

      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i} className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Line item {i + 1}</span>
              {items.length > 1 && (
                <button onClick={() => setItems((p) => p.filter((_, idx) => idx !== i))} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" aria-label="Remove item">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
                <select value={it.category} onChange={(e) => setItem(i, { category: e.target.value as ExpenseCategory })} className={inputCls}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Amount (₹)</label>
                <input type="number" min={0} step="0.01" value={it.amount} onChange={(e) => setItem(i, { amount: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Date</label>
                <input type="date" value={it.expenseDate} onChange={(e) => setItem(i, { expenseDate: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Merchant</label>
                <input value={it.merchantName} onChange={(e) => setItem(i, { merchantName: e.target.value })} placeholder="Optional" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
                <input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="Optional" className={inputCls} />
              </div>
            </div>
          </div>
        ))}
        <button onClick={() => setItems((p) => [...p, emptyItem()])} className="flex items-center gap-1.5 text-sm font-semibold text-[#C16E00] hover:text-[#9A5600]">
          <Plus size={15} /> Add line item
        </button>
      </div>

      <div className="rounded-2xl border border-border-default bg-white p-5 shadow-sm">
        <label className="mb-1.5 block text-xs font-semibold text-text-secondary">Notes</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional context for the approver" className={inputCls} />
      </div>

      <div className="flex items-center justify-between rounded-2xl border border-[#FFD68A] bg-[#FFF8EC] px-5 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Total</p>
          <p className="text-2xl font-bold text-text-primary">{inr(total)}</p>
        </div>
        <HrButton onClick={handleSubmit} disabled={submit.isPending}>
          {submit.isPending ? 'Submitting…' : 'Submit Claim'}
        </HrButton>
      </div>
    </div>
  )
}

// ── Approvals ──────────────────────────────────────────────────────────────

function ApprovalsTab({ canReimburse }: { canReimburse: boolean }) {
  const { toast } = useToast()
  const { data, isLoading } = usePendingExpenseApprovals(0)
  const decide = useExpenseDecision()
  const reimburse = useReimburseClaim()
  const claims = data?.content ?? []

  const onDecide = async (id: string, approved: boolean) => {
    let comment: string | undefined
    if (!approved) {
      comment = window.prompt('Reason for rejection (optional):') ?? undefined
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
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {isLoading ? (
            [...Array(3)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
          ) : claims.length === 0 ? (
            <tr><td colSpan={4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">Nothing awaiting approval</p><p className="mt-1 text-xs text-text-tertiary">Submitted claims will appear here.</p></td></tr>
          ) : claims.map((c, i) => (
            <tr key={c.id}>
              <td><HrAvatar name={c.employeeName || 'Employee'} sub={c.employeeCode} seed={i} /></td>
              <td className="text-text-primary">{c.title}</td>
              <td className="font-semibold text-text-primary">{inr(c.totalAmount)}</td>
              <td>
                <div className="flex items-center justify-end gap-2">
                  <HrButton size="sm" onClick={() => onDecide(c.id, true)} disabled={decide.isPending}><Check size={14} /> Approve</HrButton>
                  <HrButton size="sm" variant="ghost" onClick={() => onDecide(c.id, false)} disabled={decide.isPending}><X size={14} /> Reject</HrButton>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableCard>
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

  const inputCls = 'rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none'

  return (
    <div className="space-y-4">
      {companies.length > 1 && (
        <select value={activeCompany} onChange={(e) => setCompanyId(e.target.value)} className={inputCls}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      )}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-border-default bg-white p-4 shadow-sm">
          <div className="flex-1 min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Policy name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Domestic travel cap" className={`${inputCls} w-full`} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)} className={inputCls}>
              {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{fmtCat(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Max / claim (₹)</label>
            <input type="number" min={0} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="No cap" className={`${inputCls} w-32`} />
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
                    {p.active && (
                      <button onClick={() => remove.mutate(p.id, { onSuccess: () => toast('Policy deactivated', 'success') })} className="rounded-lg p-1.5 text-text-tertiary hover:bg-[#FEE2E2] hover:text-[#B91C1C]" title="Deactivate">
                        <Trash2 size={14} />
                      </button>
                    )}
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
