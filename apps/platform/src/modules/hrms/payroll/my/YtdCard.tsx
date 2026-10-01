// My payslips → "This financial year". Totals over my own LOCKED/PAID payslips.
// Source: GET /v1/payroll/payslips/me/ytd (BW-55). TDS stays "Not calculated yet"
// until payroll writes a TDS line (as it does on the payslip ledger). Monthly or
// Yearly stays on the money shown; nothing is averaged.
import { AmountMask } from '@/design/kit/AmountMask'
import { Section } from '@/design/kit/display'
import { useMyPayYtd, inr } from '../../api/usePayrollRuns'

export interface YtdCardProps {
  hideAmounts: boolean
  /** When true, show per-month averages instead of financial-year totals. */
  monthly: boolean
}

export function YtdCard({ hideAmounts, monthly }: YtdCardProps) {
  const q = useMyPayYtd()
  const d = q.data
  const payslips = Number(d?.payslips ?? 0)
  const divide = (v: number) => (monthly && payslips > 0 ? v / payslips : v)
  const windowLabel = d && d.fromPeriod && d.toPeriod
    ? `${d.fromPeriod}–${d.toPeriod}`
    : d?.label ?? ''
  const tiles: { k: string; v: number | null; tds?: boolean }[] = [
    { k: 'Gross', v: d ? divide(Number(d.gross)) : null },
    { k: 'Deductions', v: d ? divide(Number(d.deductions)) : null },
    { k: 'Take-home', v: d ? divide(Number(d.net)) : null },
    { k: 'Income tax (TDS)', v: d?.tds == null ? null : divide(Number(d.tds)), tds: true },
  ]
  return (
    <Section title="This financial year"
      sub={d ? `${windowLabel} · ${payslips} final ${payslips === 1 ? 'payslip' : 'payslips'}${monthly ? ' · an average month' : ''}` : windowLabel}
      loading={q.isLoading} error={q.error} onRetry={() => { q.refetch() }}
      empty={!q.isLoading && !q.error && !d ? { title: 'No final payslips yet' } : undefined}
      spot={false} rise={false}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}>
        {tiles.map((t) => (
          <div key={t.k} style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)' }}>
            <div style={{ fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>{t.k}{windowLabel ? ` · ${windowLabel}` : ''}</div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 500, color: 'var(--u-ink,#0E1B16)', fontVariantNumeric: 'tabular-nums' }}>
              {t.tds && t.v === null
                ? <span style={{ color: 'var(--u-ink3,#6A7A73)', fontSize: 14 }}>Not calculated yet</span>
                : <AmountMask value={t.v == null ? '—' : inr(t.v)} hidden={hideAmounts && t.v != null} label={t.k} />}
            </div>
          </div>
        ))}
      </div>
    </Section>
  )
}
