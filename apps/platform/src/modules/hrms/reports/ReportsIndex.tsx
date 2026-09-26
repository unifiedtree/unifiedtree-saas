// Reports Center (/hrms/reports) in the Workforce Analytics design's language:
// the dashboard first, then every report grouped by what it's about, each
// shown only to people allowed to read it, scheduled report emails, and the
// workspace's download history (the server export log). The company picked
// here travels with every link (?co=), so the report opens on the same company.
// A date from the admin dashboard (?asOf=) travels to the reports that take one.
import { useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrPageHeader, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { HrPagination } from '@/shared/components/HrPagination'
import { SkeletonRow } from '@/shared/components/SkeletonCard'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { fileSize } from '@/shared/export/fileExport'
import { useExportLog, type ExportLogRow } from '@/modules/hrms/api/useReportExports'
import { useReportCompany } from './useReportCompany'
import { Ico, KPI_ICON, SECTION, isoDate, todayIso } from './ReportKit'
import { REPORT_LABEL } from './reportSpec'
import { ScheduledEmails } from './ReportSchedules'

const FONT = "'Plus Jakarta Sans',sans-serif"
const ARROW = 'M5 12h14M12 5l7 7-7 7'
const TILE: Record<string, [string, string, string]> = {
  green: ['#ecfdf5', '#d1fae5', '#0f6e56'], blue: ['#eff6ff', '#dbeafe', '#2563eb'], red: ['#fff1f2', '#fecdd3', '#e11d48'],
  orange: ['#fff7ed', '#fed7aa', '#c2410c'], purple: ['#f5f3ff', '#ddd6fe', '#7c3aed'], teal: ['#f0fdfa', '#99f6e4', '#0f766e'],
}
interface Card { key: string; title: string; desc: string; to: string; icon: string; color: string; has: string[]; allowed: boolean }

function ReportCard({ c, go }: { c: Card; go: (to: string) => void }) {
  const [bg, border, fg] = TILE[c.color]
  return (
    <button type="button" onClick={() => go(c.to)} className="ut-report-card"
      style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 18px', borderRadius: 16, background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(15,23,42,.05)', cursor: 'pointer', font: 'inherit', color: 'inherit', minWidth: 0 }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, background: bg, border: `1px solid ${border}`, color: fg, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico d={c.icon} size={20} /></span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700 }}>{c.title}</span>
        <span className="ut-report-go" style={{ color: '#94a3b8', display: 'inline-flex' }}><Ico d={ARROW} size={16} width={2.4} /></span>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.5, color: '#475569' }}>{c.desc}</span>
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'auto' }}>
        {c.has.map((x) => <span key={x} style={{ padding: '2px 8px', borderRadius: 999, background: '#f8fafc', border: '1px solid #eef2f6', fontSize: 11.5, fontWeight: 600, color: '#475569' }}>{x}</span>)}
      </span>
    </button>
  )
}

function Group({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div><h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2><p style={{ margin: '2px 0 0', fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{sub}</p></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,280px),1fr))', gap: 12 }}>{children}</div>
    </section>
  )
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const d = (iso: unknown) => { const v = String(iso ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v; const [y, m, dd] = v.slice(0, 10).split('-').map(Number); return `${dd} ${MON[m - 1]} ${y}` }
const FORMAT: Record<string, { label: string; tone: 'green' | 'blue' | 'purple' | 'teal' }> = {
  XLSX: { label: 'Excel', tone: 'green' }, CSV: { label: 'CSV', tone: 'blue' }, PDF: { label: 'PDF', tone: 'purple' }, PNG: { label: 'PNG', tone: 'teal' },
}
/** The filters a download was made with, in words ("1 Sep 2026 – 25 Sep 2026", "as of 25 Sep 2026", "2026"). */
function filtersText(f: ExportLogRow['filters']) {
  const parts: string[] = []
  if (f.period) parts.push(String(f.period))
  else if (f.from && f.to) parts.push(`${d(f.from)} – ${d(f.to)}`)
  if (f.asOf && !f.from) parts.push(`as of ${d(f.asOf)}`)
  if (f.year) parts.push(`leave year ${f.year}`)
  if (f.who) parts.push(`who: ${f.who}`)
  if (f.action) parts.push(`action: ${String(f.action).toLowerCase()}`)
  if (f.resource) parts.push(`resource: ${String(f.resource).toLowerCase()}`)
  if (f.frequency) parts.push(`${String(f.frequency).toLowerCase()} email to ${f.recipients ?? 0} ${f.recipients === 1 ? 'person' : 'people'}`)
  if (f.truncated) parts.push('stopped at the export limit')
  return parts.join(' · ')
}
const PAGE = 20

/**
 * The date the admin dashboard was showing (?asOf=, a past day) for each report
 * that takes one: headcount as of that day, attendance summary and late marks
 * for its month up to it, attrition for the 12 months up to it. Others: none.
 */
function datedParams(to: string, asOf: string): Record<string, string> {
  const [y, m] = asOf.split('-').map(Number)
  const monthStart = (back: number) => isoDate(new Date(y, m - 1 - back, 1))
  if (to === '/hrms/reports/headcount') return { asOf }
  if (to === '/hrms/reports/attendance-summary' || to === '/hrms/reports/late-marks') return { from: monthStart(0), to: asOf }
  if (to === '/hrms/reports/attrition') return { from: monthStart(11), to: asOf }
  return {}
}

export function ReportsIndex() {
  const navigate = useNavigate()
  const co = useReportCompany()
  const [params] = useSearchParams()
  const rawAsOf = params.get('asOf') || ''
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(rawAsOf) && rawAsOf <= todayIso() ? rawAsOf : null
  const head = usePermission(P.HRMS_REPORT_HEADCOUNT), attr = usePermission(P.HRMS_REPORT_ATTRITION), div = usePermission(P.HRMS_REPORT_DIVERSITY)
  const att = usePermission(P.HRMS_REPORT_ATTENDANCE), leave = usePermission(P.HRMS_REPORT_LEAVE)
  const canSchedule = usePermission('hrms.report.schedule.manage')
  const [scope, setScope] = useState<'all' | 'mine' | undefined>(undefined)
  const [page, setPage] = useState(0)
  const anyReport = head || attr || div || att || leave
  const log = useExportLog(scope, page, PAGE, anyReport)
  const downloads = log.data?.content ?? []
  const go = (to: string) => {
    const q = new URLSearchParams({ ...(co.company ? { co: co.company } : {}), ...(asOf ? datedParams(to, asOf) : {}) }).toString()
    navigate(`${to}${q ? `?${q}` : ''}`)
  }
  const EXPORTS = ['PDF', 'Excel', 'CSV']
  const people: Card[] = [
    { key: 'headcount', title: 'Headcount', desc: 'Active, probation and notice-period people by department, on any date.', to: '/hrms/reports/headcount', icon: KPI_ICON.users, color: 'blue', has: ['By department', ...EXPORTS], allowed: head },
    { key: 'attrition', title: 'Attrition', desc: 'Monthly exits split into resigned, terminated and other, with the attrition rate.', to: '/hrms/reports/attrition', icon: KPI_ICON.trend, color: 'red', has: ['Monthly trend', ...EXPORTS], allowed: attr },
    { key: 'diversity', title: 'Diversity', desc: 'Gender split of the current workforce, company-wide and by department.', to: '/hrms/reports/diversity', icon: KPI_ICON.pie, color: 'purple', has: ['By department', ...EXPORTS], allowed: div },
  ].filter((c) => c.allowed)
  const time: Card[] = [
    { key: 'attendance', title: 'Attendance summary', desc: 'Present days, late days, average hours and recorded overtime per person.', to: '/hrms/reports/attendance-summary', icon: KPI_ICON.calendar, color: 'green', has: ['Per person', 'Date range', ...EXPORTS], allowed: att },
    { key: 'late', title: 'Late marks', desc: 'Every late arrival with check-in time and minutes late, and who is late most.', to: '/hrms/reports/late-marks', icon: KPI_ICON.alarm, color: 'orange', has: ['Per day', 'Per person', ...EXPORTS], allowed: att },
  ].filter((c) => c.allowed)
  const leaves: Card[] = [
    { key: 'leave', title: 'Leave balance', desc: 'Entitlement, carry-forward, used, pending and available days per person and leave type.', to: '/hrms/reports/leave-balance', icon: KPI_ICON.check, color: 'teal', has: ['By leave type', 'Per year', ...EXPORTS], allowed: leave },
  ].filter((c) => c.allowed)
  const analytics = head || attr || div
  const count = people.length + time.length + leaves.length

  return (
    <DesignFrame>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, fontFamily: FONT, color: '#0f172a', minWidth: 0 }}>
        <HrPageHeader crumb="Reports & Analytics" title="Reports Center" subtitle="Every report in one place. Open one to filter it, chart it and download it as PDF, Excel or CSV." className="!mb-0" />
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: -4 }}>
          <div style={{ flex: '0 1 250px', minWidth: 0 }}><HrSelect value={co.company} options={co.options} onChange={co.setCompany} placeholder="Select company…" size="sm" disabled={co.locked} /></div>
          <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{co.locked ? 'Your company. You can’t browse others.' : 'Reports open on this company.'}</span>
          {asOf && <span role="note" style={{ fontSize: 12.5, color: '#0a5240', fontWeight: 600 }}>{`Headcount, attendance and attrition reports open on ${d(asOf)}, the date picked on the dashboard.`}</span>}
          <span style={{ flex: 1 }} />
          <HrStatusPill tone="green">{`${count + (analytics ? 1 : 0)} available to you`}</HrStatusPill>
        </div>

        {analytics && (
          <button type="button" onClick={() => go('/hrms/workforce-analytics')} className="ut-report-card"
            style={{ textAlign: 'left', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px 20px', padding: '18px 20px', borderRadius: 16, background: 'linear-gradient(135deg,#f0fdf4,#ffffff 60%)', border: '1px solid #d1fae5', boxShadow: '0 1px 2px rgba(15,23,42,.05)', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
            <span style={{ width: 48, height: 48, borderRadius: 14, background: '#0f6e56', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Ico d={KPI_ICON.trend} size={22} /></span>
            <span style={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 3 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: 16, fontWeight: 800 }}>Workforce Analytics</span><HrStatusPill tone="green">Dashboard</HrStatusPill></span>
              <span style={{ fontSize: 13, color: '#475569', lineHeight: 1.5 }}>Headcount by department, gender split and monthly attrition on one page. Click a department to open its people.</span>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: '#0f6e56' }}>Open dashboard<Ico d={ARROW} size={15} width={2.4} /></span>
          </button>
        )}

        {people.length > 0 && <Group title="People" sub="Who works here, who left, and how the workforce is made up">{people.map((c) => <ReportCard key={c.key} c={c} go={go} />)}</Group>}
        {time.length > 0 && <Group title="Time & attendance" sub="Days worked, lateness and overtime for any date range">{time.map((c) => <ReportCard key={c.key} c={c} go={go} />)}</Group>}
        {leaves.length > 0 && <Group title="Leave" sub="Balances for the leave year">{leaves.map((c) => <ReportCard key={c.key} c={c} go={go} />)}</Group>}

        {canSchedule && anyReport && (
          <ScheduledEmails co={co} reports={[
            ...(analytics ? [{ key: 'workforce-analytics', label: 'Workforce Analytics' }] : []),
            ...[...people, ...time, ...leaves].map((c) => ({ key: c.key === 'attendance' ? 'attendance-summary' : c.key === 'late' ? 'late-marks' : c.key === 'leave' ? 'leave-balance' : c.key, label: c.title })),
          ]} />
        )}

        {anyReport && (
          <section style={SECTION}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginBottom: 10 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Recent downloads</h2>
              <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>{log.data?.scope === 'all' ? 'Everyone in this workspace' : 'Your downloads'}</span>
              <span style={{ flex: 1 }} />
              {log.data?.canSeeAll && (
                <div style={{ flex: '0 1 170px', minWidth: 0 }}>
                  <HrSelect size="sm" value={log.data.scope} options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Only mine' }]} onChange={(v) => { setScope(v as 'all' | 'mine'); setPage(0) }} />
                </div>
              )}
            </div>
            {log.isLoading ? <div>{[1, 2, 3].map((x) => <SkeletonRow key={x} />)}</div>
              : log.isError ? (
                <div role="alert" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '6px 2px' }}>
                  <span style={{ flex: '1 1 240px', fontSize: 13, color: '#64748b' }}>Couldn’t load the download history. {(log.error as Error)?.message}</span>
                  <HrButton variant="ghost" size="sm" onClick={() => log.refetch()}>Try again</HrButton>
                </div>
              )
                : downloads.length === 0 ? (
                  <EmptyState icon={((p: { size?: number }) => Ico({ d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', size: p.size })) as any} title="Nothing downloaded yet" description="Every report you export (PDF, Excel, CSV or chart images) and every scheduled email is listed here, with who made it and the filters used." />
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 720 }}>
                      <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{['File', 'Report', 'Format', 'Company', 'Who', 'When', 'Size'].map((hd) => <th key={hd} style={{ padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid #f1f5f9' }}>{hd}</th>)}</tr></thead>
                      <tbody>
                        {downloads.map((x) => {
                          const fmt = FORMAT[x.format] || { label: x.format, tone: 'blue' as const }
                          const detail = filtersText(x.filters || {})
                          return (
                            <tr key={x.id}>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', fontFamily: 'JetBrains Mono,monospace', fontSize: 12.5, wordBreak: 'break-all' }}>{x.fileName || '—'}</td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc' }}><div style={{ fontWeight: 600 }}>{REPORT_LABEL[x.report] || x.label}</div>{detail && <div style={{ fontSize: 12, color: '#64748b' }}>{detail}</div>}</td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc' }}><HrStatusPill tone={fmt.tone}>{fmt.label}</HrStatusPill></td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569' }}>{x.companyName || '—'}</td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569' }}>{x.mine ? 'You' : x.userName || x.userEmail || '—'}{x.source === 'SCHEDULE' && <div style={{ fontSize: 12, color: '#64748b' }}>Scheduled email</div>}</td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569', whiteSpace: 'nowrap' }}>{new Date(x.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })}</td>
                              <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569', whiteSpace: 'nowrap' }}>{x.sizeBytes != null ? fileSize(x.sizeBytes) : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <HrPagination page={page} pageSize={PAGE} totalElements={log.data?.total ?? 0} totalPages={Math.max(1, Math.ceil((log.data?.total ?? 0) / PAGE))} onPageChange={setPage} />
                    <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>Every download is recorded on the server: files made on the server and in the browser, and scheduled emails. The history can’t be cleared.</p>
                  </div>
                )}
          </section>
        )}
      </div>
    </DesignFrame>
  )
}
