import React, { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Camera, Loader2, Mail, Phone, MapPin, UserX } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrPageHeader, HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { EmptyState } from '@/shared/components/EmptyState'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { apiJson } from '@/core/api/client'
import { useDepartments } from '@/modules/hrms/api/useOrg'
import { useEmployeesByIds, type EmploymentStatus } from '@/modules/hrms/api/useWorkforce'
import {
  useCurrentUser,
  useUpdateCurrentUser,
  useUploadAvatar,
  type CurrentUser,
} from '@/shared/hooks/useCurrentUser'
import { DelegationCard } from './DelegationCard'

/**
 * Personal profile page.
 *
 * Split from Settings/Profile because that tab is read-only by design (the
 * workspace admin's company + billing view — no update endpoint at the time).
 * This page owns the PER-USER fields the backend does let the signed-in user
 * change on themselves via /v1/users/me: display name, contact phone, and the
 * avatar. Notification-preference toggles live here too so a user has one
 * screen for "everything about me" rather than hunting through Settings for
 * per-user vs per-workspace controls.
 *
 * Save posture:
 *   - avatar   goes via {@link useUploadAvatar} with optimistic + rollback,
 *              because a file upload is a discrete action that should reflect
 *              instantly and reads as broken if it doesn't
 *   - text     collected into a local diff and PUT via {@link useUpdateCurrentUser}
 *              on Save; unchanged fields are omitted so a partial patch
 *              never overwrites a value the user didn't touch
 *   - all writes invalidate the ['user','me'] key so the sidebar chip
 *              (which will read the same hook once the shell lands the SPA
 *              collision fix) updates in the same paint.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
// Must stay in step with UserAvatarController.ImageFormat on the backend.
// JPEG/PNG alone rejected real photos: iOS hands back image/heic from the
// camera roll and Android browsers commonly produce image/webp.
//
// Note the empty-string allowance in the check below — some browsers report
// an empty File.type for HEIC because they have no decoder for it. The backend
// sniffs magic bytes and is the real authority, so a blank type is passed
// through rather than blocked client-side.
const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp'

/**
 * The signed-in user's own employee row, as GET /v1/employees/me returns it
 * (backend EmployeeResponse — only the fields this page reads). That endpoint
 * is isAuthenticated() and resolves the row from the JWT, so it works for a
 * plain EMPLOYEE too, unlike /v1/hrms/employees/{id} (hrms.employee.read).
 */
interface MyEmployee {
  id: string
  companyId: string
  employeeCode: string
  jobTitle?: string | null
  employmentType?: string | null
  employmentStatus?: EmploymentStatus | null
  dateOfJoining?: string | null
  departmentId?: string | null
  managerId?: string | null
  workLocation?: string | null
}

const STATUS_PILL: Record<EmploymentStatus, { tone: PillTone; label: string }> = {
  ACTIVE: { tone: 'ok', label: 'Active' },
  PROBATION: { tone: 'pink', label: 'Probation' },
  NOTICE_PERIOD: { tone: 'warn', label: 'On notice' },
  SUSPENDED: { tone: 'red', label: 'Suspended' },
  EXITED: { tone: 'gray', label: 'Exited' },
  TERMINATED: { tone: 'red', label: 'Terminated' },
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', INTERN: 'Intern', CONSULTANT: 'Consultant',
}

function humanUploadError(status: number, fallback = 'Please try again.'): string {
  if (status === 413) return 'That image is over 5 MB. Please pick a smaller file.'
  if (status === 415) return "This image format isn't supported. Try JPG, PNG, WebP, HEIC or GIF."
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return "You don't have permission to change your avatar."
  if (status >= 500) return "Something went wrong on our end. We're on it."
  return fallback
}

export const Profile: React.FC = () => {
  const { data: user, isLoading, isError, refetch } = useCurrentUser()
  const update = useUpdateCurrentUser()
  const upload = useUploadAvatar()
  const { fullName, initials } = useDisplayName()

  // Employment details come from the user's linked employee row. Accounts with
  // no employee record (platform admins) skip the fetch and get an empty state
  // — never someone else's data or placeholder values.
  const employeeLinked = !!user?.employeeId
  const employee = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: () => apiJson<MyEmployee>('/v1/employees/me'),
    enabled: employeeLinked,
    staleTime: 60_000,
  })
  const emp = employee.data

  // Department / manager ids resolve to names only through endpoints the
  // caller may read; without the permission the row is hidden, not guessed.
  const canReadDepartments = usePermission(P.HRMS_DEPARTMENT_READ)
  const canReadEmployees = usePermission(P.HRMS_EMPLOYEE_READ)
  const departments = useDepartments(emp?.departmentId && canReadDepartments ? emp.companyId : '')
  const manager = useEmployeesByIds(emp?.managerId ? [emp.managerId] : [], {
    enabled: !!emp?.managerId && canReadEmployees,
  })
  const departmentName = emp?.departmentId
    ? departments.data?.find((d) => d.id === emp.departmentId)?.name
    : undefined
  const managerRow = emp?.managerId ? manager.data?.find((m) => m.id === emp.managerId) : undefined
  const managerName = managerRow
    ? [managerRow.firstName, managerRow.lastName].filter(Boolean).join(' ')
    : undefined
  const statusPill = emp?.employmentStatus ? STATUS_PILL[emp.employmentStatus] : undefined

  // Editable draft — never written directly to the query cache. On Save we
  // diff against the server row and only send changed fields.
  const [draft, setDraft] = useState<{
    displayName: string
    phone: string
    emailEnabled: boolean
    pushEnabled: boolean
  } | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // Seed the draft the first time the row arrives, and re-seed if the id
  // changes (e.g. impersonation swap).
  useEffect(() => {
    if (!user) return
    setDraft({
      displayName: user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' '),
      phone: user.phone ?? '',
      emailEnabled: user.notificationPreferences?.emailEnabled ?? true,
      pushEnabled: user.notificationPreferences?.pushEnabled ?? true,
    })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFile = () => inputRef.current?.click()

  const onFilePicked = (file: File | undefined) => {
    if (!file) return
    const declaredType = (file.type || '').toLowerCase()
    if (declaredType && !ACCEPTED_TYPES.split(',').includes(declaredType)) {
      toast.error('Unsupported file type', {
        description: 'Please choose a JPG, PNG, WebP, HEIC or GIF photo.',
      })
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error('Image too large', { description: 'Please pick a file 5 MB or smaller.' })
      return
    }
    upload.mutate(file, {
      onSuccess: () => toast.success('Avatar updated'),
      onError: (err) => {
        const status = (err as Error & { status?: number }).status ?? 0
        toast.error('Could not update avatar', { description: humanUploadError(status, (err as Error).message) })
      },
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  const onSave = () => {
    if (!user || !draft) return
    const patch: Partial<CurrentUser> = {}
    const originalDisplay = user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ')
    if (draft.displayName.trim() !== originalDisplay.trim()) {
      patch.displayName = draft.displayName.trim()
    }
    if ((draft.phone || '').trim() !== (user.phone ?? '').trim()) {
      patch.phone = draft.phone.trim() || null as unknown as string
    }
    const prevEmail = user.notificationPreferences?.emailEnabled ?? true
    const prevPush = user.notificationPreferences?.pushEnabled ?? true
    if (draft.emailEnabled !== prevEmail || draft.pushEnabled !== prevPush) {
      patch.notificationPreferences = {
        ...user.notificationPreferences,
        emailEnabled: draft.emailEnabled,
        pushEnabled: draft.pushEnabled,
      }
    }
    if (Object.keys(patch).length === 0) {
      toast.info('Nothing to save', { description: 'No changes were made.' })
      return
    }
    update.mutate(patch, {
      onSuccess: () => toast.success('Profile updated'),
      onError: (err) => toast.error('Could not save changes', { description: (err as Error).message }),
    })
  }

  const dirty = (() => {
    if (!user || !draft) return false
    const originalDisplay = user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ')
    return (
      draft.displayName.trim() !== originalDisplay.trim() ||
      (draft.phone || '').trim() !== (user.phone ?? '').trim() ||
      draft.emailEnabled !== (user.notificationPreferences?.emailEnabled ?? true) ||
      draft.pushEnabled !== (user.notificationPreferences?.pushEnabled ?? true)
    )
  })()

  return (
    <div className="animate-fade-in mx-auto max-w-4xl p-6 sm:p-8">
      <HrPageHeader
        crumb="My Account"
        title="Profile"
        subtitle="Your personal details, avatar and notification preferences."
      />

      <div className="ut-card ut-card-lg p-6 sm:p-8">
        {isLoading && !user ? (
          <ProfileSkeleton />
        ) : isError || !user ? (
          <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-5 text-sm text-[#B91C1C]">
            <p className="font-semibold">Couldn't load your profile</p>
            <p className="mt-1">This is usually a transient network problem.</p>
            <button
              onClick={() => refetch()}
              className="mt-3 rounded-lg border border-[#FCA5A5] px-3 py-1.5 text-xs font-medium hover:bg-[#FEE2E2]"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* Hidden file input drives the "Change photo" button. */}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              className="hidden"
              onChange={(e) => onFilePicked(e.target.files?.[0])}
            />

            {/* ── Profile Grid ────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {/* Left Col: Avatar & Info */}
              <div className="md:col-span-1 rounded-2xl border border-border-default bg-bg-base p-6 text-center shadow-sm">
                <div className="relative mx-auto mb-4 h-24 w-24">
                  <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#059669] to-[#047857]">
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <span className="text-2xl font-bold text-white select-none">{initials}</span>
                    )}
                  </div>
                  {upload.isPending && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                      <Loader2 size={18} className="animate-spin text-white" />
                    </div>
                  )}
                </div>
                <h3 className="text-lg font-bold text-text-primary">{fullName}</h3>
                {emp?.jobTitle && <p className="text-sm text-text-secondary mb-3">{emp.jobTitle}</p>}

                {statusPill && <HrStatusPill tone={statusPill.tone}>{statusPill.label}</HrStatusPill>}

                <div className="mt-5 border-t border-border-default pt-4 text-left text-sm text-text-secondary space-y-3">
                  <div className="flex items-center gap-2 break-all">
                    <Mail size={14} className="shrink-0 text-text-tertiary" /> {user.email}
                  </div>
                  {user.phone && (
                    <div className="flex items-center gap-2">
                      <Phone size={14} className="shrink-0 text-text-tertiary" /> {user.phone}
                    </div>
                  )}
                  {emp?.workLocation && (
                    <div className="flex items-center gap-2">
                      <MapPin size={14} className="shrink-0 text-text-tertiary" /> {emp.workLocation}
                    </div>
                  )}
                </div>

                <div className="mt-5 flex justify-center">
                  <HrButton size="sm" onClick={chooseFile} disabled={upload.isPending}>
                    <Camera size={14} className="mr-1.5" />
                    {upload.isPending ? 'Uploading…' : 'Change photo'}
                  </HrButton>
                </div>
              </div>

              {/* Right Col: Employment — GET /v1/employees/me. The old bank card
                  is gone: it only ever showed placeholder values. */}
              <div className="md:col-span-2 rounded-2xl border border-border-default bg-bg-base p-6 shadow-sm">
                <h3 className="mb-4 border-b border-border-default pb-3 text-sm font-semibold text-text-primary">
                  Employment
                </h3>
                {!employeeLinked ? (
                  <EmptyState
                    icon={UserX}
                    title="No employee record linked to this login"
                    description="Employment details appear here once HR links your account to an employee record."
                  />
                ) : employee.isLoading ? (
                  <div className="grid grid-cols-2 gap-y-4 gap-x-6" role="status" aria-label="Loading employment details">
                    {[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}
                  </div>
                ) : employee.isError || !emp ? (
                  <div className="rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] p-4 text-sm text-[#B91C1C]">
                    <p className="font-semibold">Couldn't load your employment details</p>
                    <button
                      onClick={() => employee.refetch()}
                      className="mt-3 rounded-lg border border-[#FCA5A5] px-3 py-1.5 text-xs font-medium hover:bg-[#FEE2E2]"
                    >
                      Try again
                    </button>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-y-4 gap-x-6 text-sm">
                    <InfoItem label="Employee ID" value={emp.employeeCode} />
                    <InfoItem
                      label="Date of joining"
                      value={emp.dateOfJoining ? format(new Date(`${emp.dateOfJoining}T00:00:00`), 'd MMM yyyy') : undefined}
                    />
                    <InfoItem
                      label="Employment type"
                      value={emp.employmentType ? EMPLOYMENT_TYPE_LABEL[emp.employmentType] ?? emp.employmentType : undefined}
                    />
                    {(!emp.departmentId || departmentName) && <InfoItem label="Department" value={departmentName} />}
                    {(!emp.managerId || managerName) && <InfoItem label="Reporting manager" value={managerName} />}
                  </dl>
                )}
              </div>
            </div>

            <div className="my-8 h-px bg-border-subtle" />

            {/* ── Personal settings ─────────────────────────────────────── */}
            <section>
              <h3 className="mb-4 text-sm font-semibold text-text-primary">Personal settings</h3>
              <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
                <Field label="Display name">
                  <input
                    type="text"
                    value={draft?.displayName ?? ''}
                    onChange={(e) => setDraft(d => d && ({ ...d, displayName: e.target.value }))}
                    placeholder="How your name appears"
                    className="w-full rounded-xl border border-border-default bg-white px-4 py-2.5 text-sm text-text-primary outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
                  />
                </Field>
                <Field label="Contact phone" hint="Used for account recovery only.">
                  <input
                    type="tel"
                    value={draft?.phone ?? ''}
                    onChange={(e) => setDraft(d => d && ({ ...d, phone: e.target.value }))}
                    placeholder="+91 98xxxxxxxx"
                    className="w-full rounded-xl border border-border-default bg-white px-4 py-2.5 text-sm text-text-primary outline-none focus:border-[#059669] focus:ring-4 focus:ring-[#059669]/12"
                  />
                </Field>
                <Field label="Email address" hint="Change your email from the Security page.">
                  <input
                    type="email"
                    value={user.email}
                    readOnly
                    className="w-full cursor-default rounded-xl border border-border-default bg-[#F8FAFC] px-4 py-2.5 text-sm text-text-secondary"
                  />
                </Field>
              </div>
            </section>

            <div className="my-8 h-px bg-border-subtle" />

            {/* ── Approval delegation ─────────────────────────────────── */}
            <DelegationCard />

            <div className="my-8 h-px bg-border-subtle" />

            {/* ── Notification preferences ──────────────────────────────── */}
            <section>
              <h3 className="mb-1 text-sm font-semibold text-text-primary">Notification preferences</h3>
              <p className="mb-4 text-xs text-text-secondary">
                Choose how we reach you. See Settings → Notifications for the full per-event list.
              </p>
              <div className="space-y-3">
                <PrefRow
                  label="Email notifications"
                  desc="Approvals, payroll receipts, security alerts."
                  enabled={draft?.emailEnabled ?? true}
                  onChange={(v) => setDraft(d => d && ({ ...d, emailEnabled: v }))}
                />
                <PrefRow
                  label="Push notifications"
                  desc="In-app and mobile push for real-time events."
                  enabled={draft?.pushEnabled ?? true}
                  onChange={(v) => setDraft(d => d && ({ ...d, pushEnabled: v }))}
                />
              </div>
            </section>

            <div className="mt-8 flex justify-end gap-2 border-t border-border-subtle pt-6">
              <button
                type="button"
                disabled={!dirty || update.isPending}
                onClick={() => user && setDraft({
                  displayName: user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' '),
                  phone: user.phone ?? '',
                  emailEnabled: user.notificationPreferences?.emailEnabled ?? true,
                  pushEnabled: user.notificationPreferences?.pushEnabled ?? true,
                })}
                className="rounded-lg border border-border-default bg-white px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-subtle disabled:opacity-40"
              >
                Discard
              </button>
              <HrButton onClick={onSave} disabled={!dirty || update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </HrButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Small labelled field wrapper — kept private so the layout stays consistent. */
const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <div>
    <label className="mb-1.5 block text-[13px] font-semibold text-text-tertiary">{label}</label>
    {children}
    {hint && <p className="mt-1 text-[11px] text-text-tertiary">{hint}</p>}
  </div>
)

/** One read-only label/value pair in the Employment card; "—" when unset. */
const InfoItem: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
  <div>
    <dt className="text-xs text-text-tertiary mb-0.5">{label}</dt>
    <dd className="font-medium text-text-primary">{value || '—'}</dd>
  </div>
)

/** A single toggle row (label + description + switch), matching Settings.tsx's
 *  Toggle look so the whole platform speaks with one voice. */
const PrefRow: React.FC<{
  label: string
  desc: string
  enabled: boolean
  onChange: (v: boolean) => void
}> = ({ label, desc, enabled, onChange }) => (
  <div className="ut-card ut-card-sm flex items-center justify-between p-4">
    <div>
      <p className="text-sm font-medium text-text-primary">{label}</p>
      <p className="mt-0.5 text-xs text-text-secondary">{desc}</p>
    </div>
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      aria-pressed={enabled}
      aria-label={label}
      className={
        'relative inline-flex h-5 w-9 items-center rounded-full transition-colors ' +
        (enabled ? 'bg-[#059669]' : 'border border-border-default bg-bg-base')
      }
    >
      <span
        className={
          'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ' +
          (enabled ? 'translate-x-5' : 'translate-x-1')
        }
      />
    </button>
  </div>
)

/** Skeleton state shown while /v1/users/me is loading. */
const ProfileSkeleton: React.FC = () => (
  <div className="space-y-8" role="status" aria-label="Loading profile">
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
      <SkeletonBlock className="h-32 w-32 rounded-full" />
      <div className="flex-1 space-y-3">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-3 w-64 max-w-full" />
        <SkeletonBlock className="h-9 w-32 rounded-lg" />
      </div>
    </div>
    <div className="grid grid-cols-1 gap-x-4 gap-y-5 md:grid-cols-2">
      <SkeletonBlock className="h-16" />
      <SkeletonBlock className="h-16" />
      <SkeletonBlock className="h-16" />
    </div>
    <div className="space-y-3">
      <SkeletonBlock className="h-16" />
      <SkeletonBlock className="h-16" />
    </div>
  </div>
)

export default Profile
