import React from 'react'
import { Download } from 'lucide-react'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { EmptyState } from '@/shared/components/EmptyState'
import { DataTable } from '@/shared/components/DataTable'
import { FileText } from 'lucide-react'
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
        <EmptyState icon={FileText} title="No payslips yet" description="Payslips appear here once payroll is locked for a period." />
      ) : (
        <TableCard>
          <DataTable
            columns={[
              { key: 'period', header: 'Month / Year', render: (r) => <span className="font-semibold text-text-primary">{r.period}</span> },
              { key: 'paidDays', header: 'Paid Days', render: (r) => <div className="text-right tabular-nums">{r.paidDays == null ? <span className="text-text-tertiary">—</span> : fmtDays(r.paidDays, r.lopDays)}</div> },
              { key: 'gross', header: 'Gross Earnings', render: (r) => <div className="text-right tabular-nums">{r.gross == null ? <span className="text-text-tertiary">—</span> : inr2(r.gross)}</div> },
              { key: 'deductions', header: 'Total Deductions', render: (r) => <div className="text-right tabular-nums">{r.totalDeductions == null ? <span className="text-text-tertiary">—</span> : inr2(r.totalDeductions)}</div> },
              { key: 'netPay', header: 'Net Paid', render: (r) => <div className="text-right tabular-nums font-bold text-[#059669]">{inr2(r.netPay)}</div> },
              { key: 'status', header: 'Status', render: (r) => <HrStatusPill tone={PAYSLIP_TONE[r.status]}>{r.status}</HrStatusPill> },
              { key: 'action', header: '', render: (r) => (
                <div className="text-right w-full flex justify-end">
                  {(r.status === 'LOCKED' || r.status === 'PAID') ? (
                    <HrButton
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        try { await downloadMyPayslipPdf(r.runId) } catch (e) { toast((e as Error).message, 'error') }
                      }}
                    >
                      <Download size={15} /> PDF
                    </HrButton>
                  ) : <span className="text-xs text-text-tertiary">Not ready</span>}
                </div>
              )}
            ]}
            data={data}
            keyField="runId"
          />
        </TableCard>
      )}
    </div>
  )
}
