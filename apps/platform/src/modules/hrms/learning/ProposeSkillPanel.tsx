// Propose a skill level for yourself (hrms.learning.skill.assess.self; PgGrow "Propose a skill").
// Your manager (team) or HR approves it before it's on your record. The certification name
// (BW-85) is offered once V143.61 is applied; approval writes it to the skill.
import { useState } from 'react'
import { usePermission } from '@unifiedtree/sdk'
import { Callout, errorText } from '@/design/kit/display'
import { Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useMySkills, useProgramsSummary, useProposeSkillLevel } from '../api/useLearning'
import { SKILL_WORDS } from '../performance/growModel'

export function ProposeSkillPanel({ onClose, skill, level }: { onClose: () => void; skill?: string; level?: number }) {
  const toast = useToast()
  const propose = useProposeSkillLevel()
  const mine = useMySkills()
  const summary = useProgramsSummary(usePermission('hrms.learning.read'))
  const [name, setName] = useState(skill ?? '')
  const [lvl, setLvl] = useState(String(level ?? 3))
  const [cert, setCert] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const certReady = summary.data?.certificationNames ?? false
  const submit = async () => {
    const skillName = name.trim()
    if (!skillName) { setError('Name the skill.'); return }
    if (skillName.length > 120) { setError('A skill name can be at most 120 characters.'); return }
    if (note.trim().length > 1000) { setError('Keep the note under 1,000 characters.'); return }
    setError('')
    try {
      await propose.mutateAsync({ skillName, proposedProficiency: Number(lvl), note: note.trim() || undefined, certificationName: certReady && cert.trim() ? cert.trim() : undefined })
      toast.success('Skill proposed. Your manager is notified.'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t send it for approval.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!propose.isPending) onClose() }} busy={propose.isPending} width={520} title="Propose a skill"
      sub="Your manager approves the level before it shows on your record."
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={propose.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={propose.isPending} onClick={submit}>Propose a level</PanelButton>
      </>}>
      <div className="grw-form">
        <Input id="sa-skill" label="Skill name" maxLength={120} list="sa-my-skills" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. React"
          hint="Saving a skill name that already exists updates it." />
        <datalist id="sa-my-skills">{(mine.data ?? []).map((s) => <option key={s.id} value={s.skillName} />)}</datalist>
        <Select id="sa-level" label="Proficiency" value={lvl} onChange={(e) => setLvl(e.target.value)}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${SKILL_WORDS[n]}` }))} />
        {certReady && <Input label="Certification name" maxLength={200} value={cert} onChange={(e) => setCert(e.target.value)} placeholder="Optional" />}
        <Textarea id="sa-note" label="Note for your manager (optional)" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you built with it" />
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}
