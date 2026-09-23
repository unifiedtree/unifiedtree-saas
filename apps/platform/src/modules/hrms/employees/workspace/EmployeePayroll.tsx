/**
 * Payroll — salary structure, its revision history, and bank accounts.
 *
 * Every block here is gated on the EXISTING payroll/bank permission, not on a
 * profile-specific rule: payroll.structure.read for the structure and
 * hrms.employee.bank.read for accounts, exactly as the standalone screens use.
 */

import React, { useState } from 'react'
import type { useWorkforceEmployee } from '../../api/useWorkforce'
import { Info } from 'lucide-react'
import { SectionState, SubSection } from './shared'
import type {
  EmployeeAddress, EmployeeIdentityResponse, EmployeeBankAccountResponse,
  EmployeeEducation, EmployeeExperience, EmployeeDependent, EmergencyContact,
} from '../../api/useEmployeeProfile'
import {
  BankForm, bankSchema,
} from './shared'
import {
  useEmployeeAddresses, useCreateAddress, useDeleteAddress,
  useEmployeeIdentity, useSaveIdentity,
  useBankAccounts, useAddBankAccount, useDeleteBankAccount,
  useEmployeeEducation, useAddEducation, useDeleteEducation,
  useEmployeeExperience, useAddExperience, useDeleteExperience,
  useEmployeeDependents, useAddDependent, useDeleteDependent,
  useEmergencyContacts, useAddEmergencyContact, useDeleteEmergencyContact,
} from '../../api/useEmployeeProfile'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { DataTable } from '@/shared/components/DataTable'
import { EmptyState } from '@/shared/components/EmptyState'
import { FileText, Plus, Trash2, XCircle } from 'lucide-react'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useEmployeeStructure, useStructureHistory, useUpsertStructure, useSalaryComponents } from '../../api/usePayroll'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'

// ── Tab: Bank Accounts (PII) ──────────────────────────────────────────────────

function BankTab({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useBankAccounts(employeeId)
  const addMut    = useAddBankAccount(employeeId)
  const deleteMut = useDeleteBankAccount(employeeId)

  const { register, handleSubmit, reset, formState: { errors, isDirty, isValid } } = useForm<BankForm>({
    resolver: zodResolver(bankSchema),
    defaultValues: { primary: false },
  })

  const onSubmit = async (values: BankForm) => {
    try {
      await addMut.mutateAsync(values)
      toast.success('Bank account added')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to add bank account') }
  }

  if (isLoading) return <TableSkeleton rows={2} cols={4} />
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_BANK_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Account</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState icon={FileText} title="No bank accounts" description="Add a bank account for salary credit." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeBankAccountResponse[]).map((acc) => (
            <div key={acc.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-text-primary">{acc.accountHolderName}</p>
                <p className="text-xs text-text-secondary">{acc.bankName} {acc.branchName ? `· ${acc.branchName}` : ''}</p>
                <p className="text-xs font-mono text-text-secondary">IFSC: {acc.ifscCode} · ****{acc.accountNumberLast4}</p>
                <div className="flex gap-1.5 mt-1">
                  {acc.primary   && <HrStatusPill tone="ok">Primary</HrStatusPill>}
                  {acc.verified  && <HrStatusPill tone="info">Verified</HrStatusPill>}
                </div>
              </div>
              <Can code={P.HRMS_EMPLOYEE_BANK_WRITE}>
                <button onClick={() => deleteMut.mutate(acc.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Bank Account">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Account Number" required error={errors.accountNumber?.message}><Input {...register('accountNumber')} /></Field>
          <Field label="IFSC Code" required error={errors.ifscCode?.message}><Input {...register('ifscCode')} placeholder="SBIN0001234" /></Field>
          <Field label="Account Holder Name" required error={errors.accountHolderName?.message}><Input {...register('accountHolderName')} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Bank Name" error={errors.bankName?.message}><Input {...register('bankName')} /></Field>
            <Field label="Branch" error={errors.branchName?.message}><Input {...register('branchName')} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('primary')} className="rounded border-border bg-white" />
            Set as primary account
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Add Account</Button>
        </form>
      </HrDrawer>}
    </>
  )
}


// ── Tab: Salary (payroll structure) ───────────────────────────────────────────

function SalaryTab({ employeeId, companyId }: { employeeId: string; companyId?: string }) {
  const { data: structure, isLoading } = useEmployeeStructure(employeeId)
  const { data: history = [] } = useStructureHistory(employeeId)
  const { data: components = [] } = useSalaryComponents()
  const upsert = useUpsertStructure()
  const [open, setOpen] = useState(false)
  const [ctc, setCtc] = useState('')
  const [effFrom, setEffFrom] = useState(new Date().toISOString().split('T')[0])
  const [taxRegime, setTaxRegime] = useState<'OLD' | 'NEW'>('NEW')
  const [pfApplicable, setPfApplicable] = useState(true)
  const [lines, setLines] = useState<Record<string, string>>({})

  const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
  const ctcComponents = components.filter(c => c.category === 'EARNING')

  const openEdit = () => {
    setCtc(structure ? String(structure.ctcAnnual) : '')
    setEffFrom(new Date().toISOString().split('T')[0])
    setTaxRegime((structure?.taxRegime as 'OLD' | 'NEW') ?? 'NEW')
    setPfApplicable(structure?.pfApplicable ?? true)
    // Pre-fill the existing component amounts so "Revise" preserves them — without
    // this, saving a revision zeroed every line and the employee was paid ₹0.
    // (Clear a field to drop that component; that's the explicit-removal path.)
    const prefill: Record<string, string> = {}
    // `lines` is the raw configured set, so componentId is always present here.
    // The null case belongs to the server-computed statutory lines (PF/ESI/PT),
    // which have no employee_structure_components row and are never revisable.
    for (const l of structure?.lines ?? []) {
      if (l.componentId) prefill[l.componentId] = String(l.monthlyAmount)
    }
    setLines(prefill)
    setOpen(true)
  }

  const save = () => {
    if (!ctc || Number(ctc) <= 0) { toast.error('Enter a valid annual CTC'); return }
    upsert.mutate({
      employeeId, ctcAnnual: Number(ctc), effectiveFrom: effFrom, taxRegime, pfApplicable,
      components: Object.entries(lines).filter(([, v]) => v).map(([componentId, v]) => ({ componentId, monthlyAmount: Number(v) })),
    }, {
      onSuccess: () => { toast.success('Salary structure saved'); setOpen(false) },
      onError: (e) => toast.error((e as Error).message || 'Failed to save structure'),
    })
  }

  if (isLoading) return <CardSkeleton />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-text-primary">Current Salary Structure</h3>
        <Can code={P.PAYROLL_STRUCTURE_MANAGE}>
          <Button size="sm" onClick={openEdit}>{structure ? 'Revise structure' : 'Add structure'}</Button>
        </Can>
      </div>

      {!structure ? (
        <EmptyState icon={FileText} title="No salary structure" description="Define this employee's salary structure to enable payroll." />
      ) : (
        <>
          {/* 2026-09-10: this tab showed CTC / Monthly / Tax regime / PF status
              and a single flat, uncategorised component list — no gross, no
              deductions, no net. The server now returns a full-month breakdown
              computed by the payroll engine, so show the same four money cards
              the Salary Structure page does. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="ut-card ut-card-sm p-3"><p className="text-xs text-text-secondary">Annual CTC</p><p className="text-lg font-bold text-text-primary">{inr(structure.ctcAnnual)}</p><p className="text-xs text-text-tertiary">{inr(structure.ctcMonthly)} / month</p></div>
            <div className="ut-card ut-card-sm p-3"><p className="text-xs text-text-secondary">Gross / mo</p><p className="text-lg font-bold text-text-primary">{inr(structure.grossMonthly ?? structure.ctcMonthly)}</p></div>
            <div className="ut-card ut-card-sm p-3"><p className="text-xs text-text-secondary">Deductions / mo</p><p className="text-lg font-bold text-text-primary">{inr(structure.totalDeductions ?? 0)}</p></div>
            <div className="ut-card ut-card-sm p-3"><p className="text-xs text-text-secondary">Net pay / mo</p><p className="text-lg font-bold text-text-primary">{inr(structure.netMonthly ?? structure.ctcMonthly)}</p></div>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            <span>Tax regime: <span className="font-semibold text-text-primary">{structure.taxRegime}</span></span>
            <span>PF: <span className="font-semibold text-text-primary">{structure.pfApplicable ? structure.pfStatus : 'N/A'}</span></span>
          </div>
          {structure.derivedFromCtc && (
            <p className="text-xs text-text-tertiary">
              No salary components configured — this breakup is derived from CTC as a
              single Basic component, the same fallback payroll applies. Use “Revise
              structure” below to define your own.
            </p>
          )}
          {(structure.earnings ?? structure.lines).length > 0 && (
            <DataTable
          columns={[
            { key: 'component', header: 'Component', render: (l) => l.componentName },
            { key: 'type', header: 'Type', render: (l) => <span className="text-text-secondary">{l.category.replace('_', ' ')}</span> },
            { key: 'monthly', header: 'Monthly', render: (l) => inr(l.monthlyAmount) },
            { key: 'annual', header: 'Annual', render: (l) => <span className="text-text-secondary">{inr(l.monthlyAmount * 12)}</span> }
          ]}
          data={[...(structure.earnings ?? structure.lines), ...(structure.deductions ?? [])]}
          keyField="componentCode"
          emptyMessage="No salary components configured"
        />
          )}
        </>
      )}

      {history.length > 1 && (
        <div>
          <h3 className="text-sm font-bold text-text-primary mb-2">History</h3>
          <DataTable
            columns={[
              { key: 'effective', header: 'Effective', render: (h) => format(new Date(h.effectiveFrom), 'd MMM yyyy') },
              { key: 'ctc', header: 'CTC', render: (h) => inr(h.ctcAnnual) },
              { key: 'status', header: 'Status', render: (h) => h.isCurrent ? <HrStatusPill tone="ok">Current</HrStatusPill> : <HrStatusPill tone="gray">Past</HrStatusPill> }
            ]}
            data={history}
            keyField="id"
          />
        </div>
      )}

      {open && (
        <HrDrawer onClose={() => setOpen(false)} title="Salary structure">
          <div className="space-y-4">
            <Field label="Annual CTC (₹)" required><Input type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} /></Field>
            <Field label="Effective from"><Input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} /></Field>
            <Field label="Tax regime">
              <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as 'OLD' | 'NEW')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm">
                <option value="NEW">New regime</option><option value="OLD">Old regime</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-text-primary">
              <input type="checkbox" checked={pfApplicable} onChange={(e) => setPfApplicable(e.target.checked)} className="h-4 w-4 rounded accent-[#059669]" /> PF applicable
            </label>
            {ctcComponents.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-xs font-bold text-text-secondary uppercase tracking-wider">Monthly component amounts</p>
                {ctcComponents.map(c => (
                  <Field key={c.id} label={c.name}>
                    <Input type="number" value={lines[c.id] ?? ''} onChange={(e) => setLines(p => ({ ...p, [c.id]: e.target.value }))} placeholder="0" />
                  </Field>
                ))}
              </div>
            )}
            <Button className="w-full" loading={upsert.isPending} onClick={save}>Save structure</Button>
          </div>
        </HrDrawer>
      )}
    </div>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

/**
 * Salary structure and bank accounts, each behind its own existing permission:
 * payroll.structure.read and hrms.employee.bank.read. Neither is widened or
 * narrowed by being on the profile — the same codes gate the standalone screens
 * and the backend endpoints.
 */
export function EmployeePayroll({ emp }: {
  emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']>
}) {
  const canReadSalary = usePermission(P.PAYROLL_STRUCTURE_READ)
  const canReadBank = usePermission(P.HRMS_EMPLOYEE_BANK_READ)

  if (!canReadSalary && !canReadBank) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to payroll"
        forbiddenHint="Salary and bank details need the payroll structure or bank permission."
      />
    )
  }

  return (
    <div className="space-y-8">
      {canReadSalary && (
        <SubSection title="Salary structure" hint="Current structure and its revision history.">
          <SalaryTab employeeId={emp.id} companyId={emp.companyId} />
        </SubSection>
      )}
      {canReadBank && (
        <SubSection title="Bank accounts">
          <BankTab employeeId={emp.id} />
        </SubSection>
      )}
      {/* Payslips are the obvious next thing to want here and deliberately are
          not faked: the only cross-run payslip rollup, GET /v1/payroll/payslips/me,
          takes its employee id from the JWT, and GET /v1/payroll/runs has no
          employeeId filter — so listing this employee's payslips would mean one
          request per payroll run. */}
      <div className="ut-card p-4 flex gap-3">
        <Info size={15} className="text-text-tertiary shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-text-primary">Payslip history isn’t shown here yet</p>
          <p className="text-xs text-text-secondary mt-0.5">
            Payslips can only be fetched one payroll run at a time for another employee.
            Open a run under Payroll → Runs to download a payslip.
          </p>
        </div>
      </div>
    </div>
  )
}
