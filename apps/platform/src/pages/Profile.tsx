import React, { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { Camera, Loader2, Mail, Phone, MapPin, UserX } from 'lucide-react'
import { usePermission, P } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, type PillTone } from '@/shared/components/hr'
import { DesignFrame } from '@/design/dc/DesignFrame'
import { SettingsPage, SettingsSection, SettingsGrid, SettingsInput, SettingsValue, SettingsToggleRow, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
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
import { MyDocumentsCard } from './MyDocumentsCard'
import { NotificationChoiceSections, useNotificationChoices } from './NotificationChoices'

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
  // The design's dark toasts, with the sonner-style calls this page already makes.
  const { toast: note, show, dismiss } = useSettingsToast()
  const toast = {
    success: (t: string) => show('ok', t),
    error: (t: string, o?: { description?: string }) => show('error', t, o?.description),
    info: (t: string, o?: { description?: string }) => show('ok', t, o?.description),
  }

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
  } | null>(null)
  // Notification choices (email / push master switches and per-event choices)
  // have their own draft from /v1/me/notification-preferences; the unsaved
  // bar below saves both.
  const notif = useNotificationChoices(!!user)

  const inputRef = useRef<HTMLInputElement>(null)

  // Seed the draft the first time the row arrives, and re-seed if the id
  // changes (e.g. impersonation swap).
  useEffect(() => {
    if (!user) return
    setDraft({
      displayName: user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' '),
      phone: user.phone ?? '',
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

  const onSave = async () => {
    if (!user || !draft) return
    const patch: Partial<CurrentUser> = {}
    const originalDisplay = user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ')
    if (draft.displayName.trim() !== originalDisplay.trim()) {
      patch.displayName = draft.displayName.trim()
    }
    if ((draft.phone || '').trim() !== (user.phone ?? '').trim()) {
      patch.phone = draft.phone.trim() || null as unknown as string
    }
    if (Object.keys(patch).length === 0 && !notif.dirty) {
      toast.info('Nothing to save', { description: 'No changes were made.' })
      return
    }
    try {
      await Promise.all([
        Object.keys(patch).length > 0 ? update.mutateAsync(patch) : Promise.resolve(),
        notif.dirty ? notif.save() : Promise.resolve(),
      ])
      toast.success('Profile updated')
    } catch (err) {
      toast.error('Could not save changes', { description: (err as Error).message })
    }
  }

  const dirty = (() => {
    if (!user || !draft) return false
    const originalDisplay = user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ')
    return (
      draft.displayName.trim() !== originalDisplay.trim() ||
      (draft.phone || '').trim() !== (user.phone ?? '').trim() ||
      notif.dirty
    )
  })()
  const changeCount = !user || !draft ? 0 : [
    draft.displayName.trim() !== (user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' ')).trim(),
    (draft.phone || '').trim() !== (user.phone ?? '').trim(),
  ].filter(Boolean).length + notif.changeCount
  const nameError = draft && !draft.displayName.trim() ? 'Enter the name to show' : undefined
  const phoneError = draft && draft.phone.trim() && !/^\+?[\d\s()-]{7,20}$/.test(draft.phone.trim()) ? 'Enter a phone number (digits, spaces, + and - only)' : undefined
  const errorCount = (nameError ? 1 : 0) + (phoneError ? 1 : 0)
  const discard = () => {
    if (!user) return
    setDraft({
      displayName: user.displayName ?? [user.firstName, user.lastName].filter(Boolean).join(' '),
      phone: user.phone ?? '',
    })
    notif.discard()
  }

  const nav: SettingsNavItem[] = [
    { key: 'me', label: 'Photo & contact', state: 'none' },
    { key: 'employment', label: 'Employment', state: 'none' },
    { key: 'details', label: 'Personal details', state: 'none', errors: errorCount },
    { key: 'delegation', label: 'Approval delegation', state: 'none' },
    { key: 'documents', label: 'My documents', state: 'none' },
    { key: 'notifications', label: 'Notifications', state: notif.draft ? (notif.draft.emailEnabled || notif.draft.pushEnabled ? 'on' : 'off') : 'none' },
    ...(notif.draft ? [
      { key: 'email', label: 'Email choices', state: notif.draft.emailEnabled ? 'on' as const : 'off' as const },
      { key: 'inapp', label: 'In-app choices', state: 'on' as const },
      { key: 'push', label: 'Phone push choices', state: notif.draft.pushEnabled ? 'on' as const : 'off' as const },
    ] : []),
  ]
  const joined = emp?.dateOfJoining ? format(new Date(`${emp.dateOfJoining}T00:00:00`), 'd MMM yyyy') : undefined

  return (
    <DesignFrame>
      <SettingsPage
        crumb="My Account" title="Profile" subtitle="Your personal details, avatar and notification preferences."
        nav={nav} access="edit" status={isLoading && !user ? 'loading' : isError || !user ? 'error' : 'live'} onRetry={() => { void refetch() }} entity="your profile"
        dirty={dirty} changeCount={changeCount} errorCount={errorCount}
        onGoToError={() => document.getElementById('st-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        saving={update.isPending || notif.saving} onSave={() => { if (!errorCount) void onSave() }} onDiscard={discard} toast={note} onDismissToast={dismiss}>
        {user && (
          <>
            {/* Hidden file input drives the "Change photo" button. */}
            <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={(e) => onFilePicked(e.target.files?.[0])} />

            <SettingsSection id="me" icon="userCheck" title={fullName} summary={[emp?.jobTitle, user.email].filter(Boolean).join(' · ')}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
                <div style={{ position: 'relative', width: 88, height: 88, flex: '0 0 auto' }}>
                  <div style={{ width: '100%', height: '100%', borderRadius: 999, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#059669,#047857)' }}>
                    {user.avatarUrl
                      ? <img src={user.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
                      : <span style={{ fontSize: 26, fontWeight: 700, color: '#fff', userSelect: 'none' }}>{initials}</span>}
                  </div>
                  {upload.isPending && <div style={{ position: 'absolute', inset: 0, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.4)' }}><Loader2 size={18} className="animate-spin text-white" /></div>}
                </div>
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 8, fontSize: 13.5, color: '#475569' }}>
                  {statusPill && <span><HrStatusPill tone={statusPill.tone}>{statusPill.label}</HrStatusPill></span>}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, wordBreak: 'break-all' }}><Mail size={14} className="shrink-0 text-text-tertiary" />{user.email}</span>
                  {user.phone && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Phone size={14} className="shrink-0 text-text-tertiary" />{user.phone}</span>}
                  {emp?.workLocation && <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><MapPin size={14} className="shrink-0 text-text-tertiary" />{emp.workLocation}</span>}
                </div>
                <HrButton variant="ghost" onClick={chooseFile} disabled={upload.isPending}>
                  <Camera size={14} className="mr-1.5" />{upload.isPending ? 'Uploading…' : 'Change photo'}
                </HrButton>
              </div>
              <SettingsNote>JPG, PNG, WebP, HEIC or GIF, up to 5 MB. Your photo changes as soon as it uploads.</SettingsNote>
            </SettingsSection>

            <SettingsSection id="employment" icon="briefcase" title="Employment" summary={!employeeLinked ? 'No employee record linked to this login' : emp ? [emp.employeeCode, joined && `joined ${joined}`].filter(Boolean).join(' · ') : 'From your employee record'}>
              {!employeeLinked ? (
                <EmptyState icon={UserX} title="No employee record linked to this login" description="Employment details appear here once HR links your account to an employee record." />
              ) : employee.isLoading ? (
                <div role="status" aria-label="Loading employment details"><SettingsGrid>{[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}</SettingsGrid></div>
              ) : employee.isError || !emp ? (
                <SettingsNote tone="amber">Couldn’t load your employment details. <button type="button" onClick={() => employee.refetch()} style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Try again</button></SettingsNote>
              ) : (
                <SettingsGrid>
                  <SettingsValue label="Employee ID" value={emp.employeeCode || '—'} />
                  <SettingsValue label="Date of joining" value={joined || '—'} />
                  <SettingsValue label="Employment type" value={emp.employmentType ? EMPLOYMENT_TYPE_LABEL[emp.employmentType] ?? emp.employmentType : '—'} />
                  {(!emp.departmentId || departmentName) && <SettingsValue label="Department" value={departmentName || '—'} />}
                  {(!emp.managerId || managerName) && <SettingsValue label="Reporting manager" value={managerName || '—'} />}
                </SettingsGrid>
              )}
            </SettingsSection>

            <SettingsSection id="details" icon="pencil" title="Personal details" summary="How your name appears, and a phone number for account recovery">
              <SettingsGrid min={220}>
                <SettingsInput label="Display name" value={draft?.displayName ?? ''} onChange={(v) => setDraft((d) => d && ({ ...d, displayName: v }))} placeholder="How your name appears" error={nameError} maxLength={120} />
                <SettingsInput label="Contact phone" value={draft?.phone ?? ''} onChange={(v) => setDraft((d) => d && ({ ...d, phone: v }))} placeholder="+91 98xxxxxxxx" hint="Used for account recovery only." error={phoneError} maxLength={20} />
                <SettingsValue label="Email address" value={user.email} />
              </SettingsGrid>
              <SettingsNote>Your sign-in email can’t be changed here. Ask your admin if it needs to change.</SettingsNote>
            </SettingsSection>

            <SettingsSection id="delegation" icon="users" title="Approval delegation" summary="Route your approvals to someone else while you’re away. Only requests submitted during the window move.">
              <DelegationCard bare />
            </SettingsSection>

            <SettingsSection id="documents" icon="fileText" title="My documents" summary="Upload your government IDs and other documents. HR verifies each one.">
              <MyDocumentsCard bare />
            </SettingsSection>

            <SettingsSection id="notifications" icon="bell" title="Notifications" summary={notif.draft ? `Email ${notif.draft.emailEnabled ? 'on' : 'off'} · push ${notif.draft.pushEnabled ? 'on' : 'off'}` : 'Loading your choices…'}>
              {notif.status === 'error' ? <SettingsNote tone="amber">Your notification choices couldn’t be loaded. <button type="button" onClick={notif.refetch} style={{ border: 0, padding: 0, background: 'none', color: '#047857', fontWeight: 600, cursor: 'pointer' }}>Try again</button></SettingsNote>
                : notif.draft && <>
                  <SettingsToggleRow label="Email notifications" detail="Reminder emails, and any event you switch on under Email choices. Turn off to stop them all." on={notif.draft.emailEnabled} onToggle={() => notif.setMaster('emailEnabled', !notif.draft!.emailEnabled)} />
                  <SettingsToggleRow label="Push notifications" detail="Alerts on your phone from the mobile app. The bell in the app still lists them." on={notif.draft.pushEnabled} onToggle={() => notif.setMaster('pushEnabled', !notif.draft!.pushEnabled)} />
                  <SettingsNote>Password reset and invitation emails, billing alerts for admins and letters HR sends you always reach you, whatever you choose. Choose event by event below.</SettingsNote>
                </>}
            </SettingsSection>
            {notif.status === 'live' && <NotificationChoiceSections c={notif} email={user.email} masters={false} />}
          </>
        )}
      </SettingsPage>
    </DesignFrame>
  )
}

export default Profile
