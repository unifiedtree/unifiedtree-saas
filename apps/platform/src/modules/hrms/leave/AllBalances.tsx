// Everyone's leave balances in one page, plus the "Leave used this year" bars
// from the design (PgLeave.dc.html right rail). Permission:
// hrms.leave.employee.read or hrms.report.leave (BW-44).
import { useMemo, useState } from 'react'
import { CARD, HEAD_FONT, State, SubHeading, days } from '@/design/module/ModuleKit'
import { HrPagination } from '@/shared/components/HrPagination'
import { useAllLeaveBalances, useLeaveUsage, type AllBalancesTypeBalance } from '../api/useLeave'
import { useCompanies } from '../api/useOrg'

const errMsg = (e: unknown) => (e instanceof Error && e.message ? e.message : undefined)

/** Horizontal filled bar, same look as the design's "Leave used this year". */
function UsageBar({ pct, tone }: { pct: number; tone: 'green' | 'gold' }) {
  const color = tone === 'gold' ? 'var(--u-gd,#C8912E)' : 'var(--u-br,#0F6E56)'
  return (
    <span aria-hidden="true" style={{ display: 'block', height: 8, borderRadius: 4, background: 'var(--u-hv,#F0F4F2)', overflow: 'hidden' }}>
      <span style={{ display: 'block', width: `${Math.min(100, Math.max(0, pct))}%`, height: '100%', background: color, borderRadius: 4 }} />
    </span>
  )
}

export function AllBalances() {
  const [page, setPage] = useState(0)
  const [size, setSize] = useState(20)
  const [q, setQ] = useState('')
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id
  const year = new Date().getFullYear()
  const bal = useAllLeaveBalances({ companyId, year, q: q || undefined, page, size })
  const usage = useLeaveUsage({ companyId, year })

  const rows = useMemo(() => bal.data?.content ?? [], [bal.data])
  const types = useMemo(() => {
    // Build a stable column list from the first page's rows (same across people).
    const seen = new Map<string, AllBalancesTypeBalance>()
    for (const p of rows) for (const b of p.balances) if (!seen.has(b.leaveTypeId)) seen.set(b.leaveTypeId, b)
    return [...seen.values()]
  }, [rows])

  return (
    <div style={{ display: 'grid', gap: 20, minWidth: 0 }}>
      <section aria-label="Leave used this year" style={{ ...CARD, padding: '18px 20px 20px', display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontFamily: HEAD_FONT, fontSize: 16, fontWeight: 500 }}>Leave used this year</h3>
            <p style={{ margin: '2px 0 0', fontSize: 12.5, color: 'var(--u-ink3,#6A7A73)' }}>
              Company-wide, days used of days granted
            </p>
          </div>
        </div>
        {usage.isLoading ? <State kind="loading" height={120} />
          : usage.error ? <State kind="error" title="Couldn’t load leave usage" description={errMsg(usage.error)} onRetry={() => usage.refetch()} />
            : !(usage.data?.types ?? []).length ? <State kind="empty" icon="chart" title="No usage yet" description="Approved and pending leave will roll up here." />
              : (
                <div style={{ display: 'grid', gap: 14 }}>
                  {(usage.data?.types ?? []).map((t, i) => {
                    const used = t.used
                    const granted = t.granted || t.used || 1
                    const pct = granted ? Math.min(100, Math.round((used / granted) * 100)) : 0
                    return (
                      <div key={t.leaveTypeId} style={{ display: 'grid', gap: 7 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5, gap: 10 }}>
                          <span style={{ fontWeight: 500 }}>{t.leaveTypeName}</span>
                          <span style={{ color: 'var(--u-ink3,#6A7A73)' }}>
                            <b style={{ color: 'var(--u-ink,#0E1B16)', fontWeight: 500 }}>{used.toLocaleString('en-IN')}</b> of {granted.toLocaleString('en-IN')}
                          </span>
                        </div>
                        <UsageBar pct={pct} tone={i === 3 ? 'gold' : 'green'} />
                      </div>
                    )
                  })}
                </div>
              )}
      </section>

      <SubHeading
        aside={
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--u-ink3,#6A7A73)' }}>Search</span>
            <input
              value={q}
              onChange={(e) => { setPage(0); setQ(e.target.value) }}
              placeholder="Name, code"
              aria-label="Search people"
              style={{ font: 'inherit', fontSize: 13, padding: '6px 10px', border: '1px solid var(--u-ln,#E3E9E6)', borderRadius: 8, background: 'var(--u-sf,#fff)', color: 'inherit', minWidth: 160 }}
            />
          </label>
        }
      >
        All balances · {bal.data?.totalElements ?? 0}
      </SubHeading>

      {bal.isLoading ? <State kind="loading" />
        : bal.error ? <State kind="error" title="Couldn’t load balances" description={errMsg(bal.error)} onRetry={() => bal.refetch()} />
          : !rows.length ? <State kind="empty" icon="users" title="Nothing to show" description="Set up leave types for the company to see balances here." />
            : (
              <div style={{ ...CARD, padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', minWidth: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr style={{ background: 'var(--u-sf2,#F7F9F8)', color: 'var(--u-ink3,#6A7A73)', fontSize: 12, textAlign: 'left' }}>
                        <th style={{ padding: '10px 16px', fontWeight: 500 }}>Employee</th>
                        <th style={{ padding: '10px 16px', fontWeight: 500 }}>Department</th>
                        {types.map((t) => (
                          <th key={t.leaveTypeId} style={{ padding: '10px 16px', fontWeight: 500, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            {t.leaveTypeName}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.employeeId} style={{ boxShadow: 'inset 0 1px 0 var(--u-ln2,#EDF1EF)' }}>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontWeight: 500 }}>{p.employeeName}</div>
                            {p.employeeCode && <div style={{ fontSize: 12, color: 'var(--u-ink3,#6A7A73)' }}>{p.employeeCode}</div>}
                          </td>
                          <td style={{ padding: '12px 16px', color: 'var(--u-ink3,#6A7A73)' }}>{p.departmentName || '—'}</td>
                          {types.map((t) => {
                            const b = p.balances.find((x) => x.leaveTypeId === t.leaveTypeId)
                            if (!b) return <td key={t.leaveTypeId} style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--u-ink3,#6A7A73)' }}>—</td>
                            return (
                              <td key={t.leaveTypeId} style={{ padding: '12px 16px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                                <strong>{Number.isInteger(b.available) ? b.available : b.available.toFixed(1)}</strong>
                                <span style={{ color: 'var(--u-ink3,#6A7A73)' }}> / {days(b.total)}</span>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
      {(bal.data?.totalElements ?? 0) > size && (
        <HrPagination page={page} pageSize={size} totalElements={bal.data?.totalElements ?? 0}
          totalPages={Math.max(1, Math.ceil((bal.data?.totalElements ?? 0) / size))}
          onPageChange={setPage} onPageSizeChange={(s) => { setSize(s); setPage(0) }} />
      )}
    </div>
  )
}
