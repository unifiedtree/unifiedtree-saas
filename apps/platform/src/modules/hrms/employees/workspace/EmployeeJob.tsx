/**
 * Job — employment and reporting information.
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useEmployeeShift } from '../../api/useShiftPolicies'
import { Avatar, Button as KitButton, IconTile, ListRow, ListRows, StatusPill } from '@/design/kit/display'
import { useToast } from '@/design/kit/overlays'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { useDirectReports } from '../api/useProfileData'
import { fmtDate } from './profileFormat'
import { SectionState, SubSection, Facts } from './shared'
import { ManagerPicker } from '../ManagerPicker'
import type { EmploymentType } from '../../api/useWorkforce'
import {
  InfoRow, WorkForm, workSchema,
} from './shared'
import { Briefcase, Calendar, MapPin } from 'lucide-react'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { format } from 'date-fns'
import { useCompanies, useDepartments, useDesignations, useBranches, useGrades, useEmploymentTypes } from '../../api/useOrg'
import { useForm } from 'react-hook-form'
import { useWorkforceEmployee, useUpdateWorkforceEmployee, useEmployeesByIds } from '../../api/useWorkforce'
import { zodResolver } from '@hookform/resolvers/zod'

// ── Tab: Work ────────────────────────────────────────────────────────────────

function WorkTab({ emp }: { emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
  // Mirror OverviewTab: CTC is salary data, only reveal it to holders of the
  // salary-read permission (same code the Salary tab is gated on).
  const canReadSalary = usePermission(P.PAYROLL_STRUCTURE_READ)
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const updateMut = useUpdateWorkforceEmployee()

  const { data: departments  = [] } = useDepartments(emp.companyId)
  const { data: designations = [] } = useDesignations(emp.companyId)
  const { data: branches     = [] } = useBranches(emp.companyId)
  const { data: empTypes     = [] } = useEmploymentTypes(emp.companyId)

  const department  = departments.find((d) => d.id === emp.departmentId)
  const designation = designations.find((d) => d.id === emp.designationId)
  const branch      = branches.find((b) => b.id === emp.branchId)

  const { register, handleSubmit, reset, watch, setValue, formState: { errors, isDirty, isValid } } = useForm<WorkForm>({
    resolver: zodResolver(workSchema),
    values: {
      departmentId:       emp.departmentId       ?? '',
      designationId:      emp.designationId      ?? '',
      branchId:           emp.branchId           ?? '',
      reportingManagerId: emp.reportingManagerId ?? '',
      employmentType:     emp.employmentType,
      ctcAnnual:          emp.ctcAnnual,
    },
  })

  const onSubmit = async (values: WorkForm) => {
    // The manager goes only when it changed: sent unchanged, it would stop a department
    // change from moving someone to the new department's head. Empty is "no manager".
    const manager = values.reportingManagerId ?? ''
    const managerChange = manager === (emp.reportingManagerId ?? '') ? {}
      : manager ? { reportingManagerId: manager } : { clearReportingManager: true }
    try {
      await updateMut.mutateAsync({
        id: emp.id,
        data: {
          departmentId:       values.departmentId       || undefined,
          designationId:      values.designationId      || undefined,
          branchId:           values.branchId           || undefined,
          ...managerChange,
          employmentType:     values.employmentType     as EmploymentType | undefined,
          ctcAnnual:          values.ctcAnnual,
        },
      })
      toast.success('Work details updated')
      reset(values)
      setOpen(false)
    } catch (e) { toast.error('Couldn’t update the work details', { detail: (e as Error)?.message }) }
  }

  return (
    <>
      {/* Read-only summary */}
      <div className="flex flex-col gap-2.5 mb-3">
        <Facts>
          <InfoRow icon={Briefcase} label="Department"    value={department?.name} />
          <InfoRow icon={Briefcase} label="Designation"   value={designation?.title} />
          <InfoRow icon={MapPin}    label="Branch"        value={branch?.name} />
          <InfoRow icon={Briefcase} label="Employment type" value={emp.employmentType?.replace('_', ' ')} />
          {canReadSalary && emp.ctcAnnual ? <InfoRow label="CTC (annual)" value={`₹${emp.ctcAnnual.toLocaleString('en-IN')}`} /> : null}
        </Facts>

        {/* Date milestones — read-only, set via lifecycle mutations */}
        <Facts>
          <InfoRow icon={Calendar} label="Joining date"        value={emp.dateOfJoining      ? format(new Date(emp.dateOfJoining),      'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Confirmation date"   value={emp.confirmationDate   ? format(new Date(emp.confirmationDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Probation end"       value={emp.probationEndDate   ? format(new Date(emp.probationEndDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Last working day"    value={emp.lastWorkingDay     ? format(new Date(emp.lastWorkingDay),     'd MMM yyyy') : undefined} />
        </Facts>
      </div>

      <Can code={P.HRMS_EMPLOYEE_WRITE}>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit Work Details</Button>
      </Can>

      {open && <HrDrawer onClose={() => setOpen(false)} title="Edit Work Details">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">Department</label>
            <select {...register('departmentId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">Designation</label>
            <select {...register('designationId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">Branch</label>
            <select {...register('branchId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">Employment Type</label>
            <select {...register('employmentType')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {/* The company's active types: the five defaults and its own (6 Oct 2026: the server checks the code). */}
              {empTypes
                .filter((t) => t.active && t.code)
                .map((t) => <option key={t.id} value={t.code!}>{t.name}</option>)}
            </select>
          </div>
          <ManagerPicker companyId={emp.companyId} value={watch('reportingManagerId') ?? ''} excludeId={emp.id}
            onChange={(v) => setValue('reportingManagerId', v, { shouldDirty: true, shouldValidate: true })}
            error={errors.reportingManagerId?.message} label="Reporting manager" />
          {watch('departmentId') !== (emp.departmentId ?? '') && watch('reportingManagerId') === (emp.reportingManagerId ?? '') && (
            <p className="text-xs text-text-secondary">If they report to the old department’s head, they’ll move to the new department’s head.</p>
          )}
          <Field label="CTC Annual (₹)" error={errors.ctcAnnual?.message}>
            <Input {...register('ctcAnnual')} type="number" placeholder="1200000" />
          </Field>
          <Button type="submit" className="w-full" loading={updateMut.isPending} disabled={!isDirty || !isValid}>Save Changes</Button>
        </form>
      </HrDrawer>}
    </>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

/**
 * Job — the employment record, plus the reporting line and assigned shift that
 * were previously only discoverable elsewhere.
 *
 * The manager's name comes from the batched /v1/hrms/employees/by-ids endpoint:
 * one request for one id, never a lookup per row.
 */
export function EmployeeJob({ emp }: {
  emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']>
}) {
  const canReadAttendance = usePermission('attendance.team.read')
  const canRead = usePermission(P.HRMS_EMPLOYEE_READ)
  const navigate = useNavigate()
  const { data: me } = useCurrentUser()

  const managerIds = emp.reportingManagerId ? [emp.reportingManagerId] : []
  const { data: managers, isLoading: managerLoading } = useEmployeesByIds(managerIds, { enabled: canRead })
  const manager = managers?.[0]
  const { data: designations = [] } = useDesignations(emp.companyId)
  const reports = useDirectReports(emp.id, canRead)
  const shift = useEmployeeShift(emp.id, { enabled: canReadAttendance })
  const title = (desigId?: string | null) => designations.find((d) => d.id === desigId)?.title
  const nameOf = (e: { firstName?: string | null; lastName?: string | null; employeeCode: string }) => [e.firstName, e.lastName].filter(Boolean).join(' ') || e.employeeCode
  const managedByViewer = !!emp.reportingManagerId && emp.reportingManagerId === me?.employeeId
  // Only people whose manager really is this person (an older server ignores the filter).
  const direct = (reports.data?.content ?? []).filter((r) => r.reportingManagerId === emp.id)
  const [allReports, setAllReports] = useState(false)
  const shown = allReports ? direct : direct.slice(0, 8)

  return (
    <div className="upf-flow">
      <div className="upf-full">
        <SubSection title="Employment details">
          <WorkTab emp={emp} />
        </SubSection>
      </div>

      <div className="upf-half">
        <SubSection title="Reporting line" hint={canRead && direct.length ? `${direct.length} direct ${direct.length === 1 ? 'report' : 'reports'}` : undefined}
          action={<KitButton size={30} variant="secondary" icon="workflow" onClick={() => navigate(`/hrms/org-chart?focus=${emp.id}`)}>View in org chart</KitButton>}>
          <ListRows label="Reporting line">
            {!emp.reportingManagerId ? (
              <ListRow variant="divided" title="No reporting manager set" sub="Approvals that route to a manager fall back to the department head." leading={<IconTile icon="users" tone="neutral" />} />
            ) : managerLoading ? (
              <ListRow variant="divided" title="Loading manager…" />
            ) : manager ? (
              <ListRow variant="divided" onClick={() => navigate(`/hrms/employees/${manager.id}`)} chevron
                leading={<Avatar name={nameOf(manager)} size={34} tone="soft" />} title={nameOf(manager)}
                sub={`Reports to · ${title(manager.designationId) || manager.employeeCode}`} end={<StatusPill tone="brand">Manager</StatusPill>} />
            ) : managedByViewer ? (
              <ListRow variant="divided" leading={<IconTile icon="userCheck" tone="brand" />} title="You" sub="Reports to you" end={<StatusPill tone="brand">Manager</StatusPill>} />
            ) : (
              <ListRow variant="divided" title="A reporting manager is set" sub={canRead ? 'Their record couldn’t be loaded.' : 'Their name shows to people who can read the directory.'} />
            )}
            {shown.map((r) => (
              <ListRow key={r.id} variant="divided" onClick={() => navigate(`/hrms/employees/${r.id}`)} chevron
                leading={<Avatar name={nameOf(r)} size={34} tone="pale" />} title={nameOf(r)}
                sub={`Direct report · ${title(r.designationId) || r.employeeCode}`}
                end={r.employmentStatus === 'PROBATION' ? <StatusPill tone="warning">Probation</StatusPill> : r.employmentStatus === 'NOTICE_PERIOD' ? <StatusPill tone="warning">Notice period</StatusPill> : undefined} />
            ))}
          </ListRows>
          {reports.error && <p className="upf-note" style={{ marginTop: 8 }}>Couldn’t load the direct reports.</p>}
          {direct.length > shown.length && <div style={{ marginTop: 8 }}><KitButton size={30} variant="ghost" onClick={() => setAllReports(true)}>{`Show all ${direct.length} direct reports`}</KitButton></div>}
        </SubSection>
      </div>

      {canReadAttendance && (
        <div className="upf-half">
          <SubSection title="Assigned shift">
            <SectionState
              isLoading={shift.isLoading}
              error={shift.error}
              isEmpty={!shift.isLoading && !shift.error && !shift.data?.shiftPolicyId}
              emptyIcon={Clock}
              emptyTitle="No shift assigned"
              emptyHint="Use Change shift on the left to assign one."
              onRetry={() => shift.refetch()}
              skeleton={<CardSkeleton />}
            >
              <Facts>
                <InfoRow label="Shift" value={shift.data?.shiftName || '—'} />
                <InfoRow label="Timing" value={`${shift.data?.startTime?.slice(0, 5) ?? '—'} – ${shift.data?.endTime?.slice(0, 5) ?? '—'}${shift.data?.gracePeriodMinutes ? ` · ${shift.data.gracePeriodMinutes} min grace` : ''}`} />
                <InfoRow label="Next shift" value={shift.data?.upcomingShiftName ? `${shift.data.upcomingShiftName} from ${fmtDate(shift.data.upcomingEffectiveFrom)}` : 'No change scheduled'} />
              </Facts>
            </SectionState>
          </SubSection>
        </div>
      )}
    </div>
  )
}
