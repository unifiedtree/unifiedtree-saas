// Where face enrollment shows up on the web:
//   - your own profile (/profile): a "Face enrollment" section, for everyone
//     who may enroll their own face (attendance.face.enroll.self);
//   - an employee's record (/hrms/employees/:id): Enroll / Re-enroll next to
//     the existing Reset, for HR / admin (attendance.face.admin.reset, the
//     permission described as "Reset / re-enroll an employee face").
// Each loads its own status, so a failure shows in that section only.
import { useState } from 'react'
import { P, usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { SettingsNote, SettingsSection } from '@/design/settings/SettingsKit'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { dashIcon } from '@/design/dc/icons'
import { useAuthStore } from '@/core/auth/authStore'
import { FaceEnrollDrawer } from './FaceEnrollDrawer'
import { describeFace, useFaceStatus, type FaceStatus } from './faceEnroll'

/** Face attendance is part of HRMS; without the module (or the permission) the profile doesn't offer it. */
export function useCanSelfEnrollFace(): boolean {
  const can = usePermission(P.ATTENDANCE_FACE_ENROLL_SELF)
  const hrms = useAuthStore((s) => s.tenant?.activeModules.includes('hrms') ?? false)
  return can && hrms
}

/** The profile's "Face enrollment" section: your status, and Enroll / Re-enroll. */
export function MyFaceEnrollmentSection({ employeeLinked }: { employeeLinked: boolean }) {
  const target = { kind: 'self' } as const
  const q = useFaceStatus(target, employeeLinked)
  // What was on record when the drawer opened (the status refetches once it's done).
  const [open, setOpen] = useState<{ reenroll: boolean; enrolledAt?: string | null } | null>(null)
  const d = q.data ? describeFace(q.data, true) : null
  const summary = !employeeLinked ? 'Needs an employee record'
    : q.isLoading ? 'Checking…' : d?.enrolled && !d.locked ? d.detail : 'Punch in with your face. Enroll it here with your camera.'

  return (
    <SettingsSection id="face" icon="scanFace" title="Face enrollment" summary={summary}>
      {!employeeLinked ? (
        <SettingsNote>Face punch-in is for people with an employee record. Ask HR to link your account to yours.</SettingsNote>
      ) : q.isLoading ? (
        <div role="status" aria-label="Loading face enrollment"><SkeletonBlock className="h-12" /></div>
      ) : q.isError || !d ? (
        <SettingsNote tone="amber">
          Couldn’t load your face enrollment.{' '}
          <button type="button" onClick={() => void q.refetch()} style={{ padding: 0, border: 0, background: 'none', font: 'inherit', fontWeight: 700, color: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>Try again</button>
        </SettingsNote>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px' }}>
            <span aria-hidden="true" style={{ flex: '0 0 auto', width: 48, height: 48, borderRadius: 14, display: 'grid', placeItems: 'center', background: d.enrolled ? '#ecfdf5' : '#f8fafc', border: `1px solid ${d.enrolled ? '#a7f3d0' : '#e2e8f0'}`, color: d.enrolled ? '#047857' : '#94a3b8' }}>{dashIcon('scanFace', 24)}</span>
            <div style={{ flex: '1 1 220px', minWidth: 0, display: 'grid', gap: 4 }}>
              <span><HrStatusPill tone={d.tone}>{d.label}</HrStatusPill></span>
              <span style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.45 }}>{d.detail}</span>
            </div>
            {d.canEnroll && (
              <HrButton variant={d.enrolled ? 'ghost' : 'primary'} onClick={() => setOpen({ reenroll: d.enrolled, enrolledAt: q.data?.enrolledAt })}>
                {d.enrolled ? 'Re-enroll' : 'Enroll my face'}
              </HrButton>
            )}
          </div>
          <SettingsNote>Used only to check it’s really you when you punch in with your face. You can re-enroll any time, for example after a new look. Your photos aren’t stored.</SettingsNote>
        </>
      )}
      {open && (
        <FaceEnrollDrawer target={target} reenroll={open.reenroll} enrolledAt={open.enrolledAt}
          onClose={() => setOpen(null)} onEnrolled={() => void q.refetch()} />
      )}
    </SettingsSection>
  )
}

/**
 * An employee's face status, for their record page. Only fetched for people who
 * may enroll others; everyone else keeps today's line from the employee record.
 */
export function useEmployeeFaceStatus(employeeId: string | undefined, enabled: boolean) {
  return useFaceStatus({ kind: 'employee', employeeId: employeeId ?? '', name: '' }, enabled && !!employeeId)
}

/** The status line for the record page's Face enrollment row; `fallback` is what the page showed before. */
export function employeeFaceLine(q: { data?: FaceStatus; isLoading: boolean }, fallback: string): string {
  if (q.data) { const d = describeFace(q.data, false); return d.enrolled && d.label === 'Enrolled' ? d.detail : d.label }
  return q.isLoading ? 'Checking…' : fallback
}

/** HR / admin: Enroll or Re-enroll this person's face with the web camera. */
export function EmployeeFaceEnrollButton({ employeeId, name, status, onEnrolled }: {
  employeeId: string; name: string; status: FaceStatus; onEnrolled: () => void
}) {
  const [open, setOpen] = useState<{ reenroll: boolean; enrolledAt?: string | null } | null>(null)
  const d = describeFace(status, false)
  if (!d.canEnroll && !open) return null
  return (
    <>
      <HrButton size="sm" variant="ghost" onClick={() => setOpen({ reenroll: d.enrolled, enrolledAt: status.enrolledAt })} data-tip={d.enrolled ? 'Takes new photos and replaces the face on record' : 'Takes photos with this computer’s camera'}>
        {d.enrolled ? 'Re-enroll face' : 'Enroll face'}
      </HrButton>
      {open && (
        <FaceEnrollDrawer target={{ kind: 'employee', employeeId, name }} reenroll={open.reenroll} enrolledAt={open.enrolledAt}
          onClose={() => setOpen(null)} onEnrolled={onEnrolled} />
      )}
    </>
  )
}
