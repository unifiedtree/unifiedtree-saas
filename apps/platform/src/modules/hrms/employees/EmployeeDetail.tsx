import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'
import type { GeneratedLetterDto } from '../letters/api/useLetters'
import { clsx } from 'clsx'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Edit3, UserCheck, AlertTriangle, LogOut,
  Mail, Phone, Calendar, Briefcase, Building2, MapPin,
  Plus, Trash2, Eye, EyeOff, Send, CheckCircle2,
} from 'lucide-react'
import { format } from 'date-fns'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
  Drawer, Button, Field, Input, Badge, EmptyState,
  TableSkeleton, CardSkeleton,
} from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import { toast } from 'sonner'
import { useWorkforceEmployee, useUpdateWorkforceEmployee, useConfirmEmployee, useStartNotice, useExitEmployee, useCancelNotice } from '../api/useWorkforce'
import { useExtendProbation } from '../api/useProbation'
import {
  useEmployeeStructure, useStructureHistory, useUpsertStructure, useSalaryComponents,
} from '../api/usePayroll'
import type { EmploymentType } from '../api/useWorkforce'
import { useCompanies, useDepartments, useDesignations, useBranches, useGrades, useEmploymentTypes, useShifts } from '../api/useOrg'
import {
  useEmployeeAddresses, useCreateAddress, useDeleteAddress,
  useEmployeeIdentity, useSaveIdentity,
  useBankAccounts, useAddBankAccount, useDeleteBankAccount,
  useEmployeeEducation, useAddEducation, useDeleteEducation,
  useEmployeeExperience, useAddExperience, useDeleteExperience,
  useEmployeeDependents, useAddDependent, useDeleteDependent,
  useEmergencyContacts, useAddEmergencyContact, useDeleteEmergencyContact,
} from '../api/useEmployeeProfile'
import type {
  EmployeeAddress, EmployeeIdentityResponse, EmployeeBankAccountResponse,
  EmployeeEducation, EmployeeExperience, EmployeeDependent, EmergencyContact,
} from '../api/useEmployeeProfile'
import { EmployeeForm } from './EmployeeForm'
import { sendInvite, resendInvite } from './api/useInvitation'
import { resetFaceEnrollment } from './api/useFaceAdmin'

// ── Zod schemas ───────────────────────────────────────────────────────────────

const addressSchema = z.object({
  addressType: z.enum(['PERMANENT', 'CURRENT', 'OFFICE']),
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  pincode: z.string().optional(),
})

const identitySchema = z.object({
  pan: z.string().max(10).optional(),
  aadhaar: z.string().max(12).optional(),
  uan: z.string().optional(),
  esicNumber: z.string().optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().optional(),
})

const bankSchema = z.object({
  accountNumber: z.string().min(1, 'Required'),
  ifscCode: z.string().length(11, 'IFSC must be 11 characters'),
  bankName: z.string().optional(),
  branchName: z.string().optional(),
  accountHolderName: z.string().min(1, 'Required'),
  primary: z.boolean(),
})

const educationSchema = z.object({
  degree: z.string().min(1, 'Required'),
  fieldOfStudy: z.string().optional(),
  institution: z.string().min(1, 'Required'),
  startYear: z.coerce.number().optional(),
  endYear: z.coerce.number().optional(),
  gradeOrPercentage: z.string().optional(),
  highest: z.boolean(),
})

const experienceSchema = z.object({
  companyName: z.string().min(1, 'Required'),
  designation: z.string().optional(),
  startDate: z.string().min(1, 'Required'),
  endDate: z.string().optional(),
  current: z.boolean(),
  description: z.string().optional(),
  location: z.string().optional(),
})

const dependentSchema = z.object({
  name: z.string().min(1, 'Required'),
  relationship: z.string().min(1, 'Required'),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  nominee: z.boolean(),
  nomineePercentage: z.coerce.number().min(0).max(100).optional(),
})

const emergencyContactSchema = z.object({
  name: z.string().min(1, 'Required'),
  relationship: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  isPrimary: z.boolean(),
})

const workSchema = z.object({
  departmentId:       z.string().optional(),
  designationId:      z.string().optional(),
  branchId:           z.string().optional(),
  reportingManagerId: z.string().optional(),
  employmentType:     z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT']).optional(),
  ctcAnnual:          z.coerce.number().positive().optional(),
})

type AddressForm   = z.infer<typeof addressSchema>
type IdentityForm  = z.infer<typeof identitySchema>
type BankForm      = z.infer<typeof bankSchema>
type EducationForm = z.infer<typeof educationSchema>
type ExperienceForm = z.infer<typeof experienceSchema>
type DependentForm = z.infer<typeof dependentSchema>
type ContactForm   = z.infer<typeof emergencyContactSchema>
type WorkForm      = z.infer<typeof workSchema>

// ── Constants ─────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  ACTIVE:        { label: 'Active',        tone: 'success' },
  PROBATION:     { label: 'Probation',     tone: 'warning' },
  NOTICE_PERIOD: { label: 'Notice Period', tone: 'warning' },
  SUSPENDED:     { label: 'Suspended',     tone: 'warning' },
  EXITED:        { label: 'Exited',        tone: 'error'   },
  TERMINATED:    { label: 'Terminated',    tone: 'error'   },
}

// ── PII helpers ───────────────────────────────────────────────────────────────

function maskPan(pan: string) {
  if (!pan || pan.length < 5) return pan
  return pan.slice(0, 3) + '****' + pan.slice(-1)
}
function maskAadhaar(last4: string) {
  return 'XXXX XXXX ' + last4
}
function maskPassport(passport: string) {
  if (!passport || passport.length < 4) return passport
  return '****' + passport.slice(-4)
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon size={13} className="text-text-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-sm text-slate-200 truncate">{value}</p>
      </div>
    </div>
  )
}

function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function ActionModal({
  title, description, confirm, onConfirm, onClose, isLoading, children,
}: {
  title: string; description: string; confirm: string; onConfirm: () => void;
  onClose: () => void; isLoading: boolean; children?: React.ReactNode
}) {
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-border/60 rounded-2xl p-6 shadow-2xl">
          <h3 className="text-text-primary font-semibold mb-1">{title}</h3>
          <p className="text-text-secondary text-sm mb-4">{description}</p>
          {children}
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="flex-1 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">Cancel</button>
            <button onClick={onConfirm} disabled={isLoading} className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors">
              {isLoading ? 'Processing…' : confirm}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Account card (invitation status) ──────────────────────────────────────────

function AccountCard({ emp }: { emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
  const canInvite = usePermission(P.HRMS_EMPLOYEE_INVITE)
  const [busy, setBusy] = useState(false)
  // Account state comes from hasAccount — NOT employmentStatus (an active
  // employee may have no login yet, and an on-notice employee may have one).
  const hasAccount = emp.hasAccount ?? false

  const doSend = async (resend: boolean) => {
    setBusy(true)
    try {
      if (resend) {
        await resendInvite(emp.id)
        toast.success('Invitation resent')
      } else {
        await sendInvite(emp.id)
        toast.success(`Invitation sent to ${emp.email}`)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invitation')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard title="Account">
      {hasAccount ? (
        <div className="flex items-center gap-2 py-2">
          <CheckCircle2 size={16} className="text-emerald-500" />
          <span className="text-sm font-medium text-emerald-600">Account active</span>
        </div>
      ) : (
        <div className="space-y-3 py-1">
          <p className="text-sm text-text-secondary">No login account yet. Send an invitation so this employee can set a password and log in.</p>
          {canInvite && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" leftIcon={<Send size={13} />}
                loading={busy} onClick={() => doSend(false)}>
                Send invitation
              </Button>
              <Button size="sm" variant="secondary" leftIcon={<Send size={13} />}
                loading={busy} onClick={() => doSend(true)}>
                Resend
              </Button>
            </div>
          )}
        </div>
      )}
      <FaceResetRow employeeId={emp.id} employeeName={`${emp.firstName ?? ''} ${emp.lastName ?? ''}`.trim() || emp.email || 'this employee'} />
    </SectionCard>
  )
}

/**
 * Admin action: wipe an employee's face enrollment + templates so they can
 * re-enroll on the mobile app. Use when the employee is locked out from too
 * many failed verifications, or when they've changed appearance enough that
 * the existing templates are giving false rejections.
 */
function FaceResetRow({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const doReset = async () => {
    setBusy(true)
    try {
      await resetFaceEnrollment(employeeId)
      toast.success('Face enrollment reset — the employee can enroll again from the mobile app.')
      setConfirming(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reset face enrollment.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <p className="text-xs text-text-secondary">
        Reset Face Enrollment — clears stored face templates and unlocks any verification lockout for {employeeName}. They&rsquo;ll need to enroll again on the mobile app.
      </p>
      {confirming ? (
        <div className="flex gap-2">
          <Button size="sm" variant="danger" loading={busy} onClick={doReset}>Yes, reset</Button>
          <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
        </div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
          Reset face enrollment
        </Button>
      )}
    </div>
  )
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ emp, departments, designations, branches, companies }: {
  emp: ReturnType<typeof useWorkforceEmployee>['data']
  departments: ReturnType<typeof useDepartments>['data']
  designations: ReturnType<typeof useDesignations>['data']
  branches: ReturnType<typeof useBranches>['data']
  companies: ReturnType<typeof useCompanies>['data']
}) {
  if (!emp) return null
  const department  = (departments  ?? []).find((d) => d.id === emp.departmentId)
  const designation = (designations ?? []).find((d) => d.id === emp.designationId)
  const branch      = (branches     ?? []).find((b) => b.id === emp.branchId)
  const company     = (companies    ?? []).find((c) => c.id === emp.companyId)

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <AccountCard emp={emp} />
      <SectionCard title="Contact">
        <InfoRow icon={Mail}     label="Work Email"  value={emp.email} />
        <InfoRow icon={Phone}    label="Phone"       value={emp.phone} />
        {emp.dateOfBirth && <InfoRow icon={Calendar} label="Date of Birth" value={format(new Date(emp.dateOfBirth), 'd MMM yyyy')} />}
        {emp.gender && <InfoRow icon={Edit3} label="Gender" value={emp.gender.replace('_', ' ')} />}
      </SectionCard>
      <SectionCard title="Employment">
        {company     && <InfoRow icon={Building2} label="Company"      value={company.name} />}
        {department  && <InfoRow icon={Briefcase} label="Department"   value={department.name} />}
        {branch      && <InfoRow icon={MapPin}    label="Branch"       value={branch.name} />}
        {designation && <InfoRow icon={Briefcase} label="Designation"  value={designation.title} />}
        {emp.employmentType && <InfoRow icon={Briefcase} label="Type" value={emp.employmentType.replace('_', ' ')} />}
        <InfoRow icon={Calendar} label="Joining Date"   value={emp.dateOfJoining  ? format(new Date(emp.dateOfJoining),  'd MMM yyyy') : undefined} />
        <InfoRow icon={Calendar} label="Probation End"  value={emp.probationEndDate ? format(new Date(emp.probationEndDate), 'd MMM yyyy') : undefined} />
        <InfoRow icon={Calendar} label="Last Working Day" value={emp.lastWorkingDay ? format(new Date(emp.lastWorkingDay), 'd MMM yyyy') : undefined} />
        {emp.ctcAnnual && (
          <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
            <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-xs text-text-secondary">₹</span>
            </div>
            <div>
              <p className="text-xs text-text-secondary">CTC (Annual)</p>
              <p className="text-sm text-slate-200">₹{emp.ctcAnnual.toLocaleString('en-IN')}</p>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  )
}

// ── Tab: Contact ─────────────────────────────────────────────────────────────

function ContactTab({ employeeId, emp }: { employeeId: string; emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useEmployeeAddresses(employeeId)
  const createMut = useCreateAddress(employeeId)
  const deleteMut = useDeleteAddress(employeeId)

  const { register, handleSubmit, reset, formState: { errors, isDirty, isValid } } = useForm<AddressForm>({
    resolver: zodResolver(addressSchema),
    defaultValues: { addressType: 'CURRENT' },
  })

  const onSubmit = async (values: AddressForm) => {
    try {
      await createMut.mutateAsync(values)
      toast.success('Address saved')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to save address') }
  }

  if (isLoading) return <TableSkeleton rows={3} cols={4} />
  if (error) return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      {/* Contact details from employee record */}
      <div className="grid sm:grid-cols-2 gap-3 mb-5 p-4 bg-white rounded-xl border border-border/40">
        <div>
          <p className="text-xs text-text-secondary mb-0.5">Work Email</p>
          <p className="text-sm text-text-primary">{emp.email}</p>
        </div>
        {emp.phone && (
          <div>
            <p className="text-xs text-text-secondary mb-0.5">Phone</p>
            <p className="text-sm text-text-primary">{emp.phone}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Addresses</h4>
        <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Address</Button>
        </Can>
      </div>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No addresses" description="Add a permanent, current, or office address." />
      ) : (
        <div className="space-y-2">
          {data.map((addr) => (
            <div key={addr.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div>
                <Badge tone="info" className="mb-1">{addr.addressType}</Badge>
                <p className="text-sm text-slate-200">
                  {[addr.line1, addr.line2, addr.city, addr.state, addr.country, addr.pincode].filter(Boolean).join(', ')}
                </p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(addr.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Address">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Address Type</label>
            <select {...register('addressType')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="CURRENT">Current</option>
              <option value="PERMANENT">Permanent</option>
              <option value="OFFICE">Office</option>
            </select>
          </div>
          <Field label="Line 1" error={errors.line1?.message}><Input {...register('line1')} placeholder="Street address" /></Field>
          <Field label="Line 2" error={errors.line2?.message}><Input {...register('line2')} placeholder="Apt, suite, etc." /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="City" error={errors.city?.message}><Input {...register('city')} /></Field>
            <Field label="State" error={errors.state?.message}><Input {...register('state')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Country" error={errors.country?.message}><Input {...register('country')} defaultValue="India" /></Field>
            <Field label="Pincode" error={errors.pincode?.message}><Input {...register('pincode')} /></Field>
          </div>
          <Button type="submit" className="w-full" loading={createMut.isPending} disabled={!isDirty || !isValid}>Save Address</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Identity (PII) ───────────────────────────────────────────────────────

function IdentityTab({ employeeId }: { employeeId: string }) {
  const [showPan, setShowPan]           = useState(false)
  const [showAadhaar, setShowAadhaar]   = useState(false)
  const [showPassport, setShowPassport] = useState(false)

  const { data: identity, isLoading, error, refetch } = useEmployeeIdentity(employeeId)
  const saveMut = useSaveIdentity(employeeId)

  const { register, handleSubmit, formState: { errors, isDirty, isValid } } = useForm<IdentityForm>({
    resolver: zodResolver(identitySchema),
    values: {
      pan:            identity?.pan            ?? '',
      aadhaar:        identity?.aadhaar        ?? '',
      uan:            identity?.uan            ?? '',
      esicNumber:     identity?.esicNumber     ?? '',
      passportNumber: identity?.passportNumber ?? '',
      passportExpiry: identity?.passportExpiry ?? '',
    },
  })

  const onSubmit = async (values: IdentityForm) => {
    try {
      await saveMut.mutateAsync({
        pan:            values.pan            || undefined,
        aadhaar:        values.aadhaar        || undefined,
        uan:            values.uan            || undefined,
        esicNumber:     values.esicNumber     || undefined,
        passportNumber: values.passportNumber || undefined,
        passportExpiry: values.passportExpiry || undefined,
      })
      toast.success('Identity saved')
    } catch { toast.error('Failed to save identity') }
  }

  if (isLoading) return <TableSkeleton rows={6} cols={2} />
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-lg space-y-4">
      {identity && (
        <div className="space-y-3 p-4 bg-white rounded-xl border border-border/40 mb-4">
          <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Current Values</h4>
          {identity.pan && (
            <PiiField label="PAN" masked={maskPan(identity.pan)} full={identity.pan} show={showPan} onToggle={() => setShowPan((v) => !v)} />
          )}
          {identity.aadhaarLast4 && (
            <PiiField label="Aadhaar" masked={maskAadhaar(identity.aadhaarLast4)} full={identity.aadhaar ?? maskAadhaar(identity.aadhaarLast4)} show={showAadhaar} onToggle={() => setShowAadhaar((v) => !v)} />
          )}
          {identity.passportNumber && (
            <PiiField label="Passport" masked={maskPassport(identity.passportNumber)} full={identity.passportNumber} show={showPassport} onToggle={() => setShowPassport((v) => !v)} />
          )}
        </div>
      )}

      <Can code={P.HRMS_EMPLOYEE_IDENTITY_WRITE}>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="PAN" error={errors.pan?.message}><Input {...register('pan')} placeholder="ABCDE1234F" /></Field>
            <Field label="Aadhaar (12 digits)" error={errors.aadhaar?.message}><Input {...register('aadhaar')} placeholder="xxxxxxxxxxxx" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="UAN" error={errors.uan?.message}><Input {...register('uan')} /></Field>
            <Field label="ESIC Number" error={errors.esicNumber?.message}><Input {...register('esicNumber')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Passport Number" error={errors.passportNumber?.message}><Input {...register('passportNumber')} /></Field>
            <Field label="Passport Expiry" error={errors.passportExpiry?.message}><Input {...register('passportExpiry')} type="date" /></Field>
          </div>
          <Button type="submit" loading={saveMut.isPending} disabled={!isDirty || !isValid}>Save Identity</Button>
        </div>
      </Can>
    </form>
  )
}

function PiiField({ label, masked, full, show, onToggle }: { label: string; masked: string; full: string; show: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-sm text-text-primary font-mono">{show ? full : masked}</p>
      </div>
      <button type="button" onClick={onToggle} className="p-1.5 text-text-secondary hover:text-text-primary transition-colors">
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  )
}

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
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_BANK_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Account</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No bank accounts" description="Add a bank account for salary credit." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeBankAccountResponse[]).map((acc) => (
            <div key={acc.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-text-primary">{acc.accountHolderName}</p>
                <p className="text-xs text-text-secondary">{acc.bankName} {acc.branchName ? `· ${acc.branchName}` : ''}</p>
                <p className="text-xs font-mono text-text-secondary">IFSC: {acc.ifscCode} · ****{acc.accountNumberLast4}</p>
                <div className="flex gap-1.5 mt-1">
                  {acc.primary   && <Badge tone="success">Primary</Badge>}
                  {acc.verified  && <Badge tone="info">Verified</Badge>}
                </div>
              </div>
              <Can code={P.HRMS_EMPLOYEE_BANK_WRITE}>
                <button onClick={() => deleteMut.mutate(acc.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Bank Account">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Account Number" required error={errors.accountNumber?.message}><Input {...register('accountNumber')} /></Field>
          <Field label="IFSC Code" required error={errors.ifscCode?.message}><Input {...register('ifscCode')} placeholder="SBIN0001234" /></Field>
          <Field label="Account Holder Name" required error={errors.accountHolderName?.message}><Input {...register('accountHolderName')} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Bank Name" error={errors.bankName?.message}><Input {...register('bankName')} /></Field>
            <Field label="Branch" error={errors.branchName?.message}><Input {...register('branchName')} /></Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('primary')} className="rounded border-slate-600 bg-white" />
            Set as primary account
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Add Account</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Education ────────────────────────────────────────────────────────────

function EducationTab({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useEmployeeEducation(employeeId)
  const addMut    = useAddEducation(employeeId)
  const deleteMut = useDeleteEducation(employeeId)

  const { register, handleSubmit, reset, formState: { errors, isDirty, isValid } } = useForm<EducationForm>({
    resolver: zodResolver(educationSchema),
    defaultValues: { highest: false },
  })

  const onSubmit = async (values: EducationForm) => {
    try {
      await addMut.mutateAsync(values as Omit<EmployeeEducation, 'id' | 'employeeId'>)
      toast.success('Education record added')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to add education record') }
  }

  if (isLoading) return <TableSkeleton rows={3} cols={3} />
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Education</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No education records" description="Add degrees and certifications." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeEducation[]).map((edu) => (
            <div key={edu.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{edu.degree}{edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ''}</p>
                  {edu.highest && <Badge tone="accent">Highest</Badge>}
                </div>
                <p className="text-xs text-text-secondary">{edu.institution}</p>
                {(edu.startYear || edu.endYear) && (
                  <p className="text-xs text-text-secondary">{edu.startYear ?? '?'} – {edu.endYear ?? 'Present'}</p>
                )}
                {edu.gradeOrPercentage && <p className="text-xs text-text-secondary">Grade/% : {edu.gradeOrPercentage}</p>}
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(edu.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Education">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Degree" required error={errors.degree?.message}><Input {...register('degree')} placeholder="B.Tech, MBA…" /></Field>
          <Field label="Field of Study" error={errors.fieldOfStudy?.message}><Input {...register('fieldOfStudy')} /></Field>
          <Field label="Institution" required error={errors.institution?.message}><Input {...register('institution')} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Year" error={errors.startYear?.message}><Input {...register('startYear')} type="number" placeholder="2018" /></Field>
            <Field label="End Year" error={errors.endYear?.message}><Input {...register('endYear')} type="number" placeholder="2022" /></Field>
          </div>
          <Field label="Grade / Percentage" error={errors.gradeOrPercentage?.message}><Input {...register('gradeOrPercentage')} placeholder="8.5 CGPA / 85%" /></Field>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('highest')} className="rounded border-slate-600 bg-white" />
            Highest qualification
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Experience ───────────────────────────────────────────────────────────

function ExperienceTab({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useEmployeeExperience(employeeId)
  const addMut    = useAddExperience(employeeId)
  const deleteMut = useDeleteExperience(employeeId)

  const { register, handleSubmit, reset, watch, formState: { errors, isDirty, isValid } } = useForm<ExperienceForm>({
    resolver: zodResolver(experienceSchema),
    defaultValues: { current: false },
  })
  const isCurrent = watch('current')

  const onSubmit = async (values: ExperienceForm) => {
    try {
      await addMut.mutateAsync(values as Omit<EmployeeExperience, 'id' | 'employeeId'>)
      toast.success('Experience record added')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to add experience record') }
  }

  if (isLoading) return <TableSkeleton rows={3} cols={3} />
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Experience</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No experience records" description="Add previous work experience." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeExperience[]).map((exp) => (
            <div key={exp.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{exp.companyName}</p>
                  {exp.current && <Badge tone="success">Current</Badge>}
                </div>
                {exp.designation && <p className="text-xs text-text-secondary">{exp.designation}</p>}
                <p className="text-xs text-text-secondary">
                  {exp.startDate} – {exp.current ? 'Present' : (exp.endDate ?? '?')}
                  {exp.location ? ` · ${exp.location}` : ''}
                </p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(exp.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Experience">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Company Name" required error={errors.companyName?.message}><Input {...register('companyName')} /></Field>
          <Field label="Designation / Role" error={errors.designation?.message}><Input {...register('designation')} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Start Date" required error={errors.startDate?.message}><Input {...register('startDate')} type="date" /></Field>
            {!isCurrent && <Field label="End Date" error={errors.endDate?.message}><Input {...register('endDate')} type="date" /></Field>}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('current')} className="rounded border-slate-600 bg-white" />
            Currently working here
          </label>
          <Field label="Location" error={errors.location?.message}><Input {...register('location')} /></Field>
          <Field label="Description" error={errors.description?.message}><Input {...register('description')} /></Field>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Dependents ───────────────────────────────────────────────────────────

function DependentsTab({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useEmployeeDependents(employeeId)
  const addMut    = useAddDependent(employeeId)
  const deleteMut = useDeleteDependent(employeeId)

  const { register, handleSubmit, reset, watch, formState: { errors, isDirty, isValid } } = useForm<DependentForm>({
    resolver: zodResolver(dependentSchema),
    defaultValues: { nominee: false },
  })
  const isNominee = watch('nominee')

  const onSubmit = async (values: DependentForm) => {
    try {
      await addMut.mutateAsync(values as Omit<EmployeeDependent, 'id' | 'employeeId'>)
      toast.success('Dependent added')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to add dependent') }
  }

  if (isLoading) return <TableSkeleton rows={3} cols={3} />
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Dependent</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No dependents" description="Add family members or dependents." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeDependent[]).map((dep) => (
            <div key={dep.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{dep.name}</p>
                  {dep.nominee && <Badge tone="accent">Nominee {dep.nomineePercentage ? `${dep.nomineePercentage}%` : ''}</Badge>}
                </div>
                <p className="text-xs text-text-secondary">{dep.relationship}{dep.gender ? ` · ${dep.gender}` : ''}</p>
                {dep.dateOfBirth && <p className="text-xs text-text-secondary">DOB: {dep.dateOfBirth}</p>}
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(dep.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Dependent">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" required error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Relationship" required error={errors.relationship?.message}><Input {...register('relationship')} placeholder="Spouse, Child, Parent…" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Date of Birth" error={errors.dateOfBirth?.message}><Input {...register('dateOfBirth')} type="date" /></Field>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Gender</label>
              <select {...register('gender')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
                <option value="">Select</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('nominee')} className="rounded border-slate-600 bg-white" />
            Mark as nominee
          </label>
          {isNominee && (
            <Field label="Nominee %" error={errors.nomineePercentage?.message}><Input {...register('nomineePercentage')} type="number" min={0} max={100} /></Field>
          )}
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Emergency Contacts ───────────────────────────────────────────────────

function EmergencyTab({ employeeId }: { employeeId: string }) {
  const [open, setOpen] = useState(false)
  const { data = [], isLoading, error, refetch } = useEmergencyContacts(employeeId)
  const addMut    = useAddEmergencyContact(employeeId)
  const deleteMut = useDeleteEmergencyContact(employeeId)

  const { register, handleSubmit, reset, formState: { errors, isDirty, isValid } } = useForm<ContactForm>({
    resolver: zodResolver(emergencyContactSchema),
    defaultValues: { isPrimary: false },
  })

  const onSubmit = async (values: ContactForm) => {
    try {
      await addMut.mutateAsync(values as Omit<EmergencyContact, 'id' | 'employeeId'>)
      toast.success('Emergency contact added')
      reset()
      setOpen(false)
    } catch { toast.error('Failed to add emergency contact') }
  }

  if (isLoading) return <TableSkeleton rows={2} cols={3} />
  if (error)     return <EmptyState variant="error" primaryAction={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Contact</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState variant="first-run" title="No emergency contacts" description="Add at least one emergency contact." />
      ) : (
        <div className="space-y-2">
          {(data as EmergencyContact[]).map((c) => (
            <div key={c.id} className="flex items-start justify-between p-3 bg-white/50 rounded-xl border border-border/40">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{c.name}</p>
                  {c.isPrimary && <Badge tone="success">Primary</Badge>}
                </div>
                {c.relationship && <p className="text-xs text-text-secondary">{c.relationship}</p>}
                <p className="text-xs text-text-secondary">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(c.id)} className="p-1.5 text-text-secondary hover:text-red-400 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      <Drawer open={open} onOpenChange={setOpen} title="Add Emergency Contact">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" required error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Relationship" error={errors.relationship?.message}><Input {...register('relationship')} placeholder="Spouse, Parent, Sibling…" /></Field>
          <Field label="Phone" error={errors.phone?.message}><Input {...register('phone')} type="tel" /></Field>
          <Field label="Email" error={errors.email?.message}><Input {...register('email')} type="email" /></Field>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('isPrimary')} className="rounded border-slate-600 bg-white" />
            Primary contact
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </Drawer>
    </>
  )
}

// ── Tab: Work ────────────────────────────────────────────────────────────────

function WorkTab({ emp }: { emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
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
        <div className="grid sm:grid-cols-2 gap-3 p-4 bg-white rounded-xl border border-border/40">
          <InfoRow icon={Briefcase} label="Department"    value={department?.name} />
          <InfoRow icon={Briefcase} label="Designation"   value={designation?.title} />
          <InfoRow icon={MapPin}    label="Branch"        value={branch?.name} />
          <InfoRow icon={Briefcase} label="Employment Type" value={emp.employmentType?.replace('_', ' ')} />
          {emp.ctcAnnual && (
            <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0 col-span-2">
              <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-text-secondary">₹</span>
              </div>
              <div>
                <p className="text-xs text-text-secondary">CTC (Annual)</p>
                <p className="text-sm text-slate-200">₹{emp.ctcAnnual.toLocaleString('en-IN')}</p>
              </div>
            </div>
          )}
        </div>

        {/* Date milestones — read-only, set via lifecycle mutations */}
        <div className="grid sm:grid-cols-2 gap-3 p-4 bg-white rounded-xl border border-border/40">
          <InfoRow icon={Calendar} label="Joining Date"        value={emp.dateOfJoining      ? format(new Date(emp.dateOfJoining),      'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Confirmation Date"   value={emp.confirmationDate   ? format(new Date(emp.confirmationDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Probation End"       value={emp.probationEndDate   ? format(new Date(emp.probationEndDate),   'd MMM yyyy') : undefined} />
          <InfoRow icon={Calendar} label="Last Working Day"    value={emp.lastWorkingDay     ? format(new Date(emp.lastWorkingDay),     'd MMM yyyy') : undefined} />
        </div>
      </div>

      <Can code={P.HRMS_EMPLOYEE_WRITE}>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit Work Details</Button>
      </Can>

      <Drawer open={open} onOpenChange={setOpen} title="Edit Work Details">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Department</label>
            <select {...register('departmentId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Designation</label>
            <select {...register('designationId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {designations.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Branch</label>
            <select {...register('branchId')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="">— None —</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Employment Type</label>
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
      </Drawer>
    </>
  )
}

// ── Tab: Documents ────────────────────────────────────────────────────────────
// TODO[backend]: POST /v1/employees/{id}/profile/documents (multipart/form-data, S3-compatible storage) — file upload stays out of scope for Phase 1

function DocumentsTab({ employeeId }: { employeeId: string }) {
  const navigate = useNavigate()
  const [page, setPage] = useState(0)

  // Lazy-import hook to avoid circular deps; useMyLetters filtered by employee is not available,
  // so we use the generated letters list endpoint filtered client-side by employeeId.
  const { data, isLoading } = useQuery({
    queryKey: ['hrms', 'letters', 'generated', 'employee', employeeId, page],
    queryFn: () => apiJson<{ content: GeneratedLetterDto[]; totalElements: number; totalPages: number }>(
      `/v1/letters/generated?page=${page}&size=10`
    ),
    select: r => ({ ...r, content: r.content.filter(l => l.employeeId === employeeId) }),
    staleTime: 30_000,
  })

  const letters = data?.content ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">Generated Letters</h3>
        <Can code={P.HRMS_LETTERS_GENERATE}>
          <button
            onClick={() => navigate(`/hrms/letters/generated?employeeId=${employeeId}`)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            <Plus size={12} />
            Generate letter
          </button>
        </Can>
      </div>

      {isLoading ? (
        <CardSkeleton />
      ) : letters.length === 0 ? (
        <EmptyState
          variant="first-run"
          title="No letters generated"
          description="Generate an offer, appointment, or experience letter for this employee."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-white">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">Subject</th>
                <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {letters.map(l => (
                <tr key={l.id} className="hover:bg-white/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="rounded-full px-2 py-0.5 text-xs font-medium bg-indigo-500/15 text-primary">{l.type}</span>
                  </td>
                  <td className="px-4 py-3 text-text-primary max-w-xs truncate">{l.subject}</td>
                  <td className="hidden md:table-cell px-4 py-3 text-text-secondary text-xs">
                    {format(new Date(l.createdAt), 'dd MMM yyyy')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx(
                      'rounded-full px-2 py-0.5 text-xs font-medium',
                      l.status === 'VOID' ? 'bg-red-500/15 text-red-300' :
                      l.status === 'SENT' ? 'bg-blue-500/15 text-blue-300' :
                      'bg-slate-500/15 text-text-primary'
                    )}>{l.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => navigate(`/hrms/letters/generated/${l.id}`)}
                      className="text-xs text-text-secondary hover:text-slate-200 transition-colors"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
    for (const l of structure?.lines ?? []) prefill[l.componentId] = String(l.monthlyAmount)
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
        <EmptyState variant="first-run" title="No salary structure" description="Define this employee's salary structure to enable payroll." />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white border border-border rounded-xl p-3"><p className="text-xs text-text-secondary">Annual CTC</p><p className="text-lg font-bold text-text-primary">{inr(structure.ctcAnnual)}</p></div>
            <div className="bg-white border border-border rounded-xl p-3"><p className="text-xs text-text-secondary">Monthly</p><p className="text-lg font-bold text-text-primary">{inr(structure.ctcMonthly)}</p></div>
            <div className="bg-white border border-border rounded-xl p-3"><p className="text-xs text-text-secondary">Tax regime</p><p className="text-lg font-bold text-text-primary">{structure.taxRegime}</p></div>
            <div className="bg-white border border-border rounded-xl p-3"><p className="text-xs text-text-secondary">PF status</p><p className="text-sm font-bold text-text-primary">{structure.pfApplicable ? structure.pfStatus : 'N/A'}</p></div>
          </div>
          {structure.lines.length > 0 && (
            <div className="bg-white border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase tracking-wider"><th className="px-4 py-2.5">Component</th><th className="px-4 py-2.5">Monthly</th><th className="px-4 py-2.5">Annual</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {structure.lines.map(l => (
                    <tr key={l.componentId}><td className="px-4 py-2.5 text-slate-800">{l.componentName}</td><td className="px-4 py-2.5">{inr(l.monthlyAmount)}</td><td className="px-4 py-2.5 text-slate-500">{inr(l.monthlyAmount * 12)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {history.length > 1 && (
        <div>
          <h3 className="text-sm font-bold text-text-primary mb-2">History</h3>
          <div className="bg-white border border-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 text-left text-xs font-bold text-slate-500 uppercase tracking-wider"><th className="px-4 py-2.5">Effective</th><th className="px-4 py-2.5">CTC</th><th className="px-4 py-2.5">Status</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {history.map(h => (
                  <tr key={h.id}><td className="px-4 py-2.5">{format(new Date(h.effectiveFrom), 'd MMM yyyy')}</td><td className="px-4 py-2.5">{inr(h.ctcAnnual)}</td><td className="px-4 py-2.5">{h.isCurrent ? <Badge tone="success">Current</Badge> : <Badge tone="default">Past</Badge>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {open && (
        <Drawer open={open} onOpenChange={(o) => !o && setOpen(false)} title="Salary structure">
          <div className="space-y-4">
            <Field label="Annual CTC (₹)" required><Input type="number" value={ctc} onChange={(e) => setCtc(e.target.value)} /></Field>
            <Field label="Effective from"><Input type="date" value={effFrom} onChange={(e) => setEffFrom(e.target.value)} /></Field>
            <Field label="Tax regime">
              <select value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as 'OLD' | 'NEW')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm">
                <option value="NEW">New regime</option><option value="OLD">Old regime</option>
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={pfApplicable} onChange={(e) => setPfApplicable(e.target.checked)} className="h-4 w-4 rounded accent-primary" /> PF applicable
            </label>
            {ctcComponents.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monthly component amounts</p>
                {ctcComponents.map(c => (
                  <Field key={c.id} label={c.name}>
                    <Input type="number" value={lines[c.id] ?? ''} onChange={(e) => setLines(p => ({ ...p, [c.id]: e.target.value }))} placeholder="0" />
                  </Field>
                ))}
              </div>
            )}
            <Button className="w-full" loading={upsert.isPending} onClick={save}>Save structure</Button>
          </div>
        </Drawer>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export const EmployeeDetail: React.FC = () => {
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
        <EmptyState
          variant="error"
          title="Failed to load employee"
          description={(empError as Error).message}
          primaryAction={{ label: 'Retry', onClick: () => navigate(0) }}
          secondaryAction={{ label: 'Back', onClick: () => navigate('/hrms/employees') }}
        />
      </div>
    )
  }

  if (!emp) {
    return (
      <div className="p-6">
        <EmptyState
          variant="filtered"
          title="Employee not found"
          primaryAction={{ label: 'Back to employees', onClick: () => navigate('/hrms/employees') }}
        />
      </div>
    )
  }

  const fullName   = [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(' ')
  const initials   = (emp.firstName[0] ?? '') + (emp.lastName?.[0] ?? emp.firstName[1] ?? '')
  const statusInfo = STATUS_STYLE[emp.employmentStatus ?? ''] ?? { label: emp.employmentStatus ?? '—', tone: 'default' as const }

  const handleConfirm = async () => {
    try {
      await confirmMutation.mutateAsync({ id: emp.id, confirmationDate: confirmDate })
      toast.success('Employee confirmed')
      setModal(null)
    } catch { toast.error('Failed to confirm employee') }
  }

  const handleNotice = async () => {
    if (!lastDay) { toast.error('Last working day is required'); return }
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

  return (
    <div className="space-y-5">
      {/* Back nav */}
      <button onClick={() => navigate('/hrms/employees')} className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors">
        <ArrowLeft size={15} /> Back to Employees
      </button>

      {/* Profile card */}
      <div className="bg-white border border-border rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white text-xl font-bold flex-shrink-0">
            {initials.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-lg font-bold text-text-primary">{fullName}</h1>
                <p className="text-text-secondary text-sm">{emp.employeeCode}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                <button onClick={() => setShowEdit(true)} className="p-2 bg-white hover:bg-surface-2 text-text-primary rounded-xl transition-colors">
                  <Edit3 size={14} />
                </button>
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
              <button onClick={() => setModal('confirm')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg text-xs font-medium transition-colors">
                <UserCheck size={13} /> Confirm Probation
              </button>
            )}
            {emp.employmentStatus === 'ACTIVE' && (
              <button onClick={() => setModal('notice')} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 rounded-lg text-xs font-medium transition-colors">
                <AlertTriangle size={13} /> Start Notice
              </button>
            )}
            {emp.employmentStatus === 'NOTICE_PERIOD' && (
              <button onClick={() => setModal('cancel-notice')} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 rounded-lg text-xs font-medium transition-colors">
                <UserCheck size={13} /> Cancel Notice
              </button>
            )}
            {emp.employmentStatus === 'NOTICE_PERIOD' && (
              <button onClick={() => setModal('exit')} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 text-red-400 hover:bg-red-500/20 rounded-lg text-xs font-medium transition-colors">
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
              <button onClick={() => setModal('notice')} className="px-3 py-1.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-bold transition-colors">
                Begin exit
              </button>
            </div>
          </Can>
        </div>
      )}

      {/* Profile tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
          <TabsTrigger value="work">Work</TabsTrigger>
          {canReadIdentity && <TabsTrigger value="identity">Identity</TabsTrigger>}
          {canReadBank     && <TabsTrigger value="bank">Bank</TabsTrigger>}
          {canReadSalary   && <TabsTrigger value="salary">Salary</TabsTrigger>}
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="dependents">Dependents</TabsTrigger>
          <TabsTrigger value="emergency">Emergency</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <div className="mt-4">
          <TabsContent value="overview">
            <OverviewTab emp={emp} departments={departments} designations={designations} branches={branches} companies={companies} />
          </TabsContent>

          <TabsContent value="contact">
            <ContactTab employeeId={emp.id} emp={emp} />
          </TabsContent>

          <TabsContent value="work">
            <WorkTab emp={emp} />
          </TabsContent>

          {canReadIdentity && (
            <TabsContent value="identity">
              <IdentityTab employeeId={emp.id} />
            </TabsContent>
          )}

          {canReadBank && (
            <TabsContent value="bank">
              <BankTab employeeId={emp.id} />
            </TabsContent>
          )}

          {canReadSalary && (
            <TabsContent value="salary">
              <SalaryTab employeeId={emp.id} companyId={emp.companyId} />
            </TabsContent>
          )}

          <TabsContent value="education">
            <EducationTab employeeId={emp.id} />
          </TabsContent>

          <TabsContent value="experience">
            <ExperienceTab employeeId={emp.id} />
          </TabsContent>

          <TabsContent value="dependents">
            <DependentsTab employeeId={emp.id} />
          </TabsContent>

          <TabsContent value="emergency">
            <EmergencyTab employeeId={emp.id} />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab employeeId={id ?? ''} />
          </TabsContent>
        </div>
      </Tabs>

      {/* Lifecycle modals */}
      {modal === 'confirm' && (
        <ActionModal title="Confirm Probation" description="Set the confirmation date for this employee." confirm="Confirm Employee" onConfirm={handleConfirm} onClose={() => setModal(null)} isLoading={confirmMutation.isPending}>
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">Confirmation Date</label>
            <input type="date" value={confirmDate} onChange={(e) => setConfirmDate(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
          </div>
        </ActionModal>
      )}

      {modal === 'extend' && (
        <ActionModal title="Extend Probation" description="Set a new probation end date for this employee." confirm="Extend Probation" onConfirm={handleExtend} onClose={() => setModal(null)} isLoading={extendMutation.isPending}>
          <div>
            <label className="block text-xs text-text-secondary mb-1.5">New Probation End Date *</label>
            <input type="date" value={extendDate} onChange={(e) => setExtendDate(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
          </div>
        </ActionModal>
      )}

      {modal === 'notice' && (
        <ActionModal title="Start Notice Period" description="Record the employee's resignation and notice period." confirm="Start Notice" onConfirm={handleNotice} onClose={() => setModal(null)} isLoading={noticeMutation.isPending}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Notice Start Date</label>
              <input type="date" value={noticeStart} onChange={(e) => setNoticeStart(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Last Working Day *</label>
              <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary" />
            </div>
          </div>
        </ActionModal>
      )}

      {modal === 'exit' && (
        <ActionModal title="Mark Employee as Exited" description="Record the employee's final exit from the organisation." confirm="Mark Exited" onConfirm={handleExit} onClose={() => setModal(null)} isLoading={exitMutation.isPending}>
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Last Working Day *</label>
              <input type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary" />
            </div>
            <div>
              <label className="block text-xs text-text-secondary mb-1.5">Exit Reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" className="w-full bg-white border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-slate-500 focus:outline-none focus:border-primary" />
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
