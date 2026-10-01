// My salary (/me/salary) — the P-MYPAY design (EmpPay.dc.html e-salary).
// Left: a wide "Salary structure" card with CTC, Monthly/Yearly pill and a
// stacked bar of components with their monthly or yearly values and % of CTC.
// Right: "From CTC to take-home" progress bars (gross → tax → take-home) and
// "Salary history" from GET /v1/payroll/structures/me/history (BW-56). Monthly
// numbers come from the server-run engine; Yearly multiplies by 12. The
// AmountMask kit piece hides every figure when the viewer toggles amounts off.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { AmountMask, AmountToggle } from '@/design/kit/AmountMask'
import { Button, EmptyState, PageHeader, Section, Skeleton, StatusPill, errorText } from '@/design/kit/display'
import { useMySalaryStructure, type StructureLine } from '../api/usePayroll'
import { useMyStructureHistory, inr } from '../api/usePayrollRuns'
import { fmtShort } from '@/design/dc/dates'

const COMPONENT_TONE: Record<string, string> = {
  BASIC: 'var(--u-br,#0F6E56)',
  HRA: 'var(--u-g2,#5FB39C)',
  CONVEYANCE: 'var(--u-g3,#A9D6C6)',
  SPECIAL_ALLOWANCE: 'var(--u-g3,#A9D6C6)',
  SPECIAL: 'var(--u-g3,#A9D6C6)',
  MEDICAL: 'var(--u-gd,#C8912E)',
  LTA: 'var(--u-gd,#C8912E)',
  FOOD: 'var(--u-gd,#C8912E)',
  OTHER: 'var(--u-gy,#C9D2CE)',
}
const toneFor = (code: string) => COMPONENT_TONE[code.toUpperCase()] ?? COMPONENT_TONE.OTHER

function StackedBar({ segments }: { segments: { pct: number; fill: string; label: string }[] }) {
  let x = 0
  return (
    <svg width="100%" height="16" style={{ display: 'block' }} role="img" aria-label="Salary breakdown">
      {segments.map((s, i) => {
        const left = x
        x += s.pct
        return <rect key={i} x={`${left}%`} width={`${s.pct}%`} height={16} fill={s.fill}><title>{`${s.label} · ${s.pct.toFixed(1)}%`}</title></rect>
      })}
    </svg>
  )
}

function Flow({ ctc, gross, employerContrib, deductions, net, hide }: {
  ctc: number; gross: number; employerContrib: number; deductions: number; net: number; hide: boolean
}) {
  const items: { k: string; v: number; fill: string }[] = [
    { k: 'Cost to company', v: ctc, fill: 'var(--u-br,#0F6E56)' },
    { k: 'Employer PF, gratuity and health cover', v: employerContrib, fill: 'var(--u-gy,#C9D2CE)' },
    { k: 'Gross pay', v: gross, fill: 'var(--u-g3,#A9D6C6)' },
    { k: 'Tax, PF and professional tax', v: deductions, fill: 'var(--u-gd,#C8912E)' },
    { k: 'Take-home', v: net, fill: 'var(--u-br,#0F6E56)' },
  ].filter((x) => x.v > 0)
  const max = ctc || 1
  return (
    <Section title="From CTC to take-home" rise={false} spot={false}>
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((f, i) => (
          <div key={f.k} style={{ display: 'grid', gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
              <span style={{ color: 'var(--u-ink2,#4A5A54)' }}>{f.k}</span>
              <span style={{ fontWeight: 500 }}>
                {i === 1 || i === 3 ? '− ' : ''}
                <AmountMask value={inr(f.v)} hidden={hide} />
              </span>
            </div>
            <svg width="100%" height="6" style={{ display: 'block' }}>
              <rect width="100%" height={6} rx={3} fill="var(--u-hv,#F0F4F2)" />
              <rect width={`${(f.v / max) * 100}%`} height={6} rx={3} fill={f.fill} />
            </svg>
          </div>
        ))}
      </div>
    </Section>
  )
}

function History({ hide }: { hide: boolean }) {
  const q = useMyStructureHistory()
  const rows = q.data ?? []
  return (
    <Section title="Salary history" sub="Every revision to your structure, newest first"
      loading={q.isLoading} error={q.error} onRetry={() => { q.refetch() }}
      empty={!q.isLoading && !q.error && rows.length === 0 ? { title: 'No revisions yet' } : undefined}
      spot={false} rise={false}>
      <div style={{ display: 'grid' }}>
        {rows.map((r, i) => {
          const prev = rows[i + 1]
          const change = prev?.ctcAnnual && r.ctcAnnual != null ? ((Number(r.ctcAnnual) - Number(prev.ctcAnnual)) / Number(prev.ctcAnnual)) * 100 : null
          return (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>
                  <AmountMask value={r.ctcAnnual != null ? `${inr(Number(r.ctcAnnual))} a year` : '—'} hidden={hide} /> {r.current && <StatusPill tone="success">Current</StatusPill>}
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>
                  Effective {fmtShort(r.effectiveFrom)}{r.reason ? ` · ${r.reason}` : ''}
                </div>
              </div>
              {change !== null && Math.abs(change) >= 0.1 && (
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, color: change > 0 ? 'var(--u-brt,#0F6E56)' : 'var(--u-rdt,#B42318)',
                  background: change > 0 ? 'var(--u-brs,#E8F3EE)' : 'var(--u-rds,#FCEDEB)', borderRadius: 999, padding: '0 9px', lineHeight: '22px' }}>
                  {change > 0 ? '+' : ''}{change.toFixed(1)}%
                </span>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}

export function MySalaryStructure() {
  const navigate = useNavigate()
  const canPayslips = usePermission(P.PAYROLL_PAYSLIP_READ_SELF)
  const q = useMySalaryStructure()
  const d = q.data
  const [hide, setHide] = useState(false)
  const [yearly, setYearly] = useState(false)

  const earnings = useMemo<StructureLine[]>(() => (d?.earnings ?? d?.lines ?? []).filter((l) => l.category === 'EARNING' || l.category === 'REIMBURSEMENT'), [d])
  const ctcAnnual = Number(d?.ctcAnnual ?? 0)
  const ctcMonthly = Number(d?.ctcMonthly ?? 0)
  const grossMonthly = Number(d?.grossMonthly ?? ctcMonthly)
  const totalDeductions = Number(d?.totalDeductions ?? 0)
  const netMonthly = Number(d?.netMonthly ?? grossMonthly - totalDeductions)
  const employerContrib = Number(d?.employerContribMonthly ?? 0)
  const mult = yearly ? 12 : 1
  const splitBase = ctcMonthly || grossMonthly || 1
  const bars = earnings.map((e) => ({
    pct: (Number(e.monthlyAmount) / splitBase) * 100,
    label: e.componentName,
    fill: toneFor(e.componentCode),
  }))

  const header = (
    <PageHeader size="page" title="Salary"
      sub="What you earn, how it’s split, and how it turns into take-home pay."
      actions={<>
        <AmountToggle hidden={hide} onToggle={setHide} controls="my-salary-amounts" />
        {canPayslips && (
          <Button variant="ghost" onClick={() => navigate('/me/payslips')}>Payslips</Button>
        )}
      </>}
    />
  )

  if (q.isLoading) return <div style={{ display: 'grid', gap: 16 }}>{header}<Skeleton height={240} /></div>
  if (q.error) return (
    <div style={{ display: 'grid', gap: 16 }}>
      {header}
      <EmptyState title="Couldn’t load your salary" hint={errorText(q.error)}
        action={<Button variant="secondary" onClick={() => q.refetch()}>Try again</Button>} />
    </div>
  )
  if (!d) return (
    <div style={{ display: 'grid', gap: 16 }}>
      {header}
      <EmptyState icon="rupee" title="No salary structure yet" hint="HR hasn’t set up your salary yet. Ask them if you think this is a mistake." />
    </div>
  )

  return (
    <div id="my-salary-amounts" style={{ display: 'grid', gap: 20 }}>
      {header}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section data-rise aria-label="Salary structure"
          style={{ flex: '3 1 520px', minWidth: 0, padding: '20px 22px', borderRadius: 18, background: 'var(--u-sf,#fff)', border: '1px solid var(--u-ln,#E3E9E6)', boxShadow: 'var(--u-shc,0 1px 2px rgba(14,27,22,.05))', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>Cost to company</div>
              <div style={{ marginTop: 2, fontSize: 34, lineHeight: 1.1, fontWeight: 500, letterSpacing: '-.02em' }}>
                <AmountMask value={inr(yearly ? ctcAnnual : ctcMonthly)} hidden={hide} label="CTC" />
              </div>
              <div style={{ marginTop: 4, fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>
                {yearly
                  ? <>a year · <AmountMask value={inr(ctcMonthly)} hidden={hide} /> a month</>
                  : <>a month · <AmountMask value={inr(ctcAnnual)} hidden={hide} /> a year</>}
              </div>
            </div>
            <div role="group" aria-label="Show amounts" style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: 'var(--u-hv,#F0F4F2)' }}>
              {(['Monthly', 'Yearly'] as const).map((v) => {
                const on = yearly === (v === 'Yearly')
                return (
                  <button key={v} type="button" onClick={() => setYearly(v === 'Yearly')} aria-pressed={on}
                    style={{ height: 30, padding: '0 14px', border: 0, borderRadius: 999, cursor: 'pointer',
                      background: on ? 'var(--u-sf,#fff)' : 'transparent', boxShadow: on ? '0 1px 2px rgba(14,27,22,.1)' : 'none',
                      fontSize: 13, fontWeight: 500, color: on ? 'var(--u-ink,#0E1B16)' : 'var(--u-ink2,#4A5A54)' }}>{v}</button>
                )
              })}
            </div>
          </div>
          <StackedBar segments={bars} />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {earnings.map((e) => {
              const monthly = Number(e.monthlyAmount)
              const pct = (monthly / splitBase) * 100
              return (
                <div key={e.componentCode}
                  style={{ display: 'grid', gridTemplateColumns: '12px minmax(0,1fr) auto 52px', alignItems: 'center', gap: 12, padding: '10px 0', boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)', fontSize: 13.5 }}>
                  <svg width={12} height={12}><rect width={12} height={12} rx={3} fill={toneFor(e.componentCode)} /></svg>
                  <span>{e.componentName}</span>
                  <span style={{ fontWeight: 500 }}>
                    <AmountMask value={inr(monthly * mult)} hidden={hide} label={e.componentName} />
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>{pct.toFixed(1)}%</span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <StatusPill tone="info">{`Tax regime · ${d.taxRegime === 'NEW' ? 'New' : 'Old'}`}</StatusPill>
            <StatusPill tone={d.pfApplicable ? 'success' : 'neutral'}>{d.pfApplicable ? `PF · ${String(d.pfStatus || 'applies').toLowerCase().replace(/_/g, ' ')}` : 'PF not applicable'}</StatusPill>
            <StatusPill tone="muted">Effective {fmtShort(d.effectiveFrom)}</StatusPill>
          </div>
        </section>
        <div style={{ flex: '2 1 340px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Flow ctc={ctcMonthly * mult} gross={grossMonthly * mult} employerContrib={employerContrib * mult} deductions={totalDeductions * mult} net={netMonthly * mult} hide={hide} />
          <History hide={hide} />
        </div>
      </div>
    </div>
  )
}
