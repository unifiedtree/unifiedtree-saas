/**
 * Expenses — this employee's claims, with their line items and receipts.
 *
 * Reads GET /v1/expense/employees/{id}/claims (V143.13, newest first, paged);
 * a row opens the claim's line items (GET /v1/expense/claims/{id}), where each
 * receipt opens through a short-lived signed link. HR, admin and finance
 * (hrms.expense.employee.read) see anyone, department managers their team,
 * everyone else only themselves. A 403 renders as a no-access state.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useEmployeeClaims, inr, receiptSummary, type ExpenseStatus } from '../../api/useExpense'
import { EXPENSE_STATUS_LABEL } from '../../expense/expenseStatus'
import { ClaimDetailPanel } from '../../Expense'
import { SectionState, SubSection } from './shared'

const TONE: Record<ExpenseStatus, PillTone> = {
  DRAFT: 'gray', SUBMITTED: 'warn', APPROVED: 'ok', APPROVED_FOR_PAY: 'info', REJECTED: 'red', REIMBURSED: 'teal',
}
const PAGE_SIZE = 10

export function EmployeeExpenses({ employeeId, firstName, self }: { employeeId: string; firstName: string; self?: boolean }) {
  const navigate = useNavigate()
  const canApprove = usePermission('hrms.expense.claim.approve'), canReimburse = usePermission('hrms.expense.reimbursement')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const claims = useEmployeeClaims(employeeId, page, PAGE_SIZE)
  useClampedPage(page, claims.data?.totalPages, setPage)
  const rows = claims.data?.content ?? []

  return (
    <SubSection title="Expense claims" hint="Newest first. Open a claim to see its line items and receipts."
      action={canApprove || canReimburse ? <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/expenses')}>Open Expense centre</HrButton> : undefined}>
      <SectionState
        isLoading={claims.isLoading} error={claims.error} onRetry={() => claims.refetch()}
        isEmpty={!claims.isLoading && !claims.error && rows.length === 0}
        emptyIcon={Receipt} emptyTitle="No expense claims yet"
        emptyHint={`Claims ${firstName} submits appear here with their status and receipts.`}
        forbiddenTitle="You can't see this person's claims"
        forbiddenHint="Managers see their own team's claims; HR, admins and finance see everyone's."
      >
        <TableCard footer={(claims.data?.totalPages ?? 0) > 1 ? hrPaginationFooter({ page, pageSize: PAGE_SIZE, totalElements: claims.data?.totalElements ?? 0, totalPages: claims.data?.totalPages ?? 0, onPageChange: (p) => { setOpen(null); setPage(p) } }) : undefined}>
          <table className="hr-table">
            <thead><tr><th>Claim</th><th>Amount</th><th>Status</th><th className="hidden sm:table-cell">Submitted</th><th className="hidden md:table-cell">Receipts</th></tr></thead>
            <tbody>
              {rows.flatMap((c) => {
                const expanded = open === c.id
                const row = (
                  <tr key={c.id}>
                    <td>
                      <button type="button" onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded}
                        aria-label={`${expanded ? 'Hide' : 'Show'} line items for ${c.title}`}
                        className="inline-flex items-center gap-1.5 text-left font-medium text-[#047857] hover:text-[#064E3B]">
                        {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}{c.title}
                      </button>
                      {c.status === 'REJECTED' && c.approverComment && <span className="mt-1 block text-xs text-[#b91c1c]">{c.approverComment}</span>}
                    </td>
                    <td className="font-semibold text-text-primary">{inr(c.totalAmount)}</td>
                    <td><HrStatusPill tone={TONE[c.status] || 'gray'}>{EXPENSE_STATUS_LABEL[c.status] ?? c.status}</HrStatusPill></td>
                    <td className="hidden sm:table-cell whitespace-nowrap text-text-secondary">{c.submittedAt ? format(new Date(c.submittedAt), 'd MMM yyyy') : '—'}</td>
                    <td className="hidden md:table-cell text-text-secondary">{receiptSummary(c)}</td>
                  </tr>
                )
                return expanded
                  ? [row, <tr key={`${c.id}-items`}><td colSpan={5} className="bg-bg-base/40 !p-0"><ClaimDetailPanel claimId={c.id} allowAttach={self} /></td></tr>]
                  : [row]
              })}
            </tbody>
          </table>
        </TableCard>
      </SectionState>
    </SubSection>
  )
}
