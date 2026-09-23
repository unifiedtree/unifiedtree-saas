/**
 * Personal — the employee's own details.
 *
 * Six formerly-separate tabs (Contact, Identity, Education, Experience,
 * Dependents, Emergency) collapsed into one section with sub-headings. They
 * were never distinct *facets* of the employee, only distinct API calls, and
 * eleven tabs of which six said "more profile fields" buried the operational
 * ones (Attendance, Payroll, Documents) the page exists for.
 *
 * Each block keeps its own permission gate and its own loading/empty/error
 * state, so one failing endpoint cannot blank the others.
 */

import React, { useState } from 'react'
import { format } from 'date-fns'
import { SectionState, SubSection, InfoRow } from './shared'
import type {
  EmployeeAddress, EmployeeIdentityResponse, EmployeeBankAccountResponse,
  EmployeeEducation, EmployeeExperience, EmployeeDependent, EmergencyContact,
} from '../../api/useEmployeeProfile'
import {
  AddressForm, ContactForm, DependentForm, EducationForm, ExperienceForm, IdentityForm, PiiField, addressSchema, dependentSchema, educationSchema, emergencyContactSchema, experienceSchema, identitySchema, maskAadhaar, maskPan, maskPassport,
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
import { EmptyState } from '@/shared/components/EmptyState'
import { Calendar, FileText, Mail, Phone, Plus, Trash2, User as UserIcon, XCircle } from 'lucide-react'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { useWorkforceEmployee, useUpdateWorkforceEmployee, useEmployeesByIds } from '../../api/useWorkforce'
import { zodResolver } from '@hookform/resolvers/zod'

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
  if (error) return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      {/* Contact details from employee record */}
      <div className="ut-card grid sm:grid-cols-2 gap-3 mb-5 p-4">
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
        <EmptyState icon={FileText} title="No addresses" description="Add a permanent, current, or office address." />
      ) : (
        <div className="space-y-2">
          {data.map((addr) => (
            <div key={addr.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div>
                <div className="mb-1"><HrStatusPill tone="info">{addr.addressType}</HrStatusPill></div>
                <p className="text-sm text-text-primary">
                  {[addr.line1, addr.line2, addr.city, addr.state, addr.country, addr.pincode].filter(Boolean).join(', ')}
                </p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(addr.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Address">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-[13px] font-semibold text-text-primary mb-1">Address Type</label>
            <select {...register('addressType')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
              <option value="CURRENT">Current</option>
              <option value="PERMANENT">Permanent</option>
              <option value="OFFICE">Office</option>
            </select>
          </div>
          <Field label="Line 1" error={errors.line1?.message}><Input {...register('line1')} placeholder="Street address" /></Field>
          <Field label="Line 2" error={errors.line2?.message}><Input {...register('line2')} placeholder="Apt, suite, etc." /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="City" error={errors.city?.message}><Input {...register('city')} /></Field>
            <Field label="State" error={errors.state?.message}><Input {...register('state')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Country" error={errors.country?.message}><Input {...register('country')} defaultValue="India" /></Field>
            <Field label="Pincode" error={errors.pincode?.message}><Input {...register('pincode')} /></Field>
          </div>
          <Button type="submit" className="w-full" loading={createMut.isPending} disabled={!isDirty || !isValid}>Save Address</Button>
        </form>
      </HrDrawer>}
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
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-lg space-y-4">
      {identity && (
        <div className="ut-card space-y-3 p-4 mb-4">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="PAN" error={errors.pan?.message}><Input {...register('pan')} placeholder="ABCDE1234F" /></Field>
            <Field label="Aadhaar (12 digits)" error={errors.aadhaar?.message}><Input {...register('aadhaar')} placeholder="xxxxxxxxxxxx" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="UAN" error={errors.uan?.message}><Input {...register('uan')} /></Field>
            <Field label="ESIC Number" error={errors.esicNumber?.message}><Input {...register('esicNumber')} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Passport Number" error={errors.passportNumber?.message}><Input {...register('passportNumber')} /></Field>
            <Field label="Passport Expiry" error={errors.passportExpiry?.message}><Input {...register('passportExpiry')} type="date" /></Field>
          </div>
          <Button type="submit" loading={saveMut.isPending} disabled={!isDirty || !isValid}>Save Identity</Button>
        </div>
      </Can>
    </form>
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
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Education</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState icon={FileText} title="No education records" description="Add degrees and certifications." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeEducation[]).map((edu) => (
            <div key={edu.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{edu.degree}{edu.fieldOfStudy ? ` · ${edu.fieldOfStudy}` : ''}</p>
                  {edu.highest && <HrStatusPill tone="purple">Highest</HrStatusPill>}
                </div>
                <p className="text-xs text-text-secondary">{edu.institution}</p>
                {(edu.startYear || edu.endYear) && (
                  <p className="text-xs text-text-secondary">{edu.startYear ?? '?'} – {edu.endYear ?? 'Present'}</p>
                )}
                {edu.gradeOrPercentage && <p className="text-xs text-text-secondary">Grade/% : {edu.gradeOrPercentage}</p>}
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(edu.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Education">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Degree" required error={errors.degree?.message}><Input {...register('degree')} placeholder="B.Tech, MBA…" /></Field>
          <Field label="Field of Study" error={errors.fieldOfStudy?.message}><Input {...register('fieldOfStudy')} /></Field>
          <Field label="Institution" required error={errors.institution?.message}><Input {...register('institution')} /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Start Year" error={errors.startYear?.message}><Input {...register('startYear')} type="number" placeholder="2018" /></Field>
            <Field label="End Year" error={errors.endYear?.message}><Input {...register('endYear')} type="number" placeholder="2022" /></Field>
          </div>
          <Field label="Grade / Percentage" error={errors.gradeOrPercentage?.message}><Input {...register('gradeOrPercentage')} placeholder="8.5 CGPA / 85%" /></Field>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('highest')} className="rounded border-border bg-white" />
            Highest qualification
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </HrDrawer>}
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
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Experience</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState icon={FileText} title="No experience records" description="Add previous work experience." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeExperience[]).map((exp) => (
            <div key={exp.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{exp.companyName}</p>
                  {exp.current && <HrStatusPill tone="ok">Current</HrStatusPill>}
                </div>
                {exp.designation && <p className="text-xs text-text-secondary">{exp.designation}</p>}
                <p className="text-xs text-text-secondary">
                  {exp.startDate} – {exp.current ? 'Present' : (exp.endDate ?? '?')}
                  {exp.location ? ` · ${exp.location}` : ''}
                </p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(exp.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Experience">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Company Name" required error={errors.companyName?.message}><Input {...register('companyName')} /></Field>
          <Field label="Designation / Role" error={errors.designation?.message}><Input {...register('designation')} /></Field>
          {/* End Date hides while "currently working" — collapse to one column
              so Start Date doesn't strand beside a dead cell. */}
          <div className={isCurrent ? 'grid grid-cols-1 gap-y-5' : 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5'}>
            <Field label="Start Date" required error={errors.startDate?.message}><Input {...register('startDate')} type="date" /></Field>
            {!isCurrent && <Field label="End Date" error={errors.endDate?.message}><Input {...register('endDate')} type="date" /></Field>}
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('current')} className="rounded border-border bg-white" />
            Currently working here
          </label>
          <Field label="Location" error={errors.location?.message}><Input {...register('location')} /></Field>
          <Field label="Description" error={errors.description?.message}><Input {...register('description')} /></Field>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </HrDrawer>}
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
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Dependent</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState icon={FileText} title="No dependents" description="Add family members or dependents." />
      ) : (
        <div className="space-y-2">
          {(data as EmployeeDependent[]).map((dep) => (
            <div key={dep.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{dep.name}</p>
                  {dep.nominee && <HrStatusPill tone="purple">Nominee {dep.nomineePercentage ? `${dep.nomineePercentage}%` : ''}</HrStatusPill>}
                </div>
                <p className="text-xs text-text-secondary">{dep.relationship}{dep.gender ? ` · ${dep.gender}` : ''}</p>
                {dep.dateOfBirth && <p className="text-xs text-text-secondary">DOB: {dep.dateOfBirth}</p>}
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(dep.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Dependent">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" required error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Relationship" required error={errors.relationship?.message}><Input {...register('relationship')} placeholder="Spouse, Child, Parent…" /></Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-5">
            <Field label="Date of Birth" error={errors.dateOfBirth?.message}><Input {...register('dateOfBirth')} type="date" /></Field>
            <div>
              <label className="block text-[13px] font-semibold text-text-primary mb-1">Gender</label>
              <select {...register('gender')} className="w-full bg-white border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-primary">
                <option value="">Select</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('nominee')} className="rounded border-border bg-white" />
            Mark as nominee
          </label>
          {isNominee && (
            <Field label="Nominee %" error={errors.nomineePercentage?.message}><Input {...register('nomineePercentage')} type="number" min={0} max={100} /></Field>
          )}
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </HrDrawer>}
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
  if (error)     return <EmptyState icon={XCircle} title="Error" description="Failed to load data" action={{ label: 'Retry', onClick: () => refetch() }} />

  return (
    <>
      <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
        <div className="flex justify-end mb-3">
          <Button size="sm" leftIcon={<Plus size={14} />} onClick={() => setOpen(true)}>Add Contact</Button>
        </div>
      </Can>

      {data.length === 0 ? (
        <EmptyState icon={FileText} title="No emergency contacts" description="Add at least one emergency contact." />
      ) : (
        <div className="space-y-2">
          {(data as EmergencyContact[]).map((c) => (
            <div key={c.id} className="ut-card ut-card-sm flex items-start justify-between p-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text-primary">{c.name}</p>
                  {c.isPrimary && <HrStatusPill tone="ok">Primary</HrStatusPill>}
                </div>
                {c.relationship && <p className="text-xs text-text-secondary">{c.relationship}</p>}
                <p className="text-xs text-text-secondary">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
              </div>
              <Can code={P.HRMS_EMPLOYEE_PROFILE_WRITE}>
                <button onClick={() => deleteMut.mutate(c.id)} className="p-1.5 text-text-secondary hover:text-red-600 transition-colors">
                  <Trash2 size={14} />
                </button>
              </Can>
            </div>
          ))}
        </div>
      )}

      {open && <HrDrawer onClose={() => setOpen(false)} title="Add Emergency Contact">
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <Field label="Name" required error={errors.name?.message}><Input {...register('name')} /></Field>
          <Field label="Relationship" error={errors.relationship?.message}><Input {...register('relationship')} placeholder="Spouse, Parent, Sibling…" /></Field>
          <Field label="Phone" error={errors.phone?.message}><Input {...register('phone')} type="tel" /></Field>
          <Field label="Email" error={errors.email?.message}><Input {...register('email')} type="email" /></Field>
          <label className="flex items-center gap-2 text-sm text-text-primary cursor-pointer">
            <input type="checkbox" {...register('isPrimary')} className="rounded border-border bg-white" />
            Primary contact
          </label>
          <Button type="submit" className="w-full" loading={addMut.isPending} disabled={!isDirty || !isValid}>Save</Button>
        </form>
      </HrDrawer>}
    </>
  )
}

// ── Section wrapper ──────────────────────────────────────────────────────────

/**
 * All six personal blocks, stacked, each behind the permission that already
 * guarded it as its own tab. Blocks the caller cannot read are omitted rather
 * than rendered empty — an empty "Identity" heading implies the employee has no
 * identity documents, which is a different claim from "you may not see them".
 */
export function EmployeePersonal({ emp }: {
  emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']>
}) {
  const canReadPii = usePermission(P.HRMS_EMPLOYEE_PROFILE_READ)
  const canReadIdentity = usePermission(P.HRMS_EMPLOYEE_IDENTITY_READ)

  if (!canReadPii && !canReadIdentity) {
    return (
      <SectionState
        error={{ status: 403 }}
        forbiddenTitle="You don’t have access to personal details"
        forbiddenHint="Contact, identity and background details need the employee profile permission."
      />
    )
  }

  return (
    <div className="space-y-8">
      {canReadPii && (
        <SubSection title="Contact & addresses">
          {/* Date of birth and gender live here rather than on the Overview.
              They were on the old Overview's contact card, and the 5A rewrite
              dropped them — while EmployeeForm still WRITES both, so an admin
              could set a DOB and never read it back. Personal is their right
              home: they are profile facts, not operational state. */}
          <div className="ut-card grid sm:grid-cols-2 gap-x-6 p-4 mb-3">
            <InfoRow icon={Mail} label="Work email" value={emp.email} />
            <InfoRow icon={Phone} label="Phone" value={emp.phone} />
            <InfoRow
              icon={Calendar}
              label="Date of birth"
              value={emp.dateOfBirth
                ? (() => { try { return format(new Date(emp.dateOfBirth), 'd MMM yyyy') } catch { return emp.dateOfBirth } })()
                : undefined}
            />
            <InfoRow icon={UserIcon} label="Gender" value={emp.gender?.replace(/_/g, ' ')} />
          </div>
          <ContactTab employeeId={emp.id} emp={emp} />
        </SubSection>
      )}
      {/* The hint below deliberately does NOT claim the reveal is audited.
          It is not: PiiField's unmask is local component state that fires no
          request, and GET /v1/employees/{id}/profile/identity emits no audit
          event — it is guarded by @perm.check('hrms.employee.identity.read')
          and nothing more. Telling a viewer they are being watched when they
          are not is a worse failure than saying nothing, because someone will
          rely on an audit trail that does not exist. */}
      {canReadIdentity && (
        <SubSection
          title="Identity documents"
          hint="Masked by default. Visible only with the identity-read permission."
        >
          <IdentityTab employeeId={emp.id} />
        </SubSection>
      )}
      {canReadPii && (
        <>
          <SubSection title="Education"><EducationTab employeeId={emp.id} /></SubSection>
          <SubSection title="Work experience"><ExperienceTab employeeId={emp.id} /></SubSection>
          <SubSection title="Dependents"><DependentsTab employeeId={emp.id} /></SubSection>
          <SubSection title="Emergency contacts"><EmergencyTab employeeId={emp.id} /></SubSection>
        </>
      )}
    </div>
  )
}
