/**
 * Job — employment and reporting information.
 */

import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useEmployeeShift } from '../../api/useShiftPolicies'
import { SectionState, SubSection } from './shared'
import type { EmploymentType } from '../../api/useWorkforce'
import {
  InfoRow, WorkForm, workSchema,
} from './shared'
import { Briefcase, Calendar, MapPin } from 'lucide-react'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useCompanies, useDepartments, useDesignations, useBranches, useGrades, useEmploymentTypes } from '../../api/useOrg'
import { useForm } from 'react-hook-form'
import { useWorkforceEmployee, useUpdateWorkforceEmployee, useEmployeesByIds } from '../../api/useWorkforce'
import { zodResolver } from '@hookform/resolvers/zod'

// ── Tab: Work ────────────────────────────────────────────────────────────────

function WorkTab({ emp }: { emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
  // Mirror OverviewTab: CTC is salary data, only reveal it to holders of the
  // salary-read permission (same code the Salary tab is gated on).
  const canReadSalary = usePermission(P.PAYROLL_STRUCTURE_READ)
  const [open, setOpen] = useState(false)
  const updateMut = useUpdateWorkforceEmployee()

  const { data: departments  = [] } = useDepartments(emp.companyId)
  const { data: designations = [] } = useDesignations(emp.companyId)
  const { data: branches     = [] } = useBranches(emp.companyId)
  const { data: empTypes     = [] } = useEmploymentTypes(emp.companyId)

  const department  = departments.find((d) => d.id === emp.departmentId)
  const designation = designations.find((d) => d.id === emp.designationId)
  const branch      = branches.find((b) => b.id === emp.branchId)

  const { register, handleSubmit, reset, formState: { errors, isDirty, isValid } } = useForm<WorkForm>({
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
    try {
      await updateMut.mutateAsync({
        id: emp.id,
        data: {
          departmentId:       values.departmentId       || undefined,
          designationId:      values.designationId      || undefined,
          branchId:           values.branchId           || undefined,
          reportingManagerId: values.reportingManagerId || undefined,
          employmentType:     values.employmentType     as EmploymentType | undefined,
          ctcAnnual:          values.ctcAnnual,
        },
      })
      toast.success('Work details updated')
      reset(values)
      setOpen(false)
    } catch { toast.error('Failed to update work details') }
  }

  return (
    <>
      {/* Read-only summary */}
      <div className="space-y-3 mb-4">
        <div className="ut-card grid sm:grid-cols-2 gap-3 p-4">
          <InfoRow icon={Briefcase} label="Department"    value={department?.name} />
          <InfoRow icon={Briefcase} label="Designation"   value={designation?.title} />
          <InfoRow icon={MapPin}    label="Branch"        value={branch?.name} />
          <InfoRow icon={Briefcase} label="Employment Type" value={emp.employmentType?.replace('_', ' ')} />
          {canReadSalary && emp.ctcAnnual && (
            <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 col-span-2">
              <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-text-secondary">₹</span>
              </div>
              <div>
                <p className="text-xs text-text-secondary">CTC (Annual)</p>
                <p className="text-sm text-text-primary">₹{emp.ctcAnnual.toLocaleString('en-IN')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Date milestones — read-only, set via lifecycle mutations */}
        <div className="ut-card grid sm:grid-cols-2 gap-3 p-4">
          <InfoRow icon={Calendar} label="Joining Date"        value={emp.dateOfJoining      ? format(new Date(emp.dateOfJoining),      'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Confirmation Date"   value={emp.confirmationDate   ? format(new Date(emp.confirmationDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Probation End"       value={emp.probationEndDate   ? format(new Date(emp.probationEndDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Last Working Day"    value={emp.lastWorkingDay     ? format(new Date(emp.lastWorkingDay),     'd MMM yyyy') : undefined} />
        </div>
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
              {/* Only real backend enum codes — a custom/lookup code would 400 on save. */}
              {empTypes
                .filter((t) => t.active && t.code && ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'].includes(t.code))
                .map((t) => <option key={t.id} value={t.code!}>{t.name}</option>)}
            </select>
          </div>
          <Field label="Reporting Manager ID" error={errors.reportingManagerId?.message}>
            <Input {...register('reportingManagerId')} placeholder="UUID of reporting manager" />
          </Field>
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
  const navigate = useNavigate()

  const managerIds = emp.reportingManagerId ? [emp.reportingManagerId] : []
  const { data: managers, isLoading: managerLoading } = useEmployeesByIds(managerIds)
  const manager = managers?.[0]
  const shift = useEmployeeShift(emp.id, { enabled: canReadAttendance })

  return (
    <div className="space-y-8">
      <SubSection title="Employment details">
        <WorkTab emp={emp} />
      </SubSection>

      <SubSection title="Reporting line">
        <div className="ut-card p-4">
          {!emp.reportingManagerId ? (
            <p className="text-sm text-text-secondary">
              No reporting manager set. Approvals that route to a manager will fall back to
              the department head.
            </p>
          ) : managerLoading ? (
            <p className="text-sm text-text-tertiary">Loading manager…</p>
          ) : manager ? (
            <button
              type="button"
              onClick={() => navigate(`/hrms/employees/${manager.id}`)}
              className="flex items-center gap-3 text-left group"
            >
              <span className="w-9 h-9 rounded-xl bg-[var(--accent-bg)] text-[var(--accent-fg)] flex items-center justify-center text-xs font-bold">
                {((manager.firstName?.[0] ?? '') + (manager.lastName?.[0] ?? '')).toUpperCase() || '?'}
              </span>
              <span>
                <span className="block text-sm font-semibold text-text-primary group-hover:text-[#059669] transition-colors">
                  {[manager.firstName, manager.lastName].filter(Boolean).join(' ') || manager.employeeCode}
                </span>
                <span className="block text-xs text-text-secondary">{manager.employeeCode}</span>
              </span>
            </button>
          ) : (
            <p className="text-sm text-text-secondary">
              A reporting manager is set, but their record couldn’t be loaded.
            </p>
          )}
        </div>
      </SubSection>

      {canReadAttendance && (
        <SubSection title="Assigned shift">
          <SectionState
            isLoading={shift.isLoading}
            error={shift.error}
            isEmpty={!shift.isLoading && !shift.error && !shift.data?.shiftPolicyId}
            emptyIcon={Clock}
            emptyTitle="No shift assigned"
            emptyHint="Assign a shift from Attendance → Shifts & OT."
            onRetry={() => shift.refetch()}
            skeleton={<CardSkeleton />}
          >
            <div className="ut-card p-4 flex flex-wrap gap-x-8 gap-y-2">
              <div>
                <p className="text-xs text-text-secondary">Shift</p>
                <p className="text-sm font-semibold text-text-primary">{shift.data?.shiftName}</p>
              </div>
              <div>
                <p className="text-xs text-text-secondary">Timing</p>
                <p className="text-sm text-text-primary">
                  {shift.data?.startTime ?? '—'} → {shift.data?.endTime ?? '—'}
                </p>
              </div>
            </div>
          </SectionState>
        </SubSection>
      )}
    </div>
  )
}
