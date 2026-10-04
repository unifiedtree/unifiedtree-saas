// My payslips (/me/payslips) — the P-MYPAY design (EmpPay.dc.html e-slips).
// A left column lists every month (period, net); the right article shows the
// selected month's payslip (gross/deductions ledger + "Where your pay went" bar
// + Download PDF + "Ask payroll"). Below, the pay schedule, "being prepared"
// month and this financial year's totals. The AmountMask kit piece hides every
// figure when the viewer turns "Hide amounts" on. Nothing invented: hooks pull
// real BW-55 data, and the month being prepared has NO figures.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { AmountMask, AmountToggle } from '@/design/kit/AmountMask'
import { Button, PageFrame, PageHeader, Skeleton, EmptyState, errorText } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import {
  downloadMyPayslipPdf, inr, useMyPayslip, useMyPayslips, type MyPayslip,
} from '../api/usePayrollRuns'
import { AskPayrollCard } from './my/AskPayrollCard'
import { PayScheduleCard } from './my/PayScheduleCard'
import { YtdCard } from './my/YtdCard'
import { UpcomingMonthCard } from './my/UpcomingMonthCard'

const STATUS: Record<MyPayslip['status'], { label: string; tone: 'ok' | 'warn' | 'red' | 'gray' | 'info' }> = {
  DRAFT: { label: 'Draft', tone: 'gray' },
  PROCESSING: { label: 'Being prepared', tone: 'info' },
  LOCKED: { label: 'Final', tone: 'ok' },
  PAID: { label: 'Paid', tone: 'ok' },
  CANCELLED: { label: 'Cancelled', tone: 'red' },
}

const final = (s: MyPayslip['status']) => s === 'LOCKED' || s === 'PAID'

function MonthList({
  rows, selected, onPick, hide,
}: { rows: MyPayslip[]; selected: string | null; onPick: (r: MyPayslip) => void; hide: boolean }) {
  if (rows.length === 0) return null
  return (
    <nav aria-label="Months" style={{
      padding: 8, borderRadius: 18, background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)',
      display: 'flex', flexDirection: 'column', gap: 2, boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))',
    }}>
      {rows.map((r) => {
        const on = r.runId === selected
        const ready = final(r.status)
        return (
          <button type="button" key={r.runId} onClick={() => onPick(r)}
            aria-pressed={on} aria-current={on ? 'true' : undefined}
            style={{
              position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 10, padding: '12px 14px', border: 0, borderRadius: 12, cursor: 'pointer',
              background: on ? 'var(--u-brs,#E8F3EE)' : 'transparent',
              color: 'inherit', textAlign: 'left', fontFamily: 'inherit',
            }}>
            <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 500 }}>{r.period}</span>
              <span style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>
                {ready
                  ? r.payDate ? `Credited ${r.payDate.slice(0, 10)}` : 'Final'
                  : STATUS[r.status]?.label ?? r.status}
              </span>
            </span>
            <span style={{ fontSize: 14, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
              {ready
                ? <AmountMask value={inr(Number(r.netPay))} hidden={hide} label={`${r.period} take-home`} />
                : <span style={{ color: 'var(--u-ink3,#6A7A73)', fontSize: 12 }}>Being prepared</span>}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

function SlipArticle({ slip, hide, loading, error, onRetry, onDownload, downloading }: {
  slip: MyPayslip | null
  hide: boolean
  loading: boolean
  error: unknown
  onRetry: () => void
  onDownload: () => void
  downloading: boolean
}) {
  const detailQ = useMyPayslip(slip?.runId ?? null)
  const d = detailQ.data
  if (!slip) return null
  const anyLoading = loading || detailQ.isLoading
  const anyError = error || detailQ.error
  return (
    <article aria-label="Payslip" style={{
      flex: '3 1 520px', minWidth: 0, borderRadius: 18, background: 'var(--u-sf,#fff)',
      border: '1px solid var(--u-ln,#E3E9E6)', boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))', overflow: 'hidden',
    }}>
      <header style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between',
        gap: 16, padding: '20px 22px', background: 'color-mix(in oklab,#12805F 6%,var(--u-sf,#fff))',
        boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)', color: 'var(--u-ink,#0E1B16)',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>{slip.period} · take-home</div>
          <div style={{ marginTop: 4, fontSize: 38, lineHeight: 1.05, fontWeight: 500, letterSpacing: '-.03em' }}>
            <AmountMask value={inr(Number(slip.netPay))} hidden={hide} label="Take-home" />
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: 'var(--u-ink2,#4A5A54)' }}>
            {slip.paidAt
              ? `Credited ${slip.paidAt.slice(0, 10)}${d?.bankMasked ? ` to ${d.bankMasked}` : ''}`
              : slip.payDate
                ? `Expected pay date ${slip.payDate.slice(0, 10)}`
                : final(slip.status) ? 'Final payslip' : STATUS[slip.status]?.label}
            {slip.notes?.find((n) => n.kind === 'ADVANCE_RECOVERY') && (
              <> · includes advance recovery <AmountMask value={inr(Number(slip.notes.find((n) => n.kind === 'ADVANCE_RECOVERY')?.amount ?? 0))} hidden={hide} /></>
            )}
          </div>
        </div>
        <Button onClick={onDownload} loading={downloading} aria-label="Download PDF">Download PDF</Button>
      </header>
      {anyLoading ? (
        <div style={{ padding: 22 }}><Skeleton height={160} /></div>
      ) : anyError ? (
        <div style={{ padding: 22 }}>
          <EmptyState title="Couldn’t load this payslip" hint={errorText(anyError)}
            action={<Button variant="secondary" onClick={onRetry}>Try again</Button>} variant="plain" />
        </div>
      ) : d ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: '0 28px', padding: '10px 22px 4px' }}>
            <div>
              <div style={{ padding: '10px 0', fontSize: 12.5, fontWeight: 500, color: 'var(--u-ink3,#6A7A73)', boxShadow: 'inset 0 -1px 0 var(--u-ln,#E3E9E6)' }}>Earnings</div>
              {(d.earnings || []).map((l) => (
                <div key={`e-${l.code}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', fontSize: 13.5, boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)' }}>
                  <span style={{ color: 'var(--u-ink2,#4A5A54)' }}>{l.name}</span>
                  <span style={{ fontWeight: 500 }}><AmountMask value={inr(Number(l.amount))} hidden={hide} /></span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontSize: 14, fontWeight: 600 }}>
                <span>Gross</span>
                <span><AmountMask value={inr(Number(d.gross))} hidden={hide} /></span>
              </div>
            </div>
            <div>
              <div style={{ padding: '10px 0', fontSize: 12.5, fontWeight: 500, color: 'var(--u-ink3,#6A7A73)', boxShadow: 'inset 0 -1px 0 var(--u-ln,#E3E9E6)' }}>Deductions</div>
              {(d.deductions || []).map((l) => (
                <div key={`d-${l.code}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', fontSize: 13.5, boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)' }}>
                  <span style={{ color: 'var(--u-ink2,#4A5A54)' }}>{l.name}</span>
                  <span style={{ fontWeight: 500 }}><AmountMask value={inr(Number(l.amount))} hidden={hide} /></span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', fontSize: 13, color: 'var(--u-ink3,#6A7A73)', boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)' }}>
                <span>Income tax (TDS)</span>
                <span>Not calculated yet</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontSize: 14, fontWeight: 600 }}>
                <span>Total deductions</span>
                <span><AmountMask value={inr(Number(d.totalDeductions))} hidden={hide} /></span>
              </div>
            </div>
          </div>
          <footer style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px 16px', padding: '14px 22px', background: 'var(--u-sf2,#F7F9F8)', boxShadow: 'inset 0 1px 0 var(--u-ln2,#EDF1EF)', fontSize: 13, color: 'var(--u-ink2,#4A5A54)' }}>
            <span>
              Paid for {d.paidDays ?? '—'} of {d.totalDays ?? slip.totalDays ?? '—'} days
              {d.lopDays != null && Number(d.lopDays) > 0 ? ` · ${d.lopDays} unpaid` : ' · no loss of pay'}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>Scroll down to Ask payroll if something looks wrong.</span>
          </footer>
        </>
      ) : null}
    </article>
  )
}

// The routes render this page directly (not through PayrollContainer), so it
// brings its own PageFrame: the self-service width and the page gutter.
export function EmployeePayslips() {
  return <PageFrame label="My payslips" width="narrow"><MyPayslipsBody /></PageFrame>
}

function MyPayslipsBody() {
  const navigate = useNavigate()
  const canSalary = usePermission(P.PAYROLL_STRUCTURE_READ_SELF)
  const list = useMyPayslips()
  const toast = useToast()
  const [hide, setHide] = useState(false)
  const [monthly, setMonthly] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const rows = useMemo(() => {
    const sorted = [...(list.data ?? [])].sort((a, b) =>
      (b.periodYear ?? 0) - (a.periodYear ?? 0) || (b.periodMonth ?? 0) - (a.periodMonth ?? 0))
    return sorted
  }, [list.data])

  useEffect(() => {
    if (!sel && rows.length > 0) {
      const latestFinal = rows.find((r) => final(r.status))
      setSel((latestFinal ?? rows[0]).runId)
    }
  }, [rows, sel])

  const selected = useMemo(() => rows.find((r) => r.runId === sel) ?? null, [rows, sel])

  const pdf = async (r: MyPayslip) => {
    setDownloading(true)
    try {
      await downloadMyPayslipPdf(r.runId)
      toast.success(`Payslip for ${r.period} downloaded`)
    } catch (err) {
      toast.error((err as Error).message || 'Couldn’t download the payslip')
    } finally {
      setDownloading(false)
    }
  }

  const header = (
    <PageHeader
      size="page"
      title="Payslips"
      sub="Every month’s pay, what was added and what was taken out."
      actions={
        <>
          <div role="group" aria-label="Show amounts" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--u-hv,#F0F4F2)' }}>
            {(['Monthly', 'Yearly'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setMonthly(v === 'Monthly')} aria-pressed={monthly === (v === 'Monthly')}
                style={{
                  height: 30, padding: '0 14px', border: 0, borderRadius: 999, cursor: 'pointer',
                  background: monthly === (v === 'Monthly') ? 'var(--u-sf,#fff)' : 'transparent',
                  boxShadow: monthly === (v === 'Monthly') ? '0 1px 2px rgba(14,27,22,.1)' : 'none',
                  fontSize: 13, fontWeight: 500, color: monthly === (v === 'Monthly') ? 'var(--u-ink,#0E1B16)' : 'var(--u-ink2,#4A5A54)',
                }}>{v}</button>
            ))}
          </div>
          <AmountToggle hidden={hide} onToggle={setHide} controls="my-payslips-amounts" />
          {canSalary && (
            <Button variant="ghost" onClick={() => navigate('/me/salary')}>Salary structure</Button>
          )}
        </>
      }
    />
  )

  if (list.isLoading) {
    return <div style={{ display: 'grid', gap: 16 }}>{header}<Skeleton height={240} /></div>
  }
  if (list.error) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {header}
        <EmptyState title="Couldn’t load your payslips" hint={errorText(list.error)}
          action={<Button variant="secondary" onClick={() => list.refetch()}>Try again</Button>} />
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div style={{ display: 'grid', gap: 16 }}>
        {header}
        <EmptyState icon="receipt" title="No payslips yet" hint="A payslip appears here once payroll is final for a month." />
        <PayScheduleCard />
        <UpcomingMonthCard />
      </div>
    )
  }

  return (
    <div id="my-payslips-amounts" style={{ display: 'grid', gap: 20 }}>
      {header}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px', minWidth: 0, maxWidth: 340 }}>
          <MonthList rows={rows} selected={sel} onPick={(r) => setSel(r.runId)} hide={hide} />
        </div>
        <SlipArticle slip={selected} hide={hide}
          loading={list.isFetching} error={null} onRetry={() => list.refetch()}
          onDownload={() => selected && pdf(selected)} downloading={downloading} />
      </div>
      <PayScheduleCard />
      <UpcomingMonthCard />
      <YtdCard hideAmounts={hide} monthly={monthly} />
      {selected && final(selected.status) && <AskPayrollCard runId={selected.runId} periodLabel={selected.period} />}
    </div>
  )
}
