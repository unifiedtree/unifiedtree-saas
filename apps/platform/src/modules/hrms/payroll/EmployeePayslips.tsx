// My payslips (/me/payslips) in the module kit's style: this year's totals,
// then one row per payroll month. A final month opens the design's payslip
// drawer with its real lines (GET /v1/payroll/payslips/me/{runId}, own payslip
// only) and the PDF.
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import { PayslipDrawer, type Payslip } from '@/design/dc/PayslipDrawer'
import { ModulePage, StatRow, State, RowList, Row, SubHeading, Note, useDesignToast } from '@/design/module/ModuleKit'
import { useMyPayslips, useMyPayslip, downloadMyPayslipPdf, inr2, type MyPayslip } from '../api/usePayrollRuns'

const STATUS: Record<MyPayslip['status'], [string, PillTone]> = { DRAFT: ['Being prepared', 'gray'], PROCESSING: ['Being prepared', 'info'], LOCKED: ['Final', 'ok'], PAID: ['Paid', 'ok'], CANCELLED: ['Cancelled', 'red'] }
const ready = (s: MyPayslip['status']) => s === 'LOCKED' || s === 'PAID'

export function EmployeePayslips() {
  const navigate = useNavigate()
  const canSalary = usePermission(P.PAYROLL_STRUCTURE_READ_SELF)
  const q = useMyPayslips()
  const { show, node } = useDesignToast()
  const [open, setOpen] = useState<MyPayslip | null>(null)
  const [downloading, setDownloading] = useState(false)
  const slipQ = useMyPayslip(open?.runId ?? null)
  const rows = [...(q.data ?? [])].sort((a, b) => (b.periodYear ?? 0) - (a.periodYear ?? 0) || (b.periodMonth ?? 0) - (a.periodMonth ?? 0))
  const year = new Date().getFullYear()
  const thisYear = rows.filter((r) => r.periodYear === year && ready(r.status))
  const latest = rows.find((r) => ready(r.status))
  const sum = (k: 'netPay' | 'gross' | 'totalDeductions') => thisYear.reduce((a, r) => a + Number(r[k] ?? 0), 0)
  const pdf = async (r: MyPayslip) => {
    setDownloading(true)
    try { await downloadMyPayslipPdf(r.runId); show(`Payslip for ${r.period} downloaded`) } catch (e) { show('Couldn’t download the payslip', true, (e as Error).message) } finally { setDownloading(false) }
  }
  const d = slipQ.data
  const slip: Payslip | null = d ? {
    name: d.employeeName, code: d.employeeCode, role: d.designation || 'Employee', dept: d.department || '—',
    paidDays: d.paidDays ?? null, workingDays: d.totalDays ?? null, lop: d.lopDays ?? null, pan: d.panMasked || null, bank: d.bankMasked || null,
    earnings: d.earnings.map((l) => [l.name, Number(l.amount || 0)] as [string, number]), deductions: d.deductions.map((l) => [l.name, Number(l.amount || 0)] as [string, number]),
    gross: Number(d.gross || 0), ded: Number(d.totalDeductions || 0), net: Number(d.netPay || 0),
  } : null
  return (
    <ModulePage crumb="My workspace" title="Payslips" subtitle="Your pay for each month, once payroll is final."
      actions={canSalary ? <HrButton variant="ghost" onClick={() => navigate('/me/salary')}>{dashIcon('rupee', 15)} Salary structure</HrButton> : undefined}>
      {q.isLoading ? <State kind="loading" height={120} />
        : q.error ? <State kind="error" title="Couldn’t load your payslips" description={(q.error as Error).message} onRetry={() => q.refetch()} />
          : rows.length === 0 ? <State kind="empty" icon="receipt" title="No payslips yet" description="A payslip appears here once payroll is final for a month." />
            : (
              <div style={{ display: 'grid', gap: 16 }}>
                <StatRow tiles={[
                  { icon: 'rupee', color: 'green', label: 'Latest take-home', value: latest ? inr2(latest.netPay) : '—', sub: latest ? latest.period : 'No final payslip yet', onClick: latest ? () => setOpen(latest) : undefined, tip: latest ? `Opens your ${latest.period} payslip` : undefined },
                  { icon: 'chart', color: 'blue', label: `Take-home in ${year}`, value: inr2(sum('netPay')), sub: `${thisYear.length} ${thisYear.length === 1 ? 'month' : 'months'}` },
                  { icon: 'banknote', color: 'teal', label: `Gross in ${year}`, value: inr2(sum('gross')), sub: 'Before deductions' },
                  { icon: 'receipt', color: 'orange', label: `Deductions in ${year}`, value: inr2(sum('totalDeductions')), sub: 'PF, ESI, tax and others' },
                ]} />
                <SubHeading>Every month</SubHeading>
                <RowList>
                  {rows.map((r) => {
                    const [lab, tone] = STATUS[r.status] || [r.status, 'gray' as PillTone]
                    const paid = r.paidDays == null ? null : `${Number(r.paidDays).toFixed(0)} paid days${r.lopDays ? ` · ${Number(r.lopDays).toFixed(0)} unpaid` : ''}`
                    return (
                      <Row key={r.runId}
                        onClick={ready(r.status) ? () => setOpen(r) : undefined}
                        lead={<span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 11, background: '#ecfdf5', border: '1px solid #d1fae5', color: '#0f6e56', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('receipt', 17)}</span>}
                        title={r.period}
                        meta={[paid, r.gross == null ? null : `Gross ${inr2(r.gross)}`, r.totalDeductions == null ? null : `Deductions ${inr2(r.totalDeductions)}`].filter(Boolean).join(' · ')}
                        trail={<>
                          <strong style={{ fontSize: 15, color: '#0f6e56', fontVariantNumeric: 'tabular-nums' }}>{inr2(r.netPay)}</strong>
                          <HrStatusPill tone={tone}>{lab}</HrStatusPill>
                          {ready(r.status)
                            ? <HrButton size="sm" variant="ghost" onClick={(e: MouseEvent) => { e.stopPropagation(); pdf(r) }}>{dashIcon('download', 14)} PDF</HrButton>
                            : <span style={{ fontSize: 12, color: '#94a3b8' }}>PDF when final</span>}
                        </>} />
                    )
                  })}
                </RowList>
                <Note>Totals count final and paid months only. Open a month to see every earning and deduction; the PDF has the same breakdown.</Note>
              </div>
            )}
      {open && (
        <PayslipDrawer slip={slip} runLabel={open.period} final
          loading={slipQ.isLoading} error={slipQ.isError ? 'Your payslip for this month couldn’t be loaded. Try again in a moment.' : null}
          onRetry={() => { slipQ.refetch() }} onClose={() => setOpen(null)}
          onDownload={() => pdf(open)} downloading={downloading} />
      )}
      {node}
    </ModulePage>
  )
}
