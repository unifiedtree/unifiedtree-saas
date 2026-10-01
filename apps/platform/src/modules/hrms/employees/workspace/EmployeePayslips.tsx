// Payroll tab: one person's payslips from LOCKED and PAID runs (BW-58, payroll.runs.read), newest
// first. A row downloads that month's payslip PDF through the run's existing endpoint.
//   GET /v1/payroll/employees/{id}/payslips    GET /v1/payroll/runs/{runId}/employees/{id}/payslip.pdf
import { useState } from 'react'
import { Button, IconTile, ListRow, ListRows, Section } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { downloadPayslipPdf } from '../../api/usePayrollRuns'
import { useEmployeePayslips } from '../api/useProfileData'
import { MONTH_NAMES, fmtDate, inr } from './profileFormat'

export function EmployeePayslips({ employeeId }: { employeeId: string }) {
  const toast = useToast()
  const q = useEmployeePayslips(employeeId, true)
  const [busy, setBusy] = useState<string | null>(null)
  const rows = [...(q.data ?? [])].sort((a, b) => (b.periodYear - a.periodYear) || (b.periodMonth - a.periodMonth))
  const forbidden = (q.error as { status?: number } | null)?.status === 403
  const get = async (runId: string) => {
    setBusy(runId)
    try { await downloadPayslipPdf(runId, employeeId) } catch (e) { toast.error('Couldn’t download the payslip', { detail: (e as Error)?.message }) } finally { setBusy(null) }
  }
  return (
    <Section title="Payslips" count={rows.length || undefined} sub="Months whose payroll is locked or paid." variant="section" body="list"
      loading={q.isLoading} error={forbidden ? undefined : q.error} onRetry={() => void q.refetch()}
      empty={forbidden ? { title: 'You can’t see payslips', hint: 'Payslips need the payroll runs permission.' } : rows.length === 0 ? { title: 'No payslips yet', hint: 'A payslip appears once a payroll run with this person is locked.' } : undefined}>
      <ListRows label="Payslips" inset>
        {rows.map((p) => {
          const lop = Number(p.lopDays || 0)
          const when = p.paidAt ? `Paid ${fmtDate(p.paidAt)}` : p.status === 'PAID' ? 'Paid' : p.payDate ? `Pay day ${fmtDate(p.payDate)}` : 'Locked'
          return (
            <ListRow key={p.runId} variant="hover" leading={<IconTile icon="fileText" tone="brand" size={34} />}
              title={`${MONTH_NAMES[p.periodMonth - 1]} ${p.periodYear}`} sub={`${when}${lop ? ` · ${lop} LOP` : ''}`}
              end={<span style={{ fontSize: 13.5, fontWeight: 500 }}>{inr(p.netPay)}</span>}
              actions={<Button size={30} variant="ghost" icon="download" loading={busy === p.runId} aria-label={`Download ${MONTH_NAMES[p.periodMonth - 1]} ${p.periodYear} payslip`} onClick={() => void get(p.runId)} />} />
          )
        })}
      </ListRows>
    </Section>
  )
}
