import React, { useEffect, useState } from 'react'
import { apiJson } from '@/core/api/client'
import { HrButton } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { SettingsSection, SettingsNote } from '@/design/settings/SettingsKit'

/** GET /v1/workspace/plan/breakdown (BillingBreakdownService). */
interface CompanyLine {
  companyId: string; name: string; legalName: string | null; gstin: string | null; pan: string | null
  address: string | null; employees: number; amountInr: number | null
}
export interface BillingBreakdown {
  business: { name: string; gstin: string | null; pan: string | null; address: string | null } | null
  billingCycle: 'MONTHLY' | 'ANNUAL' | null; status: string | null
  periodStart: string | null; periodEnd: string | null; pricePerSeatInr: number | null
  seatsBought: number; seatsUsed: number; amountInr: number | null
  companies: CompanyLine[]; unusedSeats: number; unusedSeatsAmountInr: number | null
  extraUsers: number; extraUsersAmountInr: number | null; note: string | null
}

const inr = (n: number | null | undefined) => n == null ? '—' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const day = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : ''
const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

/**
 * Billing by company (owner decision, 6 Oct 2026): one subscription and one autopay for the business
 * this week; this shows how the cycle's amount splits across its companies, each with its own name
 * and GSTIN. A breakdown, not a tax invoice — Razorpay emails the business's invoice for each charge.
 */
export const BillingByCompany: React.FC = () => {
  const [data, setData] = useState<BillingBreakdown | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    apiJson<BillingBreakdown>('/v1/workspace/plan/breakdown')
      .then((r) => { if (alive) setData(r) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  const period = data?.periodStart && data.periodEnd ? `${day(data.periodStart)} – ${day(data.periodEnd)}` : null
  const summary = failed ? 'Couldn’t load the breakdown'
    : !data ? 'Loading…'
      : `${data.companies.length} ${data.companies.length === 1 ? 'company' : 'companies'}${period ? ` · ${period}` : ''}`

  return (
    <SettingsSection id="by-company" icon="building" title="Billing by company" summary={summary}>
      {failed ? <SettingsNote tone="amber">We couldn’t load the breakdown just now. Try again in a moment.</SettingsNote>
        : !data ? <div role="status" aria-label="Loading the breakdown"><SkeletonBlock className="h-24 w-full rounded-xl" /></div>
          : (
            <>
              {data.note && <SettingsNote>{data.note}</SettingsNote>}
              <div style={{ overflowX: 'auto' }}>
                <table aria-label="Billing by company" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 12 }}>
                      <th style={{ padding: '8px 10px' }}>Company</th>
                      <th style={{ padding: '8px 10px' }}>GSTIN</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Employees</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.companies.map((c) => (
                      <tr key={c.companyId} style={{ borderTop: '1px solid #eef2f6' }}>
                        <td style={{ padding: '10px' }}><strong>{c.name}</strong>{c.legalName && c.legalName !== c.name && <div style={{ fontSize: 12, color: '#64748b' }}>{c.legalName}</div>}</td>
                        <td style={{ padding: '10px' }} className="tabular-nums">{c.gstin || <span style={{ color: '#94a3b8' }}>Not added</span>}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{c.employees}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{inr(c.amountInr)}</td>
                      </tr>
                    ))}
                    {data.unusedSeats > 0 && (
                      <tr style={{ borderTop: '1px solid #eef2f6', color: '#64748b' }}>
                        <td style={{ padding: '10px' }} colSpan={2}>Unused seats</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{data.unusedSeats}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{inr(data.unusedSeatsAmountInr)}</td>
                      </tr>
                    )}
                    {data.amountInr != null && (
                      <tr style={{ borderTop: '2px solid #e2e8f0', fontWeight: 700 }}>
                        <td style={{ padding: '10px' }} colSpan={2}>This {data.billingCycle === 'ANNUAL' ? 'year' : 'month'}{period ? ` (${period})` : ''}</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{data.seatsBought} seats</td>
                        <td style={{ padding: '10px', textAlign: 'right' }} className="tabular-nums">{inr(data.amountInr)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {data.extraUsers > 0 && (
                <SettingsNote tone="amber">
                  {data.extraUsers} more {data.extraUsers === 1 ? 'person' : 'people'} than the seats bought: {inr(data.extraUsersAmountInr)} is billed at the end of the cycle.
                </SettingsNote>
              )}
              <p style={{ fontSize: 12.5, color: '#64748b', margin: 0 }}>
                One subscription covers the whole business; this splits it by company. Razorpay emails the invoice for each charge.
              </p>
              <div><HrButton variant="ghost" onClick={() => printBreakdown(data)}>Print or save as PDF</HrButton></div>
            </>
          )}
    </SettingsSection>
  )
}

/** A plain printable statement in a new window (the browser's own "Save as PDF"). */
export function printBreakdown(d: BillingBreakdown) {
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return
  const period = d.periodStart && d.periodEnd ? `${day(d.periodStart)} – ${day(d.periodEnd)}` : ''
  const rows = d.companies.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.legalName && c.legalName !== c.name ? `<br><small>${esc(c.legalName)}</small>` : ''}${c.address ? `<br><small>${esc(c.address)}</small>` : ''}</td>`
    + `<td>${esc(c.gstin) || '—'}</td><td class="n">${c.employees}</td><td class="n">${inr(c.amountInr)}</td></tr>`).join('')
  const unused = d.unusedSeats > 0 ? `<tr class="muted"><td colspan="2">Unused seats</td><td class="n">${d.unusedSeats}</td><td class="n">${inr(d.unusedSeatsAmountInr)}</td></tr>` : ''
  const total = d.amountInr != null ? `<tr class="total"><td colspan="2">Total for ${esc(period)}</td><td class="n">${d.seatsBought} seats</td><td class="n">${inr(d.amountInr)}</td></tr>` : ''
  const extra = d.extraUsers > 0 ? `<p>${d.extraUsers} more ${d.extraUsers === 1 ? 'person' : 'people'} than the seats bought: ${inr(d.extraUsersAmountInr)} is billed at the end of the cycle.</p>` : ''
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Billing by company${period ? ' – ' + esc(period) : ''}</title>
<style>body{font:14px/1.45 system-ui,Segoe UI,Arial,sans-serif;color:#0f172a;margin:32px}h1{font-size:20px;margin:0 0 4px}
.sub{color:#475569;margin:0 0 20px}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}
th{font-size:12px;color:#64748b}.n{text-align:right;white-space:nowrap}.muted td{color:#64748b}.total td{font-weight:700;border-top:2px solid #94a3b8}
small{color:#64748b}.foot{margin-top:24px;font-size:12px;color:#64748b}</style></head><body>
<h1>Billing by company</h1>
<p class="sub">${esc(d.business?.name)}${d.business?.gstin ? ' · GSTIN ' + esc(d.business.gstin) : ''}${period ? '<br>Billing period ' + esc(period) : ''}</p>
<table><thead><tr><th>Company</th><th>GSTIN</th><th class="n">Employees</th><th class="n">Amount</th></tr></thead><tbody>${rows}${unused}${total}</tbody></table>
${extra}<p class="foot">One subscription covers the whole business; this statement splits it by company. It is not a tax invoice: Razorpay issues the invoice for each charge.</p>
<script>window.onload=function(){window.print()}</script></body></html>`)
  w.document.close()
}
