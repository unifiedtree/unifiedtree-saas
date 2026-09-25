import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Camera, Check, CheckCircle2, Copy, FileText, Laptop, Plus, Trash2, Upload, X,
} from 'lucide-react'
import clsx from 'clsx'
import { addMonths, format, parseISO } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { EmptyState } from '@unifiedtree/ui-kit'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { ModulePage } from '@/design/module/ModuleKit'
import { useToast } from '@/shared/hooks/useToast'
import {
  useBranches, useCompanies, useDepartments, useDesignations, useEmploymentTypes,
} from '../api/useOrg'
import {
  useCreateWorkforceEmployee, useEmployeeDirectory, useUpdateWorkforceEmployee, useWorkforceEmployee,
  type CreateWorkforceEmployeePayload, type WorkforceEmployee,
} from '../api/useWorkforce'
import { useNextEmployeeCode } from '../api/useSettings'
import { useTemplates, useCreateInstance } from './api/useOnboarding'
import { usePolicies } from '../api/usePolicy'
import { saveOnboardingRecord } from './OnboardingRecord'
import { useCreateDocument } from '../api/useDocument'
import { apiJson } from '@/core/api/client'
import type { EmployeeBankAccountResponse } from '../api/useEmployeeProfile'
import { saveOnboardingPayroll } from './saveOnboardingPayroll'

/**
 * New-hire wizard: core employee creation, supplementary HR record, document
 * uploads, then the selected onboarding checklist. Each follow-up write has
 * explicit failure/retry handling so a partial save never creates a duplicate
 * employee. Policy selection is a handover record, not employee acknowledgement.
 * The attached photo is stored in Employee Documents alongside other hire documents.
 */

// ── Steps ────────────────────────────────────────────────────────────────────

type StepKey =
  | 'basic' | 'employment' | 'documents' | 'payroll'
  | 'benefits' | 'policies' | 'assets' | 'joining'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'basic',      label: 'Basic Details' },
  { key: 'employment', label: 'Employment' },
  { key: 'documents',  label: 'Documents' },
  { key: 'payroll',    label: 'Payroll' },
  { key: 'benefits',   label: 'Benefits' },
  { key: 'policies',   label: 'Policies' },
  { key: 'assets',     label: 'Assets' },
  { key: 'joining',    label: 'Joining' },
]

const STEP_HEAD: Record<StepKey, { title: string; description: string }> = {
  basic: {
    title: 'Create Employee / Onboarding',
    description: 'Fill in the basic details to create a new employee record. Employee ID will be generated automatically.',
  },
  employment: {
    title: 'Employment Details',
    description: 'Enter the job, department and work details. Company ID is generated here.',
  },
  documents: {
    title: 'Documents',
    description: 'Upload and verify required documents from the employee.',
  },
  payroll: {
    title: 'Payroll Details',
    description: 'Add salary details and bank information for payroll processing.',
  },
  benefits: {
    title: 'Benefits & Statutory',
    description: 'Enrol the hire in statutory and company benefits.',
  },
  policies: {
    title: 'Policies',
    description: 'Pick the policies to share with the hire on their first day.',
  },
  assets: {
    title: 'Assets',
    description: 'Issue the laptop, devices and accessories the hire needs on day one.',
  },
  joining: {
    title: 'Joining Day',
    description: 'Confirm the joining details and complete onboarding.',
  },
}

// ── Reference data ───────────────────────────────────────────────────────────

const GENDERS = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'OTHER', label: 'Other' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' },
]

// The API field is a fixed enum, so only org employment types whose code is a
// real backend value are offered — a custom code would 400 at deserialization.
// Same guard as employees/EmployeeForm.tsx.
const EMPLOYMENT_TYPE_ENUM = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'] as const
const EMPLOYMENT_TYPE_FALLBACK = [
  { value: 'FULL_TIME', label: 'Full Time' },
  { value: 'PART_TIME', label: 'Part Time' },
  { value: 'CONTRACT',  label: 'Contract' },
  { value: 'INTERN',    label: 'Intern' },
]

const PROBATION_OPTIONS = ['No probation', '1 Month', '3 Months', '6 Months', '12 Months']
const NOTICE_OPTIONS = ['15 Days', '30 Days', '60 Days', '90 Days']
const ACCOUNT_TYPES = ['Savings', 'Current', 'Salary']
const ISSUE_STATES = ['To be issued', 'Issued']

const BANKS = [
  'State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank',
  'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India',
  'IndusInd Bank', 'Yes Bank', 'IDFC First Bank',
]

const INSURANCE_PLANS = [
  { value: '', label: 'Not enrolled' },
  { value: 'SELF', label: 'Individual' },
  { value: 'SELF_SPOUSE', label: 'Individual + Spouse' },
  { value: 'FAMILY_FLOATER', label: 'Family Floater' },
]

/**
 * Map each checklist entry to its category in Employee Documents.
 */
const DOCUMENT_ROWS = [
  { key: 'pan',         label: 'PAN Card',                       required: true,  category: 'ID_PROOF' },
  { key: 'aadhaar',     label: 'Aadhaar Card',                   required: true,  category: 'ID_PROOF' },
  { key: 'degree',      label: 'Educational Degree Certificate', required: true,  category: 'CERTIFICATE' },
  { key: 'prevEmp',     label: 'Previous Employment Letter',     required: false, category: 'CONTRACT' },
  { key: 'bankProof',   label: 'Bank Account Details',           required: true,  category: 'OTHER' },
  { key: 'photo',       label: 'Passport Size Photo',            required: true,  category: 'OTHER' },
] as const

const ASSET_TYPES = [
  'Laptop', 'Desktop', 'Monitor', 'Mobile Phone', 'SIM Card',
  'Headset', 'Keyboard', 'Mouse', 'Docking Station', 'Access Card', 'Other',
]

const CHECKLIST_ITEMS = [
  { key: 'documents', label: 'Documents verified' },
  { key: 'payroll',   label: 'Payroll setup completed' },
  { key: 'itAccess',  label: 'IT access created' },
  { key: 'assets',    label: 'Laptop and assets ready' },
  { key: 'welcomeKit', label: 'Welcome kit prepared' },
] as const

// ── Validation ───────────────────────────────────────────────────────────────

// Same patterns as employees/EmployeeForm.tsx — a hire must not pass here on
// input the other form would have rejected.
const RX = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?\d{10,15}$/,
  pan: /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/,
  aadhaar: /^[0-9]{12}$/,
  uan: /^\d{12}$/,
  esi: /^\d{10,17}$/,
  bankAccount: /^\d{9,18}$/,
  ifsc: /^[A-Z]{4}0[A-Z\d]{6}$/,
} as const

const stripWs = (s: string) => s.replace(/\s+/g, '')

/** Local-timezone today as YYYY-MM-DD — toISOString() is UTC and rolls a day. */
const todayLocal = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const inr = (n: number) =>
  Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0'

// ── Field primitives ─────────────────────────────────────────────────────────

function Field({
  label, required, error, hint, className, children,
}: {
  label: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={clsx('min-w-0', className)}>
      <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">
        {label} {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {error
        ? <p className="mt-1 text-xs font-medium text-red-500">{error}</p>
        : hint ? <p className="mt-1 text-xs text-text-tertiary">{hint}</p> : null}
    </div>
  )
}

function Input({ error, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { error?: boolean }) {
  return <input {...props} aria-invalid={error || undefined} className={clsx('ut-input', className)} />
}

function Sel({ error, className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { error?: boolean }) {
  return (
    <select {...props} aria-invalid={error || undefined} className={clsx('ut-select', className)}>
      {children}
    </select>
  )
}

function Card({ title, description, actions, children }: {
  title: string
  description?: string
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="ut-card mb-5 p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-text-primary">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-text-secondary">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/** Two-column form grid — 1 column on phones, as in the reference layout. */
function Grid2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">{children}</div>
}

/** Read-only, copyable Employee ID well shown on the first two steps. */
function EmployeeIdField({ value, onCopy }: { value: string; onCopy: () => void }) {
  return (
    <Field label="Employee ID" hint="Automatically generated">
      <div className="flex gap-2">
        <Input readOnly value={value} placeholder="Generated on create" className="flex-1 cursor-default bg-bg-subtle" />
        <button
          type="button"
          onClick={onCopy}
          aria-label="Copy employee ID"
          title="Copy employee ID"
          className="flex h-9.5 w-10 shrink-0 items-center justify-center rounded-xl border border-border-default bg-[var(--bg-surface)] text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]"
        >
          <Copy size={15} />
        </button>
      </div>
    </Field>
  )
}

// ── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ active, reached, onJump }: {
  active: StepKey
  reached: number
  onJump: (key: StepKey) => void
}) {
  const activeIndex = STEPS.findIndex((s) => s.key === active)
  return (
    <div className="mb-6 overflow-x-auto scrollbar-hide">
      <ol className="flex w-max min-w-full items-start gap-0 px-1">
        {STEPS.map((s, i) => {
          const done = i < activeIndex
          const current = i === activeIndex
          const reachable = i <= reached
          return (
            <li key={s.key} className="flex min-w-[92px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Left connector — hidden on the first step so the row starts flush. */}
                <span
                  aria-hidden
                  className={clsx(
                    'h-0.5 flex-1 rounded-full',
                    i === 0 ? 'opacity-0' : done || current ? 'bg-[var(--interactive-primary)]' : 'bg-border-default',
                  )}
                />
                <button
                  type="button"
                  disabled={!reachable}
                  aria-current={current ? 'step' : undefined}
                  onClick={() => reachable && onJump(s.key)}
                  className={clsx(
                    'mx-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-focus)]',
                    current && 'border-transparent bg-[var(--interactive-primary)] text-white shadow-[0_4px_14px_0_rgba(15,110,86,0.35)]',
                    done && 'border-transparent bg-[var(--accent-bg)] text-[var(--accent-fg)]',
                    !current && !done && 'border-border-default bg-[var(--bg-surface)] text-text-tertiary',
                    reachable ? 'cursor-pointer' : 'cursor-not-allowed',
                  )}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </button>
                <span
                  aria-hidden
                  className={clsx(
                    'h-0.5 flex-1 rounded-full',
                    i === STEPS.length - 1 ? 'opacity-0' : done ? 'bg-[var(--interactive-primary)]' : 'bg-border-default',
                  )}
                />
              </div>
              <span className={clsx(
                'mt-2 whitespace-nowrap px-1 text-center text-[11px] font-semibold',
                current ? 'text-text-primary' : 'text-text-tertiary',
              )}>
                {s.label}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

// ── Form state ───────────────────────────────────────────────────────────────

type Errors = Record<string, string>

type DocStatus = 'PENDING' | 'VERIFIED' | 'REJECTED'
interface DocEntry { fileName: string; status: DocStatus; file?: File }

interface AssetRow {
  id: string
  type: string
  model: string
  serial: string
  issuedOn: string
}

const EMPTY_FORM = {
  // 1 — Basic Details
  fullName: '', email: '', phone: '', dateOfBirth: '', gender: '',
  currentAddress: '', sameAsCurrent: true, permanentAddress: '',
  // 2 — Employment Details
  departmentId: '', branchId: '', designationId: '', designationText: '',
  dateOfJoining: '', employmentType: 'FULL_TIME', probation: '6 Months',
  reportingManagerId: '', noticePeriod: '60 Days',
  // 4 — Payroll
  ctcAnnual: '', basicSalary: '', hra: '', specialAllowance: '', otherAllowance: '',
  accountHolderName: '', bankName: '', bankNameOther: '', accountNumber: '',
  ifsc: '', accountType: 'Savings',
  // 5 — Benefits & statutory
  pfEnrolled: true, uanNumber: '', esiEnrolled: true, esiNumber: '',
  gratuityEligible: true, insurancePlan: 'SELF', panNumber: '', aadhaarNumber: '',
  // 8 — Joining day
  orientationTime: '09:00', assignedLaptop: '',
  idCardStatus: 'To be issued', accessCardStatus: 'To be issued',
  // The onboarding template whose checklist this hire receives. Picked on the
  // Joining step, pre-selected from the department/designation match below.
  templateId: '',
}

type FormState = typeof EMPTY_FORM

export const OnboardingForm: React.FC = () => {
  const navigate = useNavigate()
  const { toast } = useToast()

  const [step, setStep] = useState<StepKey>('basic')
  const [reached, setReached] = useState(0)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [errors, setErrors] = useState<Errors>({})
  const [photoUrl, setPhotoUrl] = useState('')
  const [docs, setDocs] = useState<Record<string, DocEntry>>({})
  useEffect(() => {
    const file = docs.photo?.file
    if (!file) { setPhotoUrl(''); return }
    const url = URL.createObjectURL(file)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [docs.photo?.file])
  const [assets, setAssets] = useState<AssetRow[]>([])
  const [policyPack, setPolicyPack] = useState<Record<string, boolean>>({})
  const [checklist, setChecklist] = useState<Record<string, boolean>>({})
  const [created, setCreated] = useState<WorkforceEmployee | null>(null)
  const [recordSaving, setRecordSaving] = useState(false)
  const [recordError, setRecordError] = useState('')
  const [recordSaved, setRecordSaved] = useState(false)
  const uploadedDocuments = useRef(new Set<string>())
  const uploadDocument = useCreateDocument()
  const updateEmployee = useUpdateWorkforceEmployee()
  const canConfigurePayroll = usePermission('payroll.structure.manage')
  const [finishing, setFinishing] = useState(false)
  const [managerSearch, setManagerSearch] = useState('')
  const [managerPage, setManagerPage] = useState(0)
  // Outcome of the onboarding-instance write that follows the employee create.
  // Tracked separately so the success card can tell the truth about each.
  const [instanceStarted, setInstanceStarted] = useState(false)
  const [instanceError, setInstanceError] = useState('')

  const stepIndex = STEPS.findIndex((s) => s.key === step)
  const isLastStep = stepIndex === STEPS.length - 1

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    // Clear a field's error the moment it is corrected — a stale red border
    // after a fix reads as a bug.
    setErrors((e) => (e[key as string] ? { ...e, [key as string]: '' } : e))
  }

  // ── Project data sources ───────────────────────────────────────────────────
  // Every dropdown below is the tenant's own reference data, not invented
  // strings, so a hire created here lands on the same ids the rest of HRMS uses.
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id || ''
  const { data: departments = [] } = useDepartments(companyId)
  const { data: branches = [] } = useBranches(companyId || undefined)
  const designationQuery = useDesignations(companyId, form.departmentId || undefined)
  const designations = designationQuery.data ?? []
  const { data: employmentTypes = [] } = useEmploymentTypes(companyId)
  const managerQuery = useEmployeeDirectory(
    { companyId: companyId || undefined, search: managerSearch.trim() || undefined, page: managerPage, pageSize: 25 },
    { enabled: !!companyId },
  )
  const { data: selectedManager } = useWorkforceEmployee(form.reportingManagerId || undefined)
  const managers = managerQuery.data?.content ?? []
  const { data: policyPage } = usePolicies(0, 'ACTIVE')
  const policies = policyPage?.content ?? []
  const saveSupplementary = async (employeeId: string) => {
    setRecordSaving(true); setRecordError(''); setRecordSaved(false)
    try {
      const probationMonths = Number.parseInt(form.probation, 10)
      if (probationMonths > 0 && form.dateOfJoining) {
        await updateEmployee.mutateAsync({ id: employeeId, data: {
          employmentStatus: 'PROBATION',
          probationEndDate: format(addMonths(parseISO(form.dateOfJoining), probationMonths), 'yyyy-MM-dd'),
        } })
      } else if (form.probation === 'No probation') {
        await updateEmployee.mutateAsync({ id: employeeId, data: { employmentStatus: 'ACTIVE' } })
      }
      // Payroll reads the encrypted primary account, not the legacy employee columns.
      // Read back first so retrying a later failed step does not add duplicate accounts.
      const accountNumber = stripWs(form.accountNumber)
      const ifscCode = form.ifsc.trim().toUpperCase()
      const bankPath = `/v1/employees/${employeeId}/profile/bank-accounts`
      const accounts = await apiJson<EmployeeBankAccountResponse[]>(bankPath)
      if (!accounts.some(account => account.primary && account.accountNumberLast4 === accountNumber.slice(-4) && account.ifscCode === ifscCode && account.accountHolderName === form.accountHolderName.trim())) {
        await apiJson(bankPath, { method: 'POST', body: JSON.stringify({
          accountNumber, ifscCode, primary: true, accountHolderName: form.accountHolderName.trim(),
          bankName: form.bankName === 'OTHER' ? form.bankNameOther.trim() : form.bankName,
        }) })
      }
      await saveOnboardingRecord(employeeId, {
        details: {
          permanentAddress: form.sameAsCurrent ? form.currentAddress.trim() : form.permanentAddress.trim(),
          probation: form.probation, noticePeriod: form.noticePeriod, accountType: form.accountType,
          pfEnrolled: form.pfEnrolled ? 'Yes' : 'No', esiEnrolled: form.esiEnrolled ? 'Yes' : 'No',
          gratuityEligible: form.gratuityEligible ? 'Yes' : 'No', insurancePlan: form.insurancePlan,
          orientationTime: form.orientationTime, assignedLaptop: assets.find(asset => asset.id === form.assignedLaptop)?.model || '',
          idCardStatus: form.idCardStatus, accessCardStatus: form.accessCardStatus,
        },
        assets: assets.map(({ type, model, serial, issuedOn }) => ({ type, model, serial, issuedOn })),
        selectedPolicies: policies.filter(p => policyPack[p.id]).map(p => p.title),
        joiningChecklist: checklist,
        documentChecklist: Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, { fileName: doc.fileName, status: doc.status }])),
      })
      if (canConfigurePayroll) await saveOnboardingPayroll({
        employeeId, ctcAnnual: Number(form.ctcAnnual), effectiveFrom: form.dateOfJoining,
        pfApplicable: form.pfEnrolled, basicSalary: Number(form.basicSalary || 0), hra: Number(form.hra || 0),
        specialAllowance: Number(form.specialAllowance || 0), otherAllowance: Number(form.otherAllowance || 0),
      })
      for (const row of DOCUMENT_ROWS) {
        const doc = docs[row.key]
        if (!doc?.file) continue
        const uploadKey = `${row.key}:${doc.file.name}:${doc.file.size}:${doc.file.lastModified}`
        if (uploadedDocuments.current.has(uploadKey)) continue
        await uploadDocument.mutateAsync({ employeeId, title: row.label, category: row.category, fileUrl: '', file: doc.file, notes: `Onboarding verification: ${doc.status}` })
        uploadedDocuments.current.add(uploadKey)
      }
      setRecordSaved(true)
    } catch (error) {
      setRecordError(error instanceof Error ? error.message : 'Could not save onboarding details')
    } finally { setRecordSaving(false) }
  }
  const { data: codePreview } = useNextEmployeeCode(companyId || undefined)
  const createEmp = useCreateWorkforceEmployee()

  // ── Onboarding template ────────────────────────────────────────────────────
  // Creating the employee is only half of "start onboarding": without an
  // instance the hire never appears on the onboarding dashboard and gets no
  // checklist. The template supplies that checklist, so it is collected here
  // and POSTed straight after the employee create below.
  const canStartOnboarding = usePermission('hrms.onboarding.instance.write')
  const canReadTemplates = usePermission('hrms.onboarding.template.read')
  const { data: templates = [] } = useTemplates(companyId || undefined, { enabled: canReadTemplates })
  const createInstance = useCreateInstance()
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates])

  // Templates carry an optional departmentId/designationId. The most specific
  // match wins — a "Sales Engineer" template beats a generic "Sales" one, which
  // beats a company-wide template — so HR usually has nothing to choose.
  const suggestedTemplateId = useMemo(() => {
    if (activeTemplates.length === 0) return ''
    const score = (t: typeof activeTemplates[number]) => {
      if (t.designationId && t.designationId === form.designationId) return 3
      if (t.departmentId && t.departmentId === form.departmentId) return 2
      if (!t.departmentId && !t.designationId) return 1
      return 0
    }
    const best = activeTemplates
      .map((t) => ({ t, s: score(t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)[0]
    return best?.t.id ?? ''
  }, [activeTemplates, form.departmentId, form.designationId])

  // Follow the suggestion until HR picks one by hand; after that their choice
  // stands even if they go back and change the department.
  const templateTouched = useRef(false)
  useEffect(() => {
    if (templateTouched.current) return
    setForm((f) => (f.templateId === suggestedTemplateId ? f : { ...f, templateId: suggestedTemplateId }))
  }, [suggestedTemplateId])

  const employeeIdPreview = codePreview?.preview ?? ''

  const activeDepartments = useMemo(() => departments.filter((d) => d.active), [departments])
  const activeBranches = useMemo(() => branches.filter((b) => b.active), [branches])
  const activeDesignations = useMemo(() => designations.filter((d) => d.active), [designations])

  // Designation is a select when the tenant has a designation lookup, and a
  // free-text field when it does not — the create payload accepts either, and
  // an empty select would otherwise make a required field impossible to fill.
  const useDesignationFreeText = activeDesignations.length === 0

  const employmentTypeOptions = useMemo(() => {
    const usable = employmentTypes.filter(
      (t) => t.active && t.code && (EMPLOYMENT_TYPE_ENUM as readonly string[]).includes(t.code),
    )
    return usable.length > 0
      ? usable.map((t) => ({ value: t.code!, label: t.name }))
      : EMPLOYMENT_TYPE_FALLBACK
  }, [employmentTypes])

  // A department change invalidates a designation picked under the old one.
  const prevDeptRef = useRef(form.departmentId)
  useEffect(() => {
    if (prevDeptRef.current && prevDeptRef.current !== form.departmentId) {
      setForm((f) => ({ ...f, designationId: '' }))
    }
    prevDeptRef.current = form.departmentId
  }, [form.departmentId])

  // ── Salary breakdown ───────────────────────────────────────────────────────
  // Annual CTC drives the monthly split (50 / 20 / 20 / 10) until the admin
  // edits a component by hand; after that their figures are left alone and
  // only the total is recomputed.
  const breakdownTouched = useRef(false)

  useEffect(() => {
    if (breakdownTouched.current) return
    const ctc = Number(form.ctcAnnual)
    if (!form.ctcAnnual || Number.isNaN(ctc) || ctc <= 0) {
      setForm((f) => ({ ...f, basicSalary: '', hra: '', specialAllowance: '', otherAllowance: '' }))
      return
    }
    const monthly = ctc / 12
    setForm((f) => ({
      ...f,
      basicSalary: String(Math.round(monthly * 0.5)),
      hra: String(Math.round(monthly * 0.2)),
      specialAllowance: String(Math.round(monthly * 0.2)),
      otherAllowance: String(Math.round(monthly * 0.1)),
    }))
  }, [form.ctcAnnual])

  const setComponent = (key: 'basicSalary' | 'hra' | 'specialAllowance' | 'otherAllowance', value: string) => {
    breakdownTouched.current = true
    set(key, value)
  }

  const totalGross = useMemo(() => {
    const n = (v: string) => (v ? Number(v) : 0)
    const sum = n(form.basicSalary) + n(form.hra) + n(form.specialAllowance) + n(form.otherAllowance)
    return Number.isFinite(sum) ? sum : 0
  }, [form.basicSalary, form.hra, form.specialAllowance, form.otherAllowance])

  // ── Documents ──────────────────────────────────────────────────────────────

  const docCounts = useMemo(() => {
    let pending = 0, verified = 0, rejected = 0
    for (const row of DOCUMENT_ROWS) {
      const entry = docs[row.key]
      if (!entry) { if (row.required) pending += 1; continue }
      if (entry.status === 'VERIFIED') verified += 1
      else if (entry.status === 'REJECTED') rejected += 1
      else pending += 1
    }
    return { pending, verified, rejected }
  }, [docs])

  const requiredDocsOutstanding = DOCUMENT_ROWS.filter(
    (r) => r.required && docs[r.key]?.status !== 'VERIFIED',
  ).length

  const attachDoc = async (key: string, file: File) => {
    if (!file.size || file.size > 5 * 1024 * 1024) { toast('Choose a non-empty file of 5MB or smaller', 'error'); return }
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name) || (file.type && !['application/pdf', 'image/png', 'image/jpeg'].includes(file.type))) {
      toast('Choose a PDF, JPG or PNG file', 'error'); return
    }
    try {
      const header = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      const pdf = [37, 80, 68, 70, 45].every((byte, i) => header[i] === byte)
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header[i] === byte)
      const jpeg = [255, 216, 255].every((byte, i) => header[i] === byte)
      if (!(pdf || png || jpeg) || (key === 'photo' && !(png || jpeg))) { toast('This file is not a supported PDF, PNG or JPG document', 'error'); return }
      setDocs((d) => ({ ...d, [key]: { fileName: file.name, status: 'PENDING', file } }))
    } catch { toast('Could not read the selected file. Please choose it again.', 'error') }
  }

  const setDocStatus = (key: string, status: DocStatus) =>
    setDocs((d) => (d[key] ? { ...d, [key]: { ...d[key], status } } : d))

  const removeDoc = (key: string) =>
    setDocs((d) => { const next = { ...d }; delete next[key]; return next })

  // ── Assets ─────────────────────────────────────────────────────────────────

  const addAsset = () =>
    setAssets((a) => [
      ...a,
      { id: `asset-${Date.now()}-${a.length}`, type: 'Laptop', model: '', serial: '', issuedOn: todayLocal() },
    ])

  const updateAsset = (id: string, patch: Partial<AssetRow>) =>
    setAssets((a) => a.map((row) => (row.id === id ? { ...row, ...patch } : row)))

  const removeAsset = (id: string) => {
    const removed = assets.find((a) => a.id === id)
    setAssets((a) => a.filter((row) => row.id !== id))
    // Keep the Joining step's laptop pick honest if its asset row is deleted.
    if (removed && form.assignedLaptop === removed.id) set('assignedLaptop', '')
  }

  const laptopAssets = useMemo(
    () => assets.filter((a) => a.type === 'Laptop' || a.type === 'Desktop'),
    [assets],
  )

  // ── Validation per step ────────────────────────────────────────────────────

  const validateBasic = (): Errors => {
    const e: Errors = {}
    const name = form.fullName.trim()
    if (!name) e.fullName = 'Full name is required'
    else if (name.length < 2) e.fullName = 'Enter the hire’s full name'
    if (!form.email.trim()) e.email = 'Email address is required'
    else if (!RX.email.test(form.email.trim())) e.email = 'Enter a valid email address'
    const phone = stripWs(form.phone)
    if (!phone) e.phone = 'Phone number is required'
    else if (!RX.phone.test(phone)) e.phone = 'Enter 10–15 digits, optionally with +'
    if (!form.dateOfBirth) e.dateOfBirth = 'Date of birth is required'
    else if (form.dateOfBirth > todayLocal()) e.dateOfBirth = 'Date of birth cannot be in the future'
    if (!form.sameAsCurrent && !form.permanentAddress.trim()) {
      e.permanentAddress = 'Enter the permanent address or tick "Same as current address"'
    }
    return e
  }

  const validateEmployment = (): Errors => {
    const e: Errors = {}
    if (!form.departmentId) e.departmentId = 'Select a department'
    if (!form.branchId) e.branchId = 'Select a branch / location'
    if (useDesignationFreeText) {
      if (!form.designationText.trim()) e.designationText = 'Designation is required'
    } else if (!form.designationId) {
      e.designationId = 'Select a designation'
    }
    if (!form.dateOfJoining) e.dateOfJoining = 'Joining date is required'
    if (!form.employmentType) e.employmentType = 'Select an employment type'
    if (!form.probation) e.probation = 'Select a probation period'
    if (!form.noticePeriod) e.noticePeriod = 'Select a notice period'
    return e
  }

  const validatePayroll = (): Errors => {
    const e: Errors = {}
    const ctc = Number(form.ctcAnnual)
    if (!form.ctcAnnual.trim()) e.ctcAnnual = 'Annual CTC is required'
    else if (Number.isNaN(ctc) || ctc <= 0) e.ctcAnnual = 'Enter a valid amount'
    if (['basicSalary', 'hra', 'specialAllowance', 'otherAllowance'].some(key => !Number.isFinite(Number(form[key as keyof FormState])) || Number(form[key as keyof FormState]) < 0) || totalGross <= 0) {
      e.ctcAnnual = 'Enter valid non-negative salary amounts with a positive total'
    }
    if (!form.accountHolderName.trim()) e.accountHolderName = 'Account holder name is required'
    const bank = form.bankName === 'OTHER' ? form.bankNameOther.trim() : form.bankName
    if (!bank) e.bankName = 'Bank name is required'
    const acct = stripWs(form.accountNumber)
    if (!acct) e.accountNumber = 'Account number is required'
    else if (!RX.bankAccount.test(acct)) e.accountNumber = 'Enter 9–18 digits'
    const ifsc = form.ifsc.trim().toUpperCase()
    if (!ifsc) e.ifsc = 'IFSC code is required'
    else if (!RX.ifsc.test(ifsc)) e.ifsc = 'Format: ABCD0123456'
    if (!form.accountType) e.accountType = 'Select an account type'
    return e
  }

  const validateBenefits = (): Errors => {
    const e: Errors = {}
    // Each field is optional on its own, but an enrolled scheme without its
    // number cannot be filed — and a malformed number would 400 on create.
    const uan = stripWs(form.uanNumber)
    if (uan && !RX.uan.test(uan)) e.uanNumber = 'UAN is 12 digits'
    const esi = stripWs(form.esiNumber)
    if (esi && !RX.esi.test(esi)) e.esiNumber = 'ESI number is 10–17 digits'
    if (form.panNumber.trim() && !RX.pan.test(form.panNumber.trim().toUpperCase())) {
      e.panNumber = 'Format: ABCDE1234F'
    }
    const aadhaar = stripWs(form.aadhaarNumber)
    if (aadhaar && !RX.aadhaar.test(aadhaar)) e.aadhaarNumber = 'Aadhaar is 12 digits'
    return e
  }

  const validateFor = (key: StepKey): Errors => {
    if (key === 'basic') return validateBasic()
    if (key === 'employment') return validateEmployment()
    if (key === 'payroll') return validatePayroll()
    if (key === 'benefits') return validateBenefits()
    // Documents, Policies, Assets and Joining carry no blocking fields — a
    // hire is onboardable before every certificate has been collected.
    return {}
  }

  /** Validates every blocking step, for the final Create Employee click. */
  const validateAll = (): { errs: Errors; step: StepKey } | null => {
    for (const key of ['basic', 'employment', 'payroll', 'benefits'] as StepKey[]) {
      const errs = validateFor(key)
      if (Object.keys(errs).length > 0) return { errs, step: key }
    }
    return null
  }

  const goTo = (key: StepKey) => {
    setStep(key)
    setReached((r) => Math.max(r, STEPS.findIndex((s) => s.key === key)))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleNext = () => {
    const errs = validateFor(step)
    const firstError = Object.keys(errs)[0]
    if (firstError) {
      setErrors(errs)
      toast('Fix the highlighted fields to continue', 'error')
      document.getElementById(`field-${firstError}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setErrors({})
    if (step === 'documents' && requiredDocsOutstanding > 0) {
      toast(
        `${requiredDocsOutstanding} required document${requiredDocsOutstanding === 1 ? '' : 's'} still to verify — you can collect them later.`,
        'info',
      )
    }
    goTo(STEPS[stepIndex + 1].key)
  }

  const handleBack = () => {
    if (stepIndex === 0) { navigate('/hrms/onboarding/instances'); return }
    goTo(STEPS[stepIndex - 1].key)
  }

  const copyEmployeeId = async (value: string) => {
    if (!value) { toast('The employee ID is issued when the record is created', 'info'); return }
    try {
      await navigator.clipboard.writeText(value)
      toast('Employee ID copied', 'success')
    } catch {
      // Clipboard is permission-gated and blocked outright in some embedded
      // webviews — say so rather than failing silently.
      toast('Could not copy — select the field and copy manually', 'warning')
    }
  }

  // ── Create ─────────────────────────────────────────────────────────────────

  const splitName = (full: string) => {
    const parts = full.trim().split(/\s+/)
    return { firstName: parts[0], lastName: parts.slice(1).join(' ') || undefined }
  }

  const handleCreate = async () => {
    if (createEmp.isPending) return
    if (!companyId) {
      toast('Company data is still loading — try again in a moment.', 'warning')
      return
    }
    const failed = validateAll()
    if (failed) {
      setErrors(failed.errs)
      goTo(failed.step)
      toast('Fix the highlighted fields to create the employee', 'error')
      return
    }
    setErrors({})

    const { firstName, lastName } = splitName(form.fullName)
    const ctc = Number(form.ctcAnnual)
    const branch = activeBranches.find((b) => b.id === form.branchId)
    const bankName = form.bankName === 'OTHER' ? form.bankNameOther.trim() : form.bankName

    const payload: CreateWorkforceEmployeePayload = {
      companyId,
      // employeeCode is deliberately omitted so the backend's atomic counter
      // issues it — the field on screen is only a preview of what that will be.
      firstName,
      lastName,
      email: form.email.trim(),
      phone: stripWs(form.phone) || undefined,
      dateOfBirth: form.dateOfBirth || undefined,
      gender: (form.gender as WorkforceEmployee['gender']) || undefined,
      departmentId: form.departmentId || undefined,
      designationId: !useDesignationFreeText && form.designationId ? form.designationId : undefined,
      designation: useDesignationFreeText && form.designationText.trim()
        ? form.designationText.trim()
        : undefined,
      branchId: form.branchId || undefined,
      reportingManagerId: form.reportingManagerId || undefined,
      employmentType: form.employmentType as WorkforceEmployee['employmentType'],
      dateOfJoining: form.dateOfJoining || undefined,
      workLocation: branch?.city || branch?.name || undefined,
      ctcAnnual: Number.isFinite(ctc) && ctc > 0 ? ctc : undefined,
      salaryFrequency: 'MONTHLY',
      monthlySalary: totalGross > 0 ? totalGross : undefined,
      panNumber: form.panNumber.trim() ? form.panNumber.trim().toUpperCase() : undefined,
      aadhaarNumber: stripWs(form.aadhaarNumber) || undefined,
      uanNumber: form.pfEnrolled && stripWs(form.uanNumber) ? stripWs(form.uanNumber) : undefined,
      esiNumber: form.esiEnrolled && stripWs(form.esiNumber) ? stripWs(form.esiNumber) : undefined,
      bankName: bankName || undefined,
      bankAccountNumber: stripWs(form.accountNumber) || undefined,
      bankIfsc: form.ifsc.trim().toUpperCase() || undefined,
      currentAddressLine: form.currentAddress.trim() || undefined,
      // Backend still requires roleCode on create; everyone is provisioned as
      // EMPLOYEE here and upgraded from Users & Access, same as EmployeeForm.
      roleCode: 'EMPLOYEE',
    }

    try {
      const result = await createEmp.mutateAsync(payload)
      setFinishing(true)
      setCreated(result)
      await saveSupplementary(result.id)

      // ── Start the onboarding run ───────────────────────────────────────
      // Second write, deliberately NOT bundled into the first: the employee
      // already exists and is valid at this point, so a failure here must not
      // read as "the hire was not created". It is reported on its own and the
      // success card says which of the two landed.
      if (canStartOnboarding && form.templateId && result?.id) {
        try {
          await createInstance.mutateAsync({
            employeeId: result.id,
            templateId: form.templateId,
            joiningDate: form.dateOfJoining || undefined,
          })
          setInstanceStarted(true)
          toast('Employee created and onboarding started', 'success')
        } catch (instErr) {
          setInstanceStarted(false)
          setInstanceError((instErr as Error)?.message ?? 'Could not start the onboarding checklist')
          toast('Employee created, but the onboarding checklist could not be started', 'error')
        }
      } else {
        setInstanceStarted(false)
        toast('Employee created', 'success')
      }
      setFinishing(false)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err: unknown) {
      setFinishing(false)
      const e = err as { message?: string; status?: number; payload?: { errorCode?: string } }
      const message = e?.message ?? 'Failed to create the employee'
      const errorCode = e?.payload?.errorCode ?? ''

      // 402 Payment Required is emitted by exactly one thing in this API
      // (the seat-limit handler), so the status alone is a precise signal.
      if (e?.status === 402 || /SEAT_LIMIT/i.test(errorCode) || /SEAT_LIMIT/i.test(message)) {
        toast(
          `${message.replace(/^SEAT_LIMIT[A-Z_]*:?\s*/i, '')} A seat is one active employee — free one up or add seats from Billing.`,
          'error',
        )
        return
      }
      if (/already in use|already exists|duplicate/i.test(message) && /email/i.test(message)) {
        setErrors((p) => ({ ...p, email: 'That email is already in use for this company.' }))
        goTo('basic')
        return
      }
      toast(message, 'error')
    }
  }

  // ── Success ────────────────────────────────────────────────────────────────

  if (created) {
    const dept = activeDepartments.find((d) => d.id === created.departmentId)
    return (
      <DesignFrame>
      <div className="mx-auto max-w-xl">
        <div className="ut-card p-6 text-center sm:p-8" style={{ borderRadius: 16 }}>
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--accent-bg)]">
            <CheckCircle2 size={34} className="text-[#059669]" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-text-primary">Employee created</h1>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] text-text-secondary">
            The employee record has been created and Employee ID has been generated.
          </p>

          <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 rounded-2xl border border-border-default bg-bg-subtle/50 p-5 text-left sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Employee Name</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-text-primary">
                {[created.firstName, created.lastName].filter(Boolean).join(' ')}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Employee ID</dt>
              <dd className="mt-0.5 flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-text-primary">{created.employeeCode}</span>
                <button
                  type="button"
                  onClick={() => copyEmployeeId(created.employeeCode)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border-default bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-semibold text-text-secondary transition-colors hover:text-text-primary"
                >
                  <Copy size={11} /> Copy
                </button>
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Department</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-text-primary">{dept?.name ?? '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Joining Date</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold text-text-primary">{created.dateOfJoining ?? '—'}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary">Status</dt>
              {/* Reports what actually happened rather than always claiming
                  "Onboarding": the checklist is a second write that can be
                  skipped (no template) or fail on its own. */}
              <dd className="mt-1">
                {finishing ? <HrStatusPill tone="info">Finishing setup</HrStatusPill> : instanceStarted
                  ? <HrStatusPill tone="info">Onboarding in progress</HrStatusPill>
                  : <HrStatusPill tone="gray">Employee only</HrStatusPill>}
              </dd>
            </div>
          </dl>

          <div className="mt-5 rounded-xl border border-border-default p-4 text-left text-sm" role="status">
            {recordSaving ? 'Saving supplementary onboarding details...'
              : recordError ? <><p role="alert">Employee created, but some onboarding details or files could not be saved: {recordError}. Keep this page open to retry pending uploads.</p><HrButton disabled={finishing} variant="ghost" className="mt-2" onClick={() => saveSupplementary(created.id)}>Retry pending saves</HrButton></>
              : recordSaved ? 'Benefits, asset issues, selected policies and joining details are saved on the employee profile.' : null}
          </div>
          {!canConfigurePayroll && <p className="mt-3 text-sm text-text-secondary">The annual CTC and bank account are saved. A payroll administrator must configure the component breakup in the employee's Payroll tab.</p>}
          {finishing && <p className="mt-4 text-sm" role="status">Saving the hire's setup and starting the selected checklist. Please keep this page open.</p>}
          {!finishing && !instanceStarted && (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
              {instanceError
                ? <>The employee was created, but the onboarding checklist could not be started: {instanceError} You can start it from the onboarding dashboard.</>
                : <>No onboarding template was selected, so this hire has no checklist and will not appear on the onboarding dashboard.</>}
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2.5">
            <HrButton disabled={finishing || recordSaving} className="w-full" onClick={() => navigate(`/hrms/employees/${created.id}`)}>
              Go to Employee Profile
            </HrButton>
            <HrButton disabled={finishing || recordSaving} variant="ghost" className="w-full" onClick={() => navigate('/hrms/onboarding/instances')}>
              Continue Onboarding
            </HrButton>
          </div>
        </div>
      </div>
      </DesignFrame>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const head = STEP_HEAD[step]

  return (
    <ModulePage crumb="Onboarding · New hire" title={head.title} subtitle={head.description}
      actions={<HrButton variant="ghost" onClick={() => navigate('/hrms/onboarding/instances')}>Cancel</HrButton>}>
    <div style={{ maxWidth: 1024, minWidth: 0 }}>

      <Stepper active={step} reached={reached} onJump={goTo} />

      {/* ── 1. Basic Details ──────────────────────────────────────────────── */}
      {step === 'basic' && (
        <Card title="Basic Details">
          <div className="flex flex-col gap-6 lg:flex-row">
            <div className="min-w-0 flex-1">
              <div className="grid grid-cols-1 gap-x-6 gap-y-5">
                <EmployeeIdField value={employeeIdPreview} onCopy={() => copyEmployeeId(employeeIdPreview)} />

                <div id="field-fullName">
                  <Field label="Full Name" required error={errors.fullName}>
                    <Input value={form.fullName} error={!!errors.fullName} placeholder="Enter full name"
                      onChange={(e) => set('fullName', e.target.value)} />
                  </Field>
                </div>
                <div id="field-email">
                  <Field label="Email Address" required error={errors.email}>
                    <Input type="email" value={form.email} error={!!errors.email} placeholder="name@company.com"
                      onChange={(e) => set('email', e.target.value)} />
                  </Field>
                </div>
                <div id="field-phone">
                  <Field label="Phone Number" required error={errors.phone}>
                    <Input type="tel" value={form.phone} error={!!errors.phone} placeholder="+91 98765 43210"
                      onChange={(e) => set('phone', e.target.value)} />
                  </Field>
                </div>
                <div id="field-dateOfBirth">
                  <Field label="Date of Birth" required error={errors.dateOfBirth}>
                    <Input type="date" max={todayLocal()} value={form.dateOfBirth} error={!!errors.dateOfBirth}
                      onChange={(e) => set('dateOfBirth', e.target.value)} />
                  </Field>
                </div>
                <Field label="Gender">
                  <Sel value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                    <option value="">Select…</option>
                    {GENDERS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  </Sel>
                </Field>
              </div>
            </div>

            {/* Photo + addresses rail — full width on mobile, column on desktop. */}
            <div className="w-full shrink-0 lg:w-[300px]">
              <div className="flex items-center gap-4 rounded-2xl border border-border-default bg-[var(--bg-surface)] p-4">
                <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-default bg-bg-subtle">
                  {photoUrl
                    ? <img src={photoUrl} alt="Attached employee photo" className="h-full w-full object-cover" />
                    : <Camera size={22} className="text-text-tertiary" />}
                </div>
                <div className="min-w-0">
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border-default bg-[var(--bg-surface)] px-3 py-1.5 text-[13px] font-semibold text-text-primary transition-colors hover:border-border-strong focus-within:ring-2 focus-within:ring-[var(--border-focus)]">
                    <Upload size={14} /> Attach Photo
                    <input
                      type="file"
                      accept="image/png,image/jpeg"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        if (file.size > 2 * 1024 * 1024) { toast('Photo must be 2MB or smaller', 'error'); return }
                        void attachDoc('photo', file)
                      }}
                    />
                  </label>
                  <p className="mt-1.5 text-[11px] text-text-tertiary">JPG, PNG (max 2MB). Saved in Employee Documents when this hire is created.</p>
                  {photoUrl && (
                    <button
                      type="button"
                      onClick={() => removeDoc('photo')}
                      className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-text-primary"
                    >
                      <X size={11} /> Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <Field label="Current Address">
                  <textarea
                    value={form.currentAddress}
                    onChange={(e) => set('currentAddress', e.target.value)}
                    rows={4}
                    placeholder="House no, street, area, city, state, PIN"
                    // .ut-input is height-fixed for inputs; a textarea needs
                    // the height released or it collapses to one line.
                    className="ut-input h-auto resize-y py-2.5 leading-relaxed"
                  />
                </Field>
              </div>

              <div className="mt-5">
                <p className="mb-1.5 text-[13px] font-semibold text-text-secondary">Permanent Address</p>
                <label className="flex cursor-pointer items-center gap-2.5 py-1">
                  <input
                    type="checkbox"
                    checked={form.sameAsCurrent}
                    onChange={(e) => set('sameAsCurrent', e.target.checked)}
                    className="h-4 w-4 rounded border-border-strong accent-[#059669]"
                  />
                  <span className="text-[13px] text-text-secondary">Same as current address</span>
                </label>
                {!form.sameAsCurrent && (
                  <div id="field-permanentAddress" className="mt-2">
                    <Field label="Permanent Address" required error={errors.permanentAddress}>
                      <textarea
                        value={form.permanentAddress}
                        onChange={(e) => set('permanentAddress', e.target.value)}
                        rows={4}
                        placeholder="House no, street, area, city, state, PIN"
                        className="ut-input h-auto resize-y py-2.5 leading-relaxed"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* ── 2. Employment Details ─────────────────────────────────────────── */}
      {step === 'employment' && (
        <Card title="Employment Details">
          <Grid2>
            <EmployeeIdField value={employeeIdPreview} onCopy={() => copyEmployeeId(employeeIdPreview)} />
            <Field label="Status">
              <div className="flex h-9.5 items-center">
                <HrStatusPill tone="info">Onboarding</HrStatusPill>
              </div>
            </Field>

            <div id="field-departmentId">
              <Field
                label="Department"
                required
                error={errors.departmentId}
                hint={activeDepartments.length === 0 ? 'No departments yet — add one from Organisation settings.' : undefined}
              >
                <Sel value={form.departmentId} error={!!errors.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}>
                  <option value="">Select department…</option>
                  {activeDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </Sel>
              </Field>
            </div>
            <div id="field-branchId">
              <Field
                label="Branch / Location"
                required
                error={errors.branchId}
                hint={activeBranches.length === 0 ? 'No branches yet — add one from Organisation settings.' : undefined}
              >
                <Sel value={form.branchId} error={!!errors.branchId}
                  onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">Select branch…</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.city ? `${b.name} — ${b.city}` : b.name}</option>
                  ))}
                </Sel>
              </Field>
            </div>

            {designationQuery.isPending ? <div role="status" className="py-3 text-sm text-text-secondary">Loading designations...</div>
            : designationQuery.isError ? <div role="alert" className="text-sm text-red-700">Could not load designations. <HrButton variant="ghost" onClick={() => designationQuery.refetch()}>Try again</HrButton></div>
            : useDesignationFreeText ? (
              <div id="field-designationText">
                <Field label="Designation" required error={errors.designationText}
                  hint="No designation lookup for this department — entered as free text.">
                  <Input value={form.designationText} error={!!errors.designationText}
                    placeholder="e.g. Software Engineer"
                    onChange={(e) => set('designationText', e.target.value)} />
                </Field>
              </div>
            ) : (
              <div id="field-designationId">
                <Field label="Designation" required error={errors.designationId}>
                  <Sel value={form.designationId} error={!!errors.designationId}
                    onChange={(e) => set('designationId', e.target.value)}>
                    <option value="">Select designation…</option>
                    {activeDesignations.map((d) => (
                      <option key={d.id} value={d.id}>{d.grade ? `${d.title} (${d.grade})` : d.title}</option>
                    ))}
                  </Sel>
                </Field>
              </div>
            )}
            <div id="field-dateOfJoining">
              <Field label="Joining Date" required error={errors.dateOfJoining}>
                <Input type="date" value={form.dateOfJoining} error={!!errors.dateOfJoining}
                  onChange={(e) => set('dateOfJoining', e.target.value)} />
              </Field>
            </div>

            <div id="field-employmentType">
              <Field label="Employment Type" required error={errors.employmentType}>
                <Sel value={form.employmentType} error={!!errors.employmentType}
                  onChange={(e) => set('employmentType', e.target.value)}>
                  {employmentTypeOptions.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Sel>
              </Field>
            </div>
            <div id="field-probation">
              <Field label="Probation Period" required error={errors.probation}>
                <Sel value={form.probation} error={!!errors.probation}
                  onChange={(e) => set('probation', e.target.value)}>
                  {PROBATION_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </Sel>
              </Field>
            </div>

            <div id="field-reportingManagerId">
              <Field
                label="Reporting Manager"
                error={errors.reportingManagerId}
                hint="Optional. Search across the company or assign a manager later."
              >
                <Input aria-label="Search reporting managers" value={managerSearch} placeholder="Search name, email or employee code"
                  onChange={e => { setManagerSearch(e.target.value); setManagerPage(0) }} className="mb-2" />
                <Sel value={form.reportingManagerId} error={!!errors.reportingManagerId}
                  onChange={(e) => set('reportingManagerId', e.target.value)}>
                  <option value="">No manager assigned</option>
                  {selectedManager && !managers.some(manager => manager.id === selectedManager.id) && <option value={selectedManager.id}>{[selectedManager.firstName, selectedManager.lastName].filter(Boolean).join(' ')} ({selectedManager.employeeCode})</option>}
                  {managers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {[m.firstName, m.lastName].filter(Boolean).join(' ').trim()}
                      {m.employeeCode ? ` (${m.employeeCode})` : ''}
                    </option>
                  ))}
                </Sel>
                {managerQuery.isError ? <p role="alert" className="mt-2 text-xs text-red-700">Could not load managers. <button type="button" className="underline" onClick={() => managerQuery.refetch()}>Try again</button></p>
                  : managerQuery.isFetching ? <p role="status" className="mt-2 text-xs text-text-secondary">Loading managers...</p>
                  : managers.length === 0 ? <p className="mt-2 text-xs text-text-secondary">No employees match this search.</p> : null}
                {(managerQuery.data?.totalPages ?? 0) > 1 && <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                  <button type="button" disabled={managerPage === 0 || managerQuery.isFetching} className="text-primary disabled:opacity-40" onClick={() => setManagerPage(page => page - 1)}>Previous managers</button>
                  <span>Page {managerPage + 1} of {managerQuery.data?.totalPages}</span>
                  <button type="button" disabled={managerPage + 1 >= (managerQuery.data?.totalPages ?? 0) || managerQuery.isFetching} className="text-primary disabled:opacity-40" onClick={() => setManagerPage(page => page + 1)}>Next managers</button>
                </div>}
              </Field>
            </div>
            <div id="field-noticePeriod">
              <Field label="Notice Period" required error={errors.noticePeriod}>
                <Sel value={form.noticePeriod} error={!!errors.noticePeriod}
                  onChange={(e) => set('noticePeriod', e.target.value)}>
                  {NOTICE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                </Sel>
              </Field>
            </div>
          </Grid2>
        </Card>
      )}

      {/* ── 3. Documents ──────────────────────────────────────────────────── */}
      {step === 'documents' && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <CountTile tone="warn" label="Pending" value={docCounts.pending} />
            <CountTile tone="ok" label="Verified" value={docCounts.verified} />
            <CountTile tone="red" label="Rejected" value={docCounts.rejected} />
          </div>

          <section className="ut-card mb-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-bg-subtle/60">
                    <th className="px-5 py-3 text-[12px] font-semibold text-text-secondary">Document Type</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-text-secondary">Required</th>
                    <th className="px-5 py-3 text-[12px] font-semibold text-text-secondary">Status</th>
                    <th className="px-5 py-3 text-right text-[12px] font-semibold text-text-secondary">Upload</th>
                  </tr>
                </thead>
                <tbody>
                  {DOCUMENT_ROWS.map((row) => {
                    const entry = docs[row.key]
                    return (
                      <tr key={row.key} className="border-b border-[var(--border-subtle)] last:border-0">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <FileText size={15} className="shrink-0 text-text-tertiary" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-text-primary">{row.label}</p>
                              {entry && (
                                <p className="truncate text-[11px] text-text-tertiary">{entry.fileName}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-[13px] text-text-secondary">{row.required ? 'Yes' : 'No'}</td>
                        <td className="px-5 py-3.5">
                          {!entry
                            ? row.required
                              ? <HrStatusPill tone="warn">Pending</HrStatusPill>
                              : <HrStatusPill tone="gray">Not Required</HrStatusPill>
                            : entry.status === 'VERIFIED'
                              ? <HrStatusPill tone="ok">Verified</HrStatusPill>
                              : entry.status === 'REJECTED'
                                ? <HrStatusPill tone="red">Rejected</HrStatusPill>
                                : <HrStatusPill tone="warn">Pending</HrStatusPill>}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {!entry ? (
                              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)] transition-opacity hover:opacity-80 focus-within:ring-2 focus-within:ring-[var(--border-focus)]">
                                <Upload size={13} /> Upload
                                <input
                                  type="file"
                                  accept=".pdf,image/png,image/jpeg"
                                  className="sr-only"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0]
                                    if (f) attachDoc(row.key, f)
                                    e.target.value = ''
                                  }}
                                />
                              </label>
                            ) : (
                              <>
                                {entry.status !== 'VERIFIED' && (
                                  <button
                                    type="button"
                                    onClick={() => setDocStatus(row.key, 'VERIFIED')}
                                    className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/60 dark:text-emerald-300"
                                  >
                                    <Check size={13} /> Verify
                                  </button>
                                )}
                                {entry.status !== 'REJECTED' && (
                                  <button
                                    type="button"
                                    onClick={() => setDocStatus(row.key, 'REJECTED')}
                                    className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 dark:border-rose-800/40 dark:bg-rose-950/60 dark:text-rose-300"
                                  >
                                    <X size={13} /> Reject
                                  </button>
                                )}
                                <button
                                  type="button"
                                  aria-label={`Remove ${row.label}`}
                                  onClick={() => removeDoc(row.key)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-border-default bg-[var(--bg-surface)] text-text-tertiary transition-colors hover:text-text-primary"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-[var(--border-subtle)] px-5 py-3 text-[11px] text-text-tertiary">
              PDF, JPG or PNG up to 5MB each. Attached files are uploaded to Employee Documents after
              the employee is created. Keep this page open until saving finishes.
            </p>
          </section>
        </>
      )}

      {/* ── 4. Payroll Details ────────────────────────────────────────────── */}
      {step === 'payroll' && (
        <>
          <Card title="Salary Details" description="Annual CTC splits into a monthly breakdown you can adjust.">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div id="field-ctcAnnual">
                  <Field label="Annual CTC (₹)" required error={errors.ctcAnnual}>
                    <Input inputMode="decimal" value={form.ctcAnnual} error={!!errors.ctcAnnual} placeholder="600000"
                      onChange={(e) => set('ctcAnnual', e.target.value)} />
                  </Field>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[13px] font-semibold text-text-secondary">Salary Breakdown (Monthly)</p>
                <div className="overflow-hidden rounded-2xl border border-border-default">
                  <table className="w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-[var(--border-subtle)] bg-bg-subtle/60">
                        <th className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary">Component</th>
                        <th className="px-4 py-2.5 text-[12px] font-semibold text-text-secondary">Amount (₹)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {([
                        { key: 'basicSalary', label: 'Basic Salary' },
                        { key: 'hra', label: 'HRA' },
                        { key: 'specialAllowance', label: 'Special Allowance' },
                        { key: 'otherAllowance', label: 'Other Allowance' },
                      ] as const).map((c) => (
                        <tr key={c.key} className="border-b border-[var(--border-subtle)]">
                          <td className="px-4 py-2 text-[13px] text-text-primary">{c.label}</td>
                          <td className="px-4 py-2">
                            <input
                              inputMode="decimal"
                              value={form[c.key]}
                              placeholder="0"
                              onChange={(e) => setComponent(c.key, e.target.value)}
                              className="ut-input ut-input-sm w-full"
                              aria-label={`${c.label} amount`}
                            />
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-bg-subtle/60">
                        <td className="px-4 py-2.5 text-[13px] font-semibold text-text-primary">Total Gross</td>
                        <td className="px-4 py-2.5 text-[13px] font-bold text-text-primary">{inr(totalGross)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] text-text-tertiary">
                  {canConfigurePayroll ? 'These amounts become the employee salary structure. Payroll calculates attendance adjustments and deductions separately.' : 'Only annual CTC is saved with your access. A payroll administrator must configure the component breakup.'}
                </p>
              </div>
            </div>
          </Card>

          <Card title="Bank Details" description="Where the hire's salary is credited.">
            <Grid2>
              <div id="field-accountHolderName">
                <Field label="Account Holder Name" required error={errors.accountHolderName}>
                  <Input value={form.accountHolderName} error={!!errors.accountHolderName}
                    placeholder="As printed on the passbook"
                    onChange={(e) => set('accountHolderName', e.target.value)} />
                </Field>
              </div>
              <div id="field-bankName">
                <Field label="Bank Name" required error={errors.bankName}>
                  <Sel value={form.bankName} error={!!errors.bankName}
                    onChange={(e) => set('bankName', e.target.value)}>
                    <option value="">Select bank…</option>
                    {BANKS.map((b) => <option key={b} value={b}>{b}</option>)}
                    <option value="OTHER">Other…</option>
                  </Sel>
                  {form.bankName === 'OTHER' && (
                    <Input
                      className="mt-2"
                      value={form.bankNameOther}
                      placeholder="Enter bank name"
                      onChange={(e) => set('bankNameOther', e.target.value)}
                    />
                  )}
                </Field>
              </div>
              <div id="field-accountNumber">
                <Field label="Account Number" required error={errors.accountNumber}>
                  <Input inputMode="numeric" value={form.accountNumber} error={!!errors.accountNumber}
                    placeholder="9–18 digits" onChange={(e) => set('accountNumber', e.target.value)} />
                </Field>
              </div>
              <div id="field-ifsc">
                <Field label="IFSC Code" required error={errors.ifsc}>
                  {/* Uppercased on entry — IFSC is always uppercase and the
                      regex would otherwise reject a correctly-typed lowercase. */}
                  <Input value={form.ifsc} error={!!errors.ifsc} placeholder="SBIN0001234"
                    onChange={(e) => set('ifsc', e.target.value.toUpperCase())} />
                </Field>
              </div>
              <div id="field-accountType">
                <Field label="Account Type" required error={errors.accountType}>
                  <Sel value={form.accountType} error={!!errors.accountType}
                    onChange={(e) => set('accountType', e.target.value)}>
                    {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Sel>
                </Field>
              </div>
            </Grid2>
          </Card>
        </>
      )}

      {/* ── 5. Benefits & Statutory ───────────────────────────────────────── */}
      {step === 'benefits' && (
        <>
          <Card title="Statutory Benefits" description="EPF, ESI and gratuity enrolment for this hire.">
            <div className="mb-5 flex flex-col gap-2">
              <Toggle
                label="Enrol in Employees' Provident Fund (EPF)"
                hint="12% of basic salary, matched by the employer."
                checked={form.pfEnrolled}
                onChange={(v) => set('pfEnrolled', v)}
              />
              <Toggle
                label="Enrol in Employees' State Insurance (ESI)"
                hint="Applicable while gross pay is ₹21,000 or less per month."
                checked={form.esiEnrolled}
                onChange={(v) => set('esiEnrolled', v)}
              />
              <Toggle
                label="Eligible for gratuity"
                hint="Payable after five years of continuous service."
                checked={form.gratuityEligible}
                onChange={(v) => set('gratuityEligible', v)}
              />
            </div>

            <Grid2>
              <div id="field-uanNumber">
                <Field label="UAN" error={errors.uanNumber}
                  hint={form.pfEnrolled ? 'Leave blank if the hire has no UAN yet.' : 'EPF enrolment is off.'}>
                  <Input inputMode="numeric" value={form.uanNumber} error={!!errors.uanNumber}
                    disabled={!form.pfEnrolled} placeholder="12 digits"
                    onChange={(e) => set('uanNumber', e.target.value)} />
                </Field>
              </div>
              <div id="field-esiNumber">
                <Field label="ESI Number" error={errors.esiNumber}
                  hint={form.esiEnrolled ? undefined : 'ESI enrolment is off.'}>
                  <Input inputMode="numeric" value={form.esiNumber} error={!!errors.esiNumber}
                    disabled={!form.esiEnrolled} placeholder="10–17 digits"
                    onChange={(e) => set('esiNumber', e.target.value)} />
                </Field>
              </div>
            </Grid2>
          </Card>

          <Card title="Company Benefits">
            <Grid2>
              <Field label="Health Insurance Plan">
                <Sel value={form.insurancePlan} onChange={(e) => set('insurancePlan', e.target.value)}>
                  {INSURANCE_PLANS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </Sel>
              </Field>
            </Grid2>
          </Card>

          <Card title="Tax Identification" description="Needed before the first payroll run can compute TDS.">
            <Grid2>
              <div id="field-panNumber">
                <Field label="PAN Number" error={errors.panNumber}>
                  <Input value={form.panNumber} error={!!errors.panNumber} placeholder="ABCDE1234F"
                    onChange={(e) => set('panNumber', e.target.value.toUpperCase())} />
                </Field>
              </div>
              <div id="field-aadhaarNumber">
                <Field label="Aadhaar Number" error={errors.aadhaarNumber}>
                  <Input inputMode="numeric" value={form.aadhaarNumber} error={!!errors.aadhaarNumber}
                    placeholder="1234 5678 9012" onChange={(e) => set('aadhaarNumber', e.target.value)} />
                </Field>
              </div>
            </Grid2>
          </Card>
        </>
      )}

      {/* ── 6. Policies ───────────────────────────────────────────────────── */}
      {step === 'policies' && (
        <Card
          title="Policy Pack"
          description="Active company policies. Pick the ones to share on day one — the hire acknowledges them from their own Documents page."
          actions={
            policies.length > 0 ? (
              <>
                <span className="rounded-full bg-[var(--accent-bg)] px-3 py-1 text-xs font-bold text-[var(--accent-fg)]">
                  {policies.filter((p) => policyPack[p.id]).length}/{policies.length} selected
                </span>
                <HrButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const allOn = policies.every((p) => policyPack[p.id])
                    setPolicyPack(allOn ? {} : Object.fromEntries(policies.map((p) => [p.id, true])))
                  }}
                >
                  {policies.every((p) => policyPack[p.id]) ? 'Clear all' : 'Select all'}
                </HrButton>
              </>
            ) : undefined
          }
        >
          {policies.length === 0 ? (
            <EmptyState
              variant="first-run"
              icon={<FileText size={22} />}
              title="No active policies"
              description="Publish a policy from HRMS → Policies and it will be offered here for every new hire."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {policies.map((p) => {
                const on = !!policyPack[p.id]
                return (
                  <li key={p.id}>
                    <label
                      className={clsx(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--border-focus)]',
                        on
                          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                          : 'border-border-default bg-[var(--bg-surface)] hover:border-border-strong',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => setPolicyPack((s) => ({ ...s, [p.id]: !s[p.id] }))}
                      />
                      <span
                        aria-hidden
                        className={clsx(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                          on ? 'border-[#059669] bg-[#059669] text-white' : 'border-border-strong bg-[var(--bg-surface)]',
                        )}
                      >
                        {on && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-text-primary">{p.title}</span>
                        <span className="block truncate text-[11px] text-text-tertiary">
                          {[p.category, p.version && `v${p.version}`, p.effectiveDate && `effective ${p.effectiveDate}`]
                            .filter(Boolean).join(' · ') || 'Active policy'}
                        </span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      {/* ── 7. Assets ─────────────────────────────────────────────────────── */}
      {step === 'assets' && (
        <Card
          title="Assets to Issue"
          description="Record the assets handed to this employee. These details are saved with their onboarding record."
          actions={<HrButton size="sm" onClick={addAsset}><Plus size={14} /> Add Asset</HrButton>}
        >
          {assets.length === 0 ? (
            <EmptyState
              variant="first-run"
              icon={<Laptop size={22} />}
              title="No assets added"
              description="Add the laptop, devices and accessories this hire needs on day one."
              primaryAction={{ label: 'Add Asset', onClick: addAsset }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              {assets.map((row, i) => (
                <div key={row.id} className="rounded-2xl border border-border-default bg-[var(--bg-surface)] p-4">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold text-text-primary">Asset {i + 1}</p>
                    <button
                      type="button"
                      aria-label={`Remove asset ${i + 1}`}
                      onClick={() => removeAsset(row.id)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-border-default bg-[var(--bg-surface)] text-text-tertiary transition-colors hover:text-red-500"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
                    <Field label="Asset Type">
                      <Sel value={row.type} onChange={(e) => updateAsset(row.id, { type: e.target.value })}>
                        {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </Sel>
                    </Field>
                    <Field label="Make / Model">
                      <Input value={row.model} placeholder="e.g. Dell Latitude 5450"
                        onChange={(e) => updateAsset(row.id, { model: e.target.value })} />
                    </Field>
                    <Field label="Serial / Asset Tag">
                      <Input value={row.serial} placeholder="e.g. SN-84213"
                        onChange={(e) => updateAsset(row.id, { serial: e.target.value })} />
                    </Field>
                    <Field label="Issue Date">
                      <Input type="date" value={row.issuedOn}
                        onChange={(e) => updateAsset(row.id, { issuedOn: e.target.value })} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── 8. Joining Day ────────────────────────────────────────────────── */}
      {step === 'joining' && (
        <>
          <Card title="Joining Information">
            <Grid2>
              {canStartOnboarding && (
                <Field
                  label="Onboarding Template"
                  hint={
                    activeTemplates.length === 0
                      ? 'No active templates — the hire will be created without an onboarding checklist.'
                      : 'Supplies the checklist and task due dates. Pre-selected from the department and designation.'
                  }
                >
                  <Sel
                    value={form.templateId}
                    onChange={(e) => { templateTouched.current = true; set('templateId', e.target.value) }}
                    disabled={activeTemplates.length === 0}
                  >
                    <option value="">
                      {activeTemplates.length === 0 ? 'No templates available' : 'No checklist — create the employee only'}
                    </option>
                    {activeTemplates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Sel>
                </Field>
              )}
              <Field label="Joining Date" hint="Set on the Employment step.">
                <Input type="date" value={form.dateOfJoining}
                  onChange={(e) => set('dateOfJoining', e.target.value)} />
              </Field>
              <Field label="Work Location" hint="Set on the Employment step.">
                <Sel value={form.branchId} onChange={(e) => set('branchId', e.target.value)}>
                  <option value="">Select branch…</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>{b.city ? `${b.name} — ${b.city}` : b.name}</option>
                  ))}
                </Sel>
              </Field>
              <Field label="Orientation Time">
                <Input type="time" value={form.orientationTime}
                  onChange={(e) => set('orientationTime', e.target.value)} />
              </Field>
              <Field
                label="Assigned Laptop"
                hint={laptopAssets.length === 0 ? 'Add a laptop on the Assets step to pick one here.' : undefined}
              >
                <Sel value={form.assignedLaptop} onChange={(e) => set('assignedLaptop', e.target.value)}>
                  <option value="">{laptopAssets.length === 0 ? 'No laptop assigned' : 'Select…'}</option>
                  {laptopAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {[a.model || a.type, a.serial].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </Sel>
              </Field>
              <Field label="Employee ID Card">
                <Sel value={form.idCardStatus} onChange={(e) => set('idCardStatus', e.target.value)}>
                  {ISSUE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Sel>
              </Field>
              <Field label="Access Card">
                <Sel value={form.accessCardStatus} onChange={(e) => set('accessCardStatus', e.target.value)}>
                  {ISSUE_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                </Sel>
              </Field>
            </Grid2>
          </Card>

          <Card
            title="Pre-Joining Checklist"
            actions={
              <span className="rounded-full bg-[var(--accent-bg)] px-3 py-1 text-xs font-bold text-[var(--accent-fg)]">
                {CHECKLIST_ITEMS.filter((c) => checklist[c.key]).length}/{CHECKLIST_ITEMS.length} done
              </span>
            }
          >
            <ul className="flex flex-col gap-2">
              {CHECKLIST_ITEMS.map((item) => {
                const on = !!checklist[item.key]
                return (
                  <li key={item.key}>
                    <label
                      className={clsx(
                        'flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--border-focus)]',
                        on
                          ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]'
                          : 'border-border-default bg-[var(--bg-surface)] hover:border-border-strong',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => setChecklist((c) => ({ ...c, [item.key]: !c[item.key] }))}
                      />
                      <span
                        aria-hidden
                        className={clsx(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
                          on ? 'border-[#059669] bg-[#059669] text-white' : 'border-border-strong bg-[var(--bg-surface)]',
                        )}
                      >
                        {on && <Check size={13} strokeWidth={3} />}
                      </span>
                      <span className={clsx('text-sm font-medium', on ? 'text-[var(--accent-fg)]' : 'text-text-primary')}>
                        {item.label}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </Card>
        </>
      )}

      {/* Sticky action bar — Back / Next stay reachable on long steps and on
          phones where the header has scrolled away. */}
      <div className="sticky bottom-3 z-10 mt-6 flex items-center justify-between gap-3 rounded-2xl border border-border-default bg-[var(--bg-surface)]/95 px-4 py-3 shadow-[0_12px_32px_-18px_rgba(15,23,42,0.35)] backdrop-blur">
        <span className="text-xs font-medium text-text-tertiary">
          Step {stepIndex + 1} of {STEPS.length}
        </span>
        <div className="flex items-center gap-2.5">
          <HrButton variant="ghost" onClick={handleBack}>Back</HrButton>
          {isLastStep ? (
            <HrButton onClick={handleCreate} disabled={createEmp.isPending}>
              {createEmp.isPending ? 'Creating…' : 'Create Employee'}
            </HrButton>
          ) : (
            <HrButton onClick={handleNext} disabled={step === 'employment' && (designationQuery.isPending || designationQuery.isError)}>Next</HrButton>
          )}
        </div>
      </div>
    </div>
    </ModulePage>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function CountTile({ tone, label, value }: { tone: 'warn' | 'ok' | 'red'; label: string; value: number }) {
  const ring = {
    warn: 'border-amber-200/80 bg-amber-50/70 text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/40 dark:text-amber-300',
    ok: 'border-emerald-200/80 bg-emerald-50/70 text-emerald-700 dark:border-emerald-800/40 dark:bg-emerald-950/40 dark:text-emerald-300',
    red: 'border-rose-200/80 bg-rose-50/70 text-rose-700 dark:border-rose-800/40 dark:bg-rose-950/40 dark:text-rose-300',
  }[tone]
  return (
    <div className={clsx('flex items-center justify-between gap-3 rounded-2xl border px-4 py-3', ring)}>
      <span className="text-[13px] font-semibold">{label}</span>
      <span className="text-lg font-bold leading-none">{value}</span>
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-default bg-[var(--bg-surface)] px-4 py-3 transition-colors hover:border-border-strong focus-within:ring-2 focus-within:ring-[var(--border-focus)]">
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={clsx(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-[#059669] bg-[#059669] text-white' : 'border-border-strong bg-[var(--bg-surface)]',
        )}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-text-primary">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-text-tertiary">{hint}</span>}
      </span>
    </label>
  )
}
