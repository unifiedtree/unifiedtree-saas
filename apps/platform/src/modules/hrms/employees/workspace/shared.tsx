/**
 * Shared atoms for the employee workspace.
 *
 * Extracted from EmployeeDetail.tsx (Milestone 5A) so the eleven sections can
 * each own one domain instead of all of them living in a single 1,700-line
 * file. Nothing here changed behaviour — these are the same schemas, masks and
 * layout primitives the profile has always used, now importable.
 */

import React, { useState } from 'react'
import { Button, Field, Input, TableSkeleton, CardSkeleton } from '@unifiedtree/ui-kit'
import { Can, P, usePermission } from '@unifiedtree/sdk'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, Eye, EyeOff, FileText, Send } from 'lucide-react'
import { HrDrawer, HrStatusPill, HrButton, TableCard, type PillTone } from '@/shared/components/hr'
import { format } from 'date-fns'
import { resetFaceEnrollment } from '../api/useFaceAdmin'
import { sendInvite, resendInvite } from '../api/useInvitation'
import { toast } from 'sonner'
import { useWorkforceEmployee, useUpdateWorkforceEmployee, useEmployeesByIds } from '../../api/useWorkforce'
import { z } from 'zod'
import { EmptyState } from '@/shared/components/EmptyState'

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const addressSchema = z.object({
  addressType: z.enum(['PERMANENT', 'CURRENT', 'OFFICE']),
  line1: z.string().optional(),
  line2: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
  pincode: z.string().optional(),
})

// Empty string in a form input must not become a Zod validation failure — an
// admin who cleared a field expects "no value", not "invalid pattern". The
// unions accept "" as an explicit escape hatch before the format check runs.
export const PAN_RX     = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/
export const AADHAAR_RX = /^[0-9]{12}$/

export const identitySchema = z.object({
  pan: z.union([z.literal(''), z.string().regex(PAN_RX, 'PAN must be 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)')]).optional(),
  // 12-digit Aadhaar format check only — Verhoeff checksum deferred to backend.
  aadhaar: z.union([z.literal(''), z.string().regex(AADHAAR_RX, 'Aadhaar must be exactly 12 digits')]).optional(),
  uan: z.string().optional(),
  esicNumber: z.string().optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().optional(),
})

export const bankSchema = z.object({
  accountNumber: z.string().min(1, 'Required'),
  ifscCode: z.string().length(11, 'IFSC must be 11 characters'),
  bankName: z.string().optional(),
  branchName: z.string().optional(),
  accountHolderName: z.string().min(1, 'Required'),
  primary: z.boolean(),
})

export const educationSchema = z.object({
  degree: z.string().min(1, 'Required'),
  fieldOfStudy: z.string().optional(),
  institution: z.string().min(1, 'Required'),
  startYear: z.coerce.number().optional(),
  endYear: z.coerce.number().optional(),
  gradeOrPercentage: z.string().optional(),
  highest: z.boolean(),
})

export const experienceSchema = z.object({
  companyName: z.string().min(1, 'Required'),
  designation: z.string().optional(),
  startDate: z.string().min(1, 'Required'),
  endDate: z.string().optional(),
  current: z.boolean(),
  description: z.string().optional(),
  location: z.string().optional(),
})

export const dependentSchema = z.object({
  name: z.string().min(1, 'Required'),
  relationship: z.string().min(1, 'Required'),
  dateOfBirth: z.string().optional(),
  gender: z.string().optional(),
  nominee: z.boolean(),
  nomineePercentage: z.coerce.number().min(0).max(100).optional(),
})

export const emergencyContactSchema = z.object({
  name: z.string().min(1, 'Required'),
  relationship: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  isPrimary: z.boolean(),
})

export const workSchema = z.object({
  departmentId:       z.string().optional(),
  designationId:      z.string().optional(),
  branchId:           z.string().optional(),
  reportingManagerId: z.string().optional(),
  employmentType:     z.enum(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT']).optional(),
  // ctcAnnual accepts three shapes cleanly: undefined (field never touched),
  // "" (admin cleared it — treat as undefined), and a positive number. The
  // previous z.coerce.number().positive().optional() rejected "" because
  // Number("") === 0 which fails .positive(), blocking the whole form save.
  ctcAnnual: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().positive().optional(),
  ),
})

export type AddressForm   = z.infer<typeof addressSchema>
export type IdentityForm  = z.infer<typeof identitySchema>
export type BankForm      = z.infer<typeof bankSchema>
export type EducationForm = z.infer<typeof educationSchema>
export type ExperienceForm = z.infer<typeof experienceSchema>
export type DependentForm = z.infer<typeof dependentSchema>
export type ContactForm   = z.infer<typeof emergencyContactSchema>
export type WorkForm      = z.infer<typeof workSchema>

// ── Constants ─────────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<string, { label: string; tone: 'success' | 'warning' | 'error' | 'info' | 'default' }> = {
  ACTIVE:        { label: 'Active',        tone: 'success' },
  PROBATION:     { label: 'Probation',     tone: 'warning' },
  NOTICE_PERIOD: { label: 'Notice Period', tone: 'warning' },
  SUSPENDED:     { label: 'Suspended',     tone: 'warning' },
  EXITED:        { label: 'Exited',        tone: 'error'   },
  TERMINATED:    { label: 'Terminated',    tone: 'error'   },
}

// Map ui-kit Badge tones to client HR status-pill tones
export const PILL_TONE: Record<string, PillTone> = {
  success: 'ok',
  warning: 'warn',
  error:   'red',
  info:    'info',
  default: 'gray',
}

// ── PII helpers ───────────────────────────────────────────────────────────────

export function maskPan(pan: string) {
  if (!pan || pan.length < 5) return pan
  return pan.slice(0, 3) + '****' + pan.slice(-1)
}
export function maskAadhaar(last4: string) {
  return 'XXXX XXXX ' + last4
}
export function maskPassport(passport: string) {
  if (!passport || passport.length < 4) return passport
  return '****' + passport.slice(-4)
}

// ── Small helpers ─────────────────────────────────────────────────────────────

export function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string }) {
  if (!value) return null
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center flex-shrink-0">
        <Icon size={13} className="text-text-secondary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-text-secondary">{label}</p>
        <p className="text-sm text-text-primary truncate">{value}</p>
      </div>
    </div>
  )
}

export function SectionCard({ title, action, className, children }: { title: string; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={className ? `ut-card p-4 ${className}` : 'ut-card p-4'}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

export function ActionModal({
  title, description, confirm, onConfirm, onClose, isLoading, children,
}: {
  title: string; description: string; confirm: string; onConfirm: () => void;
  onClose: () => void; isLoading: boolean; children?: React.ReactNode
}) {
  return (
    <>
      <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[210] flex items-center justify-center p-4">
        <div className="ut-card ut-card-lg w-full max-w-md p-6">
          <h3 className="text-text-primary font-semibold mb-1">{title}</h3>
          <p className="text-text-secondary text-sm mb-4">{description}</p>
          {children}
          <div className="flex gap-3 mt-4">
            <button onClick={onClose} className="flex-1 py-2.5 border border-border text-text-secondary hover:text-text-primary rounded-xl text-sm transition-colors">Cancel</button>
            <button onClick={onConfirm} disabled={isLoading} className="flex-1 py-2.5 bg-[#059669] hover:bg-[#047857] disabled:opacity-50 text-white font-medium rounded-xl text-sm transition-colors">
              {isLoading ? 'Processing…' : confirm}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Account card (invitation status) ──────────────────────────────────────────

export function AccountCard({ emp }: { emp: NonNullable<ReturnType<typeof useWorkforceEmployee>['data']> }) {
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
export function FaceResetRow({ employeeId, employeeName }: { employeeId: string; employeeName: string }) {
  // Backend is @PreAuthorize attendance.face.admin.reset (V034 grants it to
  // SUPER_ADMIN + HR_MANAGER only). This row rendered for every viewer of the
  // card, so COMPANY_ADMIN / DEPT_MANAGER clicked it and got a red 403
  // (2026-09-08 audit). Hooks must run before the early return.
  const canResetFace = usePermission('attendance.face.admin.reset')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!canResetFace) return null
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


export function PiiField({ label, masked, full, show, onToggle }: { label: string; masked: string; full: string; show: boolean; onToggle: () => void }) {
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

// ── Uniform section state ─────────────────────────────────────────────────────

/**
 * Every workspace section has to answer four questions — loading, failed,
 * forbidden, empty — and before 5A each tab answered them slightly differently
 * (some rendered a bare `<TableSkeleton>`, some a blank div). A blank panel is
 * indistinguishable from "this employee has nothing", which is the one reading
 * a profile must never be ambiguous about.
 *
 * `403` is called out separately on purpose. Several employee-scoped endpoints
 * carry an object-scope guard on top of the permission — attendance, for
 * instance, is readable by HR/admin, the employee themselves, or their direct
 * manager, and returns 403 to anyone else even though they hold
 * `attendance.team.read`. "You can't see this employee's attendance" and
 * "this employee has no attendance" are completely different facts, so they get
 * completely different states.
 */
export function SectionState({
  isLoading, error, isEmpty, children,
  emptyIcon = FileText, emptyTitle = 'Nothing here yet', emptyHint,
  forbiddenTitle = 'You don’t have access to this', forbiddenHint,
  onRetry, skeleton,
}: {
  isLoading?: boolean
  error?: unknown
  isEmpty?: boolean
  children?: React.ReactNode
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyHint?: string
  forbiddenTitle?: string
  forbiddenHint?: string
  onRetry?: () => void
  skeleton?: React.ReactNode
}) {
  if (isLoading) return <>{skeleton ?? <TableSkeleton rows={3} cols={4} />}</>

  if (error) {
    const status = (error as { status?: number })?.status
    if (status === 403) {
      return (
        <EmptyState
          icon={EyeOff}
          title={forbiddenTitle}
          description={forbiddenHint ?? 'Your role doesn’t cover this employee’s record for this section.'}
        />
      )
    }
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn’t load this section"
        description={(error as Error)?.message || 'The request failed. The rest of the profile is unaffected.'}
        action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined}
      />
    )
  }

  if (isEmpty) return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyHint ?? ''} />

  return <>{children}</>
}

/** Heading for a block inside a stacked section (Personal, Payroll, …). */
export function SubSection({ title, hint, action, children }: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          {hint && <p className="text-xs text-text-tertiary mt-0.5">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}
