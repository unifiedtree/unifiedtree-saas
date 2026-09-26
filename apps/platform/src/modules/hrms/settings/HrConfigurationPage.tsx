// HR Configuration (/hrms/settings/hr-configuration, in HRMS settings) in the settings
// pattern of the Payroll Settings design (design/settings/SettingsKit).
// One page for a company's HR rules: employee ID format, probation (length and
// reminders), notice and retirement, the work week, late arrival, attendance
// rules and the fiscal year. Each section says whether the system applies the
// value or only saves it today (docs/Designs/STATIC-UI-TO-BUILD.md §8).
// Late arrival + Attendance rules edit the company's attendance timing policy
// (/v1/attendance/policy, attendance.policy.manage, V143.10) and the geofence /
// work-from-home rules the server now applies.
// The fiscal year is read from and saved to the company record (one source).
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrSelect } from '@/shared/components/hr'
import { DesignFrame } from '@/design/dc/DesignFrame'
import {
  SettingsPage, SettingsSection, SettingsGrid, SettingsInput, SettingsValue, SettingsToggleRow, SettingsNote, useSettingsToast, type SettingsNavItem,
} from '@/design/settings/SettingsKit'
import { useCompanies } from '../api/useOrg'
import { useHrConfig, useUpdateHrConfig, type HrConfigResponse } from '../api/useSettings'
import { useProbationConfig, useUpdateProbationConfig, useProbationReminders, useTriggerProbationScan } from '../api/useProbation'
import { useAttendancePolicy, useSaveAttendancePolicy, type AttendancePolicy, type AllowancePeriod, type AfterAllowance } from '../api/useAttendanceReview'

const DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [7, 'Sun']] as const
const DAY_NAME: Record<number, string> = { 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday', 7: 'Sunday' }
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const title = (m: string) => m.charAt(0) + m.slice(1).toLowerCase()

interface Form {
  prefix: string; next: string
  probationMonths: string; reminderDays: string; autoExtend: boolean; autoExtendDays: string
  noticeDays: string; retirementAge: string
  weekStart: string; weekend: number[]
  grace: string; start: string; halfDayLate: string; allowance: string; period: AllowancePeriod; after: AfterAllowance
  geofence: boolean; wfh: boolean; fullDayHours: string; halfDayHours: string; earlyLeave: string
  fiscal: string
}
const num = (v: string) => (v === '' ? NaN : Number(v))
const digits = (n: number) => (v: string) => v.replace(/\D/g, '').slice(0, n)
/** Hours like "7.5": digits and one dot. */
const hoursIn = (v: string) => v.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1').slice(0, 5)
const AFTER: { value: AfterAllowance; label: string }[] = [
  { value: 'KEEP_LATE', label: 'Keep it as Late' }, { value: 'HALF_DAY', label: 'Count it as a Half day' }, { value: 'LOSS_OF_PAY', label: 'Count it as loss of pay' },
]
const AFTER_WORD: Record<AfterAllowance, string> = { KEEP_LATE: 'late', HALF_DAY: 'a half day', LOSS_OF_PAY: 'loss of pay' }

function formOf(c: HrConfigResponse | undefined, p: { reminderDaysBefore: number; autoExtendEnabled: boolean; autoExtendDays: number } | undefined, a: AttendancePolicy | undefined): Form {
  const pad = c?.employeeCodePadding ?? 4
  return {
    prefix: c?.employeeCodePrefix ?? 'EMP', next: String(c?.employeeCodeNextNumber ?? 1).padStart(pad, '0'),
    probationMonths: String(c?.probationPeriodMonths ?? ''), reminderDays: String(p?.reminderDaysBefore ?? ''), autoExtend: !!p?.autoExtendEnabled, autoExtendDays: String(p?.autoExtendDays ?? ''),
    noticeDays: String(c?.defaultNoticePeriodDays ?? ''), retirementAge: String(c?.retirementAge ?? ''),
    weekStart: String(c?.workweekStartDay ?? 1), weekend: Array.isArray(c?.weekendDays) && c!.weekendDays!.length ? [...c!.weekendDays!].sort() : [6, 7],
    grace: String(a?.graceMinutes ?? c?.lateGraceMinutes ?? ''), start: (a?.defaultStartTime || '09:15').slice(0, 5),
    halfDayLate: a?.halfDayLateMinutes != null ? String(a.halfDayLateMinutes) : '', allowance: String(a?.lateAllowanceCount ?? 0),
    period: a?.lateAllowancePeriod || 'MONTH', after: a?.afterAllowanceAction || 'KEEP_LATE',
    geofence: !!c?.enforceGeofencingForMobile, wfh: !!c?.allowWorkFromHome,
    fullDayHours: a?.fullDayMinHours != null ? String(a.fullDayMinHours) : '', halfDayHours: a?.halfDayMinHours != null ? String(a.halfDayMinHours) : '',
    earlyLeave: String(a?.earlyLeaveMinutes ?? 0),
    fiscal: (c?.fiscalYearStart || 'APRIL').toUpperCase(),
  }
}

export function HrConfigurationPage() {
  const location = useLocation()
  const canHrWrite = usePermission(P.SETTINGS_HRCONFIG_WRITE), canSettingsRead = usePermission(P.SETTINGS_READ)
  const canProbRead = usePermission(P.HRMS_PROBATION_CONFIG_READ), canProbWrite = usePermission(P.HRMS_PROBATION_CONFIG_UPDATE), canReminders = usePermission(P.HRMS_PROBATION_REMINDERS_READ)
  const canPolicy = usePermission('attendance.policy.manage')
  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState('')
  const co = companyId || companies[0]?.id || ''
  const hrQ = useHrConfig(co)
  const probQ = useProbationConfig(canProbRead || canProbWrite)
  const reminders = useProbationReminders(canReminders)
  const scan = useTriggerProbationScan()
  const policyQ = useAttendancePolicy(co || undefined)
  const saveHr = useUpdateHrConfig(), saveProb = useUpdateProbationConfig(), savePolicy = useSaveAttendancePolicy()
  const { toast, show, dismiss } = useSettingsToast()

  const saved = useMemo(() => formOf(hrQ.data, probQ.data, policyQ.data), [hrQ.data, probQ.data, policyQ.data])
  const [edit, setEdit] = useState<Form | null>(null)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setEdit(null); setTried(false) }, [co])
  const hrEdit = canHrWrite, probEdit = canProbWrite, polEdit = canPolicy && !!policyQ.data
  const f = edit || saved
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEdit((cur) => ({ ...(cur || saved), [k]: v }))

  // Validation (only fields the person can change)
  const E: Partial<Record<keyof Form, string>> = {}
  if (hrEdit) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(f.prefix)) E.prefix = 'Use 1–10 letters or digits'
    if (!/^\d{1,8}$/.test(f.next) || Number(f.next) < 1) E.next = 'Enter a number from 1'
    if (f.probationMonths !== '' && !(num(f.probationMonths) >= 0 && num(f.probationMonths) <= 24)) E.probationMonths = 'Between 0 and 24 months'
    if (f.noticeDays !== '' && !(num(f.noticeDays) >= 0 && num(f.noticeDays) <= 365)) E.noticeDays = 'Between 0 and 365 days'
    if (f.retirementAge !== '' && !(num(f.retirementAge) >= 40 && num(f.retirementAge) <= 80)) E.retirementAge = 'Between 40 and 80'
    if (f.weekend.length > 6) E.weekend = 'Leave at least one working day'
  }
  if (polEdit) {
    if (!(num(f.grace) >= 0 && num(f.grace) <= 180)) E.grace = 'Between 0 and 180 minutes'
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(f.start)) E.start = 'Use 24-hour time, like 09:15'
    if (f.halfDayLate !== '' && !(num(f.halfDayLate) >= 1 && num(f.halfDayLate) <= 720)) E.halfDayLate = 'Between 1 and 720 minutes, or empty'
    else if (f.halfDayLate !== '' && num(f.halfDayLate) <= num(f.grace)) E.halfDayLate = 'Must be more than the grace period'
    const maxAllow = f.period === 'WEEK' ? 7 : 31
    if (!(num(f.allowance) >= 0 && num(f.allowance) <= maxAllow)) E.allowance = `Between 0 and ${maxAllow}`
    if (f.fullDayHours !== '' && !(num(f.fullDayHours) > 0 && num(f.fullDayHours) <= 24)) E.fullDayHours = 'More than 0 and up to 24, or empty'
    if (f.halfDayHours !== '' && !(num(f.halfDayHours) > 0 && num(f.halfDayHours) <= 24)) E.halfDayHours = 'More than 0 and up to 24, or empty'
    else if (f.halfDayHours !== '' && f.fullDayHours !== '' && num(f.halfDayHours) >= num(f.fullDayHours)) E.halfDayHours = 'Must be less than the full-day minimum'
    if (!(num(f.earlyLeave) >= 0 && num(f.earlyLeave) <= 600)) E.earlyLeave = 'Between 0 and 600 minutes'
  }
  if (probEdit) {
    if (!(num(f.reminderDays) >= 1 && num(f.reminderDays) <= 90)) E.reminderDays = 'Between 1 and 90 days'
    if (f.autoExtend && !(num(f.autoExtendDays) >= 1 && num(f.autoExtendDays) <= 365)) E.autoExtendDays = 'Between 1 and 365 days'
  }
  const changed = (Object.keys(f) as (keyof Form)[]).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(saved[k]))
  const dirty = !!edit && changed.length > 0
  const errKeys = Object.keys(E) as (keyof Form)[]
  const shown = (k: keyof Form) => (tried || changed.includes(k) ? E[k] : undefined)
  const SECTION_OF: Record<string, string> = { prefix: 'ids', next: 'ids', probationMonths: 'probation', reminderDays: 'probation', autoExtendDays: 'probation', noticeDays: 'notice', retirementAge: 'notice', weekend: 'week', grace: 'late', start: 'late', halfDayLate: 'late', allowance: 'late', fullDayHours: 'attendance', halfDayHours: 'attendance', earlyLeave: 'attendance' }
  const secErr = (s: string) => errKeys.filter((k) => SECTION_OF[k] === s && shown(k)).length

  const doSave = async () => {
    if (errKeys.length) { setTried(true); const first = SECTION_OF[errKeys[0]]; document.getElementById('st-' + first)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
    setSaving(true)
    const hrKeys: (keyof Form)[] = ['prefix', 'next', 'probationMonths', 'noticeDays', 'retirementAge', 'weekStart', 'weekend', 'geofence', 'wfh', 'fiscal']
    const polKeys: (keyof Form)[] = ['grace', 'start', 'halfDayLate', 'allowance', 'period', 'after', 'fullDayHours', 'halfDayHours', 'earlyLeave']
    const probKeys: (keyof Form)[] = ['reminderDays', 'autoExtend', 'autoExtendDays']
    try {
      if (hrEdit && changed.some((k) => hrKeys.includes(k))) {
        await saveHr.mutateAsync({
          companyId: co, body: {
            employeeCodePrefix: f.prefix.toUpperCase(), employeeCodeNextNumber: Number(f.next), employeeCodePadding: f.next.length,
            probationPeriodMonths: f.probationMonths === '' ? undefined : Number(f.probationMonths), defaultNoticePeriodDays: f.noticeDays === '' ? undefined : Number(f.noticeDays),
            retirementAge: f.retirementAge === '' ? undefined : Number(f.retirementAge), workweekStartDay: Number(f.weekStart), weekendDays: f.weekend,
            enforceGeofencingForMobile: f.geofence, allowWorkFromHome: f.wfh,
            // The fiscal year lives on the company record: send it only when it was changed here.
            fiscalYearStart: changed.includes('fiscal') ? f.fiscal : undefined,
          },
        })
      }
      // The grace lives with the rest of the timing policy (the server keeps HR Configuration's copy in step).
      if (polEdit && changed.some((k) => polKeys.includes(k))) {
        await savePolicy.mutateAsync({
          companyId: co, body: {
            graceMinutes: Number(f.grace), defaultStartTime: f.start, halfDayLateMinutes: f.halfDayLate === '' ? null : Number(f.halfDayLate),
            fullDayMinHours: f.fullDayHours === '' ? null : Number(f.fullDayHours), halfDayMinHours: f.halfDayHours === '' ? null : Number(f.halfDayHours),
            earlyLeaveMinutes: Number(f.earlyLeave), lateAllowanceCount: Number(f.allowance), lateAllowancePeriod: f.period, afterAllowanceAction: f.after,
          },
        })
      }
      if (probEdit && changed.some((k) => probKeys.includes(k))) {
        await saveProb.mutateAsync({ reminderDaysBefore: Number(f.reminderDays), autoExtendEnabled: f.autoExtend, autoExtendDays: f.autoExtend ? Number(f.autoExtendDays) : Number(saved.autoExtendDays || 0) })
      }
      await Promise.all([hrQ.refetch(), probQ.refetch(), policyQ.refetch()])
      setEdit(null); setTried(false); show('ok', 'HR settings saved')
    } catch (e) {
      show('error', 'Couldn’t save HR settings', `${e instanceof Error && e.message ? 'Server: “' + e.message + '” ' : ''}Your changes are still here.`)
    } finally { setSaving(false) }
  }

  const readableHr = canHrWrite || canSettingsRead || !!hrQ.data
  const access: 'edit' | 'view' | 'none' = hrEdit || probEdit || polEdit ? 'edit' : readableHr || canProbRead ? 'view' : 'none'
  const status: 'loading' | 'error' | 'live' = (co && (hrQ.isLoading || policyQ.isLoading)) || ((canProbRead || canProbWrite) && probQ.isLoading) ? 'loading' : hrQ.error && !hrQ.data ? 'error' : 'live'
  const preview = !E.prefix && !E.next ? `${f.prefix.toUpperCase()}-${f.next}` : '—'
  const weekendText = f.weekend.length ? f.weekend.map((d) => DAY_NAME[d]).join(' & ') : 'None'
  const nav: SettingsNavItem[] = [
    { key: 'ids', label: 'Employee IDs', state: 'on', errors: secErr('ids') },
    { key: 'probation', label: 'Probation', state: 'on', errors: secErr('probation') },
    { key: 'notice', label: 'Notice & exit', state: 'on', errors: secErr('notice') },
    { key: 'week', label: 'Work week', state: 'on', errors: secErr('week') },
    { key: 'late', label: 'Late arrival', state: 'on', errors: secErr('late') },
    { key: 'attendance', label: 'Attendance rules', state: 'on', errors: secErr('attendance') },
    { key: 'fiscal', label: 'Fiscal year', state: 'on' },
  ]
  const ro = !hrEdit, pro = !probEdit, pol = !polEdit
  const per = f.period === 'WEEK' ? 'week' : 'month'
  const allowN = Number(f.allowance) || 0
  const lateSummary = `${f.grace || '0'} minutes’ grace · ${allowN ? `${allowN} late arrival${allowN === 1 ? '' : 's'} a ${per} allowed, then ${AFTER_WORD[f.after]}` : `every late arrival counts as ${AFTER_WORD[f.after]}`}`
  const hoursSummary = [f.fullDayHours ? `${f.fullDayHours}h for a full day` : '', f.halfDayHours ? `${f.halfDayHours}h for a half day` : ''].filter(Boolean).join(' · ') || 'No minimum hours'
  const selectBox = (label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[], readOnly: boolean) => readOnly
    ? <SettingsValue label={label} value={options.find((o) => o.value === value)?.label || value} />
    : <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>{label}</span><HrSelect value={value} onChange={onChange} options={options} /></div>

  return (
    <DesignFrame>
      <SettingsPage
        crumb="HRMS settings" title="HR Configuration" subtitle="Employee IDs, probation, notice, the work week and attendance rules for each company."
        nav={nav} access={access} status={status} onRetry={() => { void hrQ.refetch(); void probQ.refetch() }} entity="HR settings"
        viewOnlyText="You can view these settings. Ask an HR admin to change them."
        dirty={dirty} changeCount={changed.length} errorCount={tried ? errKeys.length : errKeys.filter((k) => shown(k)).length}
        onGoToError={() => { setTried(true); document.getElementById('st-' + SECTION_OF[errKeys[0]])?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}
        saving={saving} onSave={doSave} onDiscard={() => { setEdit(null); setTried(false) }} toast={toast} onDismissToast={dismiss}>
        {companies.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>Company</span>
            <div style={{ minWidth: 240 }}><HrSelect value={co} onChange={(v: string) => { if (dirty && !window.confirm('Discard your unsaved changes for this company?')) return; setCompanyId(v) }} options={companies.map((c) => ({ value: c.id, label: c.name }))} /></div>
            <span style={{ fontSize: 12.5, color: '#64748b' }}>Probation reminders apply to every company.</span>
          </div>
        )}

        <SettingsSection id="ids" icon="hash" title="Employee IDs" summary={`New people get the next code automatically · next: ${preview}`} readOnly={ro}>
          <SettingsGrid>
            <SettingsInput label="Prefix" value={f.prefix} onChange={(v) => set('prefix', v.replace(/[^A-Za-z0-9]/g, '').slice(0, 10))} readOnly={ro} error={shown('prefix')} mono placeholder="EMP" />
            <SettingsInput label="Next number" value={f.next} onChange={(v) => set('next', digits(8)(v))} readOnly={ro} error={shown('next')} inputMode="numeric" mono hint="Its length sets the padding (0047 → 4 digits)" />
            <SettingsValue label="Next employee code" value={preview} />
          </SettingsGrid>
          <SettingsNote>Only people added after you save get the new format. If a higher code is already in use, the next code skips past it.</SettingsNote>
        </SettingsSection>

        <SettingsSection id="probation" icon="calendarClock" title="Probation" summary={`${f.probationMonths || '—'} months by default · reminders ${f.reminderDays || '—'} days before it ends${f.autoExtend ? ` · auto-extends by ${f.autoExtendDays} days` : ''}`}>
          <SettingsGrid>
            <SettingsInput label="Default probation" value={f.probationMonths} onChange={(v) => set('probationMonths', digits(2)(v))} readOnly={ro} error={shown('probationMonths')} suffix="months" inputMode="numeric" />
            {(canProbRead || probEdit) && <SettingsInput label="Remind managers and HR" value={f.reminderDays} onChange={(v) => set('reminderDays', digits(2)(v))} readOnly={pro} error={shown('reminderDays')} suffix="days before" inputMode="numeric" />}
          </SettingsGrid>
          {(canProbRead || probEdit) && <SettingsToggleRow label="Extend automatically" detail="If nobody confirms a person by the end date, their probation is extended." on={f.autoExtend} onToggle={() => set('autoExtend', !f.autoExtend)} readOnly={pro} />}
          {f.autoExtend && (canProbRead || probEdit) && <SettingsGrid><SettingsInput label="Extend by" value={f.autoExtendDays} onChange={(v) => set('autoExtendDays', digits(3)(v))} readOnly={pro} error={shown('autoExtendDays')} suffix="days" inputMode="numeric" /></SettingsGrid>}
          <SettingsNote>People added from now on get a probation end date of their joining date plus this many months. Changing it doesn’t move the dates of people already hired; use Extend on their page for that.</SettingsNote>
          {f.probationMonths === '0' && <SettingsNote tone="amber">With 0 months, new hires start confirmed on their joining date, with no probation and no probation reminders.</SettingsNote>}
          {canReminders && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 700 }}>Recent reminders</span>
                {probEdit && <button type="button" onClick={() => scan.mutate(undefined, { onSuccess: (r) => show('ok', `Scan complete — ${r.remindersSent} reminder${r.remindersSent === 1 ? '' : 's'} sent`), onError: (e) => show('error', 'Couldn’t run the reminder scan', e instanceof Error ? e.message : undefined) })} disabled={scan.isPending}
                  style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', font: 'inherit', fontSize: 13, fontWeight: 600, color: '#0f172a', cursor: 'pointer' }}>{scan.isPending ? 'Sending…' : 'Send reminders now'}</button>}
              </div>
              {(reminders.data ?? []).length === 0
                ? <SettingsNote>{reminders.isLoading ? 'Loading…' : 'No reminders have been sent yet.'}</SettingsNote>
                : <div style={{ border: '1px solid #f1f5f9', borderRadius: 12, overflow: 'hidden' }}>
                  {(reminders.data ?? []).slice(0, 8).map((r) => (
                    <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px 12px', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
                      <span style={{ flex: 1, fontWeight: 600 }}>{r.employeeName}</span>
                      <span style={{ color: '#64748b' }}>ends {r.probationEndDate}</span>
                      <span style={{ color: '#64748b' }}>{r.reminderType.toLowerCase()}</span>
                      <span style={{ color: '#64748b' }}>{new Date(r.sentAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    </div>
                  ))}
                </div>}
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="notice" icon="logOut" title="Notice & retirement" summary={`${f.noticeDays || '—'} days’ notice by default · retirement at ${f.retirementAge || '—'}`}>
          <SettingsGrid>
            <SettingsInput label="Default notice period" value={f.noticeDays} onChange={(v) => set('noticeDays', digits(3)(v))} readOnly={ro} error={shown('noticeDays')} suffix="days" inputMode="numeric" />
            <SettingsInput label="Retirement age" value={f.retirementAge} onChange={(v) => set('retirementAge', digits(2)(v))} readOnly={ro} error={shown('retirementAge')} suffix="years" inputMode="numeric" />
          </SettingsGrid>
          <SettingsNote>The notice period is the suggested last working day when you start someone’s exit in Employee Master. Retirement is counted from each person’s date of birth: the dashboard lists who retires in the next six months, and people with the “Get retirement alerts” permission are alerted 90 and 30 days before.</SettingsNote>
        </SettingsSection>

        <SettingsSection id="week" icon="calendarDays" title="Work week" summary={`Starts ${DAY_NAME[Number(f.weekStart)]} · ${weekendText} off`}>
          <SettingsGrid>
            {ro ? <SettingsValue label="Week starts on" value={DAY_NAME[Number(f.weekStart)]} />
              : <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Week starts on</span><HrSelect value={f.weekStart} onChange={(v: string) => set('weekStart', v)} options={DAYS.map(([d, l]) => ({ value: String(d), label: DAY_NAME[d] || l }))} /></div>}
          </SettingsGrid>
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Weekly off days</span>
            <div role="group" aria-label="Weekly off days" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {DAYS.map(([d, l]) => {
                const on = f.weekend.includes(d)
                return <button key={d} type="button" aria-pressed={on} disabled={ro} onClick={() => set('weekend', on ? f.weekend.filter((x) => x !== d) : [...f.weekend, d].sort())}
                  style={{ minWidth: 52, height: 38, borderRadius: 10, border: `1px solid ${on ? '#6ee7b7' : '#e2e8f0'}`, background: on ? '#ecfdf5' : '#fff', color: on ? '#0a5240' : '#475569', font: 'inherit', fontSize: 13, fontWeight: 700, cursor: ro ? 'default' : 'pointer' }}>{l}</button>
              })}
            </div>
            {shown('weekend') && <span style={{ fontSize: 12.5, fontWeight: 600, color: '#b91c1c' }}>{shown('weekend')}</span>}
          </div>
          <SettingsNote tone="amber">The leave form and leave calendar treat these days as off. The server still counts leave with Saturday and Sunday off, and attendance uses each person’s own weekly offs (set on their record).</SettingsNote>
        </SettingsSection>

        <SettingsSection id="late" icon="clock" title="Late arrival" summary={lateSummary}>
          <SettingsGrid>
            <SettingsInput label="Company grace period" value={f.grace} onChange={(v) => set('grace', digits(3)(v))} readOnly={pol} error={shown('grace')} suffix="minutes" inputMode="numeric" hint="A shift with its own grace (more than 0) uses that instead." />
            <SettingsInput label="Start time without a shift" value={f.start} onChange={(v) => set('start', v.replace(/[^\d:]/g, '').slice(0, 5))} readOnly={pol} error={shown('start')} placeholder="09:15" mono hint="People with no shift are late after this time plus the grace." />
            <SettingsInput label="Half day if later than" value={f.halfDayLate} onChange={(v) => set('halfDayLate', digits(3)(v))} readOnly={pol} error={shown('halfDayLate')} suffix="minutes" inputMode="numeric" placeholder="Off" hint="Minutes after the start time. Leave empty to turn this off." />
          </SettingsGrid>
          <SettingsGrid>
            <SettingsInput label="Late arrivals allowed" value={f.allowance} onChange={(v) => set('allowance', digits(2)(v))} readOnly={pol} error={shown('allowance')} suffix={`a ${per}`} inputMode="numeric" hint="These count as present. 0 means no allowance." />
            {selectBox('Allowance resets every', f.period, (v) => set('period', v as AllowancePeriod), [{ value: 'WEEK', label: 'Week' }, { value: 'MONTH', label: 'Month' }], pol)}
            {selectBox('After the allowance is used', f.after, (v) => set('after', v as AfterAllowance), AFTER, pol)}
          </SettingsGrid>
          <SettingsNote>A check-in after the start time plus the grace is late. {allowN ? `The first ${allowN} late arrival${allowN === 1 ? '' : 's'} each ${per} count as present; after that, each one counts as ${AFTER_WORD[f.after]}.` : `Each late arrival counts as ${AFTER_WORD[f.after]}.`} Arriving later than the half-day limit is always a half day. Days a reviewer excuses (Attendance → Daily Tracking → Review) don’t use up the allowance. Applies to the roster, muster roll, dashboards and everyone’s attendance history.</SettingsNote>
          {f.after !== 'KEEP_LATE' && <SettingsNote tone="amber">{f.after === 'LOSS_OF_PAY' ? 'Warning: late arrivals past the allowance count as a full day’s loss of pay. Payroll can deduct pay for them.' : 'Warning: late arrivals past the allowance count as half days. Payroll can deduct half a day’s pay for each one.'}</SettingsNote>}
          {canPolicy && !policyQ.data && policyQ.isError && <SettingsNote tone="amber">The attendance policy didn’t load, so these fields can’t be changed right now. Reload the page to try again.</SettingsNote>}
          {policyQ.data?.updatedAt && <SettingsNote>Last changed {new Date(policyQ.data.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}{policyQ.data.updatedByName ? ` by ${policyQ.data.updatedByName}` : ''}.</SettingsNote>}
        </SettingsSection>

        <SettingsSection id="attendance" icon="mapPin" title="Attendance rules" summary={`Geofencing on mobile ${f.geofence ? 'required' : 'not required'} · work from home ${f.wfh ? 'allowed' : 'not allowed'} · ${hoursSummary}`}>
          <SettingsToggleRow label="Require geofencing on mobile" detail="Mobile check-ins outside the branch’s zone (or the person’s own zone) are refused. When off, they’re accepted and listed for review." on={f.geofence} onToggle={() => set('geofence', !f.geofence)} readOnly={ro} />
          <SettingsToggleRow label="Allow work from home" detail="People can request work-from-home days. When off, nobody in this company can request one." on={f.wfh} onToggle={() => set('wfh', !f.wfh)} readOnly={ro} />
          <SettingsGrid>
            <SettingsInput label="Minimum hours for a full day" value={f.fullDayHours} onChange={(v) => set('fullDayHours', hoursIn(v))} readOnly={pol} error={shown('fullDayHours')} suffix="hours" inputMode="decimal" placeholder="Off" hint="Fewer hours between check-in and check-out is a half day." />
            <SettingsInput label="Minimum hours for a half day" value={f.halfDayHours} onChange={(v) => set('halfDayHours', hoursIn(v))} readOnly={pol} error={shown('halfDayHours')} suffix="hours" inputMode="decimal" placeholder="Off" hint="Fewer hours is an absence. Leave empty to turn off." />
            <SettingsInput label="Early leave after" value={f.earlyLeave} onChange={(v) => set('earlyLeave', digits(3)(v))} readOnly={pol} error={shown('earlyLeave')} suffix="minutes" inputMode="numeric" hint="Minutes before the shift ends. 0 means any time before the end." />
          </SettingsGrid>
          <SettingsNote>An approved work-from-home day still lets that person check in from anywhere, and requests already approved still count if you turn work from home off. Early leaving is shown for review; it doesn’t change the day by itself.</SettingsNote>
          {(f.fullDayHours || f.halfDayHours) && <SettingsNote tone="amber">Warning: days under the minimum hours count as half days or absences, which payroll can deduct. People who forget to check out aren’t judged on hours; they show as “No check-out” for review.</SettingsNote>}
        </SettingsSection>

        <SettingsSection id="fiscal" icon="calendar" title="Fiscal year" summary={`Starts in ${title(f.fiscal)}`}>
          <SettingsGrid>
            {ro ? <SettingsValue label="Fiscal year starts in" value={title(f.fiscal)} />
              : <div style={{ display: 'grid', gap: 6 }}><span style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Fiscal year starts in</span><HrSelect value={f.fiscal} onChange={(v: string) => set('fiscal', v)} options={MONTHS.map((m) => ({ value: m, label: title(m) }))} /></div>}
          </SettingsGrid>
          <SettingsNote>Saved on this company’s record, the one fiscal year everything uses (for example, joiners and leavers “this fiscal year” in the headcount export). April is the Indian financial year, April to March.</SettingsNote>
        </SettingsSection>
      </SettingsPage>
      {status === 'live' && location.pathname.endsWith('/work-time') && <ScrollTo id="st-week" />}
    </DesignFrame>
  )
}

/** /hrms/settings/work-time opens at the Work week section. */
function ScrollTo({ id }: { id: string }) {
  useEffect(() => {
    // Waits for the section, then scrolls the shell's scroller (not the window) so it sits under the header.
    let tries = 0, t: ReturnType<typeof setTimeout>
    const go = () => {
      const el = document.getElementById(id)
      let sc = el?.parentElement || null
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      if (el && sc) sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 88 })
      else if (tries++ < 20) t = setTimeout(go, 100)
    }
    t = setTimeout(go, 50)
    return () => clearTimeout(t)
  }, [id])
  return null
}
