import React, { useState } from 'react'
import { X, ChevronRight, Send, Users } from 'lucide-react'
import { clsx } from 'clsx'
import { useToast } from '@/shared/hooks/useToast'
import { useAuthStore } from '@unifiedtree/sdk'
import { P } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import {
  useCreateWorkforceEmployee,
  useUpdateWorkforceEmployee,
  useEmployeeDirectory,
  type WorkforceEmployee,
  type PageResponse,
} from '../api/useWorkforce'
import {
  useCompanies, useDepartments, useDesignations, useBranches,
  useGrades, useEmploymentTypes, useShifts, assignEmployeeShift,
} from '../api/useOrg'
import { useGeofenceZones } from '../api/useGeofence'
import { useTemplates } from '../onboarding/api/useOnboarding'
import { sendInvite } from './api/useInvitation'
import { useNextEmployeeCode } from '../api/useSettings'

// Mobile-parity validators. Mirror the constants used in the Attendance app's
// staff-onboarding.tsx so a user filling the same field in either client gets
// the same accept/reject verdict — payroll compliance strings (PAN / Aadhaar /
// UAN / ESI / IFSC / account) are Indian statutory formats and are fixed by
// spec, not by our UI.
const RX = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?\d{10,15}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  aadhaar: /^\d{12}$/,
  uan: /^\d{12}$/,
  esi: /^\d{10,17}$/,
  bankAccount: /^\d{9,18}$/,
  ifsc: /^[A-Z]{4}0[A-Z\d]{6}$/,
} as const

const stripWs = (s: string) => s.replace(/\s+/g, '')

// Local-timezone today, YYYY-MM-DD. Not toISOString() — that's UTC and rolls
// the date over for anyone east of GMT for the last few hours of their day.
function todayLocalIso(): string {
  const d = new Date()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

const WEEK_DAYS: { iso: number; short: string }[] = [
  { iso: 1, short: 'Mon' },
  { iso: 2, short: 'Tue' },
  { iso: 3, short: 'Wed' },
  { iso: 4, short: 'Thu' },
  { iso: 5, short: 'Fri' },
  { iso: 6, short: 'Sat' },
  { iso: 7, short: 'Sun' },
]
const DEFAULT_WEEK_OFFS = [6, 7]
const formatWeekOffs = (days: number[]) =>
  Array.from(new Set(days)).sort((a, b) => a - b).join(',')

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
      className={`w-full bg-white border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary focus:outline-none transition-colors ${error ? 'border-red-400 focus:border-red-500 bg-red-50' : 'border-border/60 focus:border-primary'}`}
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
  // Set when the workspace has run out of paid seats — see the catch in submit().
  const [seatLimitMessage, setSeatLimitMessage] = useState<string | null>(null)
  // Only these roles can change the plan; must match WorkspacePlanController's
  // requireAdmin, or we would send an HR manager to a page that 403s them.
  const canManageBilling = useAuthStore(
    s => (s.user?.roles ?? []).some(r => ['SUPER_ADMIN', 'OWNER', 'COMPANY_ADMIN'].includes(r)))

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
  const { data: geofenceZones = [] } = useGeofenceZones()
  const { data: templates = [] } = useTemplates(companyId || undefined)
  const { data: managerPage } = useEmployeeDirectory({ companyId: companyId || undefined, pageSize: 200 })
  const managers = (managerPage?.content ?? []).filter((m) => m.id !== employee?.id)

  // Pre-fill Employee Code with the next auto-generated value from HR config
  // whenever we're adding a NEW employee under a selected company. Field
  // stays editable so admin can override for special cases.
  const { data: nextCodePreview } = useNextEmployeeCode(isEdit ? undefined : companyId || undefined)

  const [step, setStep] = useState<FormStep>('basic')
  const [form, setForm] = useState({
    firstName: employee?.firstName ?? '',
    middleName: employee?.middleName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    dateOfBirth: employee?.dateOfBirth ?? '',
    // Defaulting gender to MALE matches the mobile onboarding form so the two
    // clients don't disagree on the initial value shown to the HR admin.
    gender: employee?.gender ?? (isEdit ? '' : 'MALE'),
    employeeCode: employee?.employeeCode ?? '',
    // work
    designationId: employee?.designationId ?? '',
    branchId: employee?.branchId ?? '',
    reportingManagerId: employee?.reportingManagerId ?? '',
    employmentType: employee?.employmentType ?? 'FULL_TIME',
    gradeId: '',
    shiftId: '',
    geoFenceZoneId: '',
    workLocation: '',
    // Prefill DOJ with today so the field lands with a valid value the way
    // it does in the mobile onboarding form. Edit mode keeps whatever the
    // employee row actually has.
    dateOfJoining: employee?.dateOfJoining ?? (isEdit ? '' : todayLocalIso()),
    salaryFrequency: 'MONTHLY',
    monthlySalary: '',
    ctcAnnual: employee?.ctcAnnual ? String(employee.ctcAnnual) : '',
    // identity
    panNumber: '', aadhaarNumber: '', uanNumber: '', passportNumber: '',
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
  // Weekly off days kept as an ISO-day array so the chip UI can toggle
  // membership cheaply; serialised to CSV ("6,7") on submit to match the
  // backend column shape.
  const [weeklyOffDays, setWeeklyOffDays] = useState<number[]>([...DEFAULT_WEEK_OFFS])
  const toggleWeekOff = (iso: number) =>
    setWeeklyOffDays((p) => (p.includes(iso) ? p.filter((d) => d !== iso) : [...p, iso]))

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const set = (key: string, value: string) => {
    setForm((p) => ({ ...p, [key]: value }))
    if (errors[key]) setErrors((p) => ({ ...p, [key]: '' }))
  }

  // Once we have a next-code preview (only fires in ADD mode), pre-fill the
  // Employee Code field IF the admin hasn't already typed something. The
  // field is editable so this only sets an initial suggestion. We remember
  // the exact string we auto-filled so on submit we can tell whether the
  // admin actually typed a custom code — if it's still the auto-fill, we
  // send undefined so the backend's atomic counter fires. Sending the
  // literal value would take the override branch and never increment.
  const autoFilledCodeRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (isEdit) return
    if (!nextCodePreview?.preview) return
    if (form.employeeCode) return
    setForm((p) => (p.employeeCode ? p : { ...p, employeeCode: nextCodePreview.preview }))
    autoFilledCodeRef.current = nextCodePreview.preview
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCodePreview?.preview])

  const handleSubmit = async () => {
    if (createEmp.isPending || updateEmp.isPending) return

    // Companies list is loaded before submit is even enabled in the UI, but
    // a race (network delay + admin racing through steps) could still leave
    // it empty. Bailing here with a warning is safer than an early-return
    // that silently swallows the click.
    if (!isEdit && companies.length === 0) {
      toast('Company data is still loading — try again in a moment.', 'warning')
      return
    }

    const errs: Record<string, string> = {}
    // -- Basic step ---------------------------------------------------------
    if (!form.firstName.trim()) errs.firstName = 'First name is required'
    if (!form.email.trim()) {
      errs.email = 'Work email is required'
    } else if (!RX.email.test(form.email.trim())) {
      errs.email = 'Enter a valid email address'
    }
    // Phone is required — mobile logs in by phone number, so a missing phone
    // means the employee cannot use the Attendance app at all.
    const phoneClean = stripWs(form.phone)
    if (!phoneClean) {
      errs.phone = 'Phone is required (used for mobile app login)'
    } else if (!RX.phone.test(phoneClean)) {
      errs.phone = 'Enter a valid phone number (10–15 digits, optional + prefix)'
    }
    if (!isEdit && !companyId) errs.companyId = 'Select a company — create one in Organization → Companies first'
    // -- Work step ----------------------------------------------------------
    if (!isEdit && !form.branchId) errs.branchId = 'Select a Punch Location so the employee can clock in'
    if (!form.salaryFrequency) errs.salaryFrequency = 'Salary frequency is required'
    // -- Identity step (all optional, but validate if provided) --------------
    if (form.panNumber && !RX.pan.test(form.panNumber.toUpperCase()))
      errs.panNumber = 'PAN must be 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)'
    if (form.aadhaarNumber && !RX.aadhaar.test(stripWs(form.aadhaarNumber)))
      errs.aadhaarNumber = 'Aadhaar must be 12 digits'
    if (form.uanNumber && !RX.uan.test(stripWs(form.uanNumber)))
      errs.uanNumber = 'UAN must be 12 digits'
    // -- Bank step ----------------------------------------------------------
    if (form.bankAccountNumber && !RX.bankAccount.test(stripWs(form.bankAccountNumber)))
      errs.bankAccountNumber = 'Account number must be 9–18 digits'
    if (form.bankIfsc && !RX.ifsc.test(form.bankIfsc.toUpperCase()))
      errs.bankIfsc = 'IFSC must be 4 letters + 0 + 6 alphanum (e.g. HDFC0001234)'

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      // Jump to the first step that contains an error. Order matches the
      // wizard's step order so the admin lands on the earliest problem.
      if (errs.firstName || errs.email || errs.phone || errs.companyId) setStep('basic')
      else if (errs.branchId || errs.salaryFrequency) setStep('work')
      else if (errs.panNumber || errs.aadhaarNumber || errs.uanNumber) setStep('identity')
      else if (errs.bankAccountNumber || errs.bankIfsc) setStep('bank')
      return
    }
    setErrors({})

    // Derive ctcAnnual from monthlySalary when the admin filled the monthly
    // figure. If they already typed a CTC directly, that wins — don't stomp
    // on an explicit override.
    const monthly = form.monthlySalary ? parseFloat(form.monthlySalary) : undefined
    const ctc = form.ctcAnnual
      ? parseFloat(form.ctcAnnual)
      : monthly !== undefined && !Number.isNaN(monthly)
      ? monthly * 12
      : undefined
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
        // Only forward the code if the admin manually edited the field;
        // otherwise let the backend atomically issue the next code (see the
        // auto-fill effect above).
        const codeToSend =
          !form.employeeCode ||
          (autoFilledCodeRef.current && form.employeeCode === autoFilledCodeRef.current)
            ? undefined
            : form.employeeCode
        const payload = {
          companyId,
          employeeCode: codeToSend,
          firstName: form.firstName,
          middleName: form.middleName || undefined,
          lastName: form.lastName || undefined,
          email: form.email,
          phone: phoneClean || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          gender: form.gender as WorkforceEmployee['gender'] || undefined,
          departmentId: departmentId || undefined,
          designationId: form.designationId || undefined,
          branchId: form.branchId || undefined,
          geoFenceZoneId: form.geoFenceZoneId || undefined,
          weeklyOffDays: weeklyOffDays.length ? formatWeekOffs(weeklyOffDays) : undefined,
          reportingManagerId: form.reportingManagerId || undefined,
          employmentType: form.employmentType as WorkforceEmployee['employmentType'],
          dateOfJoining: form.dateOfJoining || undefined,
          salaryFrequency: form.salaryFrequency || undefined,
          monthlySalary: monthly !== undefined && !Number.isNaN(monthly) ? monthly : undefined,
          ctcAnnual: ctc,
          workLocation: form.workLocation.trim() || undefined,
          panNumber: form.panNumber ? form.panNumber.toUpperCase() : undefined,
          aadhaarNumber: form.aadhaarNumber ? stripWs(form.aadhaarNumber) : undefined,
          uanNumber: form.uanNumber ? stripWs(form.uanNumber) : undefined,
          passportNumber: form.passportNumber || undefined,
          bankName: form.bankName || undefined,
          bankAccountNumber: form.bankAccountNumber ? stripWs(form.bankAccountNumber) : undefined,
          bankIfsc: form.bankIfsc ? form.bankIfsc.toUpperCase() : undefined,
          currentAddressLine: form.currentAddressLine || undefined,
          currentAddressCity: form.currentAddressCity || undefined,
          currentAddressState: form.currentAddressState || undefined,
          currentAddressPincode: form.currentAddressPincode || undefined,
          emergencyContactName: form.emergencyContactName || undefined,
          emergencyContactRelation: form.emergencyContactRelation || undefined,
          emergencyContactPhone: form.emergencyContactPhone || undefined,
          onboardingTemplateId: form.onboardingTemplateId || undefined,
          roleCode: form.systemRole || 'EMPLOYEE',
        }
        let result: WorkforceEmployee
        try {
          result = await createEmp.mutateAsync(payload)
        } catch (createErr: unknown) {
          // Dedupe recovery — mirrors the mobile submitWithRecovery pattern.
          // A transient blip mid-POST can hide a 201 from the client; the
          // next click then hits "employee code already in use" but the row
          // was in fact created. Look it up by (code, email) and, if the
          // same row is there, treat the retry as silent success rather
          // than erroring the admin out.
          const apiError = createErr as { status?: number; message?: string }
          const message = apiError?.message ?? ''
          const looksLikeDuplicate =
            apiError?.status === 409 ||
            apiError?.status === 422 ||
            /already in use|already exists|duplicate/i.test(message)
          const codeUpper = (payload.employeeCode ?? '').trim().toUpperCase()
          const emailLower = (payload.email ?? '').trim().toLowerCase()
          let recovered: WorkforceEmployee | undefined
          if (looksLikeDuplicate && emailLower) {
            try {
              const params = new URLSearchParams({
                companyId, page: '0', pageSize: '200',
              })
              const page = await apiJson<PageResponse<WorkforceEmployee>>(
                `/v1/hrms/employees?${params.toString()}`,
              )
              recovered = page.content.find((c) => {
                const codeMatches = codeUpper
                  ? (c.employeeCode ?? '').toUpperCase() === codeUpper
                  : true
                const emailMatches = (c.email ?? '').toLowerCase() === emailLower
                return codeMatches && emailMatches
              })
            } catch {
              // fall through and rethrow original
            }
          }
          if (recovered) {
            result = recovered
          } else if (looksLikeDuplicate && /email/i.test(message)) {
            // Real collision on email — surface as a field error and jump
            // the admin back to Basic Info where they can fix it.
            setErrors((p) => ({ ...p, email: 'That email is already in use for this company.' }))
            setStep('basic')
            return
          } else if (looksLikeDuplicate) {
            // Real collision on employee code — same treatment, on the Work
            // step where the code field lives.
            setErrors((p) => ({ ...p, employeeCode: 'That employee code is already in use.' }))
            setStep('work')
            return
          } else {
            throw createErr
          }
        }
        // Best-effort shift assignment. Employee already exists — don't fail
        // the whole onboarding if this hiccups, HR can set it later from the
        // employee profile.
        if (form.shiftId && result?.id) {
          try {
            await assignEmployeeShift(result.id, form.shiftId)
          } catch {
            // swallow — non-fatal
          }
        }
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
      // The workspace is out of paid seats. Not a failure the user can fix by
      // retrying, so don't show it as a transient toast — say what happened
      // and, for someone who can actually act on it, give them the way through.
      // HR managers deliberately cannot reach billing (WorkspacePlanController
      // is admin-only), so they get told to ask their admin rather than sent
      // to a page that would refuse them.
      const message = (err as Error)?.message ?? 'Failed to save employee'
      if (/SEAT_LIMIT_REACHED/i.test(message) || /used all \d+ seats/i.test(message)) {
        setSeatLimitMessage(message.replace(/^SEAT_LIMIT_REACHED:?\s*/i, ''))
        return
      }
      toast(message, 'error')
    }
  }

  const isPending = createEmp.isPending || updateEmp.isPending
  // The update API persists ONLY Basic + Work fields. Identity/Bank/Address/Emergency
  // are managed via the employee's profile tabs (separate endpoints), and System Access
  // (role + invite) is create-only. Showing those steps on edit silently dropped data,
  // so in edit mode we restrict the wizard to the steps the update actually saves.
  const visibleSteps = isEdit ? STEPS.filter((s) => s.key === 'basic' || s.key === 'work') : STEPS
  const stepIdx = Math.max(0, visibleSteps.findIndex((s) => s.key === step))
  const isLastStep = stepIdx === visibleSteps.length - 1

  // Out of seats. Replaces the form rather than sitting behind it: the answer
  // is never "try again", it is either buy a seat or ask someone who can.
  if (seatLimitMessage) {
    return (
      <>
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="fixed left-1/2 top-1/2 z-[110] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100">
            <Users size={22} className="text-amber-700" />
          </div>
          <h3 className="text-center text-lg font-semibold text-text-primary">
            You've run out of seats
          </h3>
          <p className="mt-2 text-center text-sm text-text-secondary">{seatLimitMessage}</p>
          <p className="mt-3 text-center text-xs text-text-tertiary">
            A seat is one active employee. Removing someone who has left frees their seat
            straight away.
          </p>
          <div className="mt-6 flex flex-col gap-2">
            {canManageBilling ? (
              <button
                onClick={() => { window.location.href = '/plan' }}
                className="w-full rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#047857]">
                Add seats
              </button>
            ) : (
              <div className="rounded-xl bg-[#F8FAFC] px-4 py-3 text-center text-xs text-text-secondary">
                Only a workspace admin can change the plan. Ask your admin to add seats.
              </div>
            )}
            <button onClick={onClose}
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary">
              Close
            </button>
          </div>
        </div>
      </>
    )
  }

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
          {visibleSteps.map((s, i) => (
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
              <Field label="Phone" required error={errors.phone}>
                <Input error={!!errors.phone} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 9876543210" />
              </Field>
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
              {/* A workspace login account is always provisioned on create (the backend
                  sends a roleCode unconditionally), so the role is always required.
                  The old "Enable System Access" toggle was a no-op and was removed. */}
              <div className="p-4 bg-bg-base border border-border-default rounded-xl">
                <h4 className="text-sm font-semibold text-text-primary">System Access</h4>
                <p className="text-xs text-text-tertiary mt-0.5">A workspace login account is created for this employee. Choose their access level below.</p>
              </div>

              <Field label="Workspace Role" required>
                <Sel value={form.systemRole} onChange={(e) => set('systemRole', e.target.value)}>
                  <option value="EMPLOYEE">Employee (Self-service only)</option>
                  <option value="DEPT_MANAGER">Dept Manager (Approve team leaves)</option>
                  <option value="HR_MANAGER">HR Manager (Full HR access)</option>
                  <option value="FINANCE_LEAD">Finance Lead (Payroll &amp; reports)</option>
                  <option value="SUPER_ADMIN">Super Admin (Full access)</option>
                </Sel>
              </Field>
              <p className="mt-3 text-xs bg-[#ECFDF5] text-[#047857] p-3 rounded-lg border border-[#6EE7B7]">
                An invitation email will be sent to <strong>{form.email || 'the employee'}</strong> (when "Send invitation" is enabled) so they can set their password.
              </p>
            </div>
          )}

          {step === 'work' && (
            <>
              {!isEdit && (
                <Field label="Employee ID" error={errors.employeeCode}>
                  <Input
                    error={!!errors.employeeCode}
                    value={form.employeeCode}
                    onChange={(e) => set('employeeCode', e.target.value)}
                    placeholder={nextCodePreview?.preview ?? 'Auto-generated on save'}
                  />
                </Field>
              )}
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
                <p className="mt-1 text-xs text-text-secondary">Leave requests route here for approval. If unset, the department head (or HR) approves.</p>
              </Field>
              <Field label="Work Location">
                <Input value={form.workLocation} onChange={(e) => set('workLocation', e.target.value)} placeholder="e.g. Hyderabad" />
              </Field>
              <Field label="Punch Location (Branch)" required={!isEdit} error={errors.branchId}>
                <Sel error={!!errors.branchId} value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">
                    {branches.length === 0 ? 'No branches configured — set up in Organization' : 'Select branch'}
                  </option>
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Sel>
                <p className="mt-1 text-xs text-text-secondary">
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
                    <p className="mt-1 text-xs text-text-secondary">
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
                  <p className="mt-1 text-xs text-text-secondary">
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
                  <p className="mt-1 text-xs text-text-secondary">
                    Add shifts under <a href="/hrms/organization" className="text-primary hover:underline">Organization → Shifts</a>
                  </p>
                )}
              </Field>
              <Field label="Weekly Off Days">
                {/* ISO day chips (1=Mon..7=Sun). Serialized to CSV on submit to
                    match backend column shape. Drives this employee's attendance
                    calendar and payroll working-day count. */}
                <div className="flex flex-wrap gap-1.5">
                  {WEEK_DAYS.map((d) => {
                    const on = weeklyOffDays.includes(d.iso)
                    return (
                      <button
                        key={d.iso}
                        type="button"
                        onClick={() => toggleWeekOff(d.iso)}
                        className={clsx(
                          'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
                          on
                            ? 'bg-primary text-white border-primary'
                            : 'bg-white text-text-secondary border-border/60 hover:text-text-primary'
                        )}
                      >
                        {d.short}
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1 text-xs text-text-secondary">Defaults to Sat + Sun. Tap to toggle.</p>
              </Field>
              <Field label="Geofence Zone (Punch)">
                <Sel value={form.geoFenceZoneId} onChange={(e) => set('geoFenceZoneId', e.target.value)}>
                  <option value="">
                    {geofenceZones.length === 0 ? 'No zones configured — set up in Attendance' : 'No specific zone'}
                  </option>
                  {geofenceZones.filter((z) => z.active).map((z) => (
                    <option key={z.id} value={z.id}>{z.name}</option>
                  ))}
                </Sel>
                <p className="mt-1 text-xs text-text-secondary">
                  Optional — when set, the employee can only punch in from inside this zone.
                </p>
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
                <Field label="Salary Frequency" required error={errors.salaryFrequency}>
                  <Sel error={!!errors.salaryFrequency} value={form.salaryFrequency} onChange={(e) => set('salaryFrequency', e.target.value)}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="DAILY">Daily</option>
                  </Sel>
                </Field>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Monthly Salary">
                  <Input
                    type="number"
                    value={form.monthlySalary}
                    onChange={(e) => set('monthlySalary', e.target.value)}
                    placeholder="e.g. 50000"
                  />
                </Field>
                <Field label="CTC (Annual)">
                  <Input
                    type="number"
                    value={form.ctcAnnual}
                    onChange={(e) => set('ctcAnnual', e.target.value)}
                    placeholder={form.monthlySalary ? `Auto: ${Number(form.monthlySalary) * 12}` : 'e.g. 600000'}
                  />
                </Field>
              </div>
              <p className="text-xs text-text-secondary -mt-2">
                Leave CTC blank to auto-derive it as monthly × 12.
              </p>
            </>
          )}

          {step === 'identity' && (
            <>
              <Field label="PAN Number" error={errors.panNumber}>
                <Input error={!!errors.panNumber} value={form.panNumber} onChange={(e) => set('panNumber', e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
              </Field>
              <Field label="Aadhaar Number" error={errors.aadhaarNumber}>
                <Input error={!!errors.aadhaarNumber} value={form.aadhaarNumber} onChange={(e) => set('aadhaarNumber', e.target.value)} placeholder="1234 5678 9012" />
              </Field>
              <Field label="UAN Number" error={errors.uanNumber}>
                <Input error={!!errors.uanNumber} value={form.uanNumber} onChange={(e) => set('uanNumber', e.target.value)} placeholder="12-digit UAN (optional)" />
              </Field>
              <Field label="Passport Number"><Input value={form.passportNumber} onChange={(e) => set('passportNumber', e.target.value)} placeholder="A1234567" /></Field>
            </>
          )}

          {step === 'bank' && (
            <>
              <Field label="Bank Name"><Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="e.g. HDFC Bank" /></Field>
              <Field label="Account Number" error={errors.bankAccountNumber}>
                <Input error={!!errors.bankAccountNumber} value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} placeholder="123456789012" />
              </Field>
              <Field label="IFSC Code" error={errors.bankIfsc}>
                <Input error={!!errors.bankIfsc} value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
              </Field>
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
          {stepIdx > 0 && (
            <button onClick={() => setStep(visibleSteps[stepIdx - 1].key)} className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
              Back
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">
            Cancel
          </button>
          {!isLastStep ? (
            <button
              onClick={() => setStep(visibleSteps[stepIdx + 1].key)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary-dark text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <div className="flex-1 flex flex-col gap-2">
              {!isEdit && canInvite && (
                <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
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
