// A training program's page (/hrms/learning/programs/:id), restyled on the redesign kit (no
// prototype screen; same blocks as before).
//   - Everyone who can browse programs (hrms.learning.read) sees the details and
//     can enroll or leave (hrms.learning.enroll.self).
//   - hrms.learning.write edits the details (title, description, category, trainer, mode, place,
//     dates, seats), changes the status and runs the roster.
// The server enforces the edit rules: seats never below the people already enrolled, the end
// date not before the start date, and completed or cancelled programs keep their details.
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { Button, Callout, ErrorState, KeyValueGrid, PageFrame, PageHeader, Section, SkeletonStats, StatusPill, errorText } from '@/design/kit/display'
import { Dialog, PanelButton, Select, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useCompanies } from '../api/useOrg'
import {
  useChangeProgramStatus, useDropEnrollment, useEnroll, useMyEnrollments, useTrainingProgram, ALLOWED_TRANSITIONS, type ProgramStatus,
} from '../api/useLearning'
import { dateLong } from '../performance/growModel'
import { PROGRAM_LABEL, PROGRAM_TONE, ProgramFormPanel, ProgramRoster, isOpenEnrollment, modeLabel, schedule } from './programs'
import '../performance/grow.css'

export function ProgramDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const today = istToday()
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  const q = useTrainingProgram(id)
  const { data: companies = [] } = useCompanies()
  const mine = useMyEnrollments(canEnroll)
  const enroll = useEnroll()
  const leave = useDropEnrollment()
  const changeStatus = useChangeProgramStatus()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState<ProgramStatus | 'leave' | null>(null)
  const p = q.data
  const closed = p?.status === 'COMPLETED' || p?.status === 'CANCELLED'
  const myEnrollment = useMemo(() => (mine.data ?? []).find((e) => e.programId === id && isOpenEnrollment(e.status)), [mine.data, id])
  const full = p?.capacity != null && p.enrolledCount >= p.capacity
  const company = companies.find((c) => c.id === p?.companyId)

  const onEnroll = async () => {
    try { await enroll.mutateAsync(id); toast.success(`You’re enrolled in ${p?.title}`); void q.refetch() }
    catch (e) { toast.error('Couldn’t enroll you', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const onLeave = async () => {
    if (!myEnrollment) return
    try { await leave.mutateAsync(myEnrollment.id); toast.success(`You’ve left ${p?.title}`); setConfirm(null); void q.refetch() }
    catch (e) { toast.error('Couldn’t leave the program', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const applyStatus = async (status: ProgramStatus) => {
    if (!p) return
    try { await changeStatus.mutateAsync({ id: p.id, status }); toast.success(`Program marked ${PROGRAM_LABEL[status].toLowerCase()}`); setConfirm(null) }
    catch (e) { toast.error('Couldn’t change the status', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const onStatus = (status: ProgramStatus) => {
    if (!p || status === p.status) return
    if (status === 'CANCELLED' || status === 'COMPLETED') setConfirm(status)
    else void applyStatus(status)
  }

  return (
    <PageFrame label="Learning" className="grw-page">
      <PageHeader eyebrow="Learning" title={p?.title || 'Training program'}
        sub={p ? [p.category, modeLabel(p.mode, p.location) === 'Not set' ? null : modeLabel(p.mode, p.location), schedule(p, today)].filter(Boolean).join(' · ') : undefined}
        actions={<>
          <Button variant="secondary" icon="chevronLeft" onClick={() => navigate('/hrms/learning?view=programs')}>Programs</Button>
          {canWrite && p && !closed && <Button variant="primary" icon="pencil" onClick={() => setEditing(true)}>Edit details</Button>}
        </>} />
      {q.isLoading ? <SkeletonStats />
        : q.isError || !p ? <ErrorState title="Couldn’t load this program" error={q.error} onRetry={() => q.refetch()} />
          : (
            <>
              <Section title="About this program">
                <div className="grw-stack">
                  <KeyValueGrid items={[
                    { label: 'Status', value: <StatusPill tone={PROGRAM_TONE[p.status]}>{PROGRAM_LABEL[p.status]}</StatusPill> },
                    { label: 'Mode', value: modeLabel(p.mode, p.location) },
                    { label: 'Trainer', value: p.trainer || '—' },
                    { label: 'Starts', value: p.startDate ? dateLong(p.startDate) : '—' },
                    { label: 'Ends', value: p.endDate ? dateLong(p.endDate) : '—' },
                    { label: 'Seats', value: p.capacity != null ? `${p.enrolledCount} of ${p.capacity} taken` : `${p.enrolledCount} enrolled · no limit` },
                    ...(companies.length > 1 ? [{ label: 'Company', value: company?.name || '—' }] : []),
                  ]} />
                  <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: p.description ? 'var(--u-ink2, #4A5A54)' : 'var(--u-ink3, #6A7A73)' }}>{p.description || 'No description yet.'}</p>
                </div>
              </Section>
              {canEnroll && !closed && (
                <Section title="Your place" action={myEnrollment
                  ? { label: 'Leave', onClick: () => setConfirm('leave'), tone: 'neutral', disabled: leave.isPending }
                  : { label: full ? 'Full' : 'Enroll', onClick: onEnroll, disabled: enroll.isPending || full }}>
                  <p style={{ margin: 0, fontSize: 13.5 }}>{myEnrollment ? 'You’re enrolled in this program.' : full ? 'Every seat is taken.' : 'You’re not enrolled yet.'}</p>
                </Section>
              )}
              {closed && <Callout tone="neutral">{`This program is ${PROGRAM_LABEL[p.status].toLowerCase()}. Its details are kept as a record and can’t be changed.`}</Callout>}
              {canWrite && !closed && (
                <Section title="Status" sub="Planned → Ongoing → Completed. Cancelling drops everyone still enrolled. Completed and cancelled programs can’t be reopened.">
                  <div style={{ maxWidth: 260 }}>
                    <Select aria-label="Program status" value={p.status} disabled={changeStatus.isPending} onChange={(e) => onStatus(e.target.value as ProgramStatus)}
                      options={ALLOWED_TRANSITIONS[p.status].map((s) => ({ value: s, label: PROGRAM_LABEL[s] }))} />
                  </div>
                </Section>
              )}
              {canWrite && <Section title="Roster"><ProgramRoster program={p} /></Section>}
            </>
          )}
      {editing && p && <ProgramFormPanel program={p} onClose={() => setEditing(false)} onSaved={() => void q.refetch()} />}
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={changeStatus.isPending || leave.isPending} tone={confirm === 'CANCELLED' || confirm === 'leave' ? 'danger' : 'brand'}
        title={confirm === 'leave' ? `Leave ${p?.title ?? 'this program'}?` : confirm === 'CANCELLED' ? `Cancel ${p?.title ?? ''}?` : `Mark ${p?.title ?? ''} completed?`}
        sub={confirm === 'leave' ? 'You can enroll again while it’s open.' : confirm === 'CANCELLED' ? 'Everyone still enrolled is dropped, and a cancelled program can’t be reopened or edited.' : 'A completed program can’t be reopened or edited.'}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setConfirm(null)}>{confirm === 'leave' ? 'Stay enrolled' : 'Keep it'}</PanelButton>
          <PanelButton variant={confirm === 'COMPLETED' ? 'primary' : 'danger'} busy={changeStatus.isPending || leave.isPending}
            onClick={() => { if (confirm === 'leave') void onLeave(); else if (confirm) void applyStatus(confirm) }}>
            {confirm === 'leave' ? 'Leave program' : confirm === 'CANCELLED' ? 'Cancel program' : 'Mark completed'}
          </PanelButton>
        </>} />
    </PageFrame>
  )
}
