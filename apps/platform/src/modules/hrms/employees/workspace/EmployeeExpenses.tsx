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
import { ChevronDown, ChevronRight, Receipt } from 'lucide-react'
import { P, usePermission } from '@unifiedtree/sdk'
import { Button } from '@/design/kit/display'
import { HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { hrPaginationFooter, useClampedPage } from '@/shared/components/HrPagination'
import { useEmployeeClaims, inr, receiptSummary, type ExpenseStatus } from '../../api/useExpense'
import { EXPENSE_STATUS_LABEL } from '../../expense/expenseStatus'
import { ClaimDetailPanel } from '../../Expense'
import { SectionState, SubSection } from './shared'
import { NewClaimForPanel } from './OnBehalfPanels'
import { fmtDate } from './profileFormat'

const TONE: Record<ExpenseStatus, PillTone> = {
  DRAFT: 'gray', SUBMITTED: 'warn', APPROVED: 'ok', APPROVED_FOR_PAY: 'info', REJECTED: 'red', REIMBURSED: 'teal',
}
const PAGE_SIZE = 10

export function EmployeeExpenses({ employeeId, firstName, self, name }: { employeeId: string; firstName: string; self?: boolean; name?: string }) {
  const navigate = useNavigate()
  const canApprove = usePermission('hrms.expense.claim.approve'), canReimburse = usePermission('hrms.expense.reimbursement')
  // New claim on behalf (BW-61): never for yourself (that is your own claim, from Expenses).
  const canOthers = usePermission(P.HRMS_EXPENSE_CLAIM_OTHERS) && !self
  const [onBehalf, setOnBehalf] = useState(false)
  const canClaimSelf = usePermission('hrms.expense.claim.self')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const claims = useEmployeeClaims(employeeId, page, PAGE_SIZE)
  useClampedPage(page, claims.data?.totalPages, setPage)
  const rows = claims.data?.content ?? []

  return (
    <>
    <SubSection title="Expense claims" hint={`Submitted by ${firstName}, newest first. Open a claim to see its line items and receipts.`}
      action={(canOthers || canApprove || canReimburse || (self && canClaimSelf)) ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>
        {canOthers && <Button size={30} variant="secondary" icon="plus" onClick={() => setOnBehalf(true)}>New claim</Button>}
        {self && canClaimSelf && <Button size={30} variant="secondary" icon="plus" onClick={() => navigate('/hrms/expenses?tab=my')}>New claim</Button>}
        {(canApprove || canReimburse) && <HrButton size="sm" variant="ghost" onClick={() => navigate('/hrms/expenses')}>Open Expense centre</HrButton>}
      </span> : undefined}>
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
                        className="inline-flex items-center gap-1.5 text-left font-medium hover:underline" style={{ color: 'var(--u-brt,#0F6E56)' }}>
                        {expanded ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}{c.title}
                      </button>
                      {c.status === 'REJECTED' && c.approverComment && <span className="mt-1 block text-xs" style={{ color: 'var(--u-rdt,#B42318)' }}>{c.approverComment}</span>}
                    </td>
                    <td className="font-semibold text-text-primary">{inr(c.totalAmount)}</td>
                    <td><HrStatusPill tone={TONE[c.status] || 'gray'}>{EXPENSE_STATUS_LABEL[c.status] ?? c.status}</HrStatusPill></td>
                    <td className="hidden sm:table-cell whitespace-nowrap text-text-secondary">{fmtDate(c.submittedAt)}</td>
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
    {canOthers && <NewClaimForPanel open={onBehalf} onClose={() => setOnBehalf(false)} employeeId={employeeId} name={name || firstName} />}
    </>
  )
}
