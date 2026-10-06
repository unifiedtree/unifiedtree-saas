import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { Button, EmptyState, ErrorState, Section, Skeleton, type CalendarDay, type StatusTone } from '@/design/kit/display'
import { Dialog, PanelButton, useToast } from '@/design/kit/overlays'
import { useNavigationGuard } from '@/design/shell/navigationGuard'
import { SettingsPage, SettingsSection, SettingsToggleRow, SettingsNote, useSettingsToast, type SettingsNavItem } from '@/design/settings/SettingsKit'
import { istToday } from '@/design/dc/dates'
import { useDisplayName } from '@/shared/hooks/useDisplayName'
import { usePersonalPages } from '@/shared/hooks/usePersonalPages'
import { apiJson } from '@/core/api/client'
import type { EmploymentStatus, WorkforceEmployee } from '@/modules/hrms/api/useWorkforce'
import { useEmergencyContacts, useEmployeeAddresses } from '@/modules/hrms/api/useEmployeeProfile'
import { useMyEmployeeRecord } from '@/modules/hrms/api/shared/useMyEmployeeRecord'
import { useMyDocumentSummary } from '@/modules/hrms/api/useDocument'
import { dayCell } from '@/modules/hrms/attendance/daily/MyAttendance'
import {
  useInvitationStatus, useMyDocumentsIf, useMyGoalsIf, useMyLeaveBalancesIf, useMyMissingDocumentsIf, useMyMonthIf, useMyReviewsIf, useMyWeekIf,
} from '@/modules/hrms/employees/api/useProfileData'
import { ProfileFrame, type ProfileField } from '@/modules/hrms/employees/workspace/ProfileFrame'
import { AttentionList, EmploymentCard, GlanceRow, MonthCard, type Attention, type Glance } from '@/modules/hrms/employees/workspace/HrOverview'
import { EmployeePersonal } from '@/modules/hrms/employees/workspace/EmployeePersonal'
import { EmployeeLeave } from '@/modules/hrms/employees/workspace/EmployeeLeave'
import { EmployeeExpenses } from '@/modules/hrms/employees/workspace/EmployeeExpenses'
import { SelfAttendance, SelfJob, SelfLetters, SelfPay, SelfPerformance } from '@/modules/hrms/employees/workspace/SelfTabs'
import { daysUntil, fmtDate, fmtDateTime, hrs, plural, tenure } from '@/modules/hrms/employees/workspace/profileFormat'
import {
  useCurrentUser,
  useUpdateCurrentUser,
  useUploadAvatar,
  type CurrentUser,
} from '@/shared/hooks/useCurrentUser'
import { DelegationCard } from './DelegationCard'
import { MyDocumentsCard } from './MyDocumentsCard'
import { NotificationChoiceSections, useNotificationChoices } from './NotificationChoices'
import { MyFaceEnrollmentSection, useCanSelfEnrollFace } from '@/modules/hrms/attendance/face/FaceEnrollment'
import { AdminOverview, useAdminRoleLine } from './AdminProfile'
import { SecuritySettings } from './SettingsSecurity'

/**
 * My profile (/profile) — redesign (DECISIONS 17, option A): the prototype's PgProfile (self=true)
 * in the profile frame, with the person's own tabs and a Preferences tab.
 *
 * What the person can change is as today (DECISIONS 17 "self-edit"): their display name, the
 * contact phone of their login (Mobile, used for account recovery) and their photo, in the left
 * card (PUT /v1/users/me, changed fields only; the avatar via useUploadAvatar). First and last
 * name, city and emergency contacts are HR-owned and shown read-only (the person's own sections
 * are readable since BW-99).
 *
 * Tabs follow the person's own permissions; Attendance is hidden for admin roles (client rule).
 * Preferences keeps the settings anchors (#st-delegation, #st-notifications, #st-email,
 * #st-inapp, #st-push) and the "keep in view while sections above load" behaviour (SettingsPage).
 * #st-face (Overview) and #st-documents (Documents) open their tab too.
 * An account with no employee record keeps today's empty state.
 *
 * Without the personal pages (an admin role by default, usePersonalPages) the profile is an
 * administrator's (AdminProfile.tsx): Overview shows their role, companies, the business and their
 * recent activity, plus Sign-in & security and Preferences; no leave, attendance, pay or "My …" tabs,
 * and none of those reads are made.
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024 // 5 MB
// Must stay in step with UserAvatarController.ImageFormat on the backend. A blank File.type (some
// browsers for HEIC) is passed through: the backend sniffs magic bytes and is the real authority.
const ACCEPTED_TYPES = 'image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,image/bmp'

/** GET /v1/employees/me (only the fields this page reads). isAuthenticated(), from the token. */
interface MyEmployee {
  id: string
  companyId: string
  employeeCode: string
  firstName?: string | null
  lastName?: string | null
  email?: string | null
  phone?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  jobTitle?: string | null
  employmentType?: string | null
  employmentStatus?: EmploymentStatus | null
  dateOfJoining?: string | null
  departmentId?: string | null
  managerId?: string | null
  workLocation?: string | null
}

const STATUS: Record<string, [string, StatusTone]> = {
  ACTIVE: ['Active', 'brand'], PROBATION: ['Probation', 'mint'], NOTICE_PERIOD: ['On notice', 'warning'],
  SUSPENDED: ['Suspended', 'danger'], EXITED: ['Exited', 'muted'], TERMINATED: ['Terminated', 'danger'],
}
const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full time', PART_TIME: 'Part time', CONTRACT: 'Contract', INTERN: 'Intern', CONSULTANT: 'Consultant' }
// Which tab a settings anchor lives in.
const HASH_TAB: Record<string, string> = {
  me: 'overview', face: 'overview', employment: 'overview', details: 'overview',
  documents: 'documents', delegation: 'preferences', notifications: 'preferences', email: 'preferences', inapp: 'preferences', push: 'preferences',
  // The administrator's profile only (no such tab on the personal one: it opens Overview).
  password: 'security', twofa: 'security', sessions: 'security',
}
const PHONE_RX = /^\+?[\d\s()-]{7,20}$/

function humanUploadError(status: number, fallback = 'Please try again.'): string {
  if (status === 413) return 'That image is over 5 MB. Please pick a smaller file.'
  if (status === 415) return "This image format isn't supported. Try JPG, PNG, WebP, HEIC or GIF."
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return "You don't have permission to change your avatar."
  if (status >= 500) return "Something went wrong on our end. We're on it."
  return fallback
}

/** The scroll container the shell uses (the page scrolls inside it, not the window). */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement || null
  while (n) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; n = n.parentElement }
  return null
}

/**
 * Outside Preferences (which has SettingsPage's own handling): a "#st-<section>" link opens at that
 * section once it is drawn and keeps it in view while cards above it finish loading, until the
 * person scrolls or two seconds pass.
 */
function useKeepAnchor(active: boolean, rootRef: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (!active) return
    const h = window.location.hash.slice(1)
    if (!h.startsWith('st-')) return
    // Until the section is drawn (its card may wait for permissions or data) keep looking for up to
    // 10 s; once it is placed, keep it in place for 3 s while cards above it finish loading.
    const giveUpAt = Date.now() + 10_000
    let holdUntil = 0, ro: ResizeObserver | undefined, done = false
    const place = () => {
      const el = document.getElementById(h), sc = scrollerOf(rootRef.current)
      if (!el || !sc) return false
      sc.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 88) })
      return true
    }
    const release = () => { done = true; ro?.disconnect(); ro = undefined }
    const tick = () => {
      if (done) return
      const now = Date.now()
      if (holdUntil ? now > holdUntil : now > giveUpAt) { release(); return }
      if (place() && !holdUntil) holdUntil = now + 3000
    }
    const t = setTimeout(() => {
      tick()
      if (!done && rootRef.current && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(tick)
        ro.observe(rootRef.current)
      }
    }, 60)
    const userScroll = () => release()
    window.addEventListener('wheel', userScroll, { passive: true })
    window.addEventListener('touchmove', userScroll, { passive: true })
    window.addEventListener('keydown', userScroll)
    return () => {
      clearTimeout(t); release()
      window.removeEventListener('wheel', userScroll); window.removeEventListener('touchmove', userScroll); window.removeEventListener('keydown', userScroll)
    }
  }, [active, rootRef])
}

export const Profile: React.FC = () => {
  const { data: user, isLoading, isError, refetch } = useCurrentUser()
  const update = useUpdateCurrentUser()
  const upload = useUploadAvatar()
  const { fullName } = useDisplayName()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const today = istToday()
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── what the person may read about themselves ──
  const personal = usePersonalPages()
  const canCheckin = usePermission('attendance.checkin.self')
  const canPay = usePermission('payroll.structure.read.self'), canSlips = usePermission('payroll.payslip.read.self')
  const canLeave = usePermission('leave.request.self'), canClaims = usePermission('hrms.expense.claim.self')
  const canDocs = usePermission('hrms.document.read.self'), canLetters = usePermission('hrms.letters.read.self')
  const canPerf = usePermission('hrms.performance.review.self')
  const canFace = useCanSelfEnrollFace()
  // The client's rule: by default an admin's own profile has no Attendance (as My Attendance; the
  // personal pages rule, usePersonalPages: the owner sets it per role).
  const showAttendance = canCheckin && personal
  // An administrator's profile (no personal pages): none of the employee's own reads below.
  const admin = !personal
  const adminRoleLine = useAdminRoleLine()

  // ── data: the login, the employee row, the work record (BW-98), own sections (BW-99) ──
  const linked = !!user?.employeeId
  const employee = useQuery({
    queryKey: ['employee', 'me'],
    queryFn: () => apiJson<MyEmployee>('/v1/employees/me'),
    enabled: linked,
    staleTime: 60_000,
  })
  const emp = employee.data
  const selfId = emp?.id ?? user?.employeeId ?? ''
  const record = useMyEmployeeRecord({ enabled: linked })
  const rec = record.data
  const addresses = useEmployeeAddresses(linked && !admin ? selfId : '')
  const contacts = useEmergencyContacts(linked && !admin ? selfId : '')
  const invitation = useInvitationStatus(selfId, linked)
  const year = Number(today.slice(0, 4)), month = Number(today.slice(5, 7))
  const week = useMyWeekIf(linked && showAttendance)
  const monthQ = useMyMonthIf(year, month, linked && showAttendance)
  const balances = useMyLeaveBalancesIf(year, linked && canLeave && !admin)
  const docs = useMyDocumentsIf(linked && canDocs && !admin)
  const docSummary = useMyDocumentSummary(linked && canDocs && !admin)
  const missing = useMyMissingDocumentsIf(linked && canDocs && !admin)
  const goals = useMyGoalsIf(linked && canPerf && !admin)
  const reviews = useMyReviewsIf(linked && canPerf && !admin)
  const notif = useNotificationChoices(!!user)
  const { toast: prefToast, show: showPref, dismiss: dismissPref } = useSettingsToast()

  // ── the left card's editable fields (display name, Mobile = the login's recovery phone) ──
  const original = useMemo(() => ({
    displayName: (user?.displayName ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ')) || '',
    phone: user?.phone ?? '',
  }), [user?.displayName, user?.firstName, user?.lastName, user?.phone])
  const [draft, setDraft] = useState<{ displayName: string; phone: string } | null>(null)
  useEffect(() => { if (user) setDraft({ ...original }) }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const d = draft ?? original
  const nameError = !d.displayName.trim() ? 'Enter the name to show' : undefined
  const phoneError = d.phone.trim() && !PHONE_RX.test(d.phone.trim()) ? 'Enter a phone number (digits, spaces, + and - only)' : undefined
  const changeCount = (d.displayName.trim() !== original.displayName.trim() ? 1 : 0) + (d.phone.trim() !== original.phone.trim() ? 1 : 0)
  const changed = changeCount > 0
  const discardCard = () => setDraft({ ...original })
  // Typed changes in the card are never dropped silently: closing or reloading the tab asks (beforeunload),
  // and moving away inside the app (rail, top tabs, More) asks first too. Switching the profile's own
  // tabs keeps the card, so nothing is lost there.
  const [leave, setLeave] = useState<null | (() => void)>(null)
  useEffect(() => {
    if (!changed) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [changed])
  useNavigationGuard(changed ? (proceed) => { setLeave(() => proceed); return true } : null)
  const saveCard = async () => {
    if (!user || nameError || phoneError || !changed) return
    const patch: Partial<CurrentUser> = {}
    if (d.displayName.trim() !== original.displayName.trim()) patch.displayName = d.displayName.trim()
    if (d.phone.trim() !== original.phone.trim()) patch.phone = d.phone.trim() || (null as unknown as string)
    try { await update.mutateAsync(patch); toast.success('Profile updated') } catch (err) { toast.error('Could not save changes', { detail: (err as Error).message }) }
  }
  const onFilePicked = (file: File | undefined) => {
    if (!file) return
    const declared = (file.type || '').toLowerCase()
    if (declared && !ACCEPTED_TYPES.split(',').includes(declared)) { toast.error('Unsupported file type', { detail: 'Please choose a JPG, PNG, WebP, HEIC or GIF photo.' }); return }
    if (file.size > MAX_AVATAR_BYTES) { toast.error('Image too large', { detail: 'Please pick a file 5 MB or smaller.' }); return }
    upload.mutate(file, {
      onSuccess: () => toast.success('Avatar updated'),
      onError: (err) => toast.error('Could not update avatar', { detail: humanUploadError((err as Error & { status?: number }).status ?? 0, (err as Error).message) }),
    })
    if (inputRef.current) inputRef.current.value = ''
  }

  // ── tabs (by the person's own permissions; an administrator's: Overview, Sign-in & security, Preferences) ──
  const tabs = admin ? [
    { key: 'overview', label: 'Overview' },
    { key: 'security', label: 'Sign-in & security' },
    { key: 'preferences', label: 'Preferences' },
  ] : linked ? [
    { key: 'overview', label: 'Overview' },
    { key: 'personal', label: 'Personal' },
    { key: 'job', label: 'Job' },
    ...(showAttendance ? [{ key: 'attendance', label: 'Attendance' }] : []),
    ...(canPay || canSlips ? [{ key: 'pay', label: 'My pay' }] : []),
    ...(canLeave ? [{ key: 'leave', label: 'Leave' }] : []),
    ...(canClaims ? [{ key: 'expenses', label: 'Expenses' }] : []),
    ...(canDocs ? [{ key: 'documents', label: 'Documents', badge: docs.data?.totalElements || undefined }] : []),
    ...(canLetters ? [{ key: 'letters', label: 'Letters' }] : []),
    ...(canPerf ? [{ key: 'performance', label: 'Performance' }] : []),
    { key: 'preferences', label: 'Preferences' },
  ] : [{ key: 'overview', label: 'Overview' }, { key: 'preferences', label: 'Preferences' }]
  // A "#st-…" link picks its tab; otherwise ?tab= (replaced, so Back leaves the page).
  const hashTab = (() => { const h = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''; return h.startsWith('st-') ? HASH_TAB[h.slice(3)] : undefined })()
  const wanted = params.get('tab') || hashTab || 'overview'
  const active = tabs.some((t) => t.key === wanted) ? wanted : 'overview'
  const setTab = (k: string) => {
    const n = new URLSearchParams(params); if (k === 'overview') n.delete('tab'); else n.set('tab', k)
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    setParams(n, { replace: true })
  }
  useEffect(() => {
    const go = () => { const h = window.location.hash.slice(1); const t = h.startsWith('st-') ? HASH_TAB[h.slice(3)] : undefined; if (t && t !== (params.get('tab') || 'overview')) { const n = new URLSearchParams(params); if (t === 'overview') n.delete('tab'); else n.set('tab', t); setParams(n, { replace: true }) } }
    window.addEventListener('hashchange', go)
    return () => window.removeEventListener('hashchange', go)
  }, [params, setParams])
  useKeepAnchor(active !== 'preferences' && active !== 'security' && !!user, rootRef)

  if (isLoading && !user) {
    return (
      <div role="status" aria-label="Loading your profile" style={{ maxWidth: 1440, margin: '0 auto', padding: '28px clamp(16px,2.4vw,36px) 56px', display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <Skeleton style={{ flex: '0 1 340px', height: 520, borderRadius: 22 }} />
        <Skeleton style={{ flex: '1 1 620px', height: 520, borderRadius: 22 }} />
      </div>
    )
  }
  if (isError || !user) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '28px clamp(16px,2.4vw,36px) 56px' }}>
        <Section title="My profile" variant="section"><ErrorState title="Couldn’t load your profile" message="Something went wrong while loading. Nothing was changed — try again." onRetry={() => void refetch()} /></Section>
      </div>
    )
  }

  // ── left card ──
  const [stLabel, stTone] = emp?.employmentStatus ? STATUS[emp.employmentStatus] ?? [emp.employmentStatus, 'neutral' as StatusTone] : [null, 'neutral' as StatusTone]
  const city = (addresses.data ?? []).find((a) => a.addressType === 'CURRENT')?.city
  const contact = (contacts.data ?? [])[0]
  const activated = invitation.data?.activated ?? true
  const fields: ProfileField[] = [
    { key: 'first', label: 'First name', icon: 'user', value: user.firstName || emp?.firstName || '' },
    { key: 'last', label: 'Last name', icon: 'user', value: user.lastName || emp?.lastName || '' },
    { key: 'display', label: 'Display name', icon: 'user', edit: { value: d.displayName, onChange: (v) => setDraft({ ...d, displayName: v }), placeholder: 'How your name appears', error: nameError, maxLength: 120 } },
    { key: 'email', label: 'Email', icon: 'mail', value: user.email, verified: activated, verifiedLabel: 'Your sign-in email' },
    { key: 'mobile', label: 'Mobile', icon: 'phone', edit: { value: d.phone, onChange: (v) => setDraft({ ...d, phone: v }), placeholder: '+91 98xxxxxxxx', error: phoneError, maxLength: 20, inputMode: 'tel' } },
    ...(linked && !admin ? [
      { key: 'city', label: 'Current city', icon: 'pin' as const, value: city || '' },
      { key: 'contact', label: 'Emergency contact', icon: 'heart' as const, value: contact ? `${contact.name}${contact.relationship ? ` (${contact.relationship.toLowerCase()})` : ''}${contact.phone ? ` · ${contact.phone}` : ''}` : 'None on record' },
    ] : []),
  ]
  const footer = (
    <>
      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} hidden onChange={(e) => onFilePicked(e.target.files?.[0])} />
      <p className="upf-note">{admin ? 'Mobile is used for account recovery. Your first and last name come from your employee record.' : 'Mobile is used for account recovery. Your name, city and emergency contacts are kept by HR; ask them to change these.'}</p>
      {changed && (
        <div role="region" aria-label="Unsaved changes" className="upf-unsaved">
          <span aria-hidden="true" className="upf-unsaved__dot" />
          <span className="upf-unsaved__t">{`${changeCount} ${changeCount === 1 ? 'change' : 'changes'} · not saved yet`}</span>
          <Button size={30} variant="ghost" onClick={discardCard}>Discard</Button>
        </div>
      )}
      <div className="upf-update" style={{ justifyContent: 'space-between', gap: 8 }}>
        <Button size={40} variant="secondary" icon="upload" loading={upload.isPending} onClick={() => inputRef.current?.click()}>Change photo</Button>
        <Button size={40} variant="primary" loading={update.isPending} disabled={!changed || !!nameError || !!phoneError}
          title={nameError || phoneError || (!changed ? 'Change a field to update' : undefined)} onClick={() => void saveCard()}>Update</Button>
      </div>
    </>
  )

  // ── Overview ──
  const w = week.data
  const leaveLeft = (balances.data ?? []).reduce((n, b) => n + (b.available || 0), 0)
  // Exact counts over all your documents (BW-77); older servers fall back to the first page.
  const docSum = docSummary.data
  const docRows = docs.data?.content ?? []
  const docTotal = docSum ? docSum.onFile : docs.data?.totalElements
  const docPending = docSum ? docSum.waitingForHr : docTotal != null && docTotal <= docRows.length ? docRows.filter((x) => (x.verificationStatus || 'PENDING') === 'PENDING').length : null
  const goalList = (goals.data ?? []).filter((g) => g.status !== 'DROPPED')
  const onTrack = goalList.filter((g) => g.status === 'ACTIVE' || g.status === 'COMPLETED').length
  const glance: Glance[] = linked ? [
    ...(showAttendance ? [{ label: 'This week', value: w ? hrs(w.totalHours) : null, loading: week.isLoading, icon: 'clock', tone: 'brand' as const, note: w ? `${plural(w.presentDays, 'day')} present` : '', onClick: () => setTab('attendance') }] : []),
    ...(canLeave ? [{ label: 'Leave balance', value: balances.data ? `${Number.isInteger(leaveLeft) ? leaveLeft : leaveLeft.toFixed(1)} days` : null, loading: balances.isLoading, icon: 'calendarDays', tone: 'brand' as const, note: 'left this year', onClick: () => setTab('leave') }] : []),
    ...(canDocs ? [{ label: 'Documents', value: docTotal != null ? String(docTotal) : null, loading: docs.isLoading, icon: 'file', tone: docPending ? 'gold' as const : 'brand' as const, note: docPending ? `${docPending} waiting for review` : 'on record', onClick: () => setTab('documents') }] : []),
    ...(canPerf ? [{ label: 'Goals', value: goals.data ? (goalList.length ? `${onTrack} of ${goalList.length}` : '0') : null, loading: goals.isLoading, icon: 'target', tone: 'brand' as const, note: goalList.length ? 'on track' : 'none set yet', onClick: () => setTab('performance') }] : []),
  ] : []
  const probation = rec?.probationEndDate && !rec.confirmationDate && emp?.employmentStatus === 'PROBATION'
    ? (daysUntil(rec.probationEndDate, today) >= 0 ? `Ends in ${plural(daysUntil(rec.probationEndDate, today), 'day')} · ${fmtDate(rec.probationEndDate)}` : `Ended ${fmtDate(rec.probationEndDate)}`)
    : rec?.confirmationDate ? `Completed ${fmtDate(rec.confirmationDate)}` : '—'
  const employment = [
    { label: 'Designation', value: rec?.designationName || emp?.jobTitle || '—' },
    { label: 'Department', value: rec?.departmentName || '—' },
    // A company's own type (6 Oct 2026) shows its code tidied: "SEASONAL_STAFF" → "Seasonal staff".
    { label: 'Employment type', value: TYPE_LABEL[emp?.employmentType || ''] || (emp?.employmentType ? emp.employmentType.charAt(0) + emp.employmentType.slice(1).toLowerCase().replaceAll('_', ' ') : '—') },
    { label: 'Employee code', value: emp?.employeeCode || '—' },
    { label: 'Work location', value: emp?.workLocation || '—' },
    { label: 'Joined', value: emp?.dateOfJoining ? [fmtDate(emp.dateOfJoining), tenure(emp.dateOfJoining, today)].filter(Boolean).join(' · ') : '—' },
    { label: 'Probation', value: probation },
    { label: 'Reports to', value: rec?.managerName || '—' },
    ...(rec?.lastWorkingDay ? [{ label: 'Last working day', value: fmtDate(rec.lastWorkingDay) }] : []),
  ]
  const attention: Attention[] = []
  if (rec?.probationEndDate && !rec.confirmationDate && emp?.employmentStatus === 'PROBATION' && daysUntil(rec.probationEndDate, today) <= 30) attention.push({ tone: 'amber', title: daysUntil(rec.probationEndDate, today) >= 0 ? `Your probation ends in ${plural(daysUntil(rec.probationEndDate, today), 'day')}` : 'Your probation end date has passed', sub: `${fmtDate(rec.probationEndDate)} · HR or your manager confirms it` })
  if (emp?.employmentStatus === 'NOTICE_PERIOD') attention.push({ tone: 'amber', title: 'You are serving notice', sub: rec?.lastWorkingDay ? `Last working day ${fmtDate(rec.lastWorkingDay)}` : undefined })
  const miss = missing.data ?? []
  if (miss.length) attention.push({ tone: 'red', title: `${plural(miss.length, 'document')} still to upload`, sub: miss.slice(0, 3).map((m) => m.displayName).join(', ') + (miss.length > 3 ? '…' : ''), cta: { label: 'Upload', onClick: () => setTab('documents') } })
  if (docSum?.expired) attention.push({ tone: 'red', title: `${plural(docSum.expired, 'document')} expired`, sub: docSum.expiredTitles.slice(0, 3).join(', ') + (docSum.expiredTitles.length > 3 ? '…' : ''), cta: { label: 'Upload again', onClick: () => setTab('documents') } })
  const due = (reviews.data ?? []).filter((r) => r.status === 'PENDING' || r.status === 'IN_PROGRESS')
  if (due.length) attention.push({ tone: 'amber', title: due.length === 1 ? `Self-review to finish${due[0].cycleName ? ` · ${due[0].cycleName}` : ''}` : `${due.length} reviews to finish`, cta: { label: 'Review', onClick: () => setTab('performance') } })
  const cells: CalendarDay[] = (monthQ.data ?? []).map((x) => dayCell(x, today))
  const inv = invitation.data

  const overview = (
    <>
      {glance.length > 0 && <GlanceRow items={glance} />}
      {!linked ? (
        <Section title="Employment" variant="section">
          <EmptyState title="No employee record linked to this login" hint="Employment details appear here once HR links your account to an employee record." icon="userX" />
        </Section>
      ) : (
        <div className="upf-flow">
          <div className="upf-main">
            <EmploymentCard items={employment} />
            <Section title="Needs attention" variant="section" count={attention.length || undefined} countTone="gold" body="list"
              empty={attention.length ? undefined : { title: 'Nothing needs attention right now' }}>
              <AttentionList items={attention} />
            </Section>
          </div>
          <div className="upf-side">
            {showAttendance && <MonthCard ym={today.slice(0, 7)} days={cells} loading={monthQ.isLoading} error={monthQ.error} onRetry={() => void monthQ.refetch()} onOpen={() => setTab('attendance')} />}
            <Section title="Account" variant="section">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="upf-banner-ok">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3" /></svg>
                  Account active
                </div>
                <div className="upf-kvline"><span>Last sign-in</span><span>{inv?.lastLoginAt ? [fmtDateTime(inv.lastLoginAt, today), inv.lastLoginDevice].filter(Boolean).join(' · ') : '—'}</span></div>
              </div>
            </Section>
          </div>
        </div>
      )}
      {canFace && <MyFaceEnrollmentSection employeeLinked={linked} />}
    </>
  )

  // ── Preferences: approval delegation and notification choices (the settings anchors) ──
  const prefNav: SettingsNavItem[] = [
    { key: 'delegation', label: 'Approval delegation', state: 'none' },
    { key: 'notifications', label: 'Notifications', state: notif.draft ? (notif.draft.emailEnabled || notif.draft.pushEnabled ? 'on' : 'off') : 'none' },
    ...(notif.draft ? [
      { key: 'email', label: 'Email choices', state: notif.draft.emailEnabled ? 'on' as const : 'off' as const },
      { key: 'inapp', label: 'In-app choices', state: 'on' as const },
      { key: 'push', label: 'Phone push choices', state: notif.draft.pushEnabled ? 'on' as const : 'off' as const },
    ] : []),
  ]
  const preferences = (
    <SettingsPage
      crumb="My profile" title="Preferences" subtitle="Who approves for you while you’re away, and how you hear about things."
      nav={prefNav} access="edit" status="live" entity="your preferences"
      dirty={notif.dirty} changeCount={notif.changeCount} errorCount={0}
      saving={notif.saving}
      onSave={() => { notif.save().then(() => showPref('ok', 'Preferences saved'), (err: unknown) => showPref('error', 'Could not save changes', (err as Error)?.message)) }}
      onDiscard={notif.discard} toast={prefToast} onDismissToast={dismissPref}>
      <SettingsSection id="delegation" icon="users" title="Approval delegation" summary="Route your approvals to someone else while you’re away. Only requests submitted during the window move.">
        <DelegationCard bare />
      </SettingsSection>
      <SettingsSection id="notifications" icon="bell" title="Notifications" summary={notif.draft ? `Email ${notif.draft.emailEnabled ? 'on' : 'off'} · push ${notif.draft.pushEnabled ? 'on' : 'off'}` : 'Loading your choices…'}>
        {notif.status === 'error' ? <SettingsNote tone="amber">Your notification choices couldn’t be loaded. <button type="button" onClick={notif.refetch} style={{ border: 0, padding: 0, background: 'none', color: 'var(--u-brt,#0F6E56)', fontWeight: 600, cursor: 'pointer' }}>Try again</button></SettingsNote>
          : notif.draft && <>
            <SettingsToggleRow label="Email notifications" detail="Reminder emails, and any event you switch on under Email choices. Turn off to stop them all." on={notif.draft.emailEnabled} onToggle={() => notif.setMaster('emailEnabled', !notif.draft!.emailEnabled)} />
            <SettingsToggleRow label="Push notifications" detail="Alerts on your phone from the mobile app. The bell in the app still lists them." on={notif.draft.pushEnabled} onToggle={() => notif.setMaster('pushEnabled', !notif.draft!.pushEnabled)} />
            <SettingsNote>Password reset and invitation emails, billing alerts for admins and letters HR sends you always reach you, whatever you choose. Choose event by event below.</SettingsNote>
          </>}
      </SettingsSection>
      {notif.status === 'live' && <NotificationChoiceSections c={notif} email={user.email} masters={false} />}
    </SettingsPage>
  )

  // Personal reads the person's own sections with the employee row's facts.
  const asEmp = emp ? ({ ...emp, id: emp.id } as unknown as WorkforceEmployee) : null
  const callName = rec?.firstName || emp?.firstName || user.firstName || fullName
  const content = active === 'personal' && asEmp ? <EmployeePersonal emp={asEmp} self />
    : active === 'job' && emp ? <SelfJob me={emp} record={rec} recordMissing={record.notAvailable} />
      : active === 'attendance' ? <SelfAttendance />
        : active === 'pay' ? <SelfPay />
          : active === 'leave' && selfId ? <EmployeeLeave employeeId={selfId} firstName={callName} self />
            : active === 'expenses' && selfId ? <EmployeeExpenses employeeId={selfId} firstName={callName} self />
              : active === 'documents' && !admin ? (
                <SettingsSection id="documents" icon="fileText" title="My documents" summary="Upload your government IDs and other documents. HR verifies each one.">
                  <MyDocumentsCard bare />
                </SettingsSection>
              )
                : active === 'letters' ? <SelfLetters />
                  : active === 'performance' ? <SelfPerformance />
                    : active === 'preferences' ? preferences
                      : active === 'security' ? <SecuritySettings personal crumb="My profile" title="Sign-in & security" subtitle="Your password, two-factor sign-in and the devices you’re signed in on." />
                        : admin ? <AdminOverview userId={user.id} homeCompanyId={user.companyId} employeeId={linked ? selfId : null} onSecurity={() => setTab('security')} />
                          : overview

  return (
    <div ref={rootRef}>
      <Dialog open={!!leave} onClose={() => setLeave(null)} title="Leave without saving?" icon="alertTriangle" tone="warning"
        sub={`Your ${changeCount === 1 ? 'change' : `${changeCount} changes`} to your profile card ${changeCount === 1 ? 'isn’t' : 'aren’t'} saved yet.`}
        footer={<>
          <PanelButton onClick={() => setLeave(null)}>Keep editing</PanelButton>
          <PanelButton variant="danger" onClick={() => { const go = leave; setLeave(null); discardCard(); go?.() }}>Leave without saving</PanelButton>
        </>} />
      <ProfileFrame
        screenLabel="My profile"
        avatar={{ name: fullName, src: user.avatarUrl, checkedIn: !!w?.days?.find((x) => x.date === today && x.checkInTime && !x.checkOutTime) }}
        name={fullName}
        status={admin ? (adminRoleLine ? { label: adminRoleLine, tone: 'brand' } : null) : stLabel ? { label: stLabel, tone: stTone } : null}
        roleLine={admin ? [rec?.designationName || emp?.jobTitle, user.companyName].filter(Boolean).join(' · ') : [rec?.designationName || emp?.jobTitle, rec?.departmentName].filter(Boolean).join(' · ')}
        email={user.email}
        fields={fields}
        footer={footer}
        tabs={tabs}
        active={active}
        onTab={setTab}
      >
        {employee.isError && linked && !admin && active !== 'preferences' ? (
          <Section title="Your employee record" variant="section"><ErrorState title="Couldn’t load your employment details" error={employee.error} onRetry={() => void employee.refetch()} /></Section>
        ) : content}
      </ProfileFrame>
    </div>
  )
}

export default Profile
