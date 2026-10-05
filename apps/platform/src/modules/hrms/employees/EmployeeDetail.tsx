/**
 * Employee profile, HR view (/hrms/employees/:id) — the page every employee reference lands on
 * (the directory, ⌘K search, every name link). Redesign: prototype PgProfile (self=false) +
 * PgProfileTabs, on the kit, in ProfileFrame (banner, left card, right card with tabs).
 *
 * This file loads the record and everything the left card and Overview show, maps each action to
 * its API, and puts each tab's real sections in the frame. Nothing is invented: a value the API
 * doesn't have shows a dash, and a block the viewer can't read says so.
 *
 * Who sees what (unchanged, plus the redesign's additions):
 *   - the record: hrms.employee.read; a direct manager holding hrms.employee.team.manage gets the
 *     list view without pay, bank or identity (BW-97), and only the tabs their permissions open;
 *   - each tab by its read permission (see `tabs` below); each endpoint enforces its own scope;
 *   - Access (client, 1 Oct): workspace.users.manage — sign-in, roles, extra permissions.
 * The tab lives in the URL (?tab=, replaced, so Back leaves the page rather than stepping tabs).
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { P, usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { Button, EmptyState, ErrorState, Section, Skeleton, type CalendarDay, type StatusTone } from '@/design/kit/display'
import { Menu, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import {
  useWorkforceEmployee, useConfirmEmployee, useStartNotice, useExitEmployee, useCancelNotice, useEmployeesByIds, useUpdateWorkforceEmployee,
  EXIT_TYPES, exitTypeLabel, type UpdateWorkforceEmployeePayload, type EmploymentType, type ExitType,
} from '../api/useWorkforce'
import { useExtendProbation } from '../api/useProbation'
import { useCompanies, useDepartments, useDesignations, useBranches, useEmploymentTypes, assignEmployeeShift } from '../api/useOrg'
import { useEmployeeWeeklySummary } from '../api/useAttendance'
import { useEmployeeShift, useShiftPolicies } from '../api/useShiftPolicies'
import { useEmployeeStructure } from '../api/usePayroll'
import { useEmployeeDocuments, useEmployeeDocumentSummary } from '../api/useDocument'
import { useEmployeeKpis } from '../api/usePerformance'
import { useEmployeeLeaveBalances } from '../api/useLeave'
import type { OnboardingRecordData } from '../onboarding/OnboardingRecord'
import { dayCell } from '../attendance/daily/MyAttendance'
import { sendInvite, resendInvite } from './api/useInvitation'
import { resetFaceEnrollment } from './api/useFaceAdmin'
import { invitationKey, useEmployeeMonth, useInvitationStatus } from './api/useProfileData'
import { EmployeeFaceEnrollButton, employeeFaceLine, useEmployeeFaceStatus } from '../attendance/face/FaceEnrollment'
import { faceErrorText } from '../attendance/face/faceEnroll'
import { EmployeeForm } from './EmployeeForm'
import { ProfileFrame, type ProfileField } from './workspace/ProfileFrame'
import { AccountCard, AttentionList, EmploymentCard, GlanceRow, MonthCard, OnboardingCard, type Attention, type Glance, type OnboardingView } from './workspace/HrOverview'
import { EditProfilePanel, LifecycleDialog, ShiftPanel, type EditField, type LifecycleCalls, type LifecycleKind } from './workspace/HrPanels'
import { FaceResetDialog } from './workspace/FaceResetDialog'
import { EmployeeAccess, useCanManageAccess } from './workspace/EmployeeAccess'
import { EmployeePersonal } from './workspace/EmployeePersonal'
import { EmployeeJob } from './workspace/EmployeeJob'
import { EmployeeAttendance } from './workspace/EmployeeAttendance'
import { EmployeeMonth } from './workspace/EmployeeMonth'
import { EmployeePayroll } from './workspace/EmployeePayroll'
import { EmployeeDocuments, EMPLOYEE_DOCUMENTS_PAGE_SIZE } from './workspace/EmployeeDocuments'
import { EmployeeLetters } from './workspace/EmployeeLetters'
import { EmployeePerformance } from './workspace/EmployeePerformance'
import { EmployeeExit } from './workspace/EmployeeExit'
import { EmployeeLeave } from './workspace/EmployeeLeave'
import { EmployeeExpenses } from './workspace/EmployeeExpenses'
import { daysUntil, fmtDate, fmtDateTime, hrs, inr, plural, tenure } from './workspace/profileFormat'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { greetingName } from '@/shared/hooks/greetingName'

const STATUS: Record<string, [string, StatusTone]> = {
  ACTIVE: ['Active', 'brand'], PROBATION: ['Probation', 'mint'], NOTICE_PERIOD: ['Notice period', 'warning'],
  SUSPENDED: ['Suspended', 'danger'], EXITED: ['Exited', 'muted'], TERMINATED: ['Terminated', 'danger'],
}
const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', INTERN: 'Intern', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
const hm = (t?: string | null) => (t ? t.slice(0, 5) : '')

export function EmployeeDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const today = istToday()
  const [fullForm, setFullForm] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [shiftOpen, setShiftOpen] = useState(false)
  const [life, setLife] = useState<LifecycleKind | null>(null)
  const [resetAsk, setResetAsk] = useState(false)
  const [inviting, setInviting] = useState(false)

  // ── permissions (the codes each endpoint checks) ──
  const canRead = usePermission(P.HRMS_EMPLOYEE_READ)
  const canWrite = usePermission(P.HRMS_EMPLOYEE_WRITE), canInvite = usePermission(P.HRMS_EMPLOYEE_INVITE)
  const canFace = usePermission('attendance.face.admin.reset'), canShift = usePermission('attendance.workforce.admin')
  const canPii = usePermission(P.HRMS_EMPLOYEE_PROFILE_READ), canIdentity = usePermission(P.HRMS_EMPLOYEE_IDENTITY_READ)
  const canAttendance = usePermission('attendance.team.read'), canSalary = usePermission(P.PAYROLL_STRUCTURE_READ), canBank = usePermission(P.HRMS_EMPLOYEE_BANK_READ)
  const canDocs = usePermission('hrms.document.read'), canLetters = usePermission(P.HRMS_LETTERS_READ)
  const canPerf = usePermission('hrms.performance.read'), canSkills = usePermission('hrms.learning.skill.read')
  // Leave / Expenses tabs: anyone (HR, admin; finance for claims), a manager's team, or yourself.
  const canLeave = usePermission('hrms.leave.employee.read'), canLeaveTeam = usePermission('hrms.leave.approve.l1')
  const canClaims = usePermission('hrms.expense.employee.read'), canClaimsTeam = usePermission('hrms.expense.claim.approve')
  const canAccess = useCanManageAccess()
  const { data: me } = useCurrentUser()
  const self = !!me?.employeeId && me.employeeId === id

  // ── data ──
  const empQ = useWorkforceEmployee(id)
  const emp = empQ.data
  const co = emp?.companyId ?? ''
  // The real face enrollment (the record's own flag isn't kept up to date by face punch-in).
  const faceQ = useEmployeeFaceStatus(emp?.id, canFace)
  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(co)
  const { data: designations = [] } = useDesignations(co)
  const { data: branches = [] } = useBranches(co)
  const { data: types = [] } = useEmploymentTypes(canWrite ? co : '')
  const { data: shiftList = [] } = useShiftPolicies(canShift ? co : '')
  const { data: managers } = useEmployeesByIds(emp?.reportingManagerId ? [emp.reportingManagerId] : [], { enabled: canRead })
  const week = useEmployeeWeeklySummary(id, undefined, { enabled: canAttendance && !!emp })
  const shift = useEmployeeShift(id, { enabled: (canAttendance || canShift) && !!emp })
  const structure = useEmployeeStructure(canSalary && emp ? id : '')
  const balances = useEmployeeLeaveBalances(id, Number(today.slice(0, 4)), !canSalary && (canLeave || canLeaveTeam) && !!emp)
  const documents = useEmployeeDocuments(id, 0, canDocs && !!emp, EMPLOYEE_DOCUMENTS_PAGE_SIZE)
  // Exact counts over all of this person's documents (BW-77); older servers fall back to the first page.
  const docSummary = useEmployeeDocumentSummary(id, canDocs && !!emp)
  // Goals tile: only goals still being worked on (active or at risk), not completed or dropped ones.
  const kpis = useEmployeeKpis(id, { enabled: canPerf && !!emp, activeOnly: true })
  const invitation = useInvitationStatus(id, !!emp)
  const ym = today.slice(0, 7)
  const month = useEmployeeMonth(id, Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), canAttendance && !!emp)
  const onboarding = useQuery({
    queryKey: ['hrms', 'onboarding-record', id],
    queryFn: () => apiJson<OnboardingRecordData>(`/v1/hrms/employees/${id}/onboarding-record`),
    enabled: canWrite && !!emp, retry: false,
  })

  const confirmM = useConfirmEmployee(), noticeM = useStartNotice(), exitM = useExitEmployee(), cancelM = useCancelNotice()
  const extendM = useExtendProbation(), updateM = useUpdateWorkforceEmployee()

  const tabParam = params.get('tab') || 'overview'
  const setTab = (k: string) => { const n = new URLSearchParams(params); if (k === 'overview') n.delete('tab'); else n.set('tab', k); setParams(n, { replace: true }) }
  // People who can't open the directory (a manager on their report) go back to where they came from, else My team.
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(canRead ? '/hrms/employees' : '/team'))

  const view = useMemo(() => {
    if (!emp) return null
    const name = [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' ') || emp.employeeCode
    const call = greetingName(emp.firstName, emp.lastName) || name
    const [stLabel, stTone] = STATUS[emp.employmentStatus || 'ACTIVE'] || ['Active', 'brand']
    const company = companies.find((c) => c.id === emp.companyId), dept = departments.find((d) => d.id === emp.departmentId)
    const desig = designations.find((d) => d.id === emp.designationId), branch = branches.find((b) => b.id === emp.branchId)
    const separated = emp.employmentStatus === 'EXITED' || emp.employmentStatus === 'TERMINATED'
    const mgr = managers?.[0]
    const mgrName = mgr ? [mgr.firstName, mgr.lastName].filter(Boolean).join(' ') : emp.reportingManagerId && emp.reportingManagerId === me?.employeeId ? 'You' : ''
    const s = shift.data
    const shiftLabel = (n?: string | null, a?: string | null, b?: string | null) => (n ? `${n}${a ? ` · ${hm(a)} – ${hm(b)}` : ''}` : 'No shift assigned')
    const w = week.data
    const todayRow = w?.days?.find((d) => d.date === today)
    const inv = invitation.data
    const active = !!(inv?.activated ?? emp.hasAccount)

    // ── left card ──
    const fields: ProfileField[] = [
      { key: 'code', label: 'Employee code', icon: 'code', value: emp.employeeCode },
      { key: 'email', label: 'Work email', icon: 'mail', value: emp.email, verified: active, verifiedLabel: 'Account active' },
      { key: 'mobile', label: 'Mobile', icon: 'phone', value: emp.phone },
      {
        key: 'mgr', label: 'Reports to', icon: 'user',
        value: mgr ? <button type="button" onClick={() => navigate(`/hrms/employees/${mgr.id}`)}>{mgrName}</button> : (mgrName || (emp.reportingManagerId ? '—' : 'No manager set')),
      },
      { key: 'loc', label: 'Work location', icon: 'pin', value: branch?.name || '' },
      { key: 'joined', label: 'Joined', icon: 'cal', value: emp.dateOfJoining ? [fmtDate(emp.dateOfJoining), tenure(emp.dateOfJoining, today)].filter(Boolean).join(' · ') : '' },
    ]

    // ── Overview: glance ──
    const late = w?.days?.filter((x) => x.status === 'LATE').length ?? 0
    const sum = docSummary.data
    const docTotal = sum ? sum.onFile : documents.data?.totalElements
    const docRows = documents.data?.content ?? []
    // Waiting for review: the summary's exact count; without it, only when every document is on the first page.
    const docPending = sum ? sum.waitingForHr
      : docTotal != null && docTotal <= docRows.length ? docRows.filter((d) => ((d as { verificationStatus?: string }).verificationStatus || 'PENDING') === 'PENDING').length : null
    const leaveLeft = (balances.data ?? []).reduce((n, b) => n + (b.available || 0), 0)
    const glance: Glance[] = [
      canAttendance
        ? { label: 'This week', value: w ? hrs(w.totalHours) : null, loading: week.isLoading, icon: 'clock', tone: 'brand', note: w ? `${plural(w.presentDays, 'day')} present${late ? ` · ${late} late` : ''}` : week.error ? 'Couldn’t load' : '', onClick: () => setTab('attendance') }
        : { label: 'This week', value: null, icon: 'clock', tone: 'gray', note: 'No access', onClick: () => setTab('overview') },
      canSalary
        ? { label: 'Annual CTC', value: structure.data ? inr(Number(structure.data.ctcAnnual || 0)) : structure.isLoading ? null : '—', loading: structure.isLoading, icon: 'rupee', tone: 'brand', note: structure.data?.effectiveFrom ? `since ${fmtDate(structure.data.effectiveFrom)}` : structure.isLoading ? '' : 'No salary structure yet', onClick: () => setTab('payroll') }
        : (canLeave || canLeaveTeam)
          ? { label: 'Leave balance', value: balances.data ? `${Number.isInteger(leaveLeft) ? leaveLeft : leaveLeft.toFixed(1)} days` : null, loading: balances.isLoading, icon: 'calendarDays', tone: 'brand', note: balances.error ? 'No access' : 'left this year', onClick: () => setTab('leave') }
          : { label: 'Annual CTC', value: null, icon: 'rupee', tone: 'gray', note: 'No access', onClick: () => setTab('overview') },
      canDocs
        ? { label: 'Documents', value: docTotal != null ? String(docTotal) : null, loading: documents.isLoading, icon: 'file', tone: docPending ? 'gold' : 'brand', note: docPending ? `${docPending} waiting for review` : 'on record', onClick: () => setTab('documents') }
        : { label: 'Documents', value: null, icon: 'file', tone: 'gray', note: 'No access', onClick: () => setTab('overview') },
      canPerf
        ? { label: 'Goals', value: kpis.data ? String(kpis.data.total) : null, loading: kpis.isLoading, icon: 'target', tone: 'brand', note: 'active goals and KPIs', onClick: () => setTab('performance') }
        : { label: 'Goals', value: null, icon: 'target', tone: 'gray', note: 'No access', onClick: () => setTab('overview') },
    ]

    // ── Overview: Employment ──
    const onProbation = emp.employmentStatus === 'PROBATION'
    const probation = onProbation
      ? (emp.probationEndDate ? (daysUntil(emp.probationEndDate, today) >= 0 ? `Ends in ${plural(daysUntil(emp.probationEndDate, today), 'day')} · ${fmtDate(emp.probationEndDate)}` : `Ended ${fmtDate(emp.probationEndDate)}, not confirmed`) : 'End date not set')
      : emp.confirmationDate ? `Completed ${fmtDate(emp.confirmationDate)}` : '—'
    const employment = [
      { label: 'Designation', value: desig?.title || '—' },
      { label: 'Department', value: dept?.name || '—' },
      { label: 'Employment type', value: TYPE_LABEL[emp.employmentType || ''] || emp.employmentType || '—' },
      { label: 'Company', value: company?.name || '—' },
      { label: 'Work location', value: branch?.name || '—' },
      { label: 'Joined', value: fmtDate(emp.dateOfJoining) },
      { label: 'Probation', value: probation },
      { label: 'Reports to', value: mgrName || '—' },
      ...((canAttendance || canShift) ? [{ label: 'Shift', value: shift.isLoading ? '…' : shiftLabel(s?.shiftName, s?.startTime, s?.endTime) }] : []),
      ...(emp.lastWorkingDay ? [{ label: 'Last working day', value: fmtDate(emp.lastWorkingDay) }] : []),
    ]

    // ── Overview: Needs attention (today's rules, plus a missed punch-out this week) ──
    const attention: Attention[] = []
    // While on probation there is always a row with Confirm / Extend (today's probation banner);
    // it turns amber within 30 days of the end date or once it has passed.
    if (onProbation) {
      const d = emp.probationEndDate ? daysUntil(emp.probationEndDate, today) : null
      attention.push({
        tone: d == null || d <= 30 ? 'amber' : 'ok',
        title: d == null ? 'Probation end date not set' : d < 0 ? `Probation ended ${plural(-d, 'day')} ago and isn’t confirmed yet` : `Probation ends in ${plural(d, 'day')}`,
        sub: d == null ? 'Set a date so the confirmation reminder runs on time' : d < 0 ? `It ended on ${fmtDate(emp.probationEndDate)}: confirm, extend or begin exit` : `${fmtDate(emp.probationEndDate)} · confirm or extend before the end date`,
        actions: canWrite ? <>
          <Button size={30} variant="soft" onClick={() => setLife('confirm')}>Confirm as permanent</Button>
          <Button size={30} variant="secondary" onClick={() => setLife('extend')}>Extend</Button>
        </> : undefined,
      })
    }
    if (emp.employmentStatus === 'NOTICE_PERIOD') {
      const d = emp.lastWorkingDay ? daysUntil(emp.lastWorkingDay, today) : null
      attention.push({ tone: 'amber', title: d == null ? 'Serving notice' : d >= 0 ? `Serving notice: last working day in ${plural(d, 'day')}` : 'Notice period has passed its last working day', sub: emp.lastWorkingDay ? fmtDate(emp.lastWorkingDay) : undefined, cta: { label: 'Open exit', onClick: () => setTab('exit') } })
    }
    if (canSalary && !structure.isLoading && !structure.error && !structure.data && !separated) attention.push({ tone: 'red', title: 'No salary structure', sub: `${call} can’t be included in a payroll run until one is set up.`, cta: { label: 'Set up payroll', onClick: () => setTab('payroll') } })
    if ((canAttendance || canShift) && !shift.isLoading && !shift.error && !s?.shiftPolicyId && !separated) attention.push({ tone: 'amber', title: 'No shift assigned', sub: 'Lateness and overtime can’t be measured.', cta: { label: 'See attendance', onClick: () => setTab(canAttendance ? 'attendance' : 'job') } })
    const absent = w?.days?.filter((x) => x.status === 'ABSENT' && x.date < today).length ?? 0
    if (absent > 0) attention.push({ tone: 'amber', title: `${plural(absent, 'day')} with no attendance this week`, sub: 'Unmarked or absent', cta: { label: 'See attendance', onClick: () => setTab('attendance') } })
    const noOut = w?.days?.filter((x) => x.checkInTime && !x.checkOutTime && x.date < today) ?? []
    if (noOut.length) attention.push({ tone: 'amber', title: `${plural(noOut.length, 'day')} with no punch-out this week`, sub: noOut.map((x) => fmtDate(x.date)).join(', '), cta: { label: 'See attendance', onClick: () => setTab('attendance') } })
    if (docPending) attention.push({ tone: 'amber', title: `${plural(docPending, 'document')} to review`, sub: 'Verify each one before payroll uses it', cta: { label: 'Review', onClick: () => setTab('documents') } })
    // Titles may be missing from an older server's summary: the count still shows.
    const expiredTitles = sum?.expiredTitles ?? []
    if (sum?.expired) attention.push({ tone: 'red', title: `${plural(sum.expired, 'document')} expired`, sub: expiredTitles.slice(0, 3).join(', ') + (expiredTitles.length > 3 ? '…' : ''), cta: { label: 'See documents', onClick: () => setTab('documents') } })

    // ── Overview: this month ──
    const cells: CalendarDay[] = (month.data ?? []).map((d) => dayCell(d, today))

    // ── Overview: Account ──
    const lastAt = inv?.lastLoginAt
    const invite = canInvite && !active ? {
      label: inv?.invitedAt ? 'Resend invitation' : 'Send invitation', primary: !inv?.invitedAt, busy: inviting,
      onClick: async () => {
        if (!emp.email) { toast.error('Add a work email before sending an invitation'); return }
        setInviting(true)
        try {
          if (inv?.invitedAt) await resendInvite(emp.id); else await sendInvite(emp.id)
          await qc.invalidateQueries({ queryKey: invitationKey(id) })
          toast.success(`Invitation sent to ${emp.email}`)
        } catch (e) { toast.error('Couldn’t send the invitation', { detail: (e as Error)?.message }) } finally { setInviting(false) }
      },
    } : null
    const account = {
      active,
      title: active ? 'Account active' : inv?.invitedAt ? 'Invitation sent' : 'No login account yet',
      sub: active ? '' : inv?.invitedAt ? `${emp.email} · sent ${fmtDate(inv.invitedAt)}` : `${call} can’t sign in until invited.`,
      lastSignIn: lastAt ? [fmtDateTime(lastAt, today), inv?.lastLoginDevice].filter(Boolean).join(' · ') : active ? 'Hasn’t signed in yet' : '—',
      face: canFace ? employeeFaceLine(faceQ, emp.faceEnrolled ? 'Enrolled' : 'Not enrolled') : null,
      resetNote: canFace,
      invite,
      faceActions: canFace ? <>
        {faceQ.data && <EmployeeFaceEnrollButton employeeId={emp.id} name={name} status={faceQ.data} onEnrolled={() => void faceQ.refetch()} />}
        <Button size={36} variant="secondary" onClick={() => setResetAsk(true)}>Reset face enrollment</Button>
      </> : undefined,
    }

    // ── Overview: onboarding record (people who can edit employees only: the endpoint's rule) ──
    const rec = onboarding.data
    const recEmpty = !rec || !Object.keys(rec).length
    const onb: OnboardingView = {
      sub: `Captured when ${call} was hired · ${fmtDate(emp.dateOfJoining)}`,
      note: onboarding.isLoading ? 'Loading…' : onboarding.error ? 'The onboarding record couldn’t be loaded.' : recEmpty ? 'No onboarding record was saved for this hire.' : '',
      fields: [
        ...([
          rec?.hire?.offerAcceptedOn ? { l: 'Offer accepted', v: fmtDate(rec.hire.offerAcceptedOn) } : null,
          rec?.hire?.hiringManager ? { l: 'Hiring manager', v: rec.hire.hiringManager.name } : null,
          rec?.hire?.recruiter ? { l: 'Recruiter', v: rec.hire.recruiter.name } : null,
          rec?.hire?.source ? { l: 'Source', v: rec.hire.source } : null,
          rec?.hire?.buddy ? { l: 'Buddy', v: rec.hire.buddy.name } : null,
        ].filter(Boolean) as { l: string; v: string }[]),
        ...Object.entries(rec?.details ?? {}).filter(([, v]) => v).map(([k, v]) => ({ l: humanize(k), v: String(v) })),
      ],
      assets: (rec?.assets ?? []).map((a, i) => ({ id: String(i), type: a.type, model: a.model, serial: a.serial, on: fmtDate(a.issuedOn) })),
      policies: rec?.selectedPolicies ?? [],
      checklists: [
        rec?.joiningChecklist && Object.keys(rec.joiningChecklist).length ? { title: 'Joining checklist', rows: Object.entries(rec.joiningChecklist).map(([k, ok]) => ({ l: humanize(k), s: ok ? 'Confirmed' : 'Pending', t: ok ? 'ok' as const : 'warn' as const })) } : null,
        rec?.documentChecklist && Object.keys(rec.documentChecklist).length ? { title: 'Document verification checklist', rows: Object.entries(rec.documentChecklist).map(([k, d]) => ({ l: `${humanize(k)}${d?.fileName ? ' · ' + d.fileName : ''}`, s: d?.status === 'VERIFIED' ? 'Confirmed' : d?.status === 'REJECTED' ? 'Rejected' : 'Pending', t: d?.status === 'VERIFIED' ? 'ok' as const : d?.status === 'REJECTED' ? 'red' as const : 'warn' as const })) } : null,
      ].filter(Boolean) as OnboardingView['checklists'],
    }

    // ── Edit panel ──
    const typeOpts = (types.length ? types.filter((t) => t.code && TYPE_LABEL[t.code]).map((t) => ({ value: t.code!, label: t.name })) : Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })))
    const withCur = (opts: { value: string; label: string }[], cur?: string | null) => (cur && !opts.some((o) => o.value === cur) ? [...opts, { value: cur, label: TYPE_LABEL[cur] || cur }] : opts)
    const basic: EditField[] = [
      { key: 'firstName', label: 'First name', value: emp.firstName || '', required: true },
      { key: 'lastName', label: 'Last name', value: emp.lastName || '' },
      { key: 'email', label: 'Work email', value: emp.email || '', type: 'email', remote: 'email', check: (v) => (/^\S+@\S+\.\S+$/.test(v) ? '' : 'Enter a valid email address') },
      { key: 'phone', label: 'Mobile', value: emp.phone || '', placeholder: '+91 98450 12345', remote: 'phone', check: (v) => (/^[+\d][\d\s-]{6,19}$/.test(v) ? '' : 'Enter a valid phone number') },
      { key: 'departmentId', label: 'Department', value: emp.departmentId || '', options: departments.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name })) },
      { key: 'designationId', label: 'Designation', value: emp.designationId || '', options: designations.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.title })) },
      { key: 'branchId', label: 'Branch', value: emp.branchId || '', options: branches.filter((b) => b.active !== false).map((b) => ({ value: b.id, label: b.name })) },
      { key: 'employmentType', label: 'Employment type', value: emp.employmentType || '', options: withCur(typeOpts, emp.employmentType) },
      { key: 'dateOfJoining', label: 'Date of joining', value: emp.dateOfJoining || '', type: 'date' },
    ]
    const financial: EditField[] = [
      { key: 'ctcAnnual', label: 'Annual CTC (₹)', value: emp.ctcAnnual != null ? String(emp.ctcAnnual) : '', type: 'number', placeholder: 'Leave blank to keep the current CTC', check: (v) => (Number(v) > 0 ? '' : 'Enter an amount above 0') },
      { key: 'bankAccountNumber', label: 'Bank account number', value: '', placeholder: emp.bankAccountNumber ? `Leave blank to keep ${emp.bankAccountNumber}` : '12–18 digits', check: (v) => (/^\d{9,18}$/.test(v.replace(/\s/g, '')) ? '' : 'Use 9 to 18 digits') },
      { key: 'bankIfsc', label: 'IFSC', value: emp.bankIfsc || '', placeholder: 'SBIN0001234', check: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()) ? '' : 'Format: SBIN0001234') },
      { key: 'panNumber', label: 'PAN', value: '', placeholder: 'Leave blank to keep the PAN on record', check: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()) ? '' : 'Format: ABCDE1234F') },
      { key: 'uanNumber', label: 'UAN', value: emp.uan || '', placeholder: '12 digits', check: (v) => (/^\d{12}$/.test(v) ? '' : 'UAN has 12 digits') },
      { key: 'taxRegime', label: 'Tax regime', value: '', off: true, placeholder: 'Set on the salary structure', hint: 'The tax regime lives on each salary structure (Payroll tab).' },
    ]
    const saveEdit = async (v: Record<string, string>) => {
      const patch: UpdateWorkforceEmployeePayload = {}
      for (const f of basic) { const nv = (v[f.key] ?? '').trim(); if (nv !== (f.value ?? '')) (patch as Record<string, unknown>)[f.key] = nv }
      if (patch.employmentType) patch.employmentType = patch.employmentType as EmploymentType
      const ctc = (v.ctcAnnual ?? '').trim(); if (ctc && ctc !== financial[0].value) patch.ctcAnnual = Number(ctc)
      const acct = (v.bankAccountNumber ?? '').replace(/\s/g, ''); if (acct) patch.bankAccountNumber = acct
      const ifsc = (v.bankIfsc ?? '').trim().toUpperCase(); if (ifsc && ifsc !== financial[2].value) patch.bankIfsc = ifsc
      const pan = (v.panNumber ?? '').trim().toUpperCase(); if (pan) patch.panNumber = pan
      const uan = (v.uanNumber ?? '').trim(); if (uan && uan !== financial[4].value) patch.uanNumber = uan
      if (!Object.keys(patch).length) return 'No changes to save'
      await updateM.mutateAsync({ id: emp.id, data: patch })
      return 'Employee details saved'
    }

    // ── Lifecycle ──
    const lifecycle: LifecycleCalls = {
      defaults: { noticeStart: emp.noticeStartDate || today, lwd: emp.lastWorkingDay || '', reason: emp.exitReason || '', extendTo: emp.probationEndDate || '', exitType: emp.exitType || '' },
      exitTypes: EXIT_TYPES,
      onConfirm: async (date) => { await confirmM.mutateAsync({ id: emp.id, confirmationDate: date }); return `${name} confirmed from ${fmtDate(date)}` },
      onExtend: async (date) => { await extendM.mutateAsync({ employeeId: emp.id, newEndDate: date }); await empQ.refetch(); return `Probation extended to ${fmtDate(date)}` },
      onNotice: async (start, lwd, reason, exitType) => { await noticeM.mutateAsync({ id: emp.id, noticeStart: start, lastWorkingDay: lwd, reason: reason || undefined, exitType: (exitType || undefined) as ExitType | undefined }); return `Notice started (${exitTypeLabel(exitType)}) · last working day ${fmtDate(lwd)}` },
      onExit: async (lwd, reason, exitType) => { await exitM.mutateAsync({ id: emp.id, lastWorkingDay: lwd, reason: reason || undefined, exitType: (exitType || undefined) as ExitType | undefined }); return `${name} marked as exited (${exitTypeLabel(exitType)}) · ${fmtDate(lwd)}` },
      onCancel: async () => { await cancelM.mutateAsync(emp.id); return `Notice cancelled: ${name} is active again` },
    }

    // ── Left-card actions: Edit profile, then the two that fit the status, the rest in More actions. ──
    type Act = { key: string; label: string; icon: string; onClick: () => void }
    const acts: Act[] = []
    const lifeAct = (k: LifecycleKind, label: string, icon: string): Act => ({ key: k, label, icon, onClick: () => setLife(k) })
    if (canWrite && onProbation) acts.push(lifeAct('confirm', 'Confirm probation', 'checkCircle'), lifeAct('extend', 'Extend probation', 'calendarPlus'))
    else if (canWrite && emp.employmentStatus === 'NOTICE_PERIOD') acts.push(lifeAct('cancel', 'Cancel notice', 'x'), lifeAct('exit', 'Mark exited', 'logOut'))
    if (canShift) acts.push({ key: 'shift', label: 'Change shift', icon: 'clock', onClick: () => setShiftOpen(true) })
    if (canWrite && (emp.employmentStatus === 'ACTIVE' || onProbation)) acts.push(lifeAct('notice', 'Start notice', 'logOut'))
    const two = acts.slice(0, 2), more = acts.slice(2)
    const moreItems = [
      ...more.map((a) => ({ key: a.key, label: a.label, icon: a.icon, onSelect: a.onClick })),
      ...(invite ? [{ key: 'invite', label: invite.label, icon: 'mail', onSelect: () => void invite.onClick() }] : []),
      ...(canAccess ? [{ key: 'access', label: 'Roles and access', icon: 'shield', onSelect: () => setTab('access') }] : []),
      { key: 'org', label: 'View in org chart', icon: 'workflow', onSelect: () => navigate(`/hrms/org-chart?focus=${emp.id}`) },
    ]

    // ── Tabs: each shows when the viewer can read something in it (every section re-checks its own
    // permission and every endpoint enforces its own; a manager outside their team gets a no-access state).
    const tabs = [
      { key: 'overview', label: 'Overview' },
      ...(canPii || canIdentity ? [{ key: 'personal', label: 'Personal' }] : []),
      { key: 'job', label: 'Job' },
      ...(canAttendance ? [{ key: 'attendance', label: 'Attendance' }] : []),
      ...(canSalary || canBank ? [{ key: 'payroll', label: 'Payroll' }] : []),
      ...(canLeave || canLeaveTeam || self ? [{ key: 'leave', label: 'Leave' }] : []),
      ...(canClaims || canClaimsTeam || self ? [{ key: 'expenses', label: 'Expenses' }] : []),
      ...(canDocs ? [{ key: 'documents', label: 'Documents', badge: (documents.data?.totalElements ?? docTotal) || undefined }] : []),
      ...(canLetters ? [{ key: 'letters', label: 'Letters' }] : []),
      ...(canPerf || canSkills ? [{ key: 'performance', label: 'Performance' }] : []),
      { key: 'exit', label: 'Exit' },
      ...(canAccess ? [{ key: 'access', label: 'Access' }] : []),
    ]
    return {
      name, call, stLabel, stTone, fields, glance, employment, attention, cells, account, onb, basic, financial, saveEdit, lifecycle,
      two, moreItems, tabs, roleLine: `${desig?.title || 'No designation'} · ${dept?.name || 'No department'}`,
      checkedIn: !!todayRow?.checkInTime && !todayRow?.checkOutTime,
      shiftD: {
        current: shiftLabel(s?.shiftName, s?.startTime, s?.endTime),
        upcoming: s?.upcomingShiftName ? `changes to ${s.upcomingShiftName} from ${fmtDate(s.upcomingEffectiveFrom)}` : '',
        options: shiftList.map((p) => ({ value: p.id, label: shiftLabel(p.name, p.startTime, p.endTime) })),
        onSave: async (shiftId: string, from: string) => {
          await assignEmployeeShift(emp.id, shiftId, from > today ? from : undefined)
          await qc.invalidateQueries({ queryKey: ['shifts'] })
          const nm = shiftList.find((p) => p.id === shiftId)?.name || 'the new shift'
          return `${name} moves to ${nm}${from > today ? ' from ' + fmtDate(from) : ' from today'}`
        },
      },
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp, companies, departments, designations, branches, types, shiftList, managers, week.data, week.isLoading, week.error, shift.data, shift.isLoading, shift.error, structure.data, structure.isLoading, structure.error, balances.data, balances.isLoading, balances.error, documents.data, documents.isLoading, docSummary.data, kpis.data, kpis.isLoading, invitation.data, month.data, onboarding.data, onboarding.isLoading, onboarding.error, faceQ.data, faceQ.isLoading, inviting, today, me?.employeeId, canRead, canWrite, canInvite, canFace, canShift, canPii, canIdentity, canAttendance, canSalary, canBank, canDocs, canLetters, canPerf, canSkills, canLeave, canLeaveTeam, canClaims, canClaimsTeam, canAccess, self])

  if (empQ.isLoading) {
    return (
      <div role="status" aria-label="Loading employee" style={{ maxWidth: 1440, margin: '0 auto', padding: '28px clamp(16px,2.4vw,36px) 56px', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <Skeleton style={{ flex: '0 1 340px', height: 520, borderRadius: 22 }} />
        <Skeleton style={{ flex: '1 1 620px', height: 520, borderRadius: 22 }} />
      </div>
    )
  }
  if (!emp || !view) {
    const status = (empQ.error as { status?: number } | null)?.status
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px clamp(16px,2.4vw,36px) 56px', display: 'grid', gap: 12 }}>
        <div><Button size={32} variant="ghost" icon="chevronLeft" onClick={back}>Workforce directory</Button></div>
        <Section title="Employee profile" variant="section">
          {empQ.error && status !== 404 && status !== 403
            ? <ErrorState error={empQ.error} onRetry={() => void empQ.refetch()} />
            : status === 403
              ? <EmptyState title="You can’t open this profile" hint="Managers open their own team’s profiles; HR and admins open everyone’s." variant="dashed" />
              : <EmptyState title="Employee not found" hint="Check the details and try again." variant="dashed" action={<Button size={36} variant="secondary" onClick={() => navigate('/hrms/employees')}>Back to employees</Button>} />}
        </Section>
      </div>
    )
  }

  const v = view
  const visibleTab = v.tabs.some((t) => t.key === tabParam) ? tabParam : 'overview'
  const content = visibleTab === 'personal' ? <EmployeePersonal emp={emp} />
    : visibleTab === 'job' ? <EmployeeJob emp={emp} />
      : visibleTab === 'attendance' ? <div className="upf-stack"><EmployeeMonth employeeId={emp.id} name={v.call} /><EmployeeAttendance employeeId={emp.id} /></div>
        : visibleTab === 'payroll' ? <EmployeePayroll emp={emp} />
          : visibleTab === 'leave' ? <EmployeeLeave employeeId={emp.id} firstName={v.call} companyId={emp.companyId} name={v.name} self={self} />
            : visibleTab === 'expenses' ? <EmployeeExpenses employeeId={emp.id} firstName={v.call} self={self} name={v.name} />
              : visibleTab === 'documents' ? <EmployeeDocuments employeeId={emp.id} />
                : visibleTab === 'letters' ? <EmployeeLetters employeeId={emp.id} />
                  : visibleTab === 'performance' ? <EmployeePerformance employeeId={emp.id} />
                    : visibleTab === 'exit' ? <EmployeeExit emp={emp} />
                      : visibleTab === 'access' ? <EmployeeAccess employeeId={emp.id} name={v.name} email={emp.email} canInvite={canInvite} />
                        : (
                          <>
                            <GlanceRow items={v.glance} />
                            <div className="upf-flow">
                              <div className="upf-main">
                                <EmploymentCard items={v.employment} onEdit={canWrite ? () => setEditOpen(true) : undefined} />
                                <Section title="Needs attention" variant="section" count={v.attention.length || undefined} countTone="gold" body="list"
                                  empty={v.attention.length ? undefined : { title: 'Nothing needs attention right now' }}>
                                  <AttentionList items={v.attention} />
                                </Section>
                              </div>
                              <div className="upf-side">
                                {canAttendance && <MonthCard ym={ym} days={v.cells} loading={month.isLoading} error={month.error} onRetry={() => void month.refetch()} onOpen={() => setTab('attendance')} />}
                                <AccountCard a={v.account} />
                              </div>
                            </div>
                            {canWrite && <OnboardingCard o={v.onb} />}
                          </>
                        )

  return (
    <>
      <ProfileFrame
        screenLabel="Employee profile"
        back={{ label: canRead ? 'Workforce directory' : 'Back', onClick: back }}
        avatar={{ name: v.name, src: emp.profilePhotoUrl, checkedIn: v.checkedIn }}
        name={v.name}
        status={{ label: v.stLabel, tone: v.stTone }}
        roleLine={v.roleLine}
        email={emp.email}
        fields={v.fields}
        footer={
          <div className="upf-acts">
            {canWrite && <Button size={40} variant="primary" icon="pencil" block onClick={() => setEditOpen(true)}>Edit profile</Button>}
            {v.two.length > 0 && (
              <div className="upf-acts__two" style={v.two.length === 1 ? { gridTemplateColumns: '1fr' } : undefined}>
                {v.two.map((a) => <Button key={a.key} size={38} variant="secondary" icon={a.icon} block onClick={a.onClick}>{a.label}</Button>)}
              </div>
            )}
            <Menu label="More actions" items={v.moreItems} placement="bottom-start" width={260}
              trigger={({ props }) => <Button {...props} size={36} variant="neutral" trailingIcon="chevronDown" block>More actions</Button>} />
          </div>
        }
        tabs={v.tabs}
        active={visibleTab}
        onTab={setTab}
      >
        {content}
      </ProfileFrame>
      <EditProfilePanel open={editOpen} onClose={() => setEditOpen(false)} basic={v.basic} financial={v.financial} onSave={v.saveEdit} onFullForm={() => setFullForm(true)} employeeId={emp?.id} />
      <ShiftPanel open={shiftOpen} onClose={() => setShiftOpen(false)} today={today} {...v.shiftD} />
      <LifecycleDialog kind={life} onClose={() => setLife(null)} name={v.name} today={today} calls={v.lifecycle} />
      <FaceResetDialog open={resetAsk} onClose={() => setResetAsk(false)} name={v.call}
        onReset={async () => {
          // faceErrorText turns the server's `CODE:sentence` into plain English (a person with no login gets a 409).
          try { await resetFaceEnrollment(emp.id) } catch (err) { throw new Error(faceErrorText(err, false), { cause: err }) }
          await empQ.refetch(); void faceQ.refetch()
          return `Face enrollment cleared: ${v.call} must enrol again before face punch-in works.`
        }} />
      {fullForm && <EmployeeForm employee={emp} onClose={() => { setFullForm(false); void empQ.refetch() }} />}
    </>
  )
}
