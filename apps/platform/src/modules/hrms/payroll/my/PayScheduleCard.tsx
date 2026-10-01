// My payslips → the schedule tile. One date line: "Payroll is processed on {date}".
// Source: GET /v1/payroll/payslips/me/schedule (BW-55). Nothing is calculated here.
import { Section } from '@/design/kit/display'
import { useMyPaySchedule } from '../../api/usePayrollRuns'
import { fmtShort } from '@/design/dc/dates'

const DAY_SUFFIX = (d: number) => {
  if (d >= 11 && d <= 13) return 'th'
  const r = d % 10
  return r === 1 ? 'st' : r === 2 ? 'nd' : r === 3 ? 'rd' : 'th'
}

export function PayScheduleCard() {
  const q = useMyPaySchedule()
  const nextStr = q.data?.nextPayDate ? fmtShort(q.data.nextPayDate) : null
  const day = q.data?.processingDay ?? null
  const line = nextStr
    ? `Payroll is processed on ${nextStr}.`
    : day
      ? `Payroll is processed on the ${day}${DAY_SUFFIX(day)} of each month.`
      : 'Payroll is processed each month.'
  return (
    <Section title="Pay schedule" sub="When your next payslip is likely to land"
      loading={q.isLoading} error={q.error} onRetry={() => { q.refetch() }} spot={false} rise={false}>
      <p style={{ margin: 0, fontSize: 14.5, color: 'var(--u-ink,#0E1B16)' }}>{line}</p>
    </Section>
  )
}
