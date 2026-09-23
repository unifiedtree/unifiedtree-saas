import { EmployeeShiftAction } from '../attendance/EmployeeShiftAction'
import { attendanceDate } from '../attendance/date'
import { OnboardingRecord } from '../onboarding/OnboardingRecord'
/**
 * Employee workspace — the page every employee reference lands on.
 *
 * Reached from the Workforce Directory, from ⌘K people search, and from any
 * /hrms/employees/:id link. Milestone 5A turned it from eleven tabs of profile
 * fields into an operational workspace: one place to read an employee's state
 * and reach the work that concerns them.
 *
 * This file ORCHESTRATES. It owns the identity header, the lifecycle actions
 * (confirm / extend probation / notice / exit) and the tab routing; each tab's
 * content lives in ./workspace and belongs to its own domain. That split is the
 * point — before 5A everything was here, and "here" was 1,672 lines.
 *
 * Tab state lives in the URL (?tab=), so a colleague can be sent straight to
 * someone's attendance and a refresh keeps your place. Local state could do
 * neither.
 */

import React, { useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Edit3, UserCheck, AlertTriangle, LogOut, Mail, Phone, Briefcase, Building2, Calendar, XCircle, FileText } from 'lucide-react'
import { format } from 'date-fns'
import { CardSkeleton } from '@unifiedtree/ui-kit'
import { EmptyState } from '@/shared/components/EmptyState'
import { HrTabs, HrTabPanel, HrStatusPill } from '@/shared/components/hr'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { toast } from 'sonner'
import {
  useWorkforceEmployee, useConfirmEmployee, useStartNotice, useExitEmployee, useCancelNotice,
} from '../api/useWorkforce'
import { useExtendProbation } from '../api/useProbation'
import { useCompanies, useDepartments, useDesignations, useBranches } from '../api/useOrg'
import { EmployeeForm } from './EmployeeForm'
import {
  ActionModal, InfoRow, PILL_TONE, STATUS_STYLE,
} from './workspace/shared'
import { EmployeeOverview } from './workspace/EmployeeOverview'
import { EmployeePersonal } from './workspace/EmployeePersonal'
import { EmployeeJob } from './workspace/EmployeeJob'
import { EmployeeAttendance } from './workspace/EmployeeAttendance'
import { EmployeePayroll } from './workspace/EmployeePayroll'
import { EmployeeDocuments } from './workspace/EmployeeDocuments'
import { EmployeeLetters } from './workspace/EmployeeLetters'
import { EmployeePerformance } from './workspace/EmployeePerformance'
import { EmployeeExit } from './workspace/EmployeeExit'

/**
 * The workspace tabs.
 *
 * Deliberately NOT the eleven from the target sketch. Leave and Expenses are
 * absent because no API returns either for anyone but the signed-in user —
 * /v1/leave/my/balances and /v1/expense/my both read the employee id from the
 * JWT, so a Leave tab here could only ever show the *viewer's* leave or scan
 * the whole workspace and filter in the browser. A tab that cannot be filled
 * honestly is worse than no tab: it teaches the reader that this employee has
 * no leave. The Overview names both gaps in one line instead, and the milestone
 * report carries the endpoints that would close them.
 */
const TAB_KEYS = [
  'overview', 'personal', 'job', 'attendance',
  'payroll', 'documents', 'letters', 'performance', 'exit',
] as const
type TabKey = typeof TAB_KEYS[number]

export const EmployeeDetail: React.FC = () => {
  // Tab lives in the URL so the section is linkable and survives a refresh.
  //
  // `replace`, deliberately: this is a detail page reached from the directory
  // or from ⌘K search, and Back should return the user THERE. Pushing a history
  // entry per tab would mean someone who glanced at four tabs has to press Back
  // four times to get out, which reads as a broken button. The cost is that
  // Back does not step between tabs — the right trade for a leaf page.
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab') as TabKey | null
  const activeTab: TabKey = tabParam && (TAB_KEYS as readonly string[]).includes(tabParam)
    ? tabParam
    : 'overview'
  const setActiveTab = (key: string) => {
    const next = new URLSearchParams(searchParams)
    if (key === 'overview') next.delete('tab')
    else next.set('tab', key)
    setSearchParams(next, { replace: true })
  }
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const { data: emp, isLoading, error: empError } = useWorkforceEmployee(id)
  const { data: companies    = [] } = useCompanies()
  const { data: departments  = [] } = useDepartments(emp?.companyId ?? '')
  const { data: designations = [] } = useDesignations(emp?.companyId ?? '')
  const { data: branches     = [] } = useBranches(emp?.companyId ?? '')

  const confirmMutation = useConfirmEmployee()
  const noticeMutation  = useStartNotice()
  const exitMutation    = useExitEmployee()
  const cancelNoticeMutation = useCancelNotice()

  const canReadIdentity = usePermission(P.HRMS_EMPLOYEE_IDENTITY_READ)
  const canReadBank     = usePermission(P.HRMS_EMPLOYEE_BANK_READ)
  const canReadSalary   = usePermission(P.PAYROLL_STRUCTURE_READ)
  // Contact / Education / Experience / Dependents / Emergency all show a
  // co-worker's private profile — gate the tab surface itself so a peer with
  // only hrms.employee.read (DEPT_MANAGER, viewer HR) sees an Overview-only
  // shell instead of full PII.
  const canReadPii      = usePermission(P.HRMS_EMPLOYEE_PROFILE_READ)
  const canManageOnboardingRecord = usePermission(P.HRMS_EMPLOYEE_WRITE)
  // Raw codes, matching what the backend endpoints actually declare. The SDK's
  // HRMS_EMPLOYEE_DOCUMENT_READ constant ('hrms.employee.document.read') is not
  // checked by any controller — DocumentController declares 'hrms.document.read'.
  const canReadAttendance  = usePermission('attendance.team.read')
  const canReadDocuments   = usePermission('hrms.document.read')
  const canReadLetters     = usePermission(P.HRMS_LETTERS_READ)
  const canReadPerformance = usePermission('hrms.performance.read')
  const canReadSkills      = usePermission('hrms.learning.skill.read')

  const extendMutation = useExtendProbation()
  const [showEdit,     setShowEdit]     = useState(false)
  const [modal,        setModal]        = useState<'confirm' | 'notice' | 'exit' | 'extend' | 'cancel-notice' | null>(null)
  const [confirmDate,  setConfirmDate]  = useState(new Date().toISOString().split('T')[0])
  const [noticeStart,  setNoticeStart]  = useState(new Date().toISOString().split('T')[0])
  const [lastDay,      setLastDay]      = useState('')
  const [reason,       setReason]       = useState('')
  const [extendDate,   setExtendDate]   = useState('')

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <CardSkeleton />
      </div>
    )
  }

  if (empError) {
    return (
      <div className="p-6">
        <EmptyState icon={XCircle} title="Failed to load employee" description={(empError as Error).message} action={{ label: 'Retry', onClick: () => navigate(0) }} />
      </div>
    )
  }

  if (!emp) {
    return (
      <div className="p-6">
        <EmptyState icon={FileText} title="Employee not found" description="Check the details and try again." action={{ label: 'Back to employees', onClick: () => navigate('/hrms/employees') }} />
      </div>
    )
  }

  const fullName   = [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' ')
  // `firstName` was dereferenced directly (`emp.firstName[0]`). The `?? ''`
  // guarded only an out-of-range INDEX, not a null/undefined firstName — so an
  // employee record with no first name threw inside render and took the whole
  // profile page down via the error boundary. Same bug class, and same fix, as
  // HrAvatar on 2026-09-10: optional-chain every access and fall back to '?'
  // rather than trusting the server's shape.
  const initials   = ((emp.firstName?.[0] ?? '') + (emp.lastName?.[0] ?? emp.firstName?.[1] ?? '')) || '?'
  const statusInfo = STATUS_STYLE[emp.employmentStatus ?? ''] ?? { label: emp.employmentStatus ?? '—', tone: 'default' as const }

  const openSeparationAction = (action: 'notice' | 'exit') => {
    setNoticeStart(emp.noticeStartDate || attendanceDate())
    setLastDay(emp.lastWorkingDay || '')
    setReason(emp.exitReason || '')
    setModal(action)
  }

  const handleConfirm = async () => {
    try {
      await confirmMutation.mutateAsync({ id: emp.id, confirmationDate: confirmDate })
      toast.success('Employee confirmed')
      setModal(null)
    } catch { toast.error('Failed to confirm employee') }
  }

  const handleNotice = async () => {
    if (!lastDay) { toast.error('Last working day is required'); return }
    if (!noticeStart || lastDay < noticeStart) { toast.error('Last working day must be on or after the notice start date'); return }
    try {
      await noticeMutation.mutateAsync({ id: emp.id, noticeStart, lastWorkingDay: lastDay, reason: reason || undefined })
      toast.success('Notice period started')
      setModal(null)
    } catch { toast.error('Failed to start notice') }
  }

  const handleExit = async () => {
    if (!lastDay) { toast.error('Last working day is required'); return }
    try {
      await exitMutation.mutateAsync({ id: emp.id, lastWorkingDay: lastDay, reason: reason || undefined })
      toast.success('Employee exited')
      setModal(null)
    } catch { toast.error('Failed to exit employee') }
  }

  const handleCancelNotice = async () => {
    try {
      await cancelNoticeMutation.mutateAsync(emp.id)
      toast.success('Notice withdrawn — employee is active again')
      setModal(null)
    } catch (e) { toast.error((e as Error).message || 'Failed to cancel notice') }
  }

  const handleExtend = async () => {
    if (!extendDate) { toast.error('New probation end date is required'); return }
    try {
      await extendMutation.mutateAsync({ employeeId: emp.id, newEndDate: extendDate })
      toast.success('Probation extended')
      setModal(null)
    } catch (e) { toast.error((e as Error).message || 'Failed to extend probation') }
  }

  const probationDays = emp.probationEndDate
    ? Math.ceil((new Date(emp.probationEndDate).getTime() - Date.now()) / 86_400_000)
    : null

  // Tabs are hidden only when the caller could not read ANY of the section's
  // content. This is presentation, not authorization: every section re-checks
  // its own permission and every endpoint enforces its own, so revealing a tab
  // by hand-editing ?tab= shows a permission state, not data.
  const tabs = [
    { key: 'overview', label: 'Overview' },
    ...(canReadPii || canReadIdentity ? [{ key: 'personal', label: 'Personal' }] : []),
    { key: 'job', label: 'Job' },
    ...(canReadAttendance ? [{ key: 'attendance', label: 'Attendance' }] : []),
    ...(canReadSalary || canReadBank ? [{ key: 'payroll', label: 'Payroll' }] : []),
    ...(canReadDocuments ? [{ key: 'documents', label: 'Documents' }] : []),
    ...(canReadLetters ? [{ key: 'letters', label: 'Letters' }] : []),
    ...(canReadPerformance || canReadSkills ? [{ key: 'performance', label: 'Performance' }] : []),
    { key: 'exit', label: 'Exit' },
  ]

  return (
    <div className="space-y-5">
      {/* Back nav */}
      {/* Reached from the directory, from ⌘K search, or from a shared link.
          Going "back to Employees" is right for the first and wrong for the
          others, so step back through history when there IS history and fall
          back to the directory only on a cold open. */}
      <button
        onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/hrms/employees'))}
        className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
      >
        <ArrowLeft size={15} /> Back
      </button>

      {/* Profile card */}
      <div className="ut-card ut-card-lg p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-[#059669] to-[#047857] rounded-2xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {initials.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-lg font-bold text-text-primary">{fullName}</h1>
                <p className="text-text-secondary text-sm">{emp.employeeCode}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <HrStatusPill tone={PILL_TONE[statusInfo.tone] ?? 'gray'}>{statusInfo.label}</HrStatusPill>
                {/* Every other lifecycle action on this page is wrapped in
                    <Can HRMS_EMPLOYEE_WRITE>; this one was missed. The route
                    only needs employee.read, so a read-only viewer filled the
                    whole edit wizard and got a 403 on Save (2026-09-08 audit). */}
                <EmployeeShiftAction employeeId={emp.id} companyId={emp.companyId} name={fullName} />
                <Can code={P.HRMS_EMPLOYEE_WRITE}>
                  <button
                    onClick={() => setShowEdit(true)}
                    aria-label="Edit employee"
                    title="Edit employee"
                    className="p-2 bg-white hover:bg-surface-2 text-text-primary rounded-xl transition-colors">
                    <Edit3 size={14} />
                  </button>
                </Can>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 mt-2">
              {companies.find((c) => c.id === emp.companyId) && (
                <span className="text-xs text-text-secondary">
                  <Building2 size={10} className="inline mr-1" />
                  {companies.find((c) => c.id === emp.companyId)!.name}
                </span>
              )}
              {departments.find((d) => d.id === emp.departmentId) && (
                <span className="text-xs text-text-secondary">
                  <Briefcase size={10} className="inline mr-1" />
                  {departments.find((d) => d.id === emp.departmentId)!.name}
                </span>
              )}
              {emp.dateOfJoining && (
                <span className="text-xs text-text-secondary">
                  <Calendar size={10} className="inline mr-1" />
                  Joined {format(new Date(emp.dateOfJoining), 'd MMM yyyy')}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Lifecycle actions */}
        <Can code={P.HRMS_EMPLOYEE_WRITE}>
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
            {emp.employmentStatus === 'PROBATION' && (
              <button onClick={() => setModal('confirm')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-medium transition-colors">
                <UserCheck size={13} /> Confirm Probation
              </button>
            )}
            {emp.employmentStatus === 'ACTIVE' && (
              <button onClick={() => openSeparationAction('notice')} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-lg text-xs font-medium transition-colors">
                <AlertTriangle size={13} /> Start Notice
              </button>
            )}
            {emp.employmentStatus === 'NOTICE_PERIOD' && (
              <button onClick={() => setModal('cancel-notice')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg text-xs font-medium transition-colors">
                <UserCheck size={13} /> Cancel Notice
              </button>
            )}
            {emp.employmentStatus === 'NOTICE_PERIOD' && (
              <button onClick={() => openSeparationAction('exit')} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg text-xs font-medium transition-colors">
                <LogOut size={13} /> Mark Exited
              </button>
            )}
          </div>
        </Can>
      </div>

      {/* Probation banner */}
      {emp.employmentStatus === 'PROBATION' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100">
              <Calendar size={17} className="text-amber-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-amber-900">
                {emp.probationEndDate
                  ? probationDays != null && probationDays >= 0
                    ? `Probation ends in ${probationDays} day${probationDays === 1 ? '' : 's'}`
                    : 'Probation period has ended'
                  : 'Probation end date not set'}
              </p>
              {emp.probationEndDate && (
                <p className="text-xs text-amber-700 mt-0.5">{format(new Date(emp.probationEndDate), 'd MMMM yyyy')}</p>
              )}
            </div>
          </div>
          <Can code={P.HRMS_EMPLOYEE_WRITE}>
            <div className="flex items-center gap-2">
              <button onClick={() => setModal('confirm')} className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors">
                Confirm as permanent
              </button>
              <button onClick={() => { setExtendDate(emp.probationEndDate ?? ''); setModal('extend') }} className="px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 text-xs font-bold transition-colors">
                Extend
              </button>
              <button onClick={() => openSeparationAction('notice')} className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors">
                Begin exit
              </button>
            </div>
          </Can>
        </div>
      )}

      {/* Workspace tabs */}
      <HrTabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={tabs}
      />
      <div className="mt-4">
        {activeTab === 'overview' && (
          <HrTabPanel tabKey="overview">
            <EmployeeOverview emp={emp} onOpenTab={setActiveTab} />
            {canManageOnboardingRecord && <OnboardingRecord employeeId={emp.id} />}
          </HrTabPanel>
        )}
        {activeTab === 'personal' && (
          <HrTabPanel tabKey="personal"><EmployeePersonal emp={emp} /></HrTabPanel>
        )}
        {activeTab === 'job' && (
          <HrTabPanel tabKey="job"><EmployeeJob emp={emp} /></HrTabPanel>
        )}
        {activeTab === 'attendance' && (
          <HrTabPanel tabKey="attendance"><EmployeeAttendance employeeId={emp.id} /></HrTabPanel>
        )}
        {activeTab === 'payroll' && (
          <HrTabPanel tabKey="payroll"><EmployeePayroll emp={emp} /></HrTabPanel>
        )}
        {activeTab === 'documents' && (
          <HrTabPanel tabKey="documents"><EmployeeDocuments employeeId={emp.id} /></HrTabPanel>
        )}
        {activeTab === 'letters' && (
          <HrTabPanel tabKey="letters"><EmployeeLetters employeeId={emp.id} /></HrTabPanel>
        )}
        {activeTab === 'performance' && (
          <HrTabPanel tabKey="performance"><EmployeePerformance employeeId={emp.id} /></HrTabPanel>
        )}
        {activeTab === 'exit' && (
          <HrTabPanel tabKey="exit"><EmployeeExit emp={emp} /></HrTabPanel>
        )}
      </div>

      {/* Lifecycle modals */}
      {modal === 'confirm' && (
        <ActionModal title="Confirm Probation" description="Set the confirmation date for this employee." confirm="Confirm Employee" onConfirm={handleConfirm} onClose={() => setModal(null)} isLoading={confirmMutation.isPending}>
          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Confirmation Date</label>
            <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
          </div>
        </ActionModal>
      )}

      {modal === 'extend' && (
        <ActionModal title="Extend Probation" description="Set a new probation end date for this employee." confirm="Extend Probation" onConfirm={handleExtend} onClose={() => setModal(null)} isLoading={extendMutation.isPending}>
          <div>
            <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">New Probation End Date *</label>
            <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
          </div>
        </ActionModal>
      )}

      {modal === 'notice' && (
        <ActionModal title="Start Notice Period" description="Record the employee's resignation and notice period." confirm="Start Notice" onConfirm={handleNotice} onClose={() => setModal(null)} isLoading={noticeMutation.isPending}>
          <div className="space-y-3">
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Notice Start Date</label>
              <input type="date" value={noticeStart} onChange={(e) => setNoticeStart(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Last Working Day *</label>
              <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Reason</label>
              <input maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary" />
            </div>
          </div>
        </ActionModal>
      )}

      {modal === 'exit' && (
        <ActionModal title="Mark Employee as Exited" description="Record the employee's final exit from the organisation." confirm="Mark Exited" onConfirm={handleExit} onClose={() => setModal(null)} isLoading={exitMutation.isPending}>
          <div className="space-y-3">
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Last Working Day *</label>
              <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">Exit Reason</label>
              <input maxLength={100} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary" />
            </div>
          </div>
        </ActionModal>
      )}

      {modal === 'cancel-notice' && (
        <ActionModal title="Cancel Notice Period" description="Withdraw the resignation and set this employee back to Active." confirm="Cancel Notice" onConfirm={handleCancelNotice} onClose={() => setModal(null)} isLoading={cancelNoticeMutation.isPending}>
          <p className="text-sm text-text-secondary">
            {fullName} will return to <span className="font-semibold text-text-primary">Active</span> employment, and their notice start &amp; last working day will be cleared. You can start a new notice period later if needed.
          </p>
        </ActionModal>
      )}

      {showEdit && <EmployeeForm employee={emp} onClose={() => setShowEdit(false)} />}
    </div>
  )
}
