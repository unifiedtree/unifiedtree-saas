// Learning · My training (EmpGrowth e-learn; PgGrow p-learn tab 1). Your programs with their
// dates, mode and place (BW-85), Leave (confirmed), a few open programs worth your time
// (Enrol), your skills and your skill proposals. Programs are instructor-led: there is no
// course progress, so no rings or percentages (ess-2 C28).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Callout, EmptyState, ListRow, ListRows, MiniStat, MiniStatGrid, ProgressBar, Section, SkeletonList, StatusPill, errorText,
} from '@/design/kit/display'
import { Dialog, PanelButton, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { stamp } from '@/design/module/ModuleKit'
import {
  useDropEnrollment, useEnroll, useMyEnrollments, useMySkillAssessments, useMySkills, useTrainingPrograms, useWithdrawSkillAssessment,
  type Enrollment, type SkillAssessment, type SkillAssessmentStatus,
} from '../api/useLearning'
import { dateLong, istDay, skillTone, skillWord } from '../performance/growModel'
import { ENROLLMENT_LABEL, ENROLLMENT_TONE, isOpenEnrollment, modeLabel, schedule } from './programs'

const PROPOSAL_LABEL: Record<SkillAssessmentStatus, string> = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn' }
const PROPOSAL_TONE: Record<SkillAssessmentStatus, 'warning' | 'success' | 'danger' | 'muted'> = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger', WITHDRAWN: 'muted' }

export function MyTrainingView({ canAssess, canBrowse, onPropose }: { canAssess: boolean; canBrowse: boolean; onPropose: () => void }) {
  const toast = useToast()
  const navigate = useNavigate()
  const today = istToday()
  const { data: enrollments = [], isLoading, error, refetch } = useMyEnrollments()
  const catalogue = useTrainingPrograms(0, canBrowse)
  const drop = useDropEnrollment()
  const enroll = useEnroll()
  const [leaving, setLeaving] = useState<Enrollment | null>(null)
  const open = enrollments.filter((e) => isOpenEnrollment(e.status))
  const completed = enrollments.filter((e) => e.status === 'COMPLETED')
  const listed = [...open, ...completed, ...enrollments.filter((e) => e.status === 'DROPPED')]
  const inProgramIds = useMemo(() => new Set(open.map((e) => e.programId)), [open])
  const worth = (catalogue.data?.content ?? [])
    .filter((p) => (p.status === 'PLANNED' || p.status === 'ONGOING') && !inProgramIds.has(p.id) && !(p.capacity != null && p.enrolledCount >= p.capacity))
    .slice(0, 6)

  const onLeave = async () => {
    if (!leaving) return
    const what = leaving.programTitle || 'the program'
    try { await drop.mutateAsync(leaving.id); toast.success(`You’ve left ${what}`); setLeaving(null) }
    catch (e) { toast.error('Couldn’t leave the program', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  const onEnroll = async (id: string, title: string) => {
    try { await enroll.mutateAsync(id); toast.success(`You’re enrolled in ${title}`) }
    catch (e) { toast.error('Couldn’t enroll you', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  return (
    <>
      <Section title="Your training" loading={isLoading} skeleton="stats" error={error} onRetry={() => refetch()}>
        <MiniStatGrid>
          <MiniStat label="You’re enrolled in" value={open.length} note="Programs" tone="info" />
          <MiniStat label="In progress" value={open.filter((e) => e.status === 'IN_PROGRESS').length} note="Still going" tone="warning" />
          <MiniStat label="Completed" value={completed.length} note="Finished" tone="success" />
        </MiniStatGrid>
      </Section>
      <section aria-label="Your programs" className="grw-stack grw-stack--tight">
        <h2 className="grw-h2">My programs</h2>
        {isLoading ? <SkeletonList rows={3} /> : listed.length === 0 ? (
          <EmptyState icon="award" title="You’re not enrolled in any training" hint={canBrowse ? 'Enroll from Programs, or pick one below.' : 'Programs HR enrolls you in appear here.'} />
        ) : listed.map((e) => (
          <article key={e.id} className="grw-course" style={e.status === 'DROPPED' ? { opacity: 0.7 } : undefined}>
            <div className="grw-course__body">
              <div className="grw-row"><span className="grw-course__title">{e.programTitle || 'Program'}</span><StatusPill tone={ENROLLMENT_TONE[e.status]} size="sm">{ENROLLMENT_LABEL[e.status]}</StatusPill></div>
              <div className="grw-muted" style={{ marginTop: 3 }}>
                {[schedule({ startDate: e.programStartDate, endDate: e.programEndDate }, today), e.programMode || e.programLocation ? modeLabel(e.programMode, e.programLocation) : null,
                  e.completedAt ? `Completed ${dateLong(istDay(e.completedAt))}${e.score != null ? ` · score ${e.score}` : ''}` : `Enrolled ${dateLong(istDay(e.createdAt))}`].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="grw-row">
              <Button variant="secondary" size={32} onClick={() => navigate(`/hrms/learning/programs/${e.programId}`)}>Details</Button>
              {isOpenEnrollment(e.status) && <Button variant="secondary" size={32} disabled={drop.isPending} onClick={() => setLeaving(e)}>Leave</Button>}
            </div>
          </article>
        ))}
      </section>
      {canBrowse && worth.length > 0 && (
        <section aria-label="Worth your time" className="grw-stack grw-stack--tight">
          <h2 className="grw-h2">Worth your time</h2>
          <div className="grw-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
            {worth.map((p) => (
              <button key={p.id} type="button" className="grw-tile" disabled={enroll.isPending} onClick={() => onEnroll(p.id, p.title)} aria-label={`Enrol in ${p.title}`}>
                <span className="grw-tile__t">{p.title}</span>
                <span className="grw-muted">{[schedule(p, today), p.category, modeLabel(p.mode, p.location) === 'Not set' ? null : modeLabel(p.mode, p.location)].filter(Boolean).join(' · ')}</span>
                <span className="grw-tile__go">Enrol →</span>
              </button>
            ))}
          </div>
        </section>
      )}
      <MySkills canAssess={canAssess} onPropose={onPropose} />
      {canAssess && <MyProposals />}
      <Dialog open={!!leaving} onClose={() => setLeaving(null)} busy={drop.isPending} icon="logOut" title={`Leave ${leaving?.programTitle || 'this program'}?`}
        sub="You can enroll again while it’s open."
        footer={<>
          <PanelButton variant="secondary" onClick={() => setLeaving(null)}>Stay enrolled</PanelButton>
          <PanelButton variant="danger" busy={drop.isPending} onClick={onLeave}>Leave program</PanelButton>
        </>} />
    </>
  )
}

/** Your own skills: /skills/me (enroll.self). HR edits them in the skill matrix; you propose a level. */
function MySkills({ canAssess, onPropose }: { canAssess: boolean; onPropose: () => void }) {
  const { data: skills = [], isLoading, error, refetch } = useMySkills()
  return (
    <Section title="My skills" loading={isLoading} skeleton="list" error={error} onRetry={() => refetch()}
      sub={canAssess ? 'Think a level is out of date, or a skill is missing? Propose it. Your manager or HR approves it before it’s recorded.' : 'HR keeps this up to date from the skill matrix.'}
      action={canAssess ? { label: 'Propose a skill', icon: 'plus', onClick: onPropose } : undefined}
      empty={!isLoading && skills.length === 0 ? { title: 'No skills recorded for you yet', variant: 'plain', icon: 'star' } : undefined}>
      {skills.length > 0 && (
        <ListRows label="My skills">
          {skills.map((s) => (
            <ListRow key={s.id} variant="divided" title={s.skillName}
              sub={s.certified ? `${s.certificationName || 'Certified'}${s.certifiedOn ? ` · ${dateLong(s.certifiedOn)}` : ''}` : undefined}
              end={<span className="grw-row" style={{ minWidth: 0 }}>
                <span style={{ width: 90 }}><ProgressBar value={(s.proficiency / 5) * 100} height={6} /></span>
                <StatusPill tone={skillTone(s.proficiency)} size="sm">{skillWord(s.proficiency)}</StatusPill>
              </span>} />
          ))}
        </ListRows>
      )}
    </Section>
  )
}

/** Your proposals and what happened to them: GET /v1/learning/skill-assessments/me. */
function MyProposals() {
  const toast = useToast()
  const { data = [], isLoading, error, refetch } = useMySkillAssessments()
  const withdraw = useWithdrawSkillAssessment()
  const [confirm, setConfirm] = useState<SkillAssessment | null>(null)
  if (!isLoading && !error && !data.length) return null
  const onWithdraw = async () => {
    if (!confirm) return
    try { await withdraw.mutateAsync(confirm.id); toast.success('Proposal withdrawn'); setConfirm(null) }
    catch (e) { toast.error('Couldn’t withdraw it', { detail: errorText(e, 'Try again in a moment.') }) }
  }
  return (
    <Section title="My skill proposals" loading={isLoading} skeleton="list" error={error} onRetry={() => refetch()}>
      <ListRows label="My skill proposals">
        {data.map((a) => (
          <ListRow key={a.id} variant="divided"
            title={`${a.skillName}: ${a.currentProficiency == null ? 'new skill' : skillWord(a.currentProficiency)} → ${skillWord(a.proposedProficiency)}`}
            sub={[`Proposed ${stamp(a.createdAt)}`, a.certificationName ? `with ${a.certificationName}` : null, a.decidedAt ? `${a.status === 'APPROVED' ? 'approved' : 'decided'} ${stamp(a.decidedAt)}${a.decidedByName ? ` by ${a.decidedByName}` : ''}` : null].filter(Boolean).join(' · ')}
            meta={a.decisionNote ? `“${a.decisionNote}”` : a.employeeNote || undefined}
            end={<StatusPill tone={PROPOSAL_TONE[a.status]} size="sm">{PROPOSAL_LABEL[a.status]}</StatusPill>}
            actions={a.status === 'PENDING' ? <Button variant="secondary" size={30} onClick={() => setConfirm(a)}>Withdraw</Button> : undefined} />
        ))}
      </ListRows>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)} busy={withdraw.isPending} title={`Withdraw your proposal for ${confirm?.skillName ?? ''}?`}
        sub="Nothing on your record changes."
        footer={<>
          <PanelButton variant="secondary" onClick={() => setConfirm(null)}>Keep it</PanelButton>
          <PanelButton variant="danger" busy={withdraw.isPending} onClick={onWithdraw}>Withdraw</PanelButton>
        </>} />
      {error && <Callout tone="danger">Couldn’t load your proposals.</Callout>}
    </Section>
  )
}
