/**
 * Employee workspace — the page every employee reference lands on
 * (/hrms/employees/:id, from the directory, ⌘K search and every name link).
 *
 * Built to the Claude Design export docs/Designs/UnifiedTree Employee Workspace
 * (offline).html: the view is src/design/dc/EmployeeWorkspace.view.tsx (generated)
 * and its logic src/design/dc/EmployeeWorkspace.tsx. This file loads the real
 * record and everything the header and Overview show, maps each action to its
 * API, and puts each section's real content in the design's frame. Nothing is
 * invented: a value the API doesn't have shows a dash, and the Leave and Expenses
 * tabs say why they're empty (docs/Designs/STATIC-UI-TO-BUILD.md §7).
 *
 * The tab lives in the URL (?tab=, replaced, so Back leaves the page rather than
 * stepping through tabs).
 */
import { useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { P, usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { EmployeeWorkspace, type WorkspaceData, type WsStatus, type WsField } from '@/design/dc/EmployeeWorkspace'
import { istToday } from '@/design/dc/dates'
import {
  useWorkforceEmployee, useConfirmEmployee, useStartNotice, useExitEmployee, useCancelNotice, useEmployeesByIds, useUpdateWorkforceEmployee,
  type UpdateWorkforceEmployeePayload, type EmploymentType,
} from '../api/useWorkforce'
import { useExtendProbation } from '../api/useProbation'
import { useCompanies, useDepartments, useDesignations, useBranches, useEmploymentTypes, assignEmployeeShift } from '../api/useOrg'
import { useEmployeeWeeklySummary } from '../api/useAttendance'
import { useEmployeeShift, useShiftPolicies } from '../api/useShiftPolicies'
import { useEmployeeStructure } from '../api/usePayroll'
import { useEmployeeDocuments } from '../api/useDocument'
import { useEmployeeKpis } from '../api/usePerformance'
import type { OnboardingRecordData } from '../onboarding/OnboardingRecord'
import { sendInvite, resendInvite } from './api/useInvitation'
import { resetFaceEnrollment } from './api/useFaceAdmin'
import { EmployeeForm } from './EmployeeForm'
import { EmployeePersonal } from './workspace/EmployeePersonal'
import { EmployeeJob } from './workspace/EmployeeJob'
import { EmployeeAttendance } from './workspace/EmployeeAttendance'
import { EmployeePayroll } from './workspace/EmployeePayroll'
import { EmployeeDocuments, EMPLOYEE_DOCUMENTS_PAGE_SIZE } from './workspace/EmployeeDocuments'
import { EmployeeLetters } from './workspace/EmployeeLetters'
import { EmployeePerformance } from './workspace/EmployeePerformance'
import { EmployeeExit } from './workspace/EmployeeExit'

const STATUS: Record<string, WsStatus> = { ACTIVE: 'Active', PROBATION: 'Probation', NOTICE_PERIOD: 'Notice period', SUSPENDED: 'Suspended', EXITED: 'Exited', TERMINATED: 'Terminated' }
const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', INTERN: 'Intern', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmt = (s?: string | null) => { if (!s) return '—'; const d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(+d) ? '—' : `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` }
const days = (s: string, today: string) => Math.round((new Date(s + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86_400_000)
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')
const hrs = (h?: number) => { if (h == null) return '—'; const a = Math.floor(h), m = Math.round((h - a) * 60); return m ? `${a}h ${m}m` : `${a}h` }
const seedOf = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 8 }
const humanize = (k: string) => k.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase())
const hm = (t?: string | null) => (t ? t.slice(0, 5) : '')

const TABS = ['overview', 'personal', 'job', 'attendance', 'payroll', 'leave', 'expenses', 'documents', 'letters', 'performance', 'exit'] as const

export function EmployeeDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const today = istToday()
  const [fullForm, setFullForm] = useState(false)

  // ── permissions (the codes each endpoint checks) ──
  const canWrite = usePermission(P.HRMS_EMPLOYEE_WRITE), canInvite = usePermission(P.HRMS_EMPLOYEE_INVITE)
  const canFace = usePermission('attendance.face.admin.reset'), canShift = usePermission('attendance.workforce.admin')
  const canPii = usePermission(P.HRMS_EMPLOYEE_PROFILE_READ), canIdentity = usePermission(P.HRMS_EMPLOYEE_IDENTITY_READ)
  const canAttendance = usePermission('attendance.team.read'), canSalary = usePermission(P.PAYROLL_STRUCTURE_READ), canBank = usePermission(P.HRMS_EMPLOYEE_BANK_READ)
  const canDocs = usePermission('hrms.document.read'), canLetters = usePermission(P.HRMS_LETTERS_READ)
  const canPerf = usePermission('hrms.performance.read'), canSkills = usePermission('hrms.learning.skill.read')

  // ── data ──
  const empQ = useWorkforceEmployee(id)
  const emp = empQ.data
  const co = emp?.companyId ?? ''
  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(co)
  const { data: designations = [] } = useDesignations(co)
  const { data: branches = [] } = useBranches(co)
  const { data: types = [] } = useEmploymentTypes(canWrite ? co : '')
  const { data: shiftList = [] } = useShiftPolicies(canShift ? co : '')
  const { data: managers } = useEmployeesByIds(emp?.reportingManagerId ? [emp.reportingManagerId] : [])
  const week = useEmployeeWeeklySummary(id, undefined, { enabled: canAttendance && !!emp })
  const shift = useEmployeeShift(id, { enabled: (canAttendance || canShift) && !!emp })
  const structure = useEmployeeStructure(canSalary && emp ? id : '')
  const documents = useEmployeeDocuments(id, 0, canDocs && !!emp, EMPLOYEE_DOCUMENTS_PAGE_SIZE)
  const kpis = useEmployeeKpis(id, { enabled: canPerf && !!emp })
  const invitation = useQuery({
    queryKey: ['hrms', 'employee', id, 'invitation-status'],
    queryFn: () => apiJson<{ activated?: boolean; invitedAt?: string; lastLoginAt?: string }>(`/v1/employees/${id}/invitation-status`),
    enabled: !!emp, retry: false,
  })
  const onboarding = useQuery({
    queryKey: ['hrms', 'onboarding-record', id],
    queryFn: () => apiJson<OnboardingRecordData>(`/v1/hrms/employees/${id}/onboarding-record`),
    enabled: canWrite && !!emp, retry: false,
  })

  const confirmM = useConfirmEmployee(), noticeM = useStartNotice(), exitM = useExitEmployee(), cancelM = useCancelNotice()
  const extendM = useExtendProbation(), updateM = useUpdateWorkforceEmployee()

  const tabParam = params.get('tab') || 'overview'
  const tab = (TABS as readonly string[]).includes(tabParam) ? tabParam : 'overview'
  const setTab = (k: string) => { const n = new URLSearchParams(params); if (k === 'overview') n.delete('tab'); else n.set('tab', k); setParams(n, { replace: true }) }
  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/hrms/employees'))

  const data: WorkspaceData = useMemo(() => {
    const base = {
      onRetry: () => { void empQ.refetch() }, onBack: back, today,
    }
    if (empQ.isLoading || !emp) {
      return {
        ...base, state: empQ.isLoading ? 'loading' : empQ.error ? ((empQ.error as { status?: number }).status === 404 ? 'missing' : 'failed') : 'missing',
      } as unknown as WorkspaceData
    }
    const name = [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' ') || emp.employeeCode
    const first = emp.firstName || name
    const st = STATUS[emp.employmentStatus || 'ACTIVE'] || 'Active'
    const company = companies.find((c) => c.id === emp.companyId), dept = departments.find((d) => d.id === emp.departmentId)
    const desig = designations.find((d) => d.id === emp.designationId), branch = branches.find((b) => b.id === emp.branchId)
    const separated = st === 'Exited' || st === 'Terminated'

    // Probation banner (only while on probation)
    let probation: WorkspaceData['probation'] = null
    if (st === 'Probation') {
      if (!emp.probationEndDate) probation = { title: 'Probation end date not set', sub: 'Set a date so the confirmation reminder runs on time' }
      else {
        const d = days(emp.probationEndDate, today)
        probation = d >= 0
          ? { title: `Probation ends in ${plural(d, 'day')} · ${fmt(emp.probationEndDate)}`, sub: 'Confirm or extend before the end date' }
          : { title: 'Probation period has ended', sub: `It ended on ${fmt(emp.probationEndDate)} — confirm, extend or begin exit` }
      }
    }

    // Needs attention — the same rules the workspace always used, each opening where it's fixed.
    const w = week.data, absent = w?.days?.filter((x) => x.status === 'ABSENT' && x.date < today).length ?? 0, late = w?.days?.filter((x) => x.status === 'LATE').length ?? 0
    const attention: WorkspaceData['attention'] = []
    if (st === 'Probation' && emp.probationEndDate) {
      const d = days(emp.probationEndDate, today)
      if (d <= 30) attention.push({ tone: 'amber', title: d < 0 ? `Probation ended ${plural(-d, 'day')} ago and isn’t confirmed yet` : `Probation ends in ${plural(d, 'day')}`, cta: 'Review lifecycle', onClick: () => setTab('exit') })
    }
    if (st === 'Notice period') attention.push({ tone: 'orange', title: emp.lastWorkingDay ? (days(emp.lastWorkingDay, today) >= 0 ? `Serving notice — last working day in ${plural(days(emp.lastWorkingDay, today), 'day')}` : 'Notice period has passed its last working day') : 'Serving notice', cta: 'Open exit', onClick: () => setTab('exit') })
    if (canSalary && !structure.isLoading && !structure.error && !structure.data && !separated) attention.push({ tone: 'red', title: 'No salary structure — this employee cannot be included in a payroll run.', cta: 'Set up payroll', onClick: () => setTab('payroll') })
    if ((canAttendance || canShift) && !shift.isLoading && !shift.error && !shift.data?.shiftPolicyId && !separated) attention.push({ tone: 'amber', title: 'No shift assigned — lateness and overtime can’t be measured.', cta: 'Open attendance', onClick: () => setTab('attendance') })
    if (absent > 0) attention.push({ tone: 'amber', title: `${plural(absent, 'unmarked/absent day')} this week.`, cta: 'See attendance', onClick: () => setTab('attendance') })

    const docTotal = documents.data?.totalElements
    const openGoals = (kpis.data?.items ?? []).filter((k) => k.status === 'ACTIVE' || k.status === 'AT_RISK').length
    const glance: WorkspaceData['glance'] = [
      { l: 'This week', v: canAttendance ? (w ? hrs(w.totalHours) : '…') : '—', s: canAttendance ? (w ? `${w.presentDays} present${late ? ` · ${late} late` : ''}` : '') : 'No access', onClick: () => setTab('attendance') },
      { l: 'Salary structure', v: canSalary ? (structure.data ? inr(Number(structure.data.ctcAnnual || 0)) : structure.isLoading ? '…' : '—') : '—', s: canSalary ? (structure.data?.effectiveFrom ? `Effective ${fmt(structure.data.effectiveFrom)}` : structure.isLoading ? '' : 'Not set up') : 'No access', onClick: () => setTab('payroll') },
      { l: 'Documents', v: canDocs ? (docTotal != null ? String(docTotal) : '…') : '—', s: canDocs ? 'on record' : 'No access', onClick: () => setTab('documents') },
      // Open = still being worked on (active or at risk); completed and dropped ones are history.
      { l: 'Goals', v: canPerf ? (kpis.data ? String(openGoals) : '…') : '—', s: canPerf ? (kpis.data && kpis.data.total > openGoals ? `open · ${kpis.data.total} in all` : 'open goals & KPIs') : 'No access', onClick: () => setTab('performance') },
    ]

    // Onboarding record (people who can edit employees only — the endpoint's rule)
    const rec = onboarding.data
    const recEmpty = !rec || !Object.keys(rec).length
    const onb: WorkspaceData['onboarding'] = {
      show: canWrite, sub: `Captured when ${first} was hired · ${fmt(emp.dateOfJoining)}`,
      note: onboarding.isLoading ? 'Loading…' : onboarding.error ? 'The onboarding record couldn’t be loaded.' : recEmpty ? 'No onboarding record was saved for this hire.' : '',
      fields: Object.entries(rec?.details ?? {}).filter(([, v]) => v).map(([k, v]) => ({ l: humanize(k), v: String(v) })),
      assets: (rec?.assets ?? []).map((a, i) => ({ id: String(i), type: a.type, model: a.model, serial: a.serial, on: fmt(a.issuedOn) })),
      policies: rec?.selectedPolicies ?? [],
      checklists: [
        rec?.joiningChecklist && Object.keys(rec.joiningChecklist).length ? { title: 'Joining checklist', rows: Object.entries(rec.joiningChecklist).map(([k, ok]) => ({ l: humanize(k), s: ok ? 'Confirmed' : 'Pending', t: ok ? 'ok' : 'warn' })) } : null,
        rec?.documentChecklist && Object.keys(rec.documentChecklist).length ? { title: 'Document verification checklist', rows: Object.entries(rec.documentChecklist).map(([k, d]) => ({ l: `${humanize(k)}${d.fileName ? ' · ' + d.fileName : ''}`, s: d.status === 'VERIFIED' ? 'Confirmed' : d.status === 'REJECTED' ? 'Rejected' : 'Pending', t: d.status === 'VERIFIED' ? 'ok' : d.status === 'REJECTED' ? 'red' : 'warn' })) } : null,
      ].filter(Boolean) as WorkspaceData['onboarding']['checklists'],
    }

    // Account
    const inv = invitation.data
    const active = !!(inv?.activated ?? emp.hasAccount)
    const account: WorkspaceData['account'] = active
      ? { active: true, activeSub: `${emp.email || 'No email'} · ${inv?.lastLoginAt ? 'last signed in ' + fmt(inv.lastLoginAt) : 'hasn’t signed in yet'}`, title: '', sub: '', cta: '', primary: false, onInvite: async () => '' }
      : {
        active: false, activeSub: '',
        title: inv?.invitedAt ? 'Invitation sent' : 'No login account yet',
        sub: inv?.invitedAt ? `${emp.email} · sent ${fmt(inv.invitedAt)}` : `${first} can’t sign in until invited`,
        cta: inv?.invitedAt ? 'Resend' : 'Send invitation', primary: !inv?.invitedAt,
        onInvite: async () => {
          if (!emp.email) throw new Error('Add a work email before sending an invitation')
          if (inv?.invitedAt) await resendInvite(emp.id); else await sendInvite(emp.id)
          await qc.invalidateQueries({ queryKey: ['hrms', 'employee', id, 'invitation-status'] })
          return `Invitation sent to ${emp.email}`
        },
      }

    // Shift drawer
    const s = shift.data
    const shiftLabel = (n?: string | null, a?: string | null, b?: string | null) => (n ? `${n}${a ? ` · ${hm(a)} – ${hm(b)}` : ''}` : 'No shift assigned')
    const shiftD: WorkspaceData['shift'] = {
      current: shiftLabel(s?.shiftName, s?.startTime, s?.endTime),
      upcoming: s?.upcomingShiftName ? `Changes to ${s.upcomingShiftName} from ${fmt(s.upcomingEffectiveFrom)}` : '',
      options: shiftList.map((p) => ({ value: p.id, label: shiftLabel(p.name, p.startTime, p.endTime) })),
      effMin: today,
      onSave: async (shiftId, from) => {
        await assignEmployeeShift(emp.id, shiftId, from > today ? from : undefined)
        await qc.invalidateQueries({ queryKey: ['shifts'] })
        const nm = shiftList.find((p) => p.id === shiftId)?.name || 'the new shift'
        return `${name} moves to ${nm}${from > today ? ' from ' + fmt(from) : ' from today'}`
      },
    }

    // Edit drawer
    const typeOpts = (types.length ? types.filter((t) => t.code && TYPE_LABEL[t.code]).map((t) => ({ value: t.code!, label: t.name })) : Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label })))
    const withCur = (opts: { value: string; label: string }[], cur?: string | null) => (cur && !opts.some((o) => o.value === cur) ? [...opts, { value: cur, label: TYPE_LABEL[cur] || cur }] : opts)
    const basic: WsField[] = [
      { key: 'firstName', l: 'First name', v: emp.firstName || '', req: true },
      { key: 'lastName', l: 'Last name', v: emp.lastName || '' },
      { key: 'email', l: 'Work email', v: emp.email || '', type: 'email', check: (v) => (/^\S+@\S+\.\S+$/.test(v) ? '' : 'Enter a valid email address') },
      { key: 'phone', l: 'Mobile', v: emp.phone || '', ph: '+91 98450 12345', check: (v) => (/^[+\d][\d\s-]{6,19}$/.test(v) ? '' : 'Enter a valid phone number') },
      { key: 'departmentId', l: 'Department', v: emp.departmentId || '', opts: departments.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.name })) },
      { key: 'designationId', l: 'Designation', v: emp.designationId || '', opts: designations.filter((d) => d.active !== false).map((d) => ({ value: d.id, label: d.title })) },
      { key: 'branchId', l: 'Branch', v: emp.branchId || '', opts: branches.filter((b) => b.active !== false).map((b) => ({ value: b.id, label: b.name })) },
      { key: 'employmentType', l: 'Employment type', v: emp.employmentType || '', opts: withCur(typeOpts, emp.employmentType) },
      { key: 'dateOfJoining', l: 'Date of joining', v: emp.dateOfJoining || '', type: 'date' },
    ]
    const financial: WsField[] = [
      { key: 'ctcAnnual', l: 'Annual CTC (₹)', v: emp.ctcAnnual != null ? String(emp.ctcAnnual) : '', type: 'number', ph: 'Leave blank to keep the current CTC', check: (v) => (Number(v) > 0 ? '' : 'Enter an amount above 0') },
      { key: 'bankAccountNumber', l: 'Bank account number', v: '', ph: emp.bankAccountNumber ? `Leave blank to keep ${emp.bankAccountNumber}` : '12–18 digits', check: (v) => (/^\d{9,18}$/.test(v.replace(/\s/g, '')) ? '' : 'Use 9 to 18 digits') },
      { key: 'bankIfsc', l: 'IFSC', v: emp.bankIfsc || '', ph: 'SBIN0001234', check: (v) => (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase()) ? '' : 'Format: SBIN0001234') },
      { key: 'panNumber', l: 'PAN', v: '', ph: 'Leave blank to keep the PAN on record', check: (v) => (/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase()) ? '' : 'Format: ABCDE1234F') },
      { key: 'uanNumber', l: 'UAN', v: emp.uan || '', ph: '12 digits', check: (v) => (/^\d{12}$/.test(v) ? '' : 'UAN has 12 digits') },
      { key: 'taxRegime', l: 'Tax regime', v: '', off: true, ph: 'Set on the salary structure', hint: 'The tax regime lives on each salary structure (Payroll tab).' },
    ]
    const edit: WorkspaceData['edit'] = {
      basic, financial, onFullForm: () => setFullForm(true),
      onSave: async (v) => {
        const patch: UpdateWorkforceEmployeePayload = {}
        for (const f of basic) { const nv = (v[f.key] ?? '').trim(); if (nv !== (f.v ?? '')) (patch as any)[f.key] = nv }
        if (patch.employmentType) patch.employmentType = patch.employmentType as EmploymentType
        const ctc = (v.ctcAnnual ?? '').trim(); if (ctc && ctc !== financial[0].v) patch.ctcAnnual = Number(ctc)
        const acct = (v.bankAccountNumber ?? '').replace(/\s/g, ''); if (acct) patch.bankAccountNumber = acct
        const ifsc = (v.bankIfsc ?? '').trim().toUpperCase(); if (ifsc && ifsc !== financial[2].v) patch.bankIfsc = ifsc
        const pan = (v.panNumber ?? '').trim().toUpperCase(); if (pan) patch.panNumber = pan
        const uan = (v.uanNumber ?? '').trim(); if (uan && uan !== financial[4].v) patch.uanNumber = uan
        if (!Object.keys(patch).length) return 'No changes to save'
        await updateM.mutateAsync({ id: emp.id, data: patch })
        return 'Employee details saved'
      },
    }

    const L = emp.lastWorkingDay || ''
    const lifecycle: WorkspaceData['lifecycle'] = {
      defaults: { noticeStart: emp.noticeStartDate || today, lwd: L, reason: emp.exitReason || '', extendTo: emp.probationEndDate || '' },
      onConfirm: async (date) => { await confirmM.mutateAsync({ id: emp.id, confirmationDate: date }); return `${name} confirmed from ${fmt(date)}` },
      onExtend: async (date) => { await extendM.mutateAsync({ employeeId: emp.id, newEndDate: date }); await empQ.refetch(); return `Probation extended to ${fmt(date)}` },
      onNotice: async (start, lwd, reason) => { await noticeM.mutateAsync({ id: emp.id, noticeStart: start, lastWorkingDay: lwd, reason: reason || undefined }); return `Notice started · last working day ${fmt(lwd)}` },
      onExit: async (lwd, reason) => { await exitM.mutateAsync({ id: emp.id, lastWorkingDay: lwd, reason: reason || undefined }); return `${name} marked as exited · ${fmt(lwd)}` },
      onCancel: async () => { await cancelM.mutateAsync(emp.id); return `Notice cancelled — ${name} is active again` },
    }

    // Tabs: each shows when the viewer can read something in it (every section re-checks its own
    // permission, and every endpoint enforces its own). Leave and Expenses have no per-employee API.
    const tabs = [
      { key: 'overview', label: 'Overview' },
      ...(canPii || canIdentity ? [{ key: 'personal', label: 'Personal' }] : []),
      { key: 'job', label: 'Job' },
      ...(canAttendance ? [{ key: 'attendance', label: 'Attendance' }] : []),
      ...(canSalary || canBank ? [{ key: 'payroll', label: 'Payroll' }] : []),
      { key: 'leave', label: 'Leave' },
      { key: 'expenses', label: 'Expenses' },
      ...(canDocs ? [{ key: 'documents', label: 'Documents', badge: docTotal || undefined }] : []),
      ...(canLetters ? [{ key: 'letters', label: 'Letters' }] : []),
      ...(canPerf || canSkills ? [{ key: 'performance', label: 'Performance' }] : []),
      { key: 'exit', label: 'Exit' },
    ]
    const visibleTab = tabs.some((t) => t.key === tab) ? tab : 'overview'
    const GAP: Record<string, { label: string; note: string; cta: string; path: string }> = {
      leave: { label: 'Leave', note: `Leave balances and requests are only served for the signed-in person today, so ${first}’s can’t be shown here yet. Requests waiting for you are in the Leave centre.`, cta: 'Open Leave', path: '/hrms/leave' },
      expenses: { label: 'Expenses', note: `Expense claims are only served for the signed-in person today, so ${first}’s can’t be listed here yet. Claims waiting for approval are in the Expense centre.`, cta: 'Open Expenses', path: '/hrms/expenses' },
    }
    const gap = GAP[visibleTab]
    const content = visibleTab === 'personal' ? <EmployeePersonal emp={emp} />
      : visibleTab === 'job' ? <EmployeeJob emp={emp} />
        : visibleTab === 'attendance' ? <EmployeeAttendance employeeId={emp.id} />
          : visibleTab === 'payroll' ? <EmployeePayroll emp={emp} />
            : visibleTab === 'documents' ? <EmployeeDocuments employeeId={emp.id} />
              : visibleTab === 'letters' ? <EmployeeLetters employeeId={emp.id} />
                : visibleTab === 'performance' ? <EmployeePerformance employeeId={emp.id} />
                  : visibleTab === 'exit' ? <EmployeeExit emp={emp} /> : null
    const mgr = managers?.[0]
    const mgrDesig = mgr && designations.find((d) => d.id === mgr.designationId)

    return {
      ...base, state: 'ready', name, code: emp.employeeCode, seed: seedOf(emp.id),
      metaLine: [company?.name, dept?.name, emp.dateOfJoining ? `Joined ${fmt(emp.dateOfJoining)}` : ''].filter(Boolean).join(' · '),
      status: st, probation, tabs, tab: visibleTab, onTab: setTab, otherContent: content,
      otherPlaceholder: gap ? { label: gap.label, note: gap.note, cta: gap.cta, onClick: () => navigate(gap.path) } : null,
      jobTitle: desig?.title || 'No designation', jobSub: [dept?.name || 'No department', branch?.name].filter(Boolean).join(' · '),
      facts: [
        { l: 'Company', v: company?.name || '—' }, { l: 'Employment type', v: TYPE_LABEL[emp.employmentType || ''] || emp.employmentType || '—' },
        { l: 'Joined', v: fmt(emp.dateOfJoining) }, { l: 'Branch', v: branch?.name || '—' },
        st === 'Probation' ? { l: 'Probation ends', v: fmt(emp.probationEndDate) } : { l: 'Confirmation', v: emp.confirmationDate ? `Confirmed on ${fmt(emp.confirmationDate)}` : '—' },
        { l: 'Last working day', v: fmt(emp.lastWorkingDay) },
      ],
      mgr: mgr ? { name: [mgr.firstName, mgr.lastName].filter(Boolean).join(' '), sub: mgrDesig?.title || mgr.employeeCode, seed: seedOf(mgr.id), onOpen: () => navigate(`/hrms/employees/${mgr.id}`) } : null,
      account, face: {
        sub: emp.faceEnrolled ? 'Enrolled' : 'Not enrolled',
        onReset: async () => { await resetFaceEnrollment(emp.id); await empQ.refetch(); return 'Face enrollment reset — the employee can enroll again from the mobile app' },
      },
      attention, glance, onboarding: onb,
      can: { shift: canShift, edit: canWrite, lifecycle: canWrite, invite: canInvite && !active, face: canFace },
      shift: shiftD, edit, lifecycle,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp, empQ.isLoading, empQ.error, companies, departments, designations, branches, types, shiftList, managers, week.data, shift.data, shift.isLoading, shift.error, structure.data, structure.isLoading, structure.error, documents.data, kpis.data, invitation.data, onboarding.data, onboarding.isLoading, onboarding.error, tab, today, canWrite, canInvite, canFace, canShift, canPii, canIdentity, canAttendance, canSalary, canBank, canDocs, canLetters, canPerf, canSkills])

  return (
    <DesignFrame>
      <EmployeeWorkspace data={data} />
      {fullForm && emp && <EmployeeForm employee={emp} onClose={() => { setFullForm(false); void empQ.refetch() }} />}
    </DesignFrame>
  )
}

