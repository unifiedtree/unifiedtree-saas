import React from 'react'
import { Download } from 'lucide-react'
import { EmptyState, CardSkeleton } from '@unifiedtree/ui-kit'
import { HrPageHeader, HrButton, HrStatusPill, TableCard, type PillTone } from '@/shared/components/hr'
import { useToast } from '@/shared/hooks/useToast'
import { useMyPayslips, downloadMyPayslipPdf, inr2, type MyPayslip } from '../api/usePayrollRuns'

const PAYSLIP_TONE: Record<MyPayslip['status'], PillTone> = {
  DRAFT: 'gray',
  PROCESSING: 'info',
  LOCKED: 'ok',
  PAID: 'ok',
  CANCELLED: 'red',
}

/**
 * "22 / 30" or just "22" when there's no LOP. Never renders a bare 0 in the
 * LOP slot — that reads as "zero paid" which is wrong.
 */
function fmtDays(paid: number | null | undefined, lop: number | null | undefined): React.ReactNode {
  if (paid == null) return <span className="text-text-tertiary">—</span>
  const paidStr = Number(paid).toFixed(0)
  if (lop == null || Number(lop) === 0) return paidStr
  return <>{paidStr}<span className="text-text-tertiary"> / {Number(lop).toFixed(0)}</span></>
}

export const EmployeePayslips: React.FC = () => {
  const { toast } = useToast()
  const { data = [], isLoading } = useMyPayslips()

  if (isLoading) return <div className="max-w-3xl mx-auto p-6 sm:p-8"><CardSkeleton /></div>

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8">
      <HrPageHeader
        crumb="Payroll"
        title="My Payslips"
        subtitle="Download payslips for finalized payroll periods."
      />

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No payslips yet"
          description="Payslips appear here once payroll is locked for a period." />
      ) : (
        <TableCard>
          <table className="hr-table">
            <thead>
              <tr>
                <th>Period</th>
                <th className="hidden md:table-cell text-right">Paid days</th>
                <th className="text-right">Gross</th>
                <th className="hidden sm:table-cell text-right">Deductions</th>
                <th className="text-right">Net pay</th>
                <th className="hidden lg:table-cell">Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.runId}>
                  <td><span className="font-semibold text-text-primary">{r.period}</span></td>
                  <td className="hidden md:table-cell text-right tabular-nums">
                    {/* Null when the tenant isn't tracking LOP — render a dash, not "0". */}
                    {r.paidDays == null ? <span className="text-text-tertiary">—</span> : fmtDays(r.paidDays, r.lopDays)}
                  </td>
                  <td className="text-right tabular-nums">{r.gross == null ? <span className="text-text-tertiary">—</span> : inr2(r.gross)}</td>
                  <td className="hidden sm:table-cell text-right tabular-nums">
                    {r.totalDeductions == null ? <span className="text-text-tertiary">—</span> : inr2(r.totalDeductions)}
                  </td>
                  <td className="text-right tabular-nums font-semibold">{inr2(r.netPay)}</td>
                  <td className="hidden lg:table-cell">
                    <HrStatusPill tone={PAYSLIP_TONE[r.status]}>{r.status}</HrStatusPill>
                  </td>
                  <td className="text-right">
                    {r.status === 'LOCKED' ? (
                      <HrButton
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          try { await downloadMyPayslipPdf(r.runId) } catch (e) { toast((e as Error).message, 'error') }
                        }}
                      >
                        <Download size={15} /> PDF
                      </HrButton>
                    ) : (
                      <span className="text-xs text-text-tertiary">Not finalized</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableCard>
      )}
    </div>
  )
}
