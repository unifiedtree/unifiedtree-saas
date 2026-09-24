// Reports Center (/hrms/reports) in the Workforce Analytics design's language:
// the dashboard first, then every report grouped by what it's about, each
// shown only to people allowed to read it, and the files this browser
// downloaded from the report pages. The company picked here travels with every
// link (?co=), so the report opens on the same company.
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrPageHeader, HrSelect, HrStatusPill } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { clearRecentDownloads, fileSize, recentDownloads, type DownloadRecord } from '@/shared/export/fileExport'
import { useReportCompany } from './useReportCompany'
import { Ico, KPI_ICON, SECTION } from './ReportKit'

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

function useDownloads() {
  const [list, setList] = useState<DownloadRecord[]>(() => recentDownloads())
  useEffect(() => {
    const f = () => setList(recentDownloads())
    window.addEventListener('ut-downloads', f); window.addEventListener('storage', f)
    return () => { window.removeEventListener('ut-downloads', f); window.removeEventListener('storage', f) }
  }, [])
  return list
}

export function ReportsIndex() {
  const navigate = useNavigate()
  const co = useReportCompany()
  const head = usePermission(P.HRMS_REPORT_HEADCOUNT), attr = usePermission(P.HRMS_REPORT_ATTRITION), div = usePermission(P.HRMS_REPORT_DIVERSITY)
  const att = usePermission(P.HRMS_REPORT_ATTENDANCE), leave = usePermission(P.HRMS_REPORT_LEAVE)
  const downloads = useDownloads()
  const go = (to: string) => navigate(`${to}${co.company ? `?co=${co.company}` : ''}`)
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

        <section style={SECTION}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px 12px', marginBottom: 10 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>Recent downloads</h2>
            <span style={{ fontSize: 12.5, color: '#64748b', fontWeight: 500 }}>On this device</span>
            <span style={{ flex: 1 }} />
            {downloads.length > 0 && <HrButton variant="ghost" onClick={clearRecentDownloads}>Clear list</HrButton>}
          </div>
          {downloads.length === 0 ? (
            <EmptyState icon={((p: { size?: number }) => Ico({ d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3', size: p.size })) as any} title="Nothing downloaded yet" description="Files you export from a report (Excel, CSV or chart images) are listed here so you can find them again." />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                <thead><tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{['File', 'Report', 'Format', 'Company', 'When', 'Size'].map((hd) => <th key={hd} style={{ padding: '8px 10px', fontWeight: 700, borderBottom: '1px solid #f1f5f9' }}>{hd}</th>)}</tr></thead>
                <tbody>
                  {downloads.map((d) => (
                    <tr key={d.id}>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', fontFamily: 'JetBrains Mono,monospace', fontSize: 12.5, wordBreak: 'break-all' }}>{d.file}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', fontWeight: 600 }}>{d.report}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc' }}><HrStatusPill tone={d.fmt === 'Excel' ? 'green' : d.fmt === 'CSV' ? 'blue' : 'purple'}>{d.fmt}</HrStatusPill></td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569' }}>{d.company || '—'}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569', whiteSpace: 'nowrap' }}>{new Date(d.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td>
                      <td style={{ padding: '10px', borderBottom: '1px solid #f8fafc', color: '#475569', whiteSpace: 'nowrap' }}>{fileSize(d.size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '10px 0 0', fontSize: 12, color: '#64748b' }}>Only downloads made in this browser are listed. PDF snapshots are saved from the print dialog, so they don’t appear here.</p>
            </div>
          )}
        </section>
      </div>
    </DesignFrame>
  )
}
