// Learning (/hrms/learning) on the redesign kit (P-GROW; prototype PgGrow p-learn, and EmpGrowth
// e-learn for My training). The page's own views are inline pills (DECISIONS 21), kept in ?view=
// with today's keys, names and order:
//   - hrms.learning.read: Programs (the catalogue; everyone can browse).
//   - hrms.learning.enroll.self: My training (your programs, worth your time, your skills).
//   - hrms.learning.skill.read: Skill matrix and Certifications (V116: narrower than
//     learning.read, so the whole company's proficiency isn't visible to everyone).
//   - hrms.learning.write: create and edit programs, change their status, the roster, edit skills.
//   - hrms.learning.skill.assess.self: propose a level for your own skills (nothing changes
//     until approved). hrms.learning.skill.approve: Skill approvals (managers: their team).
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { Button, CountBadge, EmptyState, PageFrame, PageHeader, PillTabs } from '@/design/kit/display'
import { useSkillAssessmentQueue } from './api/useLearning'
import { ProgramsView } from './learning/ProgramsView'
import { MyTrainingView } from './learning/MyTrainingView'
import { SkillMatrixView } from './learning/SkillMatrixView'
import { CertificationsView } from './learning/CertificationsView'
import { SkillApprovalsView } from './learning/SkillApprovalsView'
import { ProposeSkillPanel } from './learning/ProposeSkillPanel'
import './performance/grow.css'

type View = 'programs' | 'my' | 'skills' | 'certifications' | 'approvals'

const SUBS: Record<View, string> = {
  programs: 'Training programs in the catalogue, and who’s enrolled.',
  my: 'Programs you’re enrolled in, and what you’ve finished.',
  skills: 'Skill levels for each person. Saving a skill name that already exists updates it.',
  certifications: 'Certifications on file, and when they expire.',
  approvals: 'Skill levels your team proposes appear here.',
}

export const Learning = () => {
  const canRead = usePermission('hrms.learning.read')
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  const canViewSkills = usePermission('hrms.learning.skill.read')
  const canAssess = usePermission('hrms.learning.skill.assess.self')
  const canApprove = usePermission('hrms.learning.skill.approve')
  const pending = useSkillAssessmentQueue('PENDING', canApprove)
  const [params, setParams] = useSearchParams()
  const views: { key: View; label: string; count?: number }[] = [
    ...(canRead ? [{ key: 'programs' as const, label: 'Programs' }] : []),
    ...(canEnroll ? [{ key: 'my' as const, label: 'My training' }] : []),
    ...(canViewSkills ? [{ key: 'skills' as const, label: 'Skill matrix' }, { key: 'certifications' as const, label: 'Certifications' }] : []),
    ...(canApprove ? [{ key: 'approvals' as const, label: 'Skill approvals', count: pending.data?.length || undefined }] : []),
  ]
  const view: View | undefined = views.find((v) => v.key === params.get('view'))?.key ?? views[0]?.key
  const [adding, setAdding] = useState(0)
  const [proposing, setProposing] = useState(false)
  const setView = (next: string) => {
    const sp = new URLSearchParams(params)
    sp.set('view', next)
    setParams(sp, { replace: true })
  }
  const selfOnly = !canRead && !canViewSkills && !canApprove
  const action = view === 'programs' && canWrite ? <Button variant="primary" icon="plus" onClick={() => setAdding((n) => n + 1)}>New program</Button>
    : (view === 'skills' || view === 'my') && canAssess ? <Button variant="primary" icon="plus" onClick={() => setProposing(true)}>Propose a skill</Button>
      : undefined

  if (!view) {
    return (
      <PageFrame label="Learning">
        <PageHeader eyebrow="Performance" title="Learning" />
        <EmptyState icon="lock" title="No learning access" hint="Ask an admin if you should see training programs." />
      </PageFrame>
    )
  }
  return (
    <PageFrame label="Learning" className="grw-page">
      <PageHeader eyebrow={selfOnly ? undefined : 'Performance'} title="Learning"
        sub={selfOnly ? 'Courses you need to finish, the ones you picked, and a few worth your time.' : SUBS[view]} actions={action} />
      {views.length > 1 && (
        <PillTabs label="Learning views" semantics="toggle" activeKey={view} onSelect={setView}
          items={views.map((v) => ({ key: v.key, label: v.count ? <><span>{v.label}</span><CountBadge tone="gold" size="sm">{v.count}</CountBadge></> : v.label }))} />
      )}
      {view === 'programs' && <ProgramsView canWrite={canWrite} canEnroll={canEnroll} addKey={adding} />}
      {view === 'my' && <MyTrainingView canAssess={canAssess} canBrowse={canRead} onPropose={() => setProposing(true)} />}
      {view === 'skills' && <SkillMatrixView canWrite={canWrite} />}
      {view === 'certifications' && <CertificationsView />}
      {view === 'approvals' && <SkillApprovalsView everyone={canWrite} />}
      {proposing && <ProposeSkillPanel onClose={() => setProposing(false)} />}
    </PageFrame>
  )
}
