// My payslips → "being prepared". Lists the month(s) with a DRAFT/PROCESSING run.
// Shows the period and the pay date only; NEVER a figure (draft numbers can
// change). Source: GET /v1/payroll/payslips/me/upcoming (BW-55).
import { Section, StatusPill } from '@/design/kit/display'
import { fmtShort } from '@/design/dc/dates'
import { useMyUpcoming } from '../../api/usePayrollRuns'

export function UpcomingMonthCard() {
  const q = useMyUpcoming()
  const rows = q.data ?? []
  if (!q.isLoading && !q.error && rows.length === 0) return null
  return (
    <Section title="Being prepared" sub="Payroll hasn’t finished for this month yet. No figures until it’s final."
      loading={q.isLoading} error={q.error} onRetry={() => { q.refetch() }} spot={false} rise={false}>
      <div style={{ display: 'grid', gap: 8 }}>
        {rows.map((r) => (
          <div key={`${r.periodYear}-${r.periodMonth}`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 14px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 12, background: 'var(--u-sf2,#F7F9F8)' }}>
            <div style={{ display: 'grid', gap: 2 }}>
              <strong style={{ fontSize: 14, color: 'var(--u-ink,#0E1B16)' }}>{r.period}</strong>
              {r.payDate && <span style={{ fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>Expected pay date {fmtShort(r.payDate)}</span>}
            </div>
            <StatusPill tone="info">Being prepared</StatusPill>

          </div>
        ))}
      </div>
    </Section>
  )
}
