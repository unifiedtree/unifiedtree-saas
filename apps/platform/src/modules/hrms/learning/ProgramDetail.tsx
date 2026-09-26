// A training program's page (/hrms/learning/programs/:id).
//   - Everyone who can browse programs (hrms.learning.read) sees the details and
//     can enroll or leave (hrms.learning.enroll.self).
//   - hrms.learning.write edits the details (title, description, category,
//     trainer, mode, dates, seats), changes the status and runs the roster.
// The server enforces the edit rules: seats never below the people already
// enrolled, the end date not before the start date, and completed or cancelled
// programs keep their details as a record.
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill } from '@/shared/components/hr'
import { DateField } from '@/shared/components/calendar'
import { ModulePage, State, Panel, Facts, Note, SubHeading, useDesignToast, dmy } from '@/design/module/ModuleKit'
import { useCompanies } from '../api/useOrg'
import {
  useTrainingProgram, useUpdateProgram, useChangeProgramStatus, useMyEnrollments, useEnroll, useDropEnrollment,
  ALLOWED_TRANSITIONS, PROGRAM_MODE_LABEL,
  type ProgramMode, type ProgramStatus, type TrainingProgram, type UpdateProgramPayload,
} from '../api/useLearning'
import { ProgramRoster, PROGRAM_LABEL, PROGRAM_TONE, schedule } from '../Learning'

const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

export function ProgramDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { show, node } = useDesignToast()
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  const q = useTrainingProgram(id)
  const { data: companies = [] } = useCompanies()
  const mine = useMyEnrollments(canEnroll)
  const enroll = useEnroll()
  const leave = useDropEnrollment()
  const changeStatus = useChangeProgramStatus()
  const [editing, setEditing] = useState(false)
  const p = q.data
  const closed = p?.status === 'COMPLETED' || p?.status === 'CANCELLED'
  const myEnrollment = useMemo(() => (mine.data ?? []).find((e) => e.programId === id && (e.status === 'ENROLLED' || e.status === 'IN_PROGRESS')), [mine.data, id])
  const full = p?.capacity != null && p.enrolledCount >= p.capacity
  const company = companies.find((c) => c.id === p?.companyId)

  const onEnroll = async () => {
    try { await enroll.mutateAsync(id); show(`You’re enrolled in ${p?.title}`); void q.refetch() } catch (e) { show('Couldn’t enroll you', true, (e as Error)?.message) }
  }
  const onLeave = async () => {
    if (!myEnrollment) return
    if (!window.confirm(`Leave “${p?.title}”? You can enroll again while it’s open.`)) return
    try { await leave.mutateAsync(myEnrollment.id); show(`You’ve left ${p?.title}`); void q.refetch() } catch (e) { show('Couldn’t leave the program', true, (e as Error)?.message) }
  }
  const onStatus = async (status: ProgramStatus) => {
    if (!p || status === p.status) return
    if (status === 'CANCELLED' && !window.confirm(`Cancel “${p.title}”? Everyone still enrolled is dropped, and a cancelled program can’t be reopened or edited.`)) return
    if (status === 'COMPLETED' && !window.confirm(`Mark “${p.title}” completed? A completed program can’t be reopened or edited.`)) return
    try { await changeStatus.mutateAsync({ id: p.id, status }); show(`Program marked ${PROGRAM_LABEL[status].toLowerCase()}`); setEditing(false) } catch (e) { show('Couldn’t change the status', true, (e as Error)?.message) }
  }

  const back = <HrButton variant="ghost" onClick={() => navigate('/hrms/learning?view=programs')}>← Programs</HrButton>
  const edit = canWrite && p && !closed && !editing ? <HrButton onClick={() => setEditing(true)}>Edit details</HrButton> : null
  return (
    <ModulePage crumb="Learning" title={p?.title || 'Training program'}
      subtitle={p ? [p.category, p.mode ? PROGRAM_MODE_LABEL[p.mode] : null, schedule(p)].filter(Boolean).join(' · ') : undefined}
      actions={<>{back}{edit}</>}>
      {q.isLoading ? <State kind="loading" height={240} />
        : q.isError || !p ? <State kind="error" title="Couldn’t load this program" description={(q.error as Error)?.message || 'It may have been removed.'} onRetry={() => q.refetch()} />
          : (
            <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
              <Facts items={[
                { k: 'Status', v: <HrStatusPill tone={PROGRAM_TONE[p.status]}>{PROGRAM_LABEL[p.status]}</HrStatusPill> },
                { k: 'Mode', v: p.mode ? PROGRAM_MODE_LABEL[p.mode] : 'Not set' },
                { k: 'Trainer', v: p.trainer || '—' },
                { k: 'Starts', v: dmy(p.startDate) },
                { k: 'Ends', v: dmy(p.endDate) },
                { k: 'Seats', v: p.capacity != null ? `${p.enrolledCount} of ${p.capacity} taken` : `${p.enrolledCount} enrolled · no limit` },
                ...(companies.length > 1 ? [{ k: 'Company', v: company?.name || '—' }] : []),
              ]} />
              <Panel title="About this program">
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: p.description ? '#334155' : '#64748b', whiteSpace: 'pre-wrap' }}>{p.description || 'No description yet.'}</p>
              </Panel>

              {canEnroll && !closed && (
                <Panel title="Your place" aside={myEnrollment
                  ? <HrButton size="sm" variant="ghost" onClick={onLeave} disabled={leave.isPending}>Leave</HrButton>
                  : <HrButton size="sm" onClick={onEnroll} disabled={enroll.isPending || full}>{full ? 'Full' : 'Enroll'}</HrButton>}>
                  <p style={{ margin: 0, fontSize: 13.5, color: '#334155' }}>{myEnrollment ? 'You’re enrolled in this program.' : full ? 'Every seat is taken.' : 'You’re not enrolled yet.'}</p>
                </Panel>
              )}
              {closed && <Note>{`This program is ${PROGRAM_LABEL[p.status].toLowerCase()}. Its details are kept as a record and can’t be changed.`}</Note>}

              {canWrite && !closed && (
                <Panel title="Status" sub="Planned → Ongoing → Completed. Cancelling drops everyone still enrolled. Completed and cancelled programs can’t be reopened.">
                  <div style={{ maxWidth: 240 }}>
                    <select aria-label="Program status" value={p.status} onChange={(e) => onStatus(e.target.value as ProgramStatus)} disabled={changeStatus.isPending} className="ut-select">
                      {ALLOWED_TRANSITIONS[p.status].map((s) => <option key={s} value={s}>{PROGRAM_LABEL[s]}</option>)}
                    </select>
                  </div>
                </Panel>
              )}
              {canWrite && !closed && editing && <EditProgramPanel program={p} onDone={() => setEditing(false)} toast={show} />}

              {canWrite && (
                <>
                  <SubHeading>Roster</SubHeading>
                  <Panel pad={0}><ProgramRoster program={p} toast={show} /></Panel>
                </>
              )}
            </div>
          )}
      {node}
    </ModulePage>
  )
}

/** Edit a program's details. Only the fields that changed are sent. */
function EditProgramPanel({ program, onDone, toast }: { program: TrainingProgram; onDone: () => void; toast: (m: string, err?: boolean, detail?: string) => void }) {
  const update = useUpdateProgram()
  const [f, setF] = useState({
    title: program.title, description: program.description || '', category: program.category || '', trainer: program.trainer || '',
    mode: (program.mode || '') as ProgramMode | '', startDate: program.startDate || '', endDate: program.endDate || '',
    capacity: program.capacity != null ? String(program.capacity) : '', unlimited: program.capacity == null,
  })
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const enrolled = program.enrolledCount
  const onSave = async () => {
    const title = f.title.trim()
    if (!title) { toast('Give the program a title', true); return }
    if (f.startDate && f.endDate && f.endDate < f.startDate) { toast('The end date can’t be before the start date', true); return }
    let seats: number | undefined
    if (!f.unlimited) {
      seats = Number(f.capacity)
      if (!f.capacity.trim() || !Number.isInteger(seats) || seats < 1) { toast('Seats must be a whole number of at least 1, or tick “No seat limit”', true); return }
      if (seats < enrolled) { toast(`Seats can’t be fewer than the ${enrolled} ${enrolled === 1 ? 'person' : 'people'} already enrolled`, true); return }
    }
    const patch: UpdateProgramPayload = {}
    if (title !== program.title) patch.title = title
    if (f.description.trim() !== (program.description || '')) patch.description = f.description.trim()
    if (f.category.trim() !== (program.category || '')) patch.category = f.category.trim()
    if (f.trainer.trim() !== (program.trainer || '')) patch.trainer = f.trainer.trim()
    if (f.mode !== (program.mode || '')) patch.mode = f.mode
    if (f.startDate !== (program.startDate || '')) patch.startDate = f.startDate
    if (f.endDate !== (program.endDate || '')) patch.endDate = f.endDate
    if (f.unlimited && program.capacity != null) patch.unlimitedSeats = true
    if (!f.unlimited && seats !== program.capacity) patch.capacity = seats
    if (!Object.keys(patch).length) { toast('No changes to save'); onDone(); return }
    try {
      await update.mutateAsync({ id: program.id, ...patch })
      toast('Program saved'); onDone()
    } catch (e) { toast('Couldn’t save the program', true, (e as Error)?.message) }
  }
  return (
    <Panel title="Edit details" sub="People already enrolled keep their place. Changing the dates or trainer doesn’t notify them, so let them know." aside={<HrButton size="sm" variant="ghost" onClick={onDone} disabled={update.isPending}>Cancel</HrButton>}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className={label} htmlFor="pe-title">Title</label><input id="pe-title" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} className="ut-input" /></div>
        <div><label className={label} htmlFor="pe-cat">Category</label><input id="pe-cat" maxLength={50} value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Technical" className="ut-input" /></div>
        <div><label className={label} htmlFor="pe-trainer">Trainer</label><input id="pe-trainer" maxLength={150} value={f.trainer} onChange={(e) => set('trainer', e.target.value)} placeholder="Optional" className="ut-input" /></div>
        <div><label className={label} htmlFor="pe-mode">Mode</label><select id="pe-mode" value={f.mode} onChange={(e) => set('mode', e.target.value as ProgramMode | '')} className="ut-select"><option value="">Not set</option>{(Object.keys(PROGRAM_MODE_LABEL) as ProgramMode[]).map((m) => <option key={m} value={m}>{PROGRAM_MODE_LABEL[m]}</option>)}</select></div>
        <div>
          <label className={label} htmlFor="pe-seats">Seats</label>
          <input id="pe-seats" type="number" min={Math.max(1, enrolled)} step={1} value={f.unlimited ? '' : f.capacity} disabled={f.unlimited} onChange={(e) => set('capacity', e.target.value)} placeholder={f.unlimited ? 'No limit' : undefined} className="ut-input" />
          <label className="mt-2 flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={f.unlimited} onChange={(e) => set('unlimited', e.target.checked)} className="h-4 w-4 accent-[#059669]" /> No seat limit</label>
        </div>
        <div><label className={label} htmlFor="pe-start">Starts</label><DateField id="pe-start" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} className="ut-input" clearable /></div>
        <div><label className={label} htmlFor="pe-end">Ends</label><DateField id="pe-end" min={f.startDate || undefined} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} className="ut-input" clearable /></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="pe-desc">Description</label><textarea id="pe-desc" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What people learn, who it’s for" className="ut-input resize-y" /></div>
      </div>
      {enrolled > 0 && <Note>{`${enrolled} ${enrolled === 1 ? 'person is' : 'people are'} enrolled, so seats can’t go below ${enrolled}.`}</Note>}
      <div className="flex justify-end"><HrButton onClick={onSave} disabled={update.isPending}>{update.isPending ? 'Saving…' : 'Save changes'}</HrButton></div>
    </Panel>
  )
}
