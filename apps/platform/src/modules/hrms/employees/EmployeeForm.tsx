import React, { useState } from 'react'
import { X, ChevronRight, Send } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore } from '@unifiedtree/sdk'
import { P } from '@unifiedtree/sdk'
import { useCreateWorkforceEmployee, useUpdateWorkforceEmployee, useEmployeeDirectory, type WorkforceEmployee } from '../api/useWorkforce'
import { useCompanies, useDepartments, useDesignations, useBranches, useGrades, useEmploymentTypes, useShifts } from '../api/useOrg'
import { useTemplates } from '../onboarding/api/useOnboarding'
import { sendInvite } from './api/useInvitation'

type FormStep = 'basic' | 'system' | 'work' | 'identity' | 'bank' | 'address' | 'emergency'

const STEPS: { key: FormStep; label: string }[] = [
  { key: 'basic', label: 'Basic Info' },
  { key: 'system', label: 'System Access' },
  { key: 'work', label: 'Work Info' },
  { key: 'identity', label: 'Identity' },
  { key: 'bank', label: 'Bank' },
  { key: 'address', label: 'Address' },
  { key: 'emergency', label: 'Emergency' },
]

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1.5">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500 font-medium">{error}</p>}
    </div>
  )
}

function Input({ error, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return (
    <input
      {...props}
      className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none transition-colors ${error ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-border/60 focus:border-primary'}`}
    />
  )
}

function Sel({ error, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select
      {...props}
      className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none transition-colors ${error ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-border/60 focus:border-primary'}`}
    >
      {children}
    </select>
  )
}

interface EmployeeFormProps {
  employee?: WorkforceEmployee
  onClose: () => void
  onSuccess?: (emp: WorkforceEmployee) => void
}

export const EmployeeForm: React.FC<EmployeeFormProps> = ({ employee, onClose, onSuccess }) => {
  const { toast } = useToast()
  const isEdit = !!employee
  const canInvite = useAuthStore(s => s.permissions.has(P.HRMS_EMPLOYEE_INVITE))
  const [sendInvitation, setSendInvitation] = useState(true)
  const createEmp = useCreateWorkforceEmployee()
  const updateEmp = useUpdateWorkforceEmployee()

  const { data: companies = [] } = useCompanies()
  const [companyId, setCompanyId] = useState(employee?.companyId ?? '')
  // Once companies load, auto-select the first if none already chosen
  React.useEffect(() => {
    if (!companyId && companies.length > 0) setCompanyId(companies[0].id)
  }, [companies])
  const [departmentId, setDepartmentId] = useState(employee?.departmentId ?? '')
  const { data: departments = [] } = useDepartments(companyId)
  const { data: designations = [] } = useDesignations(companyId, departmentId || undefined)
  const { data: branches = [] } = useBranches(companyId)
  const { data: grades = [] } = useGrades(companyId)
  const { data: employmentTypes = [] } = useEmploymentTypes(companyId)
  const { data: shifts = [] } = useShifts(companyId)
  const { data: templates = [] } = useTemplates(companyId || undefined)
  const { data: managerPage } = useEmployeeDirectory({ companyId: companyId || undefined, pageSize: 200 })
  const managers = (managerPage?.content ?? []).filter((m) => m.id !== employee?.id)

  const [step, setStep] = useState<FormStep>('basic')
  const [form, setForm] = useState({
    firstName: employee?.firstName ?? '',
    middleName: employee?.middleName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    dateOfBirth: employee?.dateOfBirth ?? '',
    gender: employee?.gender ?? '',
    employeeCode: employee?.employeeCode ?? '',
    // work
    designationId: employee?.designationId ?? '',
    branchId: employee?.branchId ?? '',
    reportingManagerId: employee?.reportingManagerId ?? '',
    employmentType: employee?.employmentType ?? 'FULL_TIME',
    gradeId: '',
    shiftId: '',
    dateOfJoining: employee?.dateOfJoining ?? '',
    ctcAnnual: employee?.ctcAnnual ? String(employee.ctcAnnual) : '',
    // identity
    panNumber: '', aadhaarNumber: '', passportNumber: '',
    // bank
    bankName: '', bankAccountNumber: '', bankIfsc: '',
    // address
    currentAddressLine: '', currentAddressCity: '', currentAddressState: '', currentAddressPincode: '',
    // emergency
    emergencyContactName: '', emergencyContactRelation: '', emergencyContactPhone: '',
    // onboarding
    onboardingTemplateId: '',
    // system access
    systemAccess: true,
    systemRole: 'EMPLOYEE',
  })

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }))
    if (errors[key]) setErrors((p) => ({ ...p, [key]: '' }))
  }

  const handleSubmit = async () => {
    if (createEmp.isPending || updateEmp.isPending) return

    const errs: Record<string, string> = {}
    if (!form.firstName.trim()) errs.firstName = 'First name is required'
    if (!form.email.trim()) errs.email = 'Work email is required'
    if (!isEdit && !companyId) errs.companyId = 'Select a company — create one in Organization → Companies first'
    if (!isEdit && !form.branchId) errs.branchId = 'Select a Punch Location so the employee can clock in'

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      if (errs.firstName || errs.email || errs.companyId) setStep('basic')
      else if (errs.branchId) setStep('work')
      return
    }
    setErrors({})
    try {
      if (isEdit) {
        const result = await updateEmp.mutateAsync({
          id: employee.id,
          data: {
            firstName: form.firstName,
            middleName: form.middleName || undefined,
            lastName: form.lastName || undefined,
            email: form.email,
            phone: form.phone || undefined,
            dateOfBirth: form.dateOfBirth || undefined,
            gender: (form.gender as WorkforceEmployee['gender']) || undefined,
            departmentId: departmentId || undefined,
            designationId: form.designationId || undefined,
            branchId: form.branchId || undefined,
            reportingManagerId: form.reportingManagerId || undefined,
            employmentType: form.employmentType as WorkforceEmployee['employmentType'],
            ctcAnnual: form.ctcAnnual ? parseFloat(form.ctcAnnual) : undefined,
          },
        })
        toast('Employee updated', 'success')
        onSuccess?.(result)
      } else {
        const result = await createEmp.mutateAsync({
          companyId,
          employeeCode: form.employeeCode || undefined,
          firstName: form.firstName,
          middleName: form.middleName || undefined,
          lastName: form.lastName || undefined,
          email: form.email,
          phone: form.phone || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          gender: form.gender as WorkforceEmployee['gender'] || undefined,
          departmentId: departmentId || undefined,
          designationId: form.designationId || undefined,
          branchId: form.branchId || undefined,
          reportingManagerId: form.reportingManagerId || undefined,
          employmentType: form.employmentType as WorkforceEmployee['employmentType'],
          dateOfJoining: form.dateOfJoining || undefined,
          ctcAnnual: form.ctcAnnual ? parseFloat(form.ctcAnnual) : undefined,
          panNumber: form.panNumber || undefined,
          aadhaarNumber: form.aadhaarNumber || undefined,
          passportNumber: form.passportNumber || undefined,
          bankName: form.bankName || undefined,
          bankAccountNumber: form.bankAccountNumber || undefined,
          bankIfsc: form.bankIfsc || undefined,
          currentAddressLine: form.currentAddressLine || undefined,
          currentAddressCity: form.currentAddressCity || undefined,
          currentAddressState: form.currentAddressState || undefined,
          currentAddressPincode: form.currentAddressPincode || undefined,
          emergencyContactName: form.emergencyContactName || undefined,
          emergencyContactRelation: form.emergencyContactRelation || undefined,
          emergencyContactPhone: form.emergencyContactPhone || undefined,
          onboardingTemplateId: form.onboardingTemplateId || undefined,
          roleCode: form.systemRole || 'EMPLOYEE',
        })
        if (!isEdit && sendInvitation && canInvite) {
          try {
            // The invite endpoint returns as soon as the token is created; the email
            // is sent asynchronously (best-effort), so this no longer blocks on SMTP.
            await sendInvite(result.id)
            toast(`Employee created. Invitation email queued for ${result.email}.`, 'success')
          } catch {
            toast('Employee created (could not queue invitation — resend from Users & Access)', 'warning')
          }
        } else {
          toast('Employee created', 'success')
        }
        onSuccess?.(result)
      }
      onClose()
    } catch (err: unknown) {
      toast((err as Error)?.message ?? 'Failed to save employee', 'error')
    }
  }

  const isPending = createEmp.isPending || updateEmp.isPending

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-[110] w-full max-w-lg bg-white border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold">{isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/5"><X size={16} /></button>
        </div>

        {/* Step pills */}
        <div className="flex gap-1 px-5 py-3 border-b border-border overflow-x-auto scrollbar-hide">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={clsx(
                'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all',
                step === s.key ? 'bg-primary text-white shadow-sm' : 'bg-white text-text-secondary hover:text-text-primary'
              )}
            >
              {i + 1}. {s.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {step === 'basic' && (
            <>
              {!isEdit && (
                companies.length === 0 ? (
                  <div className={`rounded-xl border px-4 py-3 text-sm ${errors.companyId ? 'border-red-400 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                    No company exists yet. Create one in <span className="font-semibold">Organization → Companies</span> before adding employees.
                    {errors.companyId && <p className="mt-1 font-semibold text-red-600">{errors.companyId}</p>}
                  </div>
                ) : (
                  <Field label="Company" required error={errors.companyId}>
                    <Sel error={!!errors.companyId} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setErrors(p => ({ ...p, companyId: '' })) }}>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Sel>
                  </Field>
                )
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="First Name" required error={errors.firstName}><Input error={!!errors.firstName} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="First name" /></Field>
                <Field label="Last Name"><Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Last name" /></Field>
              </div>
              <Field label="Middle Name"><Input value={form.middleName} onChange={(e) => set('middleName', e.target.value)} placeholder="Middle name" /></Field>
              <Field label="Work Email" required error={errors.email}><Input error={!!errors.email} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="employee@company.com" /></Field>
              <Field label="Phone"><Input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 9876543210" /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date of Birth"><Input type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></Field>
                <Field label="Gender">
                  <Sel value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">Select</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                    <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                  </Sel>
                </Field>
              </div>
            </>
          )}

          {step === 'system' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div>
                  <h4 className="text-sm font-semibold text-slate-900">Enable System Access</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Creates a workspace login account for this employee.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" checked={form.systemAccess} onChange={(e) => set('systemAccess', e.target.checked as any)} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                </label>
              </div>

              {form.systemAccess && (
                <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                  <Field label="Workspace Role" required>
                    <Sel value={form.systemRole} onChange={(e) => set('systemRole', e.target.value)}>
                      <option value="EMPLOYEE">Employee (Self-service only)</option>
                      <option value="DEPT_MANAGER">Dept Manager (Approve team leaves)</option>
                      <option value="HR_MANAGER">HR Manager (Full HR access)</option>
                      <option value="FINANCE_LEAD">Finance Lead (Payroll &amp; reports)</option>
                      <option value="SUPER_ADMIN">Super Admin (Full access)</option>
                    </Sel>
                  </Field>
                  <p className="mt-3 text-xs text-slate-500 bg-blue-50 text-blue-700 p-3 rounded-lg border border-blue-100">
                    An invitation email will automatically be sent to <strong>{form.email || 'the employee'}</strong> to set their password.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 'work' && (
            <>
              {!isEdit && <Field label="Employee Code"><Input value={form.employeeCode} onChange={(e) => set('employeeCode', e.target.value)} placeholder="Auto-generated if blank" /></Field>}
              <Field label="Department">
                <Sel value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                  <option value="">Select department</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Sel>
              </Field>
              <Field label="Designation">
                <Sel value={form.designationId} onChange={(e) => set('designationId', e.target.value)}>
                  <option value="">Select designation</option>
                  {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </Sel>
              </Field>
              <Field label="Reporting Manager">
                <Sel value={form.reportingManagerId} onChange={(e) => set('reportingManagerId', e.target.value)}>
                  <option value="">{managers.length === 0 ? 'No other employees yet — leave routes to dept head / HR' : 'Select manager (optional)'}</option>
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>{[m.firstName, m.lastName].filter(Boolean).join(' ')}{m.employeeCode ? ` (${m.employeeCode})` : ''}</option>
                  ))}
                </Sel>
                <p className="mt-1 text-xs text-slate-600">Leave requests route here for approval. If unset, the department head (or HR) approves.</p>
              </Field>
              <Field label="Punch Location (Branch)" required={!isEdit} error={errors.branchId}>
                <Sel error={!!errors.branchId} value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">
                    {branches.length === 0 ? 'No branches configured — set up in Organization' : 'Select branch'}
                  </option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Sel>
                <p className="mt-1 text-xs text-slate-600">
                  Employees can only punch in from inside this branch&rsquo;s geofence — outside-zone punches are blocked.
                  {branches.length === 0 && (
                    <> Add branches under <a href="/hrms/organization" className="text-primary hover:underline">Organization &rarr; Branches</a>.</>
                  )}
                </p>
              </Field>
              <Field label="Employment Type">
                {/* Only org types whose code is a real backend enum value are offered —
                    the API field is a fixed enum, so a custom/lookup code (or a UUID
                    fallback) would 400 at deserialization. */}
                {employmentTypes.filter((t) => t.active && t.code && ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'].includes(t.code)).length > 0 ? (
                  <Sel value={form.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                    <option value="">Select type</option>
                    {employmentTypes
                      .filter((t) => t.active && t.code && ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT'].includes(t.code))
                      .map((t) => (
                        <option key={t.id} value={t.code!}>{t.name}</option>
                      ))}
                  </Sel>
                ) : (
                  <>
                    <Sel value={form.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                      <option value="FULL_TIME">Full Time</option>
                      <option value="PART_TIME">Part Time</option>
                      <option value="CONTRACT">Contract</option>
                      <option value="INTERN">Intern</option>
                      <option value="CONSULTANT">Consultant</option>
                    </Sel>
                    <p className="mt-1 text-xs text-slate-600">
                      Using defaults — add custom types under <a href="/hrms/organization" className="text-primary hover:underline">Organization → Employment Types</a>
                    </p>
                  </>
                )}
              </Field>
              <Field label="Grade">
                <Sel value={form.gradeId} onChange={(e) => set('gradeId', e.target.value)}>
                  <option value="">
                    {grades.length === 0 ? 'No grades configured — set up in Organization' : 'Select grade'}
                  </option>
                  {grades.filter((g) => g.active).map((g) => (
                    <option key={g.id} value={g.id}>{g.name}{g.code ? ` (${g.code})` : ''}</option>
                  ))}
                </Sel>
                {grades.length === 0 && (
                  <p className="mt-1 text-xs text-slate-600">
                    Add grades under <a href="/hrms/organization" className="text-primary hover:underline">Organization → Grades</a>
                  </p>
                )}
              </Field>
              <Field label="Shift">
                <Sel value={form.shiftId} onChange={(e) => set('shiftId', e.target.value)}>
                  <option value="">
                    {shifts.length === 0 ? 'No shifts configured — set up in Organization' : 'Select shift'}
                  </option>
                  {shifts.filter((s) => s.active).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}{s.startTime && s.endTime ? ` (${s.startTime}–${s.endTime})` : ''}
                    </option>
                  ))}
                </Sel>
                {shifts.length === 0 && (
                  <p className="mt-1 text-xs text-slate-600">
                    Add shifts under <a href="/hrms/organization" className="text-primary hover:underline">Organization → Shifts</a>
                  </p>
                )}
              </Field>
              {!isEdit && (
                <Field label="Onboarding Template">
                  <Sel value={form.onboardingTemplateId} onChange={(e) => set('onboardingTemplateId', e.target.value)}>
                    <option value="">No onboarding checklist</option>
                    {templates.filter((t) => t.active).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Sel>
                </Field>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Date of Joining"><Input type="date" value={form.dateOfJoining} onChange={(e) => set('dateOfJoining', e.target.value)} /></Field>
                <Field label="CTC (Annual)"><Input type="number" value={form.ctcAnnual} onChange={(e) => set('ctcAnnual', e.target.value)} placeholder="e.g. 600000" /></Field>
              </div>
            </>
          )}

          {step === 'identity' && (
            <>
              <Field label="PAN Number"><Input value={form.panNumber} onChange={(e) => set('panNumber', e.target.value)} placeholder="ABCDE1234F" /></Field>
              <Field label="Aadhaar Number"><Input value={form.aadhaarNumber} onChange={(e) => set('aadhaarNumber', e.target.value)} placeholder="1234 5678 9012" /></Field>
              <Field label="Passport Number"><Input value={form.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} placeholder="A1234567" /></Field>
            </>
          )}

          {step === 'bank' && (
            <>
              <Field label="Bank Name"><Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
              <Field label="Account Number"><Input value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} placeholder="123456789012" /></Field>
              <Field label="IFSC Code"><Input value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value)} placeholder="HDFC0001234" /></Field>
            </>
          )}

          {step === 'address' && (
            <>
              <Field label="Address Line"><Input value={form.currentAddressLine} onChange={(e) => set('currentAddressLine', e.target.value)} placeholder="Flat/Street" /></Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="City"><Input value={form.currentAddressCity} onChange={(e) => set('currentAddressCity', e.target.value)} placeholder="Mumbai" /></Field>
                <Field label="State"><Input value={form.currentAddressState} onChange={(e) => set('currentAddressState', e.target.value)} placeholder="Maharashtra" /></Field>
              </div>
              <Field label="Pincode"><Input value={form.currentAddressPincode} onChange={(e) => set('currentAddressPincode', e.target.value)} placeholder="400001" /></Field>
            </>
          )}

          {step === 'emergency' && (
            <>
              <Field label="Contact Name"><Input value={form.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} placeholder="Full name" /></Field>
              <Field label="Relationship"><Input value={form.emergencyContactRelation} onChange={(e) => set('emergencyContactRelation', e.target.value)} placeholder="e.g. Spouse, Parent" /></Field>
              <Field label="Phone"><Input type="tel" value={form.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', e.target.value)} placeholder="+91 9876543210" /></Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-border">
          {step !== 'basic' && (
            <button onClick={() => setStep(STEPS[STEPS.findIndex((s) => s.key === step) - 1].key)} className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
              Back
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
            Cancel
          </button>
          {step !== 'emergency' ? (
            <button
              onClick={() => setStep(STEPS[STEPS.findIndex((s) => s.key === step) + 1].key)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary-dark text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <div className="flex-1 flex flex-col gap-2">
              {!isEdit && canInvite && (
                <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendInvitation}
                    onChange={e => setSendInvitation(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-primary"
                  />
                  <Send size={11} className="text-primary" />
                  Send invitation email
                </label>
              )}
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="w-full py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
              >
                {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Employee'}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
