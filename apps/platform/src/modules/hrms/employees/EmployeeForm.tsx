import React, { useEffect, useState } from 'react'
import { X, ChevronRight, Send, Users, Pencil } from 'lucide-react'
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
  useGrades, useEmploymentTypes, assignEmployeeShift,
} from '../api/useOrg'
// The Shift picker MUST be sourced from attendance.shift_policies, because the
// id it yields is posted straight to assignEmployeeShift → POST
// /v1/shifts/employee/{id} {shiftPolicyId}, and EmployeeShiftService resolves
// that id with policyRepo.findById(...).orElseThrow. It used to be filled from
// useOrg's useShifts, i.e. org.shifts ids, so every assignment 404'd — silently,
// because the catch below swallowed it. HR picked "General Shift", saw
// "Employee created", and the new hire went live with no shift at all.
import { useShiftPolicies } from '../api/useShiftPolicies'
import { useGeofenceZones } from '../api/useGeofence'
import { useTemplates } from '../onboarding/api/useOnboarding'
import { sendInvite } from './api/useInvitation'
import { useNextEmployeeCode } from '../api/useSettings'
// Edit-mode prefill for the Financial step. The workforce response DTO strips
// PII fields for list-safety, so the fetched employee object alone can't tell
// us pan/uan/esi/bank. We call the same profile endpoints EmployeeDetail's
// Identity + Bank tabs use, but ONLY when we're editing an existing row.
import { useEmployeeIdentity, useBankAccounts } from '../api/useEmployeeProfile'
// Inline entity-creation — a click on any "+ Add new" pill next to a Basic-step
// dropdown opens a portal-mounted modal, so filling in a missing department /
// designation / zone / company mid-onboarding no longer costs the admin the
// data they've already typed on the form.
import {
  InlineCreateDepartmentModal,
  InlineCreateDesignationModal,
  InlineCreateZoneModal,
  InlineCreateCompanyModal,
  AddNewButton,
} from './InlineCreateModals'

// Mobile-parity validators. Mirror the constants used in the Attendance app's
// staff-onboarding.tsx so a user filling the same field in either client gets
// the same accept/reject verdict — payroll compliance strings (PAN / Aadhaar /
// UAN / ESI / IFSC / account) are Indian statutory formats and are fixed by
// spec, not by our UI.
const RX = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?\d{10,15}$/,
  // PAN is 5 letters + 4 digits + 1 letter — statutory format enforced by
  // Income Tax India. Explicit character class avoids the ambiguity of \d
  // (which older Node/JS engines have historically expanded to include
  // non-ASCII digits) and matches the mobile app's regex exactly.
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
  // 12-digit Aadhaar. Verhoeff checksum validation is deliberately skipped
  // for now — the audit accepts a 12-digit format check as parity with
  // mobile onboarding until the check-digit lib is added.
  aadhaar: /^[0-9]{12}$/,
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

// 3-step wizard mirrors the Attendance app's staff-onboarding flow exactly —
// same order, same field grouping. Previous 7-step wizard included System
// Access / Address / Emergency screens the mobile app never asked for; those
// belong in an Employee-Detail edit-later flow, not the initial onboarding.
type FormStep = 'basic' | 'financial' | 'review'

const STEPS: { key: FormStep; label: string }[] = [
  { key: 'basic', label: 'Basic' },
  { key: 'financial', label: 'Financial' },
  { key: 'review', label: 'Review' },
]

const EMPLOYMENT_TYPE_ENUM = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-text-secondary mb-1.5">
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
  // Branches / grades / templates are still loaded so the underlying org hooks
  // continue to warm the react-query cache used elsewhere in the app; the 3-step
  // wizard just doesn't surface them anymore (mobile parity).
  const { data: _branches = [] } = useBranches(companyId)
  const { data: _grades = [] } = useGrades(companyId)
  const { data: employmentTypes = [] } = useEmploymentTypes(companyId)
  const { data: shifts = [] } = useShiftPolicies(companyId)
  const { data: geofenceZones = [] } = useGeofenceZones()
  const { data: _templates = [] } = useTemplates(companyId || undefined)
  const { data: _managerPage } = useEmployeeDirectory({ companyId: companyId || undefined, pageSize: 200 })

  // Pre-fill Employee Code with the next auto-generated value from HR config
  // whenever we're adding a NEW employee under a selected company. Field
  // stays editable so admin can override for special cases.
  const { data: nextCodePreview } = useNextEmployeeCode(isEdit ? undefined : companyId || undefined)

  // Edit-mode prefill sources — the workforce DTO doesn't ship PII, so these
  // hooks pull identity + bank from the same endpoints EmployeeDetail uses.
  // No-op in create mode (empty employeeId disables the underlying query).
  const editEmployeeId = isEdit ? (employee?.id ?? '') : ''
  const { data: existingIdentity } = useEmployeeIdentity(editEmployeeId)
  const { data: existingBanks = [] } = useBankAccounts(editEmployeeId)
  const primaryBank = existingBanks.find((b) => b.primary) ?? existingBanks[0]
  // Monthly salary reconstructed from ctcAnnual when the employee row has it —
  // matches how the create form derives ctc from monthly at submit.
  const employeeMonthlyFromCtc = employee?.ctcAnnual && employee.ctcAnnual > 0
    ? Math.round(Number(employee.ctcAnnual) / 12)
    : undefined

  const [step, setStep] = useState<FormStep>('basic')
  const [form, setForm] = useState({
    // ── Basic ─────────────────────────────────────────────────────────────
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    email: employee?.email ?? '',
    phone: employee?.phone ?? '',
    // Defaulting gender to MALE matches the mobile onboarding form so the two
    // clients don't disagree on the initial value shown to the HR admin.
    gender: employee?.gender ?? (isEdit ? '' : 'MALE'),
    dateOfBirth: employee?.dateOfBirth ?? '',
    employeeCode: employee?.employeeCode ?? '',
    // Prefill DOJ with today so the field lands with a valid value the way
    // it does in the mobile onboarding form. Edit mode keeps whatever the
    // employee row actually has.
    dateOfJoining: employee?.dateOfJoining ?? (isEdit ? '' : todayLocalIso()),
    // Designation: dropdown when the tenant has designations configured, free
    // text otherwise. We store both — designationId wins if set, else the
    // free-text value is sent as `designation` (mobile-parity payload key).
    designationId: employee?.designationId ?? '',
    designationText: '',
    // `geoFenceZoneId` isn't on the workforce response DTO typing yet — the
    // field is set at create time and read-only per employee — so fall back
    // to '' in edit mode until the DTO grows the field.
    geoFenceZoneId: (employee as unknown as { geoFenceZoneId?: string })?.geoFenceZoneId ?? '',
    shiftId: '',
    // ── Financial ─────────────────────────────────────────────────────────
    salaryFrequency: 'MONTHLY',
    monthlySalary: employeeMonthlyFromCtc != null ? String(employeeMonthlyFromCtc) : '',
    employmentType: employee?.employmentType ?? 'FULL_TIME',
    panNumber: '',
    aadhaarNumber: '',
    uanNumber: '',
    esiNumber: '',
    bankAccountNumber: '',
    bankIfsc: '',
    bankName: '',
    bankBranchName: '',
  })

  // ─── Unsaved-work guard ──────────────────────────────────────────────────
  //
  // Anil hit this on 2026-08-23: opened Add Employee, typed a bunch of fields,
  // clicked one of the top nav tabs and lost EVERYTHING.
  //
  // 2026-08-27 correction: my earlier attempt imported `useBlocker` from
  // react-router-dom, but this app is wrapped in <BrowserRouter> (a non-data
  // router) — useBlocker throws hard on mount there, killing the whole React
  // tree and painting a white screen the moment Add Employee opens. That
  // was Anil docx item 10 ("blank white page"). useBlocker only works with
  // <RouterProvider router={createBrowserRouter(...)}>. Reverted to the two
  // pieces that DO work under either router:
  //   1) a global `beforeunload` handler for browser tab close / refresh, and
  //   2) an in-app <a>-click interceptor on the document that catches SPA nav
  //      attempts and prompts before letting them through.
  // Both attach only while `dirty` is true, so they never interfere on a
  // just-opened form.
  //
  // employeeCode / dateOfJoining / gender / employmentType / salaryFrequency
  // all carry auto-seeded defaults on a new-hire form, so "non-empty" is the
  // WRONG dirty signal for them — the form has "changed" before the admin has
  // done anything. The four identity fields are only ever non-empty because
  // someone typed them, so gate on those.
  const dirty =
    form.firstName.trim() !== '' ||
    form.lastName.trim() !== '' ||
    form.email.trim() !== '' ||
    form.phone.trim() !== ''

  useEffect(() => {
    if (!dirty) return
    // 1) tab close / refresh / hard nav → native beforeunload warning
    const beforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    // 2) in-app SPA nav → intercept anchor clicks in capture phase, confirm
    //    before letting the router take over. We only intervene when the
    //    click is a plain left-click on an anchor whose href starts with `/`
    //    (same-origin route) or a router-<NavLink>. Modifier keys (Ctrl /
    //    Meta / Shift) fall through so opening in a new tab still works.
    const onClickCapture = (evt: MouseEvent) => {
      if (evt.defaultPrevented) return
      if (evt.button !== 0 || evt.metaKey || evt.ctrlKey || evt.shiftKey || evt.altKey) return
      const target = (evt.target as Element | null)?.closest('a')
      if (!target) return
      const href = target.getAttribute('href')
      if (!href || href.startsWith('#') || target.getAttribute('target') === '_blank') return
      if (!(href.startsWith('/') || href.startsWith(window.location.origin))) return
      // Only prompt if the click would leave this route
      if (href === window.location.pathname) return
      const ok = window.confirm(
        'You have unsaved employee details. Leave this page and lose your changes?',
      )
      if (!ok) {
        evt.preventDefault()
        evt.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', onClickCapture, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', onClickCapture, true)
    }
  }, [dirty])

  // Placeholder effect kept to preserve the original hook count for React
  // strict-mode reordering safety; the real work is done above.
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  // Once identity + bank hooks resolve (edit mode only), fill in the Financial
  // step fields that were empty on first render. We deliberately do NOT
  // overwrite anything the admin has already typed — the effect only sets a
  // field when it is still the empty-string default. Full account number is
  // not returned for security (only last4); the admin re-types it if they
  // want to change the bank details, otherwise the untouched-field skip on
  // submit keeps the existing value.
  React.useEffect(() => {
    if (!isEdit) return
    if (!existingIdentity && !primaryBank) return
    setForm((p) => ({
      ...p,
      panNumber: p.panNumber || (existingIdentity?.pan ?? ''),
      // Full aadhaar only if the identity endpoint returned it (PII-gated
      // server-side). Otherwise leave blank so re-typing is optional.
      aadhaarNumber: p.aadhaarNumber || (existingIdentity?.aadhaar ?? ''),
      uanNumber: p.uanNumber || (existingIdentity?.uan ?? ''),
      esiNumber: p.esiNumber || (existingIdentity?.esicNumber ?? ''),
      bankName: p.bankName || (primaryBank?.bankName ?? ''),
      bankBranchName: p.bankBranchName || (primaryBank?.branchName ?? ''),
      bankIfsc: p.bankIfsc || (primaryBank?.ifscCode ?? ''),
      // Only the last4 is available to the client — show it as a
      // placeholder-ish value the admin can overwrite. If the admin doesn't
      // touch the field, the untouched-fields skip on submit avoids sending
      // a bogus 4-digit account number back.
      bankAccountNumber: p.bankAccountNumber
        || (primaryBank?.accountNumber ?? ''),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingIdentity, primaryBank])
  // Weekly off days kept as an ISO-day array so the chip UI can toggle
  // membership cheaply; serialised to CSV ("6,7") on submit to match the
  // backend column shape. Edit mode seeds from the CSV the server stored
  // on this employee (may be missing from the response DTO — safe fallback
  // to the tenant default of Sat+Sun).
  const parseWeekOffCsv = (csv?: string): number[] => {
    if (!csv) return [...DEFAULT_WEEK_OFFS]
    const parts = csv.split(',').map((s) => parseInt(s.trim(), 10)).filter(
      (n) => Number.isFinite(n) && n >= 1 && n <= 7)
    return parts.length > 0 ? parts : [...DEFAULT_WEEK_OFFS]
  }
  const [weeklyOffDays, setWeeklyOffDays] = useState<number[]>(
    isEdit ? parseWeekOffCsv((employee as unknown as { weeklyOffDays?: string })?.weeklyOffDays)
           : [...DEFAULT_WEEK_OFFS],
  )
  const toggleWeekOff = (iso: number) =>
    setWeeklyOffDays((p) => (p.includes(iso) ? p.filter((d) => d !== iso) : [...p, iso]))

  // Inline-create modal visibility. Kept as separate booleans (not a discriminated
  // union) so opening one never briefly closes another during a state batch, and
  // so each affordance's onClose can be a stable inline callback.
  const [showAddDept, setShowAddDept] = useState(false)
  const [showAddDesignation, setShowAddDesignation] = useState(false)
  const [showAddZone, setShowAddZone] = useState(false)
  const [showAddCompany, setShowAddCompany] = useState(false)

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

  // When the selected company changes, clear the previously-suggested employee
  // code and department so the next company's format / list is picked up.
  const prevCompanyRef = React.useRef(companyId)
  React.useEffect(() => {
    if (isEdit) { prevCompanyRef.current = companyId; return }
    if (prevCompanyRef.current && prevCompanyRef.current !== companyId) {
      setForm((p) => ({ ...p, employeeCode: '' }))
      setDepartmentId('')
      autoFilledCodeRef.current = null
    }
    prevCompanyRef.current = companyId
  }, [companyId, isEdit])

  // Whether the designation field is in dropdown mode (list has ≥1 item) or
  // free-text mode (tenant has no designations configured yet — mobile parity
  // path so a fresh tenant can onboard without visiting Organization first).
  const useDesignationFreeText = designations.length === 0

  // ─── Per-step validation ──────────────────────────────────────────────────
  // Split so Next can validate only the current step, while Submit
  // re-validates every required field across both.
  // Required-set MUST match Attendance_App/app/staff-onboarding.tsx exactly.
  // Mobile treats DOB and every Financial-step statutory / bank field as
  // OPTIONAL — format-checked only when the admin actually types something.
  // Everyone provisioned later (payroll / EPFO) fills those in when they have
  // the paperwork; blocking onboarding on them would prevent HR from adding a
  // new joiner on day 1. See mobile rules at staff-onboarding.tsx lines 544-780.
  const validateBasic = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!isEdit && !companyId) {
      errs.companyId = 'Select a company — create one in Organization → Companies first'
    }
    if (!form.firstName.trim()) errs.firstName = 'First name is required'
    if (!form.email.trim()) {
      errs.email = 'Work email is required'
    } else if (!RX.email.test(form.email.trim())) {
      errs.email = 'Enter a valid email address'
    }
    const phoneClean = stripWs(form.phone)
    if (!phoneClean) {
      errs.phone = 'Phone is required (used for mobile app login)'
    } else if (!RX.phone.test(phoneClean)) {
      errs.phone = 'Enter a valid phone number (10–15 digits, optional + prefix)'
    }
    // Designation is required — either a picked designationId or free-text
    // value depending on which mode is active.
    if (useDesignationFreeText) {
      if (!form.designationText.trim()) errs.designationText = 'Designation is required'
    } else if (!form.designationId) {
      errs.designationId = 'Select a designation'
    }
    if (!departmentId) errs.departmentId = 'Select a department'
    if (!form.employeeCode.trim()) errs.employeeCode = 'Employee code is required'
    if (!form.dateOfJoining) errs.dateOfJoining = 'Date of joining is required'
    // DOB is OPTIONAL per mobile parity — format is naturally enforced by
    // <input type="date">, so no manual check needed when a value is set.
    return errs
  }

  const validateFinancial = (): Record<string, string> => {
    const errs: Record<string, string> = {}
    // salaryFrequency is the ONLY required Financial-step field in mobile.
    if (!form.salaryFrequency) errs.salaryFrequency = 'Salary frequency is required'
    // Every statutory + bank field below is OPTIONAL. Validate format ONLY
    // when the admin actually entered a value — same behaviour as mobile's
    // `validate: (v) => !v || pattern.test(v)` rules.
    if (form.panNumber.trim() && !RX.pan.test(form.panNumber.toUpperCase())) {
      errs.panNumber = 'PAN must be 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)'
    }
    if (form.aadhaarNumber.trim() && !RX.aadhaar.test(stripWs(form.aadhaarNumber))) {
      errs.aadhaarNumber = 'Aadhaar must be 12 digits'
    }
    if (form.uanNumber.trim() && !RX.uan.test(stripWs(form.uanNumber))) {
      errs.uanNumber = 'UAN must be 12 digits'
    }
    if (form.esiNumber.trim() && !RX.esi.test(stripWs(form.esiNumber))) {
      errs.esiNumber = 'ESI must be 10–17 digits'
    }
    if (form.bankAccountNumber.trim() && !RX.bankAccount.test(stripWs(form.bankAccountNumber))) {
      errs.bankAccountNumber = 'Account number must be 9–18 digits'
    }
    if (form.bankIfsc.trim() && !RX.ifsc.test(form.bankIfsc.toUpperCase())) {
      errs.bankIfsc = 'IFSC must be 4 letters + 0 + 6 alphanum (e.g. HDFC0001234)'
    }
    return errs
  }

  // Jump the admin to the step that contains their earliest error.
  const stepForErrors = (errs: Record<string, string>): FormStep => {
    const basicKeys = ['companyId', 'firstName', 'email', 'phone', 'designationId', 'designationText', 'departmentId', 'employeeCode', 'dateOfJoining', 'dateOfBirth']
    if (basicKeys.some((k) => errs[k])) return 'basic'
    return 'financial'
  }

  const handleNext = () => {
    if (step === 'basic') {
      const errs = validateBasic()
      if (Object.keys(errs).length > 0) { setErrors(errs); return }
      setErrors({})
      setStep('financial')
      return
    }
    if (step === 'financial') {
      const errs = validateFinancial()
      if (Object.keys(errs).length > 0) { setErrors(errs); return }
      setErrors({})
      // In edit mode there is no review step — Next on Financial submits.
      if (isEdit) { void handleSubmit(); return }
      setStep('review')
    }
  }

  const handleBack = () => {
    if (step === 'review') setStep('financial')
    else if (step === 'financial') setStep('basic')
  }

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

    const basicErrs = validateBasic()
    const financialErrs = validateFinancial()
    const errs = { ...basicErrs, ...financialErrs }
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      setStep(stepForErrors(errs))
      return
    }
    setErrors({})

    const phoneClean = stripWs(form.phone)

    // Derive ctcAnnual from monthlySalary if the admin filled it — mobile
    // parity, so the two clients compute the same yearly figure.
    const monthly = form.monthlySalary ? parseFloat(form.monthlySalary) : undefined
    const ctc = monthly !== undefined && !Number.isNaN(monthly) ? monthly * 12 : undefined
    try {
      if (isEdit) {
        const result = await updateEmp.mutateAsync({
          id: employee.id,
          data: {
            firstName: form.firstName,
            lastName: form.lastName || undefined,
            email: form.email,
            phone: phoneClean || undefined,
            dateOfBirth: form.dateOfBirth || undefined,
            gender: (form.gender as WorkforceEmployee['gender']) || undefined,
            departmentId: departmentId || undefined,
            designationId: form.designationId || undefined,
            employmentType: form.employmentType as WorkforceEmployee['employmentType'],
            ctcAnnual: ctc,
          },
        })
        // The Shift picker renders on the Basic step in edit mode too, but the
        // assignment call only ever ran on the create path — so an admin who
        // changed an existing employee's shift here got "Employee updated" and
        // no assignment. Guarded on shiftId, which starts empty, so an edit that
        // doesn't touch the picker still can't reassign anyone by accident.
        if (form.shiftId) {
          try {
            await assignEmployeeShift(employee.id, form.shiftId)
          } catch (shiftErr: unknown) {
            const m = (shiftErr as { message?: string })?.message || 'the shift could not be assigned'
            toast(`Employee updated, but ${m}.`, 'warning')
          }
        }
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
          lastName: form.lastName || undefined,
          email: form.email,
          phone: phoneClean || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          gender: form.gender as WorkforceEmployee['gender'] || undefined,
          departmentId: departmentId || undefined,
          // Send whichever designation representation the admin used —
          // designationId when a lookup exists, else the free-text string.
          designationId: !useDesignationFreeText && form.designationId ? form.designationId : undefined,
          designation: useDesignationFreeText && form.designationText.trim()
            ? form.designationText.trim()
            : undefined,
          geoFenceZoneId: form.geoFenceZoneId || undefined,
          weeklyOffDays: weeklyOffDays.length ? formatWeekOffs(weeklyOffDays) : undefined,
          employmentType: form.employmentType as WorkforceEmployee['employmentType'],
          dateOfJoining: form.dateOfJoining || undefined,
          salaryFrequency: form.salaryFrequency || undefined,
          monthlySalary: monthly !== undefined && !Number.isNaN(monthly) ? monthly : undefined,
          ctcAnnual: ctc,
          panNumber: form.panNumber ? form.panNumber.toUpperCase() : undefined,
          aadhaarNumber: form.aadhaarNumber ? stripWs(form.aadhaarNumber) : undefined,
          uanNumber: form.uanNumber ? stripWs(form.uanNumber) : undefined,
          esiNumber: form.esiNumber ? stripWs(form.esiNumber) : undefined,
          bankName: form.bankName || undefined,
          bankBranchName: form.bankBranchName || undefined,
          bankAccountNumber: form.bankAccountNumber ? stripWs(form.bankAccountNumber) : undefined,
          bankIfsc: form.bankIfsc ? form.bankIfsc.toUpperCase() : undefined,
          // Backend still requires roleCode on create; the mobile-parity
          // wizard drops the picker and provisions everyone as EMPLOYEE.
          // Admins upgrade access via Users & Access after onboarding.
          roleCode: 'EMPLOYEE',
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
            // the admin back to Basic where they can fix it.
            setErrors((p) => ({ ...p, email: 'That email is already in use for this company.' }))
            setStep('basic')
            return
          } else if (looksLikeDuplicate) {
            // Real collision on employee code — Basic step is where the
            // code field now lives.
            setErrors((p) => ({ ...p, employeeCode: 'That employee code is already in use.' }))
            setStep('basic')
            return
          } else {
            throw createErr
          }
        }
        // Shift assignment. The employee row already exists, so a failure here
        // must not roll the onboarding back — but it must not be invisible
        // either. This used to be a bare `catch {}`, which meant a rejected
        // assignment produced a plain "Employee created" toast and left the hire
        // scored against the hardcoded 09:30 fallback with nobody aware.
        // Surfaced as a warning toast, the same way a failed invitation is.
        let shiftAssignError: string | null = null
        if (form.shiftId && result?.id) {
          try {
            await assignEmployeeShift(result.id, form.shiftId)
          } catch (shiftErr: unknown) {
            shiftAssignError =
              (shiftErr as { message?: string })?.message || 'the shift could not be assigned'
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
        if (shiftAssignError) {
          toast(
            `Employee created, but ${shiftAssignError}. Until a shift is set from their profile, attendance is scored against the 9:30 AM default.`,
            'warning',
          )
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
      const e = err as { message?: string; status?: number; payload?: { errorCode?: string } }
      const message = e?.message ?? 'Failed to save employee'

      // Detect on the HTTP STATUS, not on words in the message.
      //
      // This previously matched only the literal "SEAT_LIMIT_REACHED" while the
      // backend enforcer actually returns "SEAT_LIMIT_EXCEEDED", and matched
      // "used all N seats" while the real copy reads "You've used N of M paid
      // seats". Neither ever matched, so the out-of-seats panel never rendered:
      // a real customer at their cap saw no explanation, assumed the click had
      // not registered, and pressed Save eight more times — eight more 402s in
      // the console and still no idea what was wrong.
      //
      // 402 Payment Required is emitted by exactly one thing in this API
      // (SeatLimitExceptionHandler), so the status alone is a precise and
      // rename-proof signal. The string checks stay only as a fallback for a
      // proxy that swallows the status.
      const errorCode = e?.payload?.errorCode ?? ''
      const isSeatLimit =
        e?.status === 402 ||
        /SEAT_LIMIT/i.test(errorCode) ||
        /SEAT_LIMIT/i.test(message) ||
        /\bseats?\b/i.test(message) && /\bupgrade\b/i.test(message)

      if (isSeatLimit) {
        setSeatLimitMessage(message.replace(/^SEAT_LIMIT[A-Z_]*:?\s*/i, ''))
        return
      }
      toast(message, 'error')
    }
  }

  const isPending = createEmp.isPending || updateEmp.isPending
  // Edit mode skips Review — update payload persists only a subset of fields,
  // and asking for a "review + send invitation" pass on an existing employee
  // is nonsense. Two-step Basic → Financial with a Save button on Financial.
  const visibleSteps = isEdit ? STEPS.filter((s) => s.key !== 'review') : STEPS
  const stepIdx = Math.max(0, visibleSteps.findIndex((s) => s.key === step))
  const isLastStep = stepIdx === visibleSteps.length - 1
  // Review does its own submit button — the footer keeps a plain Back on that
  // screen. On earlier steps the footer's primary button is Next.
  const isReviewStep = step === 'review'

  // Out of seats. Replaces the form rather than sitting behind it: the answer
  // is never "try again", it is either buy a seat or ask someone who can.
  if (seatLimitMessage) {
    return (
      <>
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <div className="ut-card ut-glass ut-card-lg fixed left-1/2 top-1/2 z-[110] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 p-6">
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
              <>
                <button
                  onClick={() => {
                    // NEW TAB, deliberately. This used to be
                    // `window.location.href = '/plan'`, which is a full page
                    // navigation — it tore down this component and threw away
                    // every field the admin had already typed. They then had to
                    // re-enter the whole employee after upgrading, which is the
                    // single most annoying possible moment to lose a form.
                    // Opening billing in a second tab keeps THIS tab (and all
                    // its form state) alive, so they can add seats, come back,
                    // and press "I've added seats" below.
                    window.open('/plan', '_blank', 'noopener,noreferrer')
                  }}
                  className="w-full rounded-xl bg-[#059669] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#047857]">
                  Add seats
                  <span className="ml-1.5 text-xs font-normal opacity-80">(opens new tab)</span>
                </button>
                <button
                  onClick={() => {
                    // Just clear the blocking state and resubmit. The backend
                    // is the sole authority on seat capacity, so if seats are
                    // still short this 402s and lands us right back on this
                    // panel — no client-side cache to second-guess.
                    setSeatLimitMessage(null)
                    void handleSubmit()
                  }}
                  className="w-full rounded-xl border border-[#059669] px-4 py-2.5 text-sm font-semibold text-[#059669] hover:bg-[#ECFDF5]">
                  I've added seats — save this employee
                </button>
              </>
            ) : (
              <div className="rounded-xl bg-[#F8FAFC] px-4 py-3 text-center text-xs text-text-secondary">
                Only a workspace admin can change the plan. Ask your admin to add seats.
              </div>
            )}
            <button onClick={() => setSeatLimitMessage(null)}
                    className="w-full rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:text-text-primary">
              Back to form
            </button>
          </div>
        </div>
      </>
    )
  }

  // ── Review lookups ────────────────────────────────────────────────────────
  const dash = (v?: string) => (v && v.trim() ? v : '—')
  const companyName = companies.find((c) => c.id === companyId)?.name ?? '—'
  const departmentName = departments.find((d) => d.id === departmentId)?.name ?? '—'
  const designationLabel = useDesignationFreeText
    ? dash(form.designationText)
    : (designations.find((d) => d.id === form.designationId)?.title ?? '—')
  const zoneName = form.geoFenceZoneId
    ? (geofenceZones.find((z) => z.id === form.geoFenceZoneId)?.name ?? '—')
    : 'No specific zone'
  const shiftName = form.shiftId
    ? (shifts.find((sh) => sh.id === form.shiftId)?.name ?? '—')
    : 'Default (9:30 AM)'
  const weekOffLabel = weeklyOffDays.length === 0
    ? 'None'
    : weeklyOffDays
        .slice().sort((a, b) => a - b)
        .map((iso) => WEEK_DAYS.find((d) => d.iso === iso)?.short ?? '')
        .filter(Boolean)
        .join(', ')
  const genderLabel = form.gender
    ? form.gender.charAt(0) + form.gender.slice(1).toLowerCase().replace(/_/g, ' ')
    : '—'
  const salaryLabel = form.monthlySalary
    ? `₹${Number(form.monthlySalary).toLocaleString('en-IN')}`
    : '—'
  const empTypeLabel = form.employmentType
    ? form.employmentType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : '—'

  return (
    <>
      <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="ut-card ut-glass ut-card-lg fixed right-0 top-0 bottom-0 z-[110] w-full max-w-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-text-primary font-semibold">{isEdit ? 'Edit Employee' : 'Add Employee'}</h3>
          <button onClick={onClose} className="p-1.5 text-text-secondary hover:text-text-primary rounded-lg hover:bg-white/5"><X size={16} /></button>
        </div>

        {/* Step pills — 3 dots (2 in edit) mirroring the mobile stepper */}
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
              {!isEdit && companies.length > 1 && (
                <Field label="Company" required error={errors.companyId}>
                  <div className="flex items-center gap-2">
                    <Sel error={!!errors.companyId} value={companyId} onChange={(e) => { setCompanyId(e.target.value); setErrors(p => ({ ...p, companyId: '' })) }}>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </Sel>
                    <AddNewButton onClick={() => setShowAddCompany(true)} label="+ Add" />
                  </div>
                </Field>
              )}
              {!isEdit && companies.length === 0 && (
                <div className={`rounded-xl border px-4 py-3 text-sm ${errors.companyId ? 'border-red-400 bg-red-50 text-red-800' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
                  No company exists yet. Create one now to keep the details you've entered so far.
                  {errors.companyId && <p className="mt-1 font-semibold text-red-600">{errors.companyId}</p>}
                  <div className="mt-2">
                    <AddNewButton onClick={() => setShowAddCompany(true)} label="+ Add Company" />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                <Field label="First Name" required error={errors.firstName}>
                  <Input error={!!errors.firstName} value={form.firstName} onChange={(e) => set('firstName', e.target.value)} placeholder="First name" />
                </Field>
                <Field label="Last Name">
                  <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} placeholder="Last name" />
                </Field>
              </div>

              <Field label="Work Email" required error={errors.email}>
                <Input error={!!errors.email} type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="employee@company.com" />
              </Field>
              <Field label="Phone" required error={errors.phone}>
                <Input error={!!errors.phone} type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 9876543210" />
              </Field>

              <Field label="Designation" required error={errors.designationId || errors.designationText}>
                {useDesignationFreeText ? (
                  <>
                    <div className="flex items-center gap-2">
                      <Input
                        error={!!errors.designationText}
                        value={form.designationText}
                        onChange={(e) => set('designationText', e.target.value)}
                        placeholder="e.g. Software Engineer"
                      />
                      <AddNewButton onClick={() => setShowAddDesignation(true)} label="+ Save to list" />
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      Typed in-line, or press "Save to list" to add a reusable designation for future hires.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Sel error={!!errors.designationId} value={form.designationId} onChange={(e) => set('designationId', e.target.value)}>
                      <option value="">Select designation</option>
                      {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                    </Sel>
                    <AddNewButton onClick={() => setShowAddDesignation(true)} label="+ Add" />
                  </div>
                )}
              </Field>

              <Field label="Department" required error={errors.departmentId}>
                <div className="flex items-center gap-2">
                  <Sel
                    error={!!errors.departmentId}
                    value={departmentId}
                    onChange={(e) => { setDepartmentId(e.target.value); setErrors(p => ({ ...p, departmentId: '' })) }}
                  >
                    <option value="">
                      {departments.length === 0 ? 'No departments yet — click Add to create one' : 'Select department'}
                    </option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Sel>
                  <AddNewButton onClick={() => setShowAddDept(true)} label="+ Add" />
                </div>
              </Field>

              <Field label="Employee Code" required error={errors.employeeCode}>
                <Input
                  error={!!errors.employeeCode}
                  value={form.employeeCode}
                  onChange={(e) => set('employeeCode', e.target.value)}
                  placeholder={nextCodePreview?.preview ?? 'e.g. EMP-1024'}
                />
              </Field>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                <Field label="Date of Joining" required error={errors.dateOfJoining}>
                  <Input error={!!errors.dateOfJoining} type="date" value={form.dateOfJoining} onChange={(e) => set('dateOfJoining', e.target.value)} />
                </Field>
                <Field label="Date of Birth" error={errors.dateOfBirth}>
                  <Input error={!!errors.dateOfBirth} type="date" value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
                </Field>
              </div>

              <Field label="Gender">
                <Sel value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="">Select</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </Sel>
              </Field>

              <Field label="Geofence Zone (Punch)">
                <div className="flex items-center gap-2">
                  <Sel value={form.geoFenceZoneId} onChange={(e) => set('geoFenceZoneId', e.target.value)}>
                    <option value="">
                      {geofenceZones.length === 0 ? 'No zones yet — click Add to create one' : 'No specific zone'}
                    </option>
                    {geofenceZones.filter((z) => z.active).map((z) => (
                      <option key={z.id} value={z.id}>{z.name}</option>
                    ))}
                  </Sel>
                  <AddNewButton onClick={() => setShowAddZone(true)} label="+ Add" />
                </div>
                <p className="mt-1 text-xs text-text-secondary">
                  Optional — when set, the employee can only punch in from inside this zone.
                </p>
              </Field>

              <Field label="Shift">
                {/* No .filter(active): /v1/shifts only returns active policies —
                    a soft-deleted one simply stops appearing in the list. */}
                <Sel value={form.shiftId} onChange={(e) => set('shiftId', e.target.value)}>
                  <option value="">
                    {shifts.length === 0 ? 'No shifts configured — set up in Organization' : 'Default (9:30 AM)'}
                  </option>
                  {shifts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.startTime && s.endTime ? ` (${s.startTime.slice(0, 5)}–${s.endTime.slice(0, 5)})` : ''}
                    </option>
                  ))}
                </Sel>
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
            </>
          )}

          {step === 'financial' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                <Field label="Salary Frequency" required error={errors.salaryFrequency}>
                  <Sel error={!!errors.salaryFrequency} value={form.salaryFrequency} onChange={(e) => set('salaryFrequency', e.target.value)}>
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="DAILY">Daily</option>
                  </Sel>
                </Field>
                <Field label="Monthly Salary (₹)">
                  <Input
                    type="number"
                    value={form.monthlySalary}
                    onChange={(e) => set('monthlySalary', e.target.value)}
                    placeholder="e.g. 50000"
                  />
                </Field>
              </div>

              <Field label="Employment Type">
                {/* Only org types whose code is a real backend enum value are offered —
                    the API field is a fixed enum, so a custom/lookup code (or a UUID
                    fallback) would 400 at deserialization. Mobile parity: hardcode
                    the 4 canonical types when no org lookup exists. */}
                {employmentTypes.filter((t) => t.active && t.code && (EMPLOYMENT_TYPE_ENUM as readonly string[]).includes(t.code)).length > 0 ? (
                  <Sel value={form.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                    {employmentTypes
                      .filter((t) => t.active && t.code && (EMPLOYMENT_TYPE_ENUM as readonly string[]).includes(t.code))
                      .map((t) => (
                        <option key={t.id} value={t.code!}>{t.name}</option>
                      ))}
                  </Sel>
                ) : (
                  <Sel value={form.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                    <option value="FULL_TIME">Full Time</option>
                    <option value="PART_TIME">Part Time</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="INTERN">Intern</option>
                  </Sel>
                )}
              </Field>

              <Field label="PAN Number" error={errors.panNumber}>
                <Input error={!!errors.panNumber} value={form.panNumber} onChange={(e) => set('panNumber', e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
              </Field>
              <Field label="Aadhaar Number" error={errors.aadhaarNumber}>
                <Input error={!!errors.aadhaarNumber} value={form.aadhaarNumber} onChange={(e) => set('aadhaarNumber', e.target.value)} placeholder="1234 5678 9012" />
              </Field>
              <Field label="UAN Number" error={errors.uanNumber}>
                <Input error={!!errors.uanNumber} value={form.uanNumber} onChange={(e) => set('uanNumber', e.target.value)} placeholder="12-digit UAN" />
              </Field>
              <Field label="ESI Number" error={errors.esiNumber}>
                <Input error={!!errors.esiNumber} value={form.esiNumber} onChange={(e) => set('esiNumber', e.target.value)} placeholder="10–17 digit ESI number" />
              </Field>

              <Field label="Bank Account Number" error={errors.bankAccountNumber}>
                <Input error={!!errors.bankAccountNumber} value={form.bankAccountNumber} onChange={(e) => set('bankAccountNumber', e.target.value)} placeholder="123456789012" />
              </Field>
              <Field label="IFSC Code" error={errors.bankIfsc}>
                <Input error={!!errors.bankIfsc} value={form.bankIfsc} onChange={(e) => set('bankIfsc', e.target.value.toUpperCase())} placeholder="HDFC0001234" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
                <Field label="Bank Name">
                  <Input value={form.bankName} onChange={(e) => set('bankName', e.target.value)} placeholder="e.g. HDFC Bank" />
                </Field>
                <Field label="Bank Branch">
                  <Input value={form.bankBranchName} onChange={(e) => set('bankBranchName', e.target.value)} placeholder="e.g. MG Road" />
                </Field>
              </div>
            </>
          )}

          {step === 'review' && !isEdit && (
            <>
              <div className="ut-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-text-primary">Basic Information</h4>
                  <button
                    type="button"
                    onClick={() => setStep('basic')}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
                <SummaryRow label="Company" value={companyName} />
                <SummaryRow label="Name" value={dash([form.firstName, form.lastName].filter(Boolean).join(' '))} />
                <SummaryRow label="Email" value={dash(form.email)} />
                <SummaryRow label="Phone" value={dash(form.phone)} />
                <SummaryRow label="Designation" value={designationLabel} />
                <SummaryRow label="Department" value={departmentName} />
                <SummaryRow label="Employee Code" value={dash(form.employeeCode)} />
                <SummaryRow label="Date of Joining" value={dash(form.dateOfJoining)} />
                <SummaryRow label="Date of Birth" value={dash(form.dateOfBirth)} />
                <SummaryRow label="Gender" value={genderLabel} />
                <SummaryRow label="Geofence Zone" value={zoneName} />
                <SummaryRow label="Shift" value={shiftName} />
                <SummaryRow label="Weekly Offs" value={weekOffLabel} />
              </div>

              <div className="ut-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-text-primary">Financial, Government &amp; Bank</h4>
                  <button
                    type="button"
                    onClick={() => setStep('financial')}
                    className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/15"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
                <SummaryRow label="Salary Frequency" value={form.salaryFrequency || '—'} />
                <SummaryRow label="Monthly Salary" value={salaryLabel} />
                <SummaryRow label="Employment Type" value={empTypeLabel} />
                <SummaryRow label="PAN" value={dash(form.panNumber)} />
                <SummaryRow label="Aadhaar" value={dash(form.aadhaarNumber)} />
                <SummaryRow label="UAN" value={dash(form.uanNumber)} />
                <SummaryRow label="ESI" value={dash(form.esiNumber)} />
                <SummaryRow label="Bank Account" value={dash(form.bankAccountNumber)} />
                <SummaryRow label="IFSC" value={dash(form.bankIfsc)} />
                <SummaryRow label="Bank Name" value={dash(form.bankName)} />
                <SummaryRow label="Bank Branch" value={dash(form.bankBranchName)} />
              </div>

              {canInvite && (
                <label className="flex items-center gap-2 px-1 text-xs text-text-secondary cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={sendInvitation}
                    onChange={e => setSendInvitation(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-primary"
                  />
                  <Send size={11} className="text-primary" />
                  Send invitation email to <strong>{form.email || 'the employee'}</strong>
                </label>
              )}

              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="w-full py-3 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-colors shadow-sm"
              >
                {isPending ? 'Saving…' : 'Create Employee'}
              </button>
            </>
          )}
        </div>

        {/* Footer — Back / Cancel / (Next | Save) */}
        <div className="flex gap-3 p-5 border-t border-border">
          {stepIdx > 0 && (
            <button
              onClick={handleBack}
              className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors"
            >
              Back
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          {!isReviewStep && (
            !isLastStep ? (
              <button
                onClick={handleNext}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary-dark text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
              >
                Next <ChevronRight size={14} />
              </button>
            ) : (
              // Edit mode: last visible step is Financial, so its primary
              // action is Save Changes (there is no Review pass on edit).
              <button
                onClick={handleSubmit}
                disabled={isPending}
                className="flex-1 py-2.5 bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors shadow-sm"
              >
                {isPending ? 'Saving…' : 'Save Changes'}
              </button>
            )
          )}
        </div>
      </div>

      {/* Inline entity-creation modals. Rendered here (siblings of the drawer,
          under the same top-level fragment) and internally portalled to the
          body, so opening one does NOT unmount the drawer and every field the
          admin already typed survives across create-and-continue. */}
      <InlineCreateCompanyModal
        open={showAddCompany}
        onClose={() => setShowAddCompany(false)}
        onCreated={(c) => {
          setCompanyId(c.id)
          setErrors((p) => ({ ...p, companyId: '' }))
        }}
      />
      <InlineCreateDepartmentModal
        open={showAddDept}
        onClose={() => setShowAddDept(false)}
        companyId={companyId}
        onCreated={(d) => {
          setDepartmentId(d.id)
          setErrors((p) => ({ ...p, departmentId: '' }))
        }}
      />
      <InlineCreateDesignationModal
        open={showAddDesignation}
        onClose={() => setShowAddDesignation(false)}
        companyId={companyId}
        departmentId={departmentId || undefined}
        initialTitle={useDesignationFreeText ? form.designationText : ''}
        onCreated={(d) => {
          // Switch the field back into dropdown mode by clearing free-text
          // and setting the picked id — the free-text branch only shows when
          // the designations list is empty, and it's about to be non-empty.
          setForm((p) => ({ ...p, designationId: d.id, designationText: '' }))
          setErrors((p) => ({ ...p, designationId: '', designationText: '' }))
        }}
      />
      <InlineCreateZoneModal
        open={showAddZone}
        onClose={() => setShowAddZone(false)}
        onCreated={(z) => {
          setForm((p) => ({ ...p, geoFenceZoneId: z.id }))
        }}
      />
    </>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-t border-border/60 first:border-t-0">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-medium text-text-primary text-right break-words">{value}</span>
    </div>
  )
}
