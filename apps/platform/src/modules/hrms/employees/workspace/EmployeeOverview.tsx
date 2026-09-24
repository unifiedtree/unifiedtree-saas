/**
 * Overview — the landing section, and the one this milestone is built around.
 *
 * It answers three questions and nothing else:
 *   Who is this employee?  What is their employment state?  Does anything need
 *   attention?
 *
 * API discipline. Overview issues no request that a section does not already
 * make: the week, the salary structure, the document count and the goals are
 * fetched with the SAME react-query keys the Attendance, Payroll, Documents and
 * Performance sections use, so opening those tabs is a cache hit, not a second
 * round trip. Every one is gated on its own domain permission, so a caller who
 * cannot read payroll never fires the payroll request at all. Nothing here is
 * per-row, so there is no fan-out: the reporting manager's name comes from the
 * batched /employees/by-ids endpoint, one request for the one id.
 *
 * Every tile and every attention item navigates somewhere real — a tab on this
 * page, or the screen that owns the action. A metric with no destination is a
 * decoration, and this page has none.
 */

import React from 'react'
import { format } from 'date-fns'
import {
  AlertTriangle, ArrowRight, Briefcase, Building2, CalendarDays, Clock,
  FileText, IndianRupee, MapPin, Target, UserCheck,
} from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { useNavigate } from 'react-router-dom'
import { HrStatusPill } from '@/shared/components/hr'
import { useEmployeeWeeklySummary } from '../../api/useAttendance'
import { useEmployeeShift } from '../../api/useShiftPolicies'
import { useEmployeeStructure } from '../../api/usePayroll'
import { useEmployeeDocuments } from '../../api/useDocument'
import { EMPLOYEE_DOCUMENTS_PAGE_SIZE } from './EmployeeDocuments'
import { useEmployeeKpis } from '../../api/usePerformance'
import { useEmployeesByIds, type useWorkforceEmployee } from '../../api/useWorkforce'
import { useCompanies, useDepartments, useDesignations, useBranches } from '../../api/useOrg'
import { AccountCard, InfoRow, PILL_TONE, STATUS_STYLE, SubSection } from './shared'

type Emp = NonNullable<ReturnType<typeof useWorkforceEmployee>['data']>

function fmt(d?: string) {
  if (!d) return undefined
  try { return format(new Date(d), 'd MMM yyyy') } catch { return d }
}

function fmtHours(h?: number) {
  if (h == null) return '—'
  const hrs = Math.floor(h)
  const mins = Math.round((h - hrs) * 60)
  return mins ? `${hrs}h ${mins}m` : `${hrs}h`
}

/** A metric that goes somewhere. `onClick` is required by design. */
function Tile({ icon: Icon, label, value, hint, onClick, cta }: {
  icon: React.ElementType
  label: string
  value: React.ReactNode
  hint?: string
  onClick: () => void
  cta: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${typeof value === 'string' || typeof value === 'number' ? value : ''}. ${cta}`}
      className="ut-card ut-card-hover p-4 text-left w-full transition-colors group"
    >
      <span className="flex items-center gap-2 text-text-secondary">
        <Icon size={14} />
        <span className="text-xs font-semibold">{label}</span>
      </span>
      <span className="mt-1.5 block text-xl font-bold text-text-primary">{value}</span>
      <span className="mt-0.5 block text-xs text-text-tertiary">{hint ?? ''}</span>
      <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#047857] group-hover:text-[#059669]">
        {cta} <ArrowRight size={11} />
      </span>
    </button>
  )
}

/** Something a human should act on, with the place to act on it. */
interface Attention {
  id: string
  tone: 'warn' | 'info'
  text: string
  cta: string
  onClick: () => void
}

export function EmployeeOverview({ emp, onOpenTab }: {
  emp: Emp
  /** Switch the workspace to another tab. Keeps every tile's destination real. */
  onOpenTab: (key: string) => void
}) {
  const navigate = useNavigate()

  // Each gate is the domain's OWN permission — the same code the standalone
  // screen and the backend endpoint use. No profile-specific authorization.
  const canReadAttendance = usePermission('attendance.team.read')
  const canReadSalary = usePermission('payroll.structure.read')
  const canReadDocuments = usePermission('hrms.document.read')
  const canReadPerformance = usePermission('hrms.performance.read')

  const week = useEmployeeWeeklySummary(emp.id, undefined, { enabled: canReadAttendance })
  const shift = useEmployeeShift(emp.id, { enabled: canReadAttendance })
  const structure = useEmployeeStructure(canReadSalary ? emp.id : '')
  // Same page size as the Documents tab, deliberately: useEmployeeDocuments
  // keys on pageSize, so a mismatch here would silently double the request.
  const documents = useEmployeeDocuments(emp.id, 0, canReadDocuments, EMPLOYEE_DOCUMENTS_PAGE_SIZE)
  const kpis = useEmployeeKpis(emp.id, { enabled: canReadPerformance })

  // One batched request for the one manager id — never a per-row lookup.
  const managerIds = emp.reportingManagerId ? [emp.reportingManagerId] : []
  const { data: managers } = useEmployeesByIds(managerIds)
  const manager = managers?.[0]

  const { data: companies = [] } = useCompanies()
  const { data: departments = [] } = useDepartments(emp.companyId)
  const { data: designations = [] } = useDesignations(emp.companyId)
  const { data: branches = [] } = useBranches(emp.companyId)

  const company = companies.find((c) => c.id === emp.companyId)
  const department = departments.find((d) => d.id === emp.departmentId)
  const designation = designations.find((d) => d.id === emp.designationId)
  const branch = branches.find((b) => b.id === emp.branchId)

  const status = emp.employmentStatus ?? ''
  const statusInfo = STATUS_STYLE[status] ?? { label: status || '—', tone: 'default' as const }
  const separated = status === 'EXITED' || status === 'TERMINATED'

  const daysToProbationEnd = emp.probationEndDate
    ? Math.ceil((new Date(emp.probationEndDate).getTime() - Date.now()) / 86_400_000)
    : null
  const daysToLastDay = emp.lastWorkingDay && !separated
    ? Math.ceil((new Date(emp.lastWorkingDay).getTime() - Date.now()) / 86_400_000)
    : null

  const w = week.data
  const absentThisWeek = w?.days?.filter((d) => d.status === 'ABSENT').length ?? 0
  const lateThisWeek = w?.days?.filter((d) => d.status === 'LATE').length ?? 0

  // ── Attention ────────────────────────────────────────────────────────────
  // Only items derived from data actually loaded. Nothing is inferred from a
  // partial page: the document count, for instance, drives a tile but never an
  // "expiring soon" claim, because only the first page is in hand.
  const attention: Attention[] = []

  if (status === 'PROBATION' && daysToProbationEnd != null && daysToProbationEnd <= 30) {
    attention.push({
      id: 'probation',
      tone: 'warn',
      text: daysToProbationEnd < 0
        ? `Probation ended ${Math.abs(daysToProbationEnd)} day${Math.abs(daysToProbationEnd) === 1 ? '' : 's'} ago and is still not confirmed.`
        : `Probation ends in ${daysToProbationEnd} day${daysToProbationEnd === 1 ? '' : 's'}.`,
      cta: 'Review lifecycle',
      onClick: () => onOpenTab('exit'),
    })
  }
  if (status === 'NOTICE_PERIOD' && daysToLastDay != null) {
    attention.push({
      id: 'notice',
      tone: 'warn',
      text: daysToLastDay >= 0
        ? `Serving notice — last working day in ${daysToLastDay} day${daysToLastDay === 1 ? '' : 's'}.`
        : 'Notice period has passed its last working day.',
      cta: 'Open exit',
      onClick: () => onOpenTab('exit'),
    })
  }
  if (canReadSalary && !structure.isLoading && !structure.error && !structure.data && !separated) {
    attention.push({
      id: 'no-structure',
      tone: 'warn',
      text: 'No salary structure — this employee cannot be included in a payroll run.',
      cta: 'Set up payroll',
      onClick: () => onOpenTab('payroll'),
    })
  }
  if (canReadAttendance && !shift.isLoading && !shift.error && !shift.data?.shiftPolicyId && !separated) {
    attention.push({
      id: 'no-shift',
      tone: 'info',
      text: 'No shift assigned — lateness and overtime can’t be measured.',
      cta: 'Open attendance',
      onClick: () => onOpenTab('attendance'),
    })
  }
  if (absentThisWeek > 0) {
    attention.push({
      id: 'absent',
      tone: 'info',
      text: `${absentThisWeek} unmarked/absent day${absentThisWeek === 1 ? '' : 's'} this week.`,
      cta: 'See attendance',
      onClick: () => onOpenTab('attendance'),
    })
  }

  return (
    <div className="space-y-6">
      {/* ── Employment state ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="ut-card p-5 lg:col-span-2">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Employment</p>
              <p className="mt-1 text-lg font-bold text-text-primary">
                {designation?.title ?? 'No designation'}
              </p>
              <p className="text-sm text-text-secondary">
                {department?.name ?? 'No department'}
                {branch ? ` · ${branch.name}` : ''}
              </p>
            </div>
            <HrStatusPill tone={PILL_TONE[statusInfo.tone] ?? 'gray'}>{statusInfo.label}</HrStatusPill>
          </div>

          <div className="mt-4 grid sm:grid-cols-2 gap-x-6">
            {company && <InfoRow icon={Building2} label="Company" value={company.name} />}
            <InfoRow icon={Briefcase} label="Employment type" value={emp.employmentType?.replace(/_/g, ' ')} />
            <InfoRow icon={CalendarDays} label="Joined" value={fmt(emp.dateOfJoining)} />
            <InfoRow
              icon={UserCheck}
              label="Reports to"
              value={manager
                ? [manager.firstName, manager.lastName].filter(Boolean).join(' ')
                : emp.reportingManagerId ? undefined : 'Not set'}
            />
            {branch && <InfoRow icon={MapPin} label="Branch" value={branch.name} />}
            {emp.probationEndDate && !emp.confirmationDate && (
              <InfoRow icon={CalendarDays} label="Probation ends" value={fmt(emp.probationEndDate)} />
            )}
            {emp.confirmationDate && (
              <InfoRow icon={UserCheck} label="Confirmed" value={fmt(emp.confirmationDate)} />
            )}
            {emp.lastWorkingDay && (
              <InfoRow icon={CalendarDays} label="Last working day" value={fmt(emp.lastWorkingDay)} />
            )}
          </div>
        </div>

        <AccountCard emp={emp} />
      </div>

      {/* ── Needs attention ──────────────────────────────────────────────── */}
      {attention.length > 0 && (
        <SubSection title="Needs attention">
          <ul className="space-y-2">
            {attention.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={a.onClick}
                  className="ut-card ut-card-hover w-full p-3.5 text-left flex items-start gap-3 group"
                >
                  <AlertTriangle
                    size={15}
                    className={`shrink-0 mt-0.5 ${a.tone === 'warn' ? 'text-orange-500' : 'text-text-tertiary'}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-text-primary">{a.text}</span>
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-[#047857] group-hover:text-[#059669]">
                      {a.cta} <ArrowRight size={11} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </SubSection>
      )}

      {/* ── Summary metrics ──────────────────────────────────────────────── */}
      <SubSection title="At a glance">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {canReadAttendance && (
            <Tile
              icon={Clock}
              label="This week"
              value={week.isLoading ? '…' : week.error ? '—' : fmtHours(w?.totalHours)}
              hint={week.error
                ? 'Attendance unavailable'
                : `${w?.presentDays ?? 0} present${lateThisWeek ? ` · ${lateThisWeek} late` : ''}`}
              cta="Open attendance"
              onClick={() => onOpenTab('attendance')}
            />
          )}
          {canReadSalary && (
            <Tile
              icon={IndianRupee}
              label="Salary structure"
              value={structure.isLoading
                ? '…'
                : structure.error
                  ? '—'
                  : structure.data?.ctcAnnual
                    ? `₹${structure.data.ctcAnnual.toLocaleString('en-IN')}`
                    : 'Not set'}
              hint={structure.data?.effectiveFrom
                ? `Effective ${fmt(structure.data.effectiveFrom)}`
                : structure.error ? 'Payroll unavailable' : 'Annual CTC'}
              cta="Open payroll"
              onClick={() => onOpenTab('payroll')}
            />
          )}
          {canReadDocuments && (
            <Tile
              icon={FileText}
              label="Documents"
              value={documents.isLoading ? '…' : documents.error ? '—' : String(documents.data?.totalElements ?? 0)}
              hint={documents.error ? 'Documents unavailable' : 'On record'}
              cta="Open documents"
              onClick={() => onOpenTab('documents')}
            />
          )}
          {canReadPerformance && (
            <Tile
              icon={Target}
              label="Goals"
              value={kpis.isLoading ? '…' : kpis.error ? '—' : String(kpis.data?.total ?? 0)}
              hint={kpis.error ? 'Performance unavailable' : 'Active goals & KPIs'}
              cta="Open performance"
              onClick={() => onOpenTab('performance')}
            />
          )}
        </div>
        {!canReadAttendance && !canReadSalary && !canReadDocuments && !canReadPerformance && (
          <p className="text-sm text-text-secondary">
            Your role doesn’t include attendance, payroll, document or performance access,
            so there are no summary metrics to show for this employee.
          </p>
        )}
      </SubSection>

      {/* ── What this page can't show yet ────────────────────────────────── */}
      <div className="ut-card p-4">
        <p className="text-sm font-semibold text-text-primary">Not on this page yet</p>
        <p className="text-xs text-text-secondary mt-1">
          <span className="font-medium">Leave balances and history</span>,{' '}
          <span className="font-medium">expense claims</span> and{' '}
          <span className="font-medium">salary advances</span> can only be read for the
          signed-in user today — no API returns them for another employee — so showing them
          here would mean reading the whole workspace and filtering in the browser. Use{' '}
          <button type="button" onClick={() => navigate('/hrms/leave')} className="font-semibold text-[#047857] hover:text-[#059669]">Leave</button>{' '}
          and{' '}
          <button type="button" onClick={() => navigate('/hrms/expenses')} className="font-semibold text-[#047857] hover:text-[#059669]">Expenses</button>{' '}
          in the meantime.
        </p>
      </div>
    </div>
  )
}
