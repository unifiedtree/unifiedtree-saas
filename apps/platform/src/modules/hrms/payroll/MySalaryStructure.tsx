// My salary (/me/salary) in the module kit's style: CTC, gross, deductions
// and take-home for a full month, then every earning and deduction. The
// server runs the payroll engine over a full month with no loss of pay, so
// these are the figures a month with full attendance pays.
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { dashIcon } from '@/design/dc/icons'
import { ModulePage, StatRow, State, Panel, Note, dmy, CARD } from '@/design/module/ModuleKit'
import { useMySalaryStructure, type StructureLine } from '../api/usePayroll'

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

function Breakdown({ title, rows, total, tone }: { title: string; rows: StructureLine[]; total?: number; tone: 'green' | 'red' }) {
  if (!rows.length) return null
  const th = { textAlign: 'left' as const, padding: '10px 16px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase' as const, color: '#64748b', borderBottom: '1px solid #f1f5f9' }
  const td = { padding: '11px 16px', fontSize: 13.5, borderBottom: '1px solid #f8fafc', fontVariantNumeric: 'tabular-nums' as const }
  return (
    <Panel title={title} pad={0} style={{ gap: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 420 }}>
          <thead><tr><th style={th}>Component</th><th style={{ ...th, textAlign: 'right' }}>Monthly</th><th style={{ ...th, textAlign: 'right' }}>Yearly</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.componentCode}>
                <td style={{ ...td, fontWeight: 600 }}>{r.componentName}{r.category !== 'EARNING' && r.category !== 'DEDUCTION' && <span style={{ marginLeft: 8 }}><HrStatusPill tone="info">{r.category.replace('_', ' ').toLowerCase()}</HrStatusPill></span>}</td>
                <td style={{ ...td, textAlign: 'right' }}>{inr(r.monthlyAmount)}</td>
                <td style={{ ...td, textAlign: 'right', color: '#64748b' }}>{inr(r.monthlyAmount * 12)}</td>
              </tr>
            ))}
            {total != null && (
              <tr style={{ background: '#f8fafc' }}>
                <td style={{ ...td, fontWeight: 800 }}>Total</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: tone === 'green' ? '#0f6e56' : '#b91c1c' }}>{inr(total)}</td>
                <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{inr(total * 12)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

export function MySalaryStructure() {
  const navigate = useNavigate()
  const canPayslips = usePermission(P.PAYROLL_PAYSLIP_READ_SELF)
  const q = useMySalaryStructure()
  const d = q.data
  return (
    <ModulePage crumb="My workspace" title="Salary" subtitle={d ? `Your salary structure, effective ${dmy(d.effectiveFrom)}.` : 'Your salary structure.'}
      actions={canPayslips ? <HrButton variant="ghost" onClick={() => navigate('/me/payslips')}>{dashIcon('receipt', 15)} Payslips</HrButton> : undefined}>
      {q.isLoading ? <State kind="loading" height={120} />
        : q.error ? <State kind="error" title="Couldn’t load your salary" description="Please try again in a moment." onRetry={() => q.refetch()} />
          : !d ? <State kind="empty" icon="rupee" title="No salary structure yet" description="HR hasn’t set up your salary yet. Ask them if you think this is a mistake." />
            : (
              <div style={{ display: 'grid', gap: 16 }}>
                <StatRow tiles={[
                  { icon: 'rupee', color: 'orange', label: 'Annual CTC', value: inr(d.ctcAnnual), sub: `${inr(d.ctcMonthly)} a month` },
                  { icon: 'banknote', color: 'green', label: 'Gross a month', value: inr(d.grossMonthly ?? d.ctcMonthly), sub: 'Before deductions' },
                  { icon: 'receipt', color: 'red', label: 'Deductions a month', value: inr(d.totalDeductions ?? 0), sub: 'PF, ESI, professional tax…' },
                  { icon: 'creditCard', color: 'blue', label: 'Take-home a month', value: inr(d.netMonthly ?? d.ctcMonthly), sub: 'With full attendance' },
                ]} />
                <div style={{ ...CARD, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Also on your structure:</span>
                  <HrStatusPill tone="info">{`Tax regime: ${d.taxRegime === 'NEW' ? 'New' : d.taxRegime === 'OLD' ? 'Old' : d.taxRegime}`}</HrStatusPill>
                  <HrStatusPill tone={d.pfApplicable ? 'ok' : 'gray'}>{d.pfApplicable ? `PF · ${String(d.pfStatus || '').toLowerCase().replace(/_/g, ' ') || 'applies'}` : 'PF not applicable'}</HrStatusPill>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,380px),1fr))', gap: 16, alignItems: 'start' }}>
                  <Breakdown title="Earnings" rows={d.earnings ?? d.lines} total={d.grossMonthly} tone="green" />
                  <Breakdown title="Deductions" rows={d.deductions ?? []} total={d.totalDeductions} tone="red" />
                </div>
                <Note>These are full-month figures. Each payslip is pro-rated by paid days, so a month with unpaid leave pays less. Ask HR if something looks wrong.</Note>
              </div>
            )}
    </ModulePage>
  )
}
