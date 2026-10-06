// My profile's own tabs (prototype PgProfile self=true): each reads the signed-in person's own
// endpoints, never someone else's, and links to the full self-service page where the work is done.
//   Job          GET /v1/hrms/employees/me (BW-98) + /v1/employees/me + /v1/shifts/employee/{self}
//   Attendance   GET /v1/attendance/history?year&month, /monthly-stats   (attendance.checkin.self)
//   My pay       GET /v1/payroll/structures/me, /payslips/me             (…structure.read.self / payslip.read.self)
//   Letters      GET /v1/letters/my                                      (hrms.letters.read.self)
//   Performance  GET /v1/performance/goals/my, /reviews/my, /v1/learning/skills/me
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { usePersonalPages } from '@/shared/hooks/usePersonalPages'
import {
  Button, CalendarLegend, IconTile, KeyValueGrid, ListRow, ListRows, MonthCalendar, ProgressBar, Section, StatusPill, type StatusTone,
} from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { dayCell } from '../../attendance/daily/MyAttendance'
import { useAttendanceHistory, useMonthlyStats } from '../../api/useAttendance'
import { useEmployeeShift } from '../../api/useShiftPolicies'
import { useMySalaryStructure } from '../../api/usePayroll'
import { downloadMyPayslipPdf, useMyPayslips } from '../../api/usePayrollRuns'
import { useMyGoals, useMyReviews } from '../../api/usePerformance'
import { useMySkills } from '../../api/useLearning'
import { downloadLetterPdf, useMyLetters } from '../../letters/api/useLetters'
import type { MyEmployeeRecord } from '../../api/shared/contracts'
import { CAL_LEGEND } from './HrOverview'
import { MONTH_NAMES, fmtDate, inr } from './profileFormat'

const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', INTERN: 'Intern', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }
const shiftYm = (ym: string, delta: number) => { const d = new Date(`${ym}-01T12:00:00`); d.setMonth(d.getMonth() + delta); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }
const notBuilt = (e: unknown) => { const s = (e as { status?: number } | null)?.status; return s === 404 || s === 400 }

export interface MeBasics {
  id: string
  employeeCode?: string | null
  employmentType?: string | null
  dateOfJoining?: string | null
  workLocation?: string | null
}

export function SelfJob({ me, record, recordMissing }: { me: MeBasics; record?: MyEmployeeRecord; recordMissing: boolean }) {
  const navigate = useNavigate()
  const canShift = usePermission('attendance.checkin.self')
  const shift = useEmployeeShift(me.id, { enabled: canShift })
  const s = shift.data
  const probation = record?.probationEndDate ? (record.confirmationDate ? `Ended ${fmtDate(record.probationEndDate)}` : `Ends ${fmtDate(record.probationEndDate)}`) : '—'
  return (
    <div className="upf-flow">
      <div className="upf-full">
        <Section title="Employment details" variant="section" sub={recordMissing ? 'Some dates show once HR’s record is available.' : undefined}>
          <KeyValueGrid items={[
            { label: 'Employee code', value: me.employeeCode || '—' },
            { label: 'Designation', value: record?.designationName || '—' },
            { label: 'Department', value: record?.departmentName || '—' },
            { label: 'Employment type', value: TYPE_LABEL[me.employmentType || ''] || (me.employmentType ? me.employmentType.charAt(0) + me.employmentType.slice(1).toLowerCase().replaceAll('_', ' ') : '—') },
            { label: 'Work location', value: me.workLocation || '—' },
            { label: 'Joining date', value: fmtDate(record?.dateOfJoining ?? me.dateOfJoining) },
            { label: 'Probation', value: probation },
            { label: 'Confirmation date', value: fmtDate(record?.confirmationDate) },
            ...(record?.noticeStartDate ? [{ label: 'Notice started', value: fmtDate(record.noticeStartDate) }] : []),
            ...(record?.lastWorkingDay ? [{ label: 'Last working day', value: fmtDate(record.lastWorkingDay) }] : []),
          ]} />
        </Section>
      </div>
      <div className="upf-half">
        <Section title="Reporting line" variant="section"
          actions={<Button size={30} variant="secondary" icon="workflow" onClick={() => navigate(`/hrms/org-chart?focus=${me.id}`)}>View in org chart</Button>}>
          <ListRows label="Reporting line">
            <ListRow variant="divided" leading={<IconTile icon="users" tone={record?.managerName ? 'brand' : 'neutral'} size={34} />}
              title={record?.managerName || 'No manager set'} sub={record?.managerName ? 'You report to them' : 'Approvals go to your department head.'}
              end={record?.managerName ? <StatusPill tone="brand">Manager</StatusPill> : undefined} />
          </ListRows>
        </Section>
      </div>
      {canShift && (
        <div className="upf-half">
          <Section title="Assigned shift" variant="section" loading={shift.isLoading} error={notBuilt(shift.error) ? undefined : shift.error} onRetry={() => void shift.refetch()} skeleton="text"
            empty={!shift.isLoading && !s?.shiftPolicyId ? { title: 'No shift assigned', hint: 'HR assigns your shift.' } : undefined}
            actions={<Button size={30} variant="ghost" onClick={() => navigate('/me/shift-change')}>Ask for a change</Button>}>
            <KeyValueGrid items={[
              { label: 'Shift', value: s?.shiftName || '—' },
              { label: 'Timing', value: `${s?.startTime?.slice(0, 5) ?? '—'} – ${s?.endTime?.slice(0, 5) ?? '—'}${s?.gracePeriodMinutes ? ` · ${s.gracePeriodMinutes} min grace` : ''}` },
              { label: 'Next shift', value: s?.upcomingShiftName ? `${s.upcomingShiftName} from ${fmtDate(s.upcomingEffectiveFrom)}` : 'No change scheduled' },
            ]} />
          </Section>
        </div>
      )}
    </div>
  )
}

export function SelfAttendance() {
  const navigate = useNavigate()
  const today = istToday()
  const [ym, setYm] = useState(today.slice(0, 7))
  const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7))
  const history = useAttendanceHistory(y, m)
  const stats = useMonthlyStats(y, m)
  const cells = useMemo(() => (history.data ?? []).map((d) => dayCell(d, today)), [history.data, today])
  const s = stats.data
  const noOut = cells.filter((c) => c.tone === 'fix').length
  const summary = s ? [`${s.presentDays} present`, `${s.lateDays} late`, `${s.absentDays} absent`, s.leaveDays != null ? `${s.leaveDays} on leave` : '', noOut ? `${noOut} incomplete` : ''].filter(Boolean).join(' · ') : ''
  return (
    <Section title={`${MONTH_NAMES[m - 1]} ${y}`} sub={summary} variant="section"
      actions={<span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
        <Button size={30} variant="secondary" icon="chevronLeft" aria-label="Previous month" onClick={() => setYm(shiftYm(ym, -1))} />
        <Button size={30} variant="secondary" icon="chevronRight" aria-label="Next month" disabled={ym >= today.slice(0, 7)} onClick={() => setYm(shiftYm(ym, 1))} />
        <Button size={30} variant="ghost" onClick={() => navigate('/hrms/attendance?tab=my')}>My attendance</Button>
      </span>}
      loading={history.isLoading} error={history.error} onRetry={() => void history.refetch()} skeleton="chart">
      <MonthCalendar month={ym} days={cells} variant="detail" today={today} label={`${MONTH_NAMES[m - 1]} ${y} attendance`}
        onMonthChange={(d) => { const n = shiftYm(ym, d); if (n <= today.slice(0, 7)) setYm(n) }} />
      <CalendarLegend items={CAL_LEGEND} variant="detail" />
    </Section>
  )
}

export function SelfPay() {
  const navigate = useNavigate()
  const toast = useToast()
  const canStructure = usePermission('payroll.structure.read.self'), canSlips = usePermission('payroll.payslip.read.self')
  const structure = useMySalaryStructure()
  const slips = useMyPayslips()
  const [busy, setBusy] = useState<string | null>(null)
  const st = structure.data
  const rows = [...(slips.data ?? [])].sort((a, b) => (b.periodYear - a.periodYear) || (b.periodMonth - a.periodMonth))
  return (
    <div className="upf-flow">
      {canStructure && (
        <div className="upf-main" style={{ flex: '2 1 520px' }}>
          <Section title="Salary structure" variant="section" body="flush" loading={structure.isLoading} error={structure.error} onRetry={() => void structure.refetch()} skeleton="table"
            sub={st ? `Monthly · effective ${fmtDate(st.effectiveFrom)} · ${st.taxRegime === 'NEW' ? 'new' : 'old'} tax regime` : undefined}
            actions={st ? <span style={{ fontSize: 13, color: 'var(--u-ink3,#6A7A73)' }}>CTC <b style={{ color: 'var(--u-ink,#0E1B16)', fontWeight: 500 }}>{inr(st.ctcAnnual)}</b></span> : undefined}
            empty={!structure.isLoading && !st ? { title: 'No salary structure yet', hint: 'HR sets it up before your first payroll.' } : undefined}>
            {st && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: '0 28px', padding: '0 20px 8px' }}>
                  {([['Earnings', st.earnings ?? [], st.grossMonthly, 'Gross'], ['Deductions', st.deductions ?? [], st.totalDeductions, 'Total deductions']] as const).map(([h, list, total, tl]) => (
                    <div key={h}>
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--u-ink3,#6A7A73)', padding: '6px 0' }}>{h}</div>
                      {list.map((l) => (
                        <div key={l.componentCode} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', boxShadow: 'inset 0 -1px 0 var(--u-ln2,#EDF1EF)', fontSize: 13.5 }}>
                          <span style={{ color: 'var(--u-ink2,#4A5A54)' }}>{l.componentName}</span><span style={{ fontWeight: 500 }}>{inr(l.monthlyAmount)}</span>
                        </div>
                      ))}
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontSize: 14, fontWeight: 500 }}><span>{tl}</span><span>{inr(total)}</span></div>
                    </div>
                  ))}
                </div>
                {st.netMonthly != null && <div className="upf-net"><span>Net pay per month</span><span>{inr(st.netMonthly)}</span></div>}
              </>
            )}
          </Section>
        </div>
      )}
      {canSlips && (
        <div className="upf-side" style={{ flex: '1 1 300px' }}>
          <Section title="Payslips" count={rows.length || undefined} variant="section" body="list" loading={slips.isLoading} error={slips.error} onRetry={() => void slips.refetch()}
            empty={!slips.isLoading && rows.length === 0 ? { title: 'No payslips yet', hint: 'A payslip appears once your month’s payroll is locked.' } : undefined}
            footerLink={{ label: 'All my payslips', onClick: () => navigate('/me/payslips'), arrow: true }}>
            <ListRows label="Payslips" inset>
              {rows.slice(0, 6).map((p) => (
                <ListRow key={p.runId} variant="hover" leading={<IconTile icon="fileText" tone="brand" size={34} />}
                  title={`${MONTH_NAMES[p.periodMonth - 1]} ${p.periodYear}`} sub={`${p.status === 'PAID' ? 'Paid' : 'Locked'}${p.lopDays ? ` · ${p.lopDays} LOP` : ''}`}
                  end={<span style={{ fontSize: 13.5, fontWeight: 500 }}>{inr(p.netPay)}</span>}
                  actions={<Button size={30} variant="ghost" icon="download" loading={busy === p.runId} aria-label={`Download ${MONTH_NAMES[p.periodMonth - 1]} ${p.periodYear} payslip`}
                    onClick={() => { setBusy(p.runId); downloadMyPayslipPdf(p.runId).catch((e) => toast.error('Couldn’t download the payslip', { detail: (e as Error)?.message })).finally(() => setBusy(null)) }} />} />
              ))}
            </ListRows>
          </Section>
        </div>
      )}
    </div>
  )
}

const LETTER_TYPE: Record<string, string> = { OFFER: 'Offer letter', APPOINTMENT: 'Appointment letter', RELIEVING: 'Relieving letter', EXPERIENCE: 'Experience letter', SALARY_REVISION: 'Salary revision', CUSTOM: 'Letter' }

export function SelfLetters() {
  const navigate = useNavigate()
  // By default owners and admins have no My letters view to open (the personal pages rule, usePersonalPages: the owner sets it per role).
  const personal = usePersonalPages()
  const toast = useToast()
  const q = useMyLetters(0)
  const rows = (q.data?.content ?? []).filter((l) => l.status !== 'VOID')
  return (
    <Section title="Letters" count={q.data?.totalElements || undefined} sub="Letters HR has issued to you." variant="section" body="list"
      loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}
      empty={!q.isLoading && rows.length === 0 ? { title: 'No letters yet', hint: 'Letters HR sends you appear here.' } : undefined}
      footerLink={!personal ? undefined : { label: 'Open My letters', onClick: () => navigate('/hrms/letters/my'), arrow: true }}>
      <ListRows label="Letters" inset>
        {rows.map((l) => (
          <ListRow key={l.id} variant="hover" leading={<IconTile icon="fileText" tone="brand" size={34} />}
            title={l.subject || LETTER_TYPE[l.type] || 'Letter'} sub={`${LETTER_TYPE[l.type] || 'Letter'} · ${l.signedAt ? `signed ${fmtDate(l.signedAt)}` : `issued ${fmtDate(l.issueDate || l.sentAt || l.createdAt)}`}`}
            end={l.status === 'SIGNED' || l.signedAt ? <StatusPill tone="brand">Signed</StatusPill> : l.signatureRequested && l.status !== 'VOID' ? <StatusPill tone="warning">To sign</StatusPill> : undefined}
            actions={l.hasPdf ? <Button size={30} variant="secondary" onClick={() => downloadLetterPdf(l.id).catch((e) => toast.error('Couldn’t download the letter', { detail: (e as Error)?.message }))}>Download</Button> : undefined} />
        ))}
      </ListRows>
    </Section>
  )
}

const GOAL: Record<string, [string, StatusTone]> = { ACTIVE: ['On track', 'brand'], AT_RISK: ['At risk', 'warning'], COMPLETED: ['Done', 'success'], DROPPED: ['Dropped', 'neutral'] }
const REVIEW: Record<string, [string, StatusTone]> = { PENDING: ['To do', 'warning'], IN_PROGRESS: ['In progress', 'info'], MISSED: ['Missed', 'danger'], SUBMITTED: ['Submitted', 'brand'], ACKNOWLEDGED: ['Completed', 'success'] }

export function SelfPerformance() {
  const navigate = useNavigate()
  // By default owners and admins have no My goals / My reviews views to open (the personal pages rule, usePersonalPages: the owner sets it per role).
  const personal = usePersonalPages()
  const goals = useMyGoals()
  const reviews = useMyReviews()
  const skills = useMySkills()
  const g = goals.data ?? [], r = reviews.data ?? [], sk = skills.data ?? []
  return (
    <div className="upf-flow">
      <div className="upf-half">
        <Section title="Goals & KPIs" sub="What you are measured on." variant="section" body="list" loading={goals.isLoading} error={goals.error} onRetry={() => void goals.refetch()}
          empty={!goals.isLoading && g.length === 0 ? { title: 'No goals yet', hint: 'Goals your manager sets appear here.' } : undefined}
          footerLink={!personal ? undefined : { label: 'Open My goals', onClick: () => navigate('/hrms/performance?view=my-goals'), arrow: true }}>
          <ListRows label="Goals" inset>
            {g.map((x) => {
              const [label, tone] = GOAL[x.status] ?? [x.status, 'neutral' as StatusTone]
              return (
                <ListRow key={x.id} variant="hover" leading={<IconTile icon="target" tone="brand" size={34} />} title={x.title}
                  sub={<ProgressBar value={Math.max(0, Math.min(100, x.progress || 0))} label={`${x.title} progress`} />}
                  end={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12.5, fontWeight: 500 }}>{Math.round(x.progress || 0)}%</span><StatusPill tone={tone}>{label}</StatusPill></span>} />
              )
            })}
          </ListRows>
        </Section>
      </div>
      <div className="upf-half">
        <Section title="Reviews" sub="Every review about you, newest first." variant="section" body="list" loading={reviews.isLoading} error={reviews.error} onRetry={() => void reviews.refetch()}
          empty={!reviews.isLoading && r.length === 0 ? { title: 'No reviews yet' } : undefined}
          footerLink={!personal ? undefined : { label: 'Open My reviews', onClick: () => navigate('/hrms/performance?view=my-reviews'), arrow: true }}>
          <ListRows label="Reviews" inset>
            {r.map((x) => {
              const [label, tone] = REVIEW[x.status] ?? [x.status, 'neutral' as StatusTone]
              return (
                <ListRow key={x.id} variant="hover" leading={<IconTile icon="star" tone="brand" size={34} />} title={x.cycleName || 'Review'}
                  sub={x.reviewerName ? `By ${x.reviewerName}` : undefined}
                  end={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{x.overallRating != null && <span style={{ fontSize: 12.5, fontWeight: 500 }}>{x.overallRating} / 5</span>}<StatusPill tone={tone}>{label}</StatusPill></span>} />
              )
            })}
          </ListRows>
        </Section>
      </div>
      <div className="upf-full">
        <Section title="Skills & certifications" variant="section" loading={skills.isLoading} error={skills.error} onRetry={() => void skills.refetch()} skeleton="text"
          empty={!skills.isLoading && sk.length === 0 ? { title: 'No skills recorded yet', hint: 'Add skills from Learning.' } : undefined}>
          <div className="upf-chips">{sk.map((x) => <StatusPill key={x.id} tone="mint" size="tag">{x.certified && x.certificationName ? `${x.skillName} · ${x.certificationName}` : x.skillName}</StatusPill>)}</div>
        </Section>
      </div>
    </div>
  )
}
