// Reports center (/hrms/reports), prototype PgReports "r-center": the featured
// Workforce analytics card with live headline numbers and their change, the
// report tiles (each with a small live chart, only for people allowed to read
// that report), scheduled report emails and the workspace's download history
// (the server export log). The company picked here travels with every link
// (?co=), and a date from the admin dashboard (?asOf=) travels to the reports
// that take one. Every figure comes from the API: /v1/reports/summary (each
// series only with its report's permission), /headcount/change, /fiscal-year
// and the diversity report as of a date.
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import {
  Button, CountBadge, EmptyState, ErrorState, PageFrame, PageHeader, Section, SegmentedControl, SkeletonTable, StatusPill, Table,
  type StatusTone, type TableColumn,
} from '@/design/kit/display'
import { Pager } from '@/design/kit/data'
import { Select } from '@/design/kit/overlays'
import { fileSize } from '@/shared/export/fileExport'
import { useExportLog, useReportSchedules, type ExportLogRow } from '@/modules/hrms/api/useReportExports'
import { useDiversityReport, useFiscalYear, useHeadcountChange, useReportSummary } from '@/modules/hrms/api/useReports'
import { useReportCompany } from './useReportCompany'
import { CompanyFilter, Ico, KPI_ICON, dayMonth, isoDate, todayIso } from './ReportKit'
import { REPORT_LABEL } from './reportSpec'
import { changeText, datedParams, miniFor, ptsSince, ptsText, womenPct, type Mini } from './reportModel'
import { ScheduledEmails } from './ReportSchedules'
import './reports.css'

const ARROW = 'M5 12h14M13 6l6 6-6 6'
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const d = (iso: unknown) => { const v = String(iso ?? ''); if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return v; const [y, m, dd] = v.slice(0, 10).split('-').map(Number); return `${dd} ${MON[m - 1]} ${y}` }
const FORMAT: Record<string, { label: string; tone: StatusTone }> = {
  XLSX: { label: 'Excel', tone: 'success' }, CSV: { label: 'CSV', tone: 'info' }, PDF: { label: 'PDF', tone: 'holiday' }, PNG: { label: 'PNG', tone: 'brand' },
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

// ── mini charts (prototype tile kinds: bars, line, split) ─────────────────────

function MiniChart({ m, label }: { m: Mini | null; label: string }) {
  if (!m) return <span className="rp-tile__chart" aria-hidden="true" />
  if (m.kind === 'none') return <span className="rp-tile__chart"><span className="rp-mini-empty">{m.text}</span></span>
  if (m.kind === 'split') {
    return (
      <span className="rp-tile__chart" role="img" aria-label={`${label}: ${[m.aLabel, m.bLabel, m.cLabel].filter(Boolean).join(', ')}`}>
        <span className="rp-mini-split">
          <span className="rp-mini-split__track">
            <span className="rp-mini-split__a" style={{ width: `${Math.max(0, Math.min(100, m.a))}%` }} />
            {m.b == null ? <span className="rp-mini-split__b" /> : <>
              <span className="rp-mini-split__b rp-mini-split__b--sized" style={{ width: `${Math.max(0, Math.min(100, m.b))}%` }} />
              <span className="rp-mini-split__c" />
            </>}
          </span>
          <span className={`rp-mini-split__labels${m.cLabel ? ' rp-mini-split__labels--three' : ''}`}><span>{m.aLabel}</span><span>{m.bLabel}</span>{m.cLabel && <span>{m.cLabel}</span>}</span>
        </span>
      </span>
    )
  }
  const max = Math.max(...m.values, 0)
  if (m.kind === 'bars') {
    return (
      <span className="rp-tile__chart" role="img" aria-label={`${label}: ${m.values.join(', ')}`}>
        <span className="rp-mini-bars">
          {m.values.map((v, i) => <span key={i} className={m.hi.includes(i) ? 'is-hi' : undefined} style={{ height: `${max ? Math.max(10, Math.round((v / max) * 100)) : 10}%` }} />)}
        </span>
      </span>
    )
  }
  const W = 240, H = 46, mn = Math.min(...m.values), rg = max - mn || 1, n = m.values.length
  const xy = m.values.map((v, i) => [n > 1 ? (i * W) / (n - 1) : W / 2, H - 4 - ((v - mn) / rg) * (H - 10)])
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return (
    <span className="rp-tile__chart" role="img" aria-label={`${label}: ${m.values.join(', ')}`}>
      <svg width="100%" height="46" viewBox="0 0 240 46" preserveAspectRatio="none" fill="none" style={{ overflow: 'visible', color: 'var(--u-brt,#0F6E56)', display: 'block' }}>
        <path d={`${line} L240 46 L0 46 Z`} fill="currentColor" fillOpacity=".08" />
        <path d={line} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </span>
  )
}


interface Tile { key: string; title: string; desc: string; to: string; icon: string; cat: 'People' | 'Time'; allowed: boolean }

function ReportTile({ t, mini, go }: { t: Tile; mini: Mini | null; go: (to: string) => void }) {
  return (
    <button type="button" className="rp-tile" aria-label={`${t.title} report`} onClick={() => go(t.to)} data-rise="">
      <span className="rp-tile__top">
        <span className="rp-tile__icon"><Ico d={t.icon} size={20} width={1.9} /></span>
        <span className="rp-tile__cat">{t.cat}</span>
      </span>
      <span style={{ display: 'block', minWidth: 0 }}>
        <span className="rp-tile__title" style={{ display: 'block' }}>{t.title}</span>
        <span className="rp-tile__desc" style={{ display: 'block' }}>{t.desc}</span>
      </span>
      <MiniChart m={mini} label={t.title} />
      <span className="rp-tile__foot">
        <span className="rp-muted">Live</span>
        <span className="rp-tile__open">Open<Ico d={ARROW} size={14} width={2.2} /></span>
      </span>
    </button>
  )
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
  const anyReport = head || attr || div || att || leave
  const analytics = head || attr || div
  const company = co.company || null
  const today = todayIso()
  const lastMonthEnd = useMemo(() => { const t = new Date(); return isoDate(new Date(t.getFullYear(), t.getMonth(), 0)) }, [])

  const summary = useReportSummary(company, { enabled: anyReport })
  const newBackend = !!summary.data
  const change = useHeadcountChange(company, lastMonthEnd, today, { enabled: head })
  const fy = useFiscalYear(company, { enabled: div && newBackend })
  const divNow = useDiversityReport(company, { enabled: div && newBackend, asOf: today })
  const divThen = useDiversityReport(company, { enabled: div && newBackend && !!fy.data, asOf: fy.data?.from })
  const schedules = useReportSchedules(canSchedule && anyReport)

  const [cat, setCat] = useState<'All' | 'People' | 'Time'>('All')
  const [scope, setScope] = useState<'all' | 'mine' | undefined>(undefined)
  const [page, setPage] = useState(0)
  const log = useExportLog(scope, page, PAGE, anyReport)
  const downloads = log.data?.content ?? []

  const go = (to: string) => {
    const q = new URLSearchParams({ ...(co.company ? { co: co.company } : {}), ...(asOf ? datedParams(to, asOf) : {}) }).toString()
    navigate(`${to}${q ? `?${q}` : ''}`)
  }

  const tiles: Tile[] = ([
    { key: 'headcount', title: 'Headcount', desc: 'Active, probation and notice-period headcount by department, as of any date.', to: '/hrms/reports/headcount', icon: KPI_ICON.users, cat: 'People', allowed: head },
    { key: 'attrition', title: 'Attrition', desc: 'Monthly exits, resignations, terminations and attrition percentage.', to: '/hrms/reports/attrition', icon: KPI_ICON.trend, cat: 'People', allowed: attr },
    { key: 'diversity', title: 'Diversity', desc: 'Headcount by gender and department for the current workforce.', to: '/hrms/reports/diversity', icon: KPI_ICON.pie, cat: 'People', allowed: div },
    { key: 'attendance', title: 'Attendance summary', desc: 'Present days, late days, average hours and overtime per employee for a period.', to: '/hrms/reports/attendance-summary', icon: KPI_ICON.clock, cat: 'Time', allowed: att },
    { key: 'late', title: 'Late marks', desc: 'Every late arrival with minutes late and check-in time for a date range.', to: '/hrms/reports/late-marks', icon: KPI_ICON.alarm, cat: 'Time', allowed: att },
    { key: 'leave', title: 'Leave balance', desc: 'Entitlement, used, pending, carry-forward and available leave per employee.', to: '/hrms/reports/leave-balance', icon: KPI_ICON.calendar, cat: 'Time', allowed: leave },
  ] as Tile[]).filter((t) => t.allowed)
  const shown = tiles.filter((t) => cat === 'All' || t.cat === cat)
  const count = (k: 'All' | 'People' | 'Time') => tiles.filter((t) => k === 'All' || t.cat === k).length

  // Hero numbers, each only with its own report permission and only when the server has the figures.
  const heroStats: { k: string; v: string; d: string }[] = []
  if (head && change.data) heroStats.push({ k: 'Headcount', v: change.data.headcountTo.toLocaleString('en-IN'), d: changeText(change.data.change, 'this month') })
  const months = summary.data?.attrition?.months ?? []
  if (attr && months.length) {
    const last = months[months.length - 1], prev = months[months.length - 2]
    const [, pm] = (prev?.month ?? '').split('-').map(Number)
    heroStats.push({ k: 'Attrition', v: `${last.pct.toFixed(1)}%`, d: prev ? ptsText(last.pct - prev.pct, MON[pm - 1]) : 'This month' })
  }
  const wNow = womenPct(divNow.data), wThen = womenPct(divThen.data)
  if (div && wNow != null) heroStats.push({ k: 'Women', v: `${Math.round(wNow)}%`, d: fy.data && wThen != null ? ptsSince(wNow - wThen, dayMonth(fy.data.from)) : '' })

  const columns: TableColumn<ExportLogRow>[] = [
    { key: 'file', header: 'File', primary: true, render: (x) => <span className="rp-file">{x.fileName || '—'}</span> },
    { key: 'report', header: 'Report', render: (x) => { const detail = filtersText(x.filters || {}); return <span><span style={{ display: 'block' }}>{REPORT_LABEL[x.report] || x.label}</span>{detail && <span className="rp-note" style={{ display: 'block' }}>{detail}</span>}</span> } },
    { key: 'format', header: 'Format', render: (x) => { const f = FORMAT[x.format] || { label: x.format, tone: 'neutral' as StatusTone }; return <StatusPill tone={f.tone} size="xs">{f.label}</StatusPill> } },
    { key: 'company', header: 'Company', render: (x) => x.companyName || '—' },
    { key: 'who', header: 'Who', render: (x) => <span>{x.mine ? 'You' : x.userName || x.userEmail || '—'}{x.source === 'SCHEDULE' && <span className="rp-note" style={{ display: 'block' }}>Scheduled email</span>}</span> },
    { key: 'when', header: 'When', render: (x) => new Date(x.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) },
    { key: 'size', header: 'Size', numeric: true, render: (x) => (x.sizeBytes != null ? fileSize(x.sizeBytes) : '—') },
  ]

  let downloadsBody: ReactNode
  if (log.isLoading) downloadsBody = <div style={{ padding: '0 16px 16px' }}><SkeletonTable /></div>
  else if (log.isError) downloadsBody = <ErrorState title="Couldn’t load the download history" error={log.error} onRetry={() => log.refetch()} />
  else if (!downloads.length) downloadsBody = <EmptyState icon="download" title="Nothing downloaded yet" hint="Every report you export (PDF, Excel, CSV or chart images) and every scheduled email is listed here, with who made it and the filters used." />
  else downloadsBody = <Table<ExportLogRow> label="Recent downloads" columns={columns} rows={downloads} rowKey={(x) => x.id} mobile="cards" minWidth={760} />

  return (
    <PageFrame label="Reports" className="rp-page">
      <PageHeader eyebrow="Reports & analytics" title="Reports" sub="Ready-made views of your workforce data. Open, schedule or export any of them."
        actions={canSchedule && anyReport ? (
          <Button variant="secondary" icon="clock" onClick={() => document.getElementById('scheduled-reports')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
            Scheduled{schedules.data && <CountBadge label={`${schedules.data.length} scheduled`}>{schedules.data.length}</CountBadge>}
          </Button>
        ) : undefined} />
      <div className="rp-filters">
        <CompanyFilter co={co} />
        <span className="rp-note">{co.locked ? 'Your company. You can’t browse others.' : 'Reports open on this company.'}</span>
        {asOf && <span role="note" className="rp-note rp-note--brand">{`Headcount, diversity, attendance and attrition reports open on ${d(asOf)}, the date picked on the dashboard.`}</span>}
      </div>

      {analytics && (
        <button type="button" className="rp-hero" aria-label="Workforce analytics" onClick={() => go('/hrms/workforce-analytics')} data-rise="">
          <span className="rp-hero__art" aria-hidden="true"><span style={{ height: '45%' }} /><span style={{ height: '70%' }} /><span style={{ height: '55%' }} /><span style={{ height: '100%' }} /></span>
          <span className="rp-hero__text">
            <span className="rp-hero__badge">Featured</span>
            <span className="rp-hero__title" style={{ display: 'block' }}>Workforce analytics</span>
            <span className="rp-hero__sub" style={{ display: 'block' }}>Headcount, attrition and diversity trends in one place, with drill-down by department.</span>
          </span>
          {heroStats.length > 0 && (
            <span className="rp-hero__stats">
              {heroStats.map((s) => (
                <span key={s.k} className="rp-hero__stat" data-hero={s.k}>
                  <span className="rp-hero__k">{s.k}</span><span className="rp-hero__v">{s.v}</span>{s.d && <span className="rp-hero__d">{s.d}</span>}
                </span>
              ))}
            </span>
          )}
          <span className="rp-hero__arrow"><Ico d={ARROW} size={20} width={2.2} /></span>
        </button>
      )}

      {tiles.length > 0 && (
        <>
          <div className="rp-bar">
            <SegmentedControl label="Report categories" value={cat} onChange={(v) => setCat(v)}
              options={(['All', 'People', 'Time'] as const).map((k) => ({ value: k, label: k, count: count(k) }))} />
            <span className="rp-note">{`${shown.length} of ${tiles.length} reports`}</span>
          </div>
          <section aria-label="All reports" className="rp-tiles">
            {shown.map((t) => <ReportTile key={t.key} t={t} mini={miniFor(t.key, summary.data)} go={go} />)}
          </section>
        </>
      )}

      {canSchedule && anyReport && (
        <ScheduledEmails id="scheduled-reports" co={co} reports={[
          ...(analytics ? [{ key: 'workforce-analytics', label: 'Workforce analytics' }] : []),
          ...tiles.map((t) => ({ key: t.key === 'attendance' ? 'attendance-summary' : t.key === 'late' ? 'late-marks' : t.key === 'leave' ? 'leave-balance' : t.key, label: t.title })),
        ]} />
      )}

      {anyReport && (
        <Section title="Recent downloads" sub={log.data?.scope === 'all' ? 'Everyone in this workspace' : 'Your downloads'} body="flush" rise
          actions={log.data?.canSeeAll ? (
            <div style={{ width: 170 }}><Select aria-label="Whose downloads" size="md" value={log.data.scope} options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Only mine' }]} onChange={(e) => { setScope(e.target.value as 'all' | 'mine'); setPage(0) }} /></div>
          ) : undefined}
          footer={downloads.length ? (
            <div className="rp-pager">
              <Pager page={page} pageSize={PAGE} total={log.data?.total ?? 0} onPageChange={setPage} noun="downloads" />
              <p className="rp-note" style={{ margin: '8px 0 0' }}>Every download is recorded on the server: files made on the server and in the browser, and scheduled emails. The history can’t be cleared.</p>
            </div>
          ) : undefined}>
          {downloadsBody}
        </Section>
      )}

      {!anyReport && <EmptyState icon="lock" title="No reports for you yet" hint="Ask an admin for a report permission." />}
    </PageFrame>
  )
}
