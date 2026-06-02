import React from 'react'
import { Download } from 'lucide-react'
import { DataTable, Badge, Button, EmptyState, CardSkeleton, type Column } from '@unifiedtree/ui-kit'
import { useToast } from '@/shared/hooks/useToast'
import { useMyPayslips, downloadMyPayslipPdf, statusTone, inr2, type MyPayslip } from '../api/usePayrollRuns'

export const EmployeePayslips: React.FC = () => {
  const { toast } = useToast()
  const { data = [], isLoading } = useMyPayslips()

  if (isLoading) return <div className="max-w-3xl mx-auto p-6 sm:p-8"><CardSkeleton /></div>

  const columns: Column<MyPayslip>[] = [
    { key: 'period', header: 'Period', cell: (r) => <span className="font-semibold text-slate-900">{r.period}</span> },
    { key: 'net', header: 'Net pay', cell: (r) => inr2(r.netPay) },
    { key: 'status', header: 'Status', cell: (r) => <Badge tone={statusTone[r.status]}>{r.status}</Badge>, hideBelow: 'sm' },
    { key: 'actions', header: '', cell: (r) => (
      r.status === 'LOCKED'
        ? <Button variant="ghost" onClick={async () => {
            try { await downloadMyPayslipPdf(r.runId) } catch (e) { toast((e as Error).message, 'error') }
          }}><Download size={15} /> PDF</Button>
        : <span className="text-xs text-slate-400">Not finalized</span>
    ) },
  ]

  return (
    <div className="max-w-3xl mx-auto p-6 sm:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 font-heading tracking-tight">My Payslips</h1>
        <p className="text-sm text-slate-500 mt-1">Download payslips for finalized payroll periods.</p>
      </div>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No payslips yet"
          description="Payslips appear here once payroll is locked for a period." />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <DataTable columns={columns} data={data} getRowKey={(r) => r.runId} />
        </div>
      )}
    </div>
  )
}
