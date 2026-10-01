// Learning · Skill matrix (PgGrow p-learn tab 2): pick a person, see their skills with the
// level words (the database keeps 1–5), certification and when each changed (BW-85).
// hrms.learning.write adds or updates a skill or certification for them.
import { useMemo, useState } from 'react'
import {
  Button, CellActions, EmptyState, KeyValueGrid, Section, StatusPill, Table, errorText, type TableColumn,
} from '@/design/kit/display'
import { SectionCell, SectionGrid } from '@/design/kit/data'
import { Checkbox, DateInput, FieldGrid, Input, PanelButton, Select, SidePanel, useToast } from '@/design/kit/overlays'
import { istToday } from '@/design/dc/dates'
import { useEmployeeSkills, useUpsertSkill, type EmployeeSkill } from '../api/useLearning'
import { SKILL_WORDS, dateLong, skillTone, skillWord } from '../performance/growModel'
import { PersonSearch, personName } from '../performance/PersonSearch'

const changed = (s: EmployeeSkill) => (s.updatedAt || s.createdAt || '').slice(0, 10)

export function SkillMatrixView({ canWrite }: { canWrite: boolean }) {
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const [editing, setEditing] = useState<EmployeeSkill | 'new' | null>(null)
  const { data: skills = [], isLoading, error, refetch } = useEmployeeSkills(employeeId)
  const certs = skills.filter((s) => s.certified)
  const last = useMemo(() => skills.map(changed).filter(Boolean).sort().pop() ?? null, [skills])
  const columns: TableColumn<EmployeeSkill>[] = [
    { key: 'skill', header: 'Skill', primary: true, render: (s) => <span className="grw-strong">{s.skillName}</span> },
    { key: 'level', header: 'Proficiency', render: (s) => <StatusPill tone={skillTone(s.proficiency)}>{skillWord(s.proficiency)}</StatusPill> },
    { key: 'cert', header: 'Certification', render: (s) => (s.certified
      ? <span style={{ display: 'grid' }}><span>{s.certificationName || 'Certified'}</span>{s.expiresOn && <span className="grw-muted">{`${s.expiresOn < istToday() ? 'Expired' : 'Expires'} ${dateLong(s.expiresOn)}`}</span>}</span>
      : <span className="grw-muted">Not certified</span>) },
    { key: 'updated', header: 'Updated', render: (s) => (changed(s) ? dateLong(changed(s)) : '—') },
    ...(canWrite ? [{ key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right' as const, render: (s: EmployeeSkill) => (
      <CellActions><Button variant="secondary" size={30} onClick={() => setEditing(s)}>Edit</Button></CellActions>
    ) }] : []),
  ]
  return (
    <>
      <SectionGrid>
        <SectionCell width="half">
          <Section title="Whose record?" sub={employeeId ? `Showing ${employeeName}` : 'Find a colleague to see their skills.'}>
            <PersonSearch value={employeeId} selectedLabel={employeeName} onChange={(e) => { setEmployeeId(e.id); setEmployeeName(personName(e)) }} />
          </Section>
        </SectionCell>
        {employeeId && (
          <SectionCell width="half">
            <Section title={employeeName} loading={isLoading} skeleton="text" error={error} onRetry={() => refetch()}
              action={canWrite ? { label: 'Add a skill', icon: 'plus', onClick: () => setEditing('new') } : undefined}>
              <KeyValueGrid items={[
                { label: 'Skills', value: String(skills.length) },
                { label: 'Certifications', value: certs.length ? `${certs.length} · ${certs[0].certificationName || certs[0].skillName}` : '0' },
                { label: 'Last updated', value: last ? dateLong(last) : '—' },
              ]} />
            </Section>
          </SectionCell>
        )}
      </SectionGrid>
      {!employeeId ? <EmptyState icon="chart" title="No one picked yet" hint="Search above to open someone’s record." /> : (
        <Section title="Skill matrix" body="flush" error={error} onRetry={() => refetch()}>
          <Table label={`${employeeName}’s skills`} columns={columns} rows={skills} rowKey={(s) => s.id} loading={isLoading} mobile="cards"
            empty={<EmptyState variant="plain" icon="chart" title="No skills recorded yet." hint={canWrite ? 'Use “Add a skill”.' : undefined} />} />
        </Section>
      )}
      {editing && employeeId && <SkillPanel employeeId={employeeId} employeeName={employeeName} existing={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Add or update a skill or certification for a person (hrms.learning.write). Same name = update. */
function SkillPanel({ employeeId, employeeName, existing, onClose }: { employeeId: string; employeeName: string; existing?: EmployeeSkill; onClose: () => void }) {
  const toast = useToast()
  const upsert = useUpsertSkill()
  const today = istToday()
  const [skillName, setSkillName] = useState(existing?.skillName ?? '')
  const [proficiency, setProficiency] = useState(String(existing?.proficiency ?? 3))
  const [certified, setCertified] = useState(existing?.certified ?? false)
  const [certificationName, setCertificationName] = useState(existing?.certificationName ?? '')
  const [certifiedOn, setCertifiedOn] = useState(existing?.certifiedOn ?? '')
  const [expiresOn, setExpiresOn] = useState(existing?.expiresOn ?? '')
  const [error, setError] = useState('')
  const save = async () => {
    if (!skillName.trim()) { setError('Name the skill.'); return }
    if (certified && certifiedOn && expiresOn && expiresOn < certifiedOn) { setError('The expiry is before the certification date.'); return }
    setError('')
    try {
      await upsert.mutateAsync({ employeeId, skillName: skillName.trim(), proficiency: Number(proficiency), certified,
        certificationName: certified ? certificationName.trim() || undefined : undefined, certifiedOn: certified ? certifiedOn || undefined : undefined, expiresOn: certified ? expiresOn || undefined : undefined })
      toast.success('Skill saved'); onClose()
    } catch (e) { setError(errorText(e, 'Couldn’t save the skill.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!upsert.isPending) onClose() }} busy={upsert.isPending} width={560}
      title={existing ? `Update ${existing.skillName}` : 'Add a skill'} sub={`For ${employeeName}. Saving a skill name that already exists updates it.`}
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={upsert.isPending}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={upsert.isPending} onClick={save}>Save</PanelButton>
      </>}>
      <div className="grw-form">
        <Input id="sk-name" label="Skill name" maxLength={120} value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="e.g. TypeScript" />
        <Select id="sk-prof" label="Proficiency" value={proficiency} onChange={(e) => setProficiency(e.target.value)}
          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} · ${SKILL_WORDS[n]}` }))} />
        <Checkbox label="Certified" checked={certified} onChange={setCertified} />
        {certified && (
          <FieldGrid columns={2}>
            <Input id="sk-cert" label="Certification name" maxLength={200} value={certificationName} onChange={(e) => setCertificationName(e.target.value)} placeholder="e.g. AWS Solutions Architect" />
            <DateInput id="sk-on" label="Certified on" max={today} value={certifiedOn} onChange={(e) => setCertifiedOn(e.target.value)} clearable />
            <DateInput id="sk-exp" label="Certification expiry" min={certifiedOn || undefined} toYear={new Date().getFullYear() + 50} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} clearable />
          </FieldGrid>
        )}
        {error && <span role="alert" style={{ color: 'var(--u-rdt, #B42318)', fontSize: 13 }}>{error}</span>}
      </div>
    </SidePanel>
  )
}
