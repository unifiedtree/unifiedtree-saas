// Learning · Skill approvals (PgGrow p-learn tab 4): proposed skill levels waiting for a decision
// (hrms.learning.skill.approve). Managers see their team (as My team); HR (learning.write)
// everyone. Approving writes the level (and a named certification) to the skill matrix straight
// away; rejecting needs a note, which the employee sees.
import { useState } from 'react'
import { Callout, EmptyState, ListRow, ListRows, Section, SkeletonList, StatusPill, errorText } from '@/design/kit/display'
import { ApprovalRow, Dialog, PanelButton, Textarea, useToast } from '@/design/kit/overlays'
import { stamp } from '@/design/module/ModuleKit'
import { useDecideSkillAssessment, useSkillAssessmentQueue, type SkillAssessment } from '../api/useLearning'
import { skillWord } from '../performance/growModel'

export function SkillApprovalsView({ everyone }: { everyone: boolean }) {
  const toast = useToast()
  const pending = useSkillAssessmentQueue('PENDING')
  const decided = useSkillAssessmentQueue('DECIDED')
  const decide = useDecideSkillAssessment()
  const [busy, setBusy] = useState<Record<string, 'approve' | 'reject'>>({})
  const [rejecting, setRejecting] = useState<SkillAssessment | null>(null)
  const [note, setNote] = useState('')
  const items = pending.data ?? []
  const run = async (a: SkillAssessment, approve: boolean, why: string) => {
    if (!approve && !why.trim()) { setRejecting(a); setNote(''); return }
    setBusy((b) => ({ ...b, [a.id]: approve ? 'approve' : 'reject' }))
    try {
      await decide.mutateAsync({ id: a.id, decision: approve ? 'APPROVED' : 'REJECTED', note: why.trim() || undefined })
      toast.success(approve ? `Approved: ${a.employeeName || 'their'} ${a.skillName} is now ${skillWord(a.proposedProficiency)}` : 'Not approved. They’ve been told why.')
      setRejecting(null)
    } catch (e) { toast.error('Couldn’t save the decision', { detail: errorText(e, 'Try again in a moment.') }) }
    finally { setBusy((b) => { const n = { ...b }; delete n[a.id]; return n }) }
  }
  return (
    <>
      <Callout tone="neutral">{everyone
        ? 'You see everyone’s proposals. Approving updates the person’s skill matrix straight away; a rejection needs a note, which they see.'
        : 'You see proposals from your team: everyone in the departments you head, or your direct reports if you don’t head one. A rejection needs a note, which they see.'}</Callout>
      <Section title="Skill approvals" count={items.length || undefined} countTone="gold" error={pending.error} onRetry={() => pending.refetch()}>
        {pending.isLoading ? <SkeletonList rows={3} /> : items.length === 0 ? (
          <EmptyState variant="success" title="Nothing to decide" hint="Skill levels your team proposes appear here." />
        ) : (
          <div className="grw-stack grw-stack--tight">
            {items.map((a) => (
              <ApprovalRow key={a.id} variant="card" name={a.employeeName || 'Employee'} meta={[a.employeeCode, a.department].filter(Boolean).join(' · ') || undefined}
                kind="Skill level" title={`${a.skillName}: ${a.currentProficiency == null ? 'new skill' : skillWord(a.currentProficiency)} → ${skillWord(a.proposedProficiency)}`}
                reason={a.employeeNote || undefined} status="pending" busy={busy[a.id] ?? false} withNote notePlaceholder="Note (needed to reject)"
                facts={[
                  { label: 'From', value: a.currentProficiency == null ? 'New skill' : `${a.currentProficiency} · ${skillWord(a.currentProficiency)}` },
                  { label: 'To', value: `${a.proposedProficiency} · ${skillWord(a.proposedProficiency)}` },
                  ...(a.certificationName ? [{ label: 'Certification', value: a.certificationName }] : []),
                  { label: 'Proposed', value: stamp(a.createdAt) },
                ]}
                onApprove={(n) => run(a, true, n)} onReject={(n) => run(a, false, n)} />
            ))}
          </div>
        )}
      </Section>
      {(decided.data?.length ?? 0) > 0 && (
        <Section title="Recently decided">
          <ListRows label="Recently decided">
            {(decided.data ?? []).map((a) => (
              <ListRow key={a.id} variant="divided" title={`${a.employeeName || 'Employee'} · ${a.skillName} → ${skillWord(a.proposedProficiency)}`}
                sub={[a.decidedAt ? stamp(a.decidedAt) : null, a.decidedByName ? `by ${a.decidedByName}` : null].filter(Boolean).join(' · ')}
                meta={a.decisionNote || undefined}
                end={<StatusPill tone={a.status === 'APPROVED' ? 'success' : 'danger'} size="sm">{a.status === 'APPROVED' ? 'Approved' : 'Not approved'}</StatusPill>} />
            ))}
          </ListRows>
        </Section>
      )}
      <Dialog open={!!rejecting} onClose={() => setRejecting(null)} busy={!!rejecting && busy[rejecting.id] === 'reject'} icon="circleX" tone="danger"
        title={`Reject ${(rejecting?.employeeName || '').split(' ')[0] || 'their'}’s skill level?`} sub="Say why. They see this note."
        footer={<>
          <PanelButton variant="secondary" onClick={() => setRejecting(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" blockedReason={note.trim() ? null : 'Add a note saying why'} busy={!!rejecting && busy[rejecting.id] === 'reject'}
            onClick={() => rejecting && run(rejecting, false, note)}>Reject level</PanelButton>
        </>}>
        <Textarea label="Why it’s not approved" required rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      </Dialog>
    </>
  )
}
