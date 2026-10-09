// Training programs, shared by Learning · Programs and a program's page (P-GROW, PgGrow p-learn):
// labels, the new/edit program panel (with the category list and the place, BW-85) and the
// roster panel ("Enroll people": who's enrolled with their department, complete with a score,
// drop, enroll more). learning.write only for the form and the roster: the roster carries
// colleagues' scores.
import { useMemo, useState } from 'react'
import {
  Button, Callout, CellActions, CellPerson, EmptyState, StatusPill, Table, errorText, type StatusTone, type TableColumn,
} from '@/design/kit/display'
import { Checkbox, DateInput, Dialog, FieldGrid, Input, PanelButton, Select, SidePanel, Textarea, useToast } from '@/design/kit/overlays'
import { useCompanies } from '../api/useOrg'
import { useCurrentCompany } from '../company/CurrentCompany'
import { useEmployeeDirectory } from '../api/useWorkforce'
import {
  useAdminDropEnrollment, useBulkEnroll, useCompleteEnrollment, useCreateProgram, useProgramCategories, useProgramEnrollments, useProgramsSummary,
  useUpdateProgram, PROGRAM_MODE_LABEL,
  type Enrollment, type EnrollmentStatus, type ProgramMode, type ProgramStatus, type TrainingProgram, type UpdateProgramPayload,
} from '../api/useLearning'
import { dateLong, dayMon } from '../performance/growModel'

export const PROGRAM_LABEL: Record<ProgramStatus, string> = { PLANNED: 'Planned', ONGOING: 'Ongoing', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
export const PROGRAM_TONE: Record<ProgramStatus, StatusTone> = { PLANNED: 'neutral', ONGOING: 'info', COMPLETED: 'success', CANCELLED: 'muted' }
export const ENROLLMENT_LABEL: Record<EnrollmentStatus, string> = { ENROLLED: 'Enrolled', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', DROPPED: 'Dropped' }
export const ENROLLMENT_TONE: Record<EnrollmentStatus, StatusTone> = { ENROLLED: 'info', IN_PROGRESS: 'warning', COMPLETED: 'success', DROPPED: 'muted' }
/** COMPLETED and DROPPED are final: complete() answers ENROLLMENT_CLOSED, and admin-drop on a dropped row is a no-op. */
export const isOpenEnrollment = (s: EnrollmentStatus) => s === 'ENROLLED' || s === 'IN_PROGRESS'
/** score is NUMERIC(5,2) (V073); anything larger overflows. */
const MAX_SCORE = 999.99

/** "1 Sep – 15 Oct", "Mon, 28 Sep", "Dates not set". */
export function schedule(p: { startDate?: string | null; endDate?: string | null }, today?: string): string {
  if (!p.startDate) return p.endDate ? `Until ${dayMon(p.endDate, today)}` : 'Dates not set'
  if (!p.endDate || p.endDate === p.startDate) return dayMon(p.startDate, today)
  const [a, b] = [dateLong(p.startDate), dateLong(p.endDate)]
  const sameYear = p.startDate.slice(0, 4) === p.endDate.slice(0, 4)
  return `${sameYear ? a.replace(/ \d{4}$/, '') : a} – ${b}`
}

/** "Online", "Classroom · Bengaluru office", "Not set". */
export function modeLabel(mode?: ProgramMode | null, location?: string | null): string {
  const m = mode ? PROGRAM_MODE_LABEL[mode] : null
  return [m, location].filter(Boolean).join(' · ') || 'Not set'
}

/** New program, or edit one (only the fields that changed are sent). */
export function ProgramFormPanel({ program, onClose, onSaved }: { program?: TrainingProgram; onClose: () => void; onSaved?: (p: TrainingProgram) => void }) {
  const toast = useToast()
  const { data: companies = [] } = useCompanies()
  const cats = useProgramCategories()
  const summary = useProgramsSummary()
  const create = useCreateProgram()
  const update = useUpdateProgram()
  const placesReady = summary.data?.locations ?? false
  const enrolled = program?.enrolledCount ?? 0
  const [f, setF] = useState({
    companyId: program?.companyId ?? '', title: program?.title ?? '', category: program?.category ?? '', trainer: program?.trainer ?? '',
    startDate: program?.startDate ?? '', endDate: program?.endDate ?? '', capacity: program?.capacity != null ? String(program.capacity) : '',
    unlimited: program ? program.capacity == null : false, description: program?.description ?? '', mode: (program?.mode ?? '') as ProgramMode | '',
    location: program?.location ?? '',
  })
  const [error, setError] = useState('')
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  // A new program starts in the company the top bar's selector is on (its only company, with one).
  const { companyId: currentCompanyId } = useCurrentCompany()
  const companyId = f.companyId || (companies.length === 1 ? companies[0].id : currentCompanyId)
  const busy = create.isPending || update.isPending
  const submit = async () => {
    const title = f.title.trim()
    if (!title) { setError('Give the program a title.'); return }
    if (!program && !companyId) { setError('Choose a company.'); return }
    if (f.startDate && f.endDate && f.endDate < f.startDate) { setError('The end date can’t be before the start date.'); return }
    let seats: number | undefined
    const seatsOff = program ? f.unlimited : !f.capacity.trim()
    if (!seatsOff) {
      seats = Number(f.capacity)
      if (!Number.isInteger(seats) || seats < 1) { setError('Seats must be a whole number of at least 1. Leave it empty for no limit.'); return }
      if (seats < enrolled) { setError(`Seats can’t be fewer than the ${enrolled} ${enrolled === 1 ? 'person' : 'people'} already enrolled.`); return }
    }
    setError('')
    try {
      if (!program) {
        const created = await create.mutateAsync({
          companyId, title, category: f.category.trim() || undefined, trainer: f.trainer.trim() || undefined, startDate: f.startDate || undefined,
          endDate: f.endDate || undefined, capacity: seats ?? null, description: f.description.trim() || undefined, mode: (f.mode || undefined) as ProgramMode | undefined,
          location: placesReady && f.location.trim() ? f.location.trim() : undefined,
        })
        toast.success('Training program created'); onSaved?.(created); onClose(); return
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
      if (placesReady && f.location.trim() !== (program.location || '')) patch.location = f.location.trim()
      if (!Object.keys(patch).length) { toast.info('No changes to save'); onClose(); return }
      const saved = await update.mutateAsync({ id: program.id, ...patch })
      toast.success('Program saved'); onSaved?.(saved); onClose()
    } catch (e) { setError(errorText(e, program ? 'Couldn’t save the program.' : 'Couldn’t create the program.')) }
  }
  return (
    <SidePanel open onClose={() => { if (!busy) onClose() }} busy={busy} width={600}
      title={program ? 'Edit details' : 'New training program'}
      sub={program ? 'People already enrolled keep their place. Changing the dates or trainer doesn’t notify them, so let them know.' : 'People can enroll from Programs once it’s saved.'}
      footer={<>
        <PanelButton variant="secondary" size="lg" onClick={onClose} disabled={busy}>Cancel</PanelButton>
        <PanelButton variant="primary" size="lg" busy={busy} onClick={submit}>{program ? 'Save changes' : 'Create program'}</PanelButton>
      </>}>
      <div className="grw-form">
        {!program && companies.length > 1 && <Select label="Company" value={companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Choose a company" options={companies.map((c) => ({ value: c.id, label: c.name }))} />}
        <Input id={program ? 'pe-title' : 'lp-title'} label="Title" maxLength={200} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Manager essentials" />
        <FieldGrid columns={2}>
          <Input id={program ? 'pe-cat' : 'lp-cat'} label="Category" maxLength={50} list="lp-categories" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Leadership" />
          <Input id={program ? 'pe-trainer' : 'lp-trainer'} label="Trainer" maxLength={150} value={f.trainer} onChange={(e) => set('trainer', e.target.value)} placeholder="Optional" />
          <DateInput id={program ? 'pe-start' : 'lp-start'} label="Starts" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} clearable />
          <DateInput id={program ? 'pe-end' : 'lp-end'} label="Ends" min={f.startDate || undefined} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} clearable />
          <Input id={program ? 'pe-seats' : 'lp-cap'} label="Seats" type="number" min={Math.max(1, enrolled)} step={1} value={program && f.unlimited ? '' : f.capacity} disabled={!!program && f.unlimited}
            onChange={(e) => set('capacity', e.target.value)} placeholder={program && f.unlimited ? 'No limit' : 'Unlimited'} />
          <Select id={program ? 'pe-mode' : 'lp-mode'} label="Mode" value={f.mode} onChange={(e) => set('mode', e.target.value as ProgramMode | '')}
            options={[{ value: '', label: 'Not set' }, ...(Object.keys(PROGRAM_MODE_LABEL) as ProgramMode[]).map((m) => ({ value: m, label: PROGRAM_MODE_LABEL[m] }))]} />
        </FieldGrid>
        <datalist id="lp-categories">{(cats.data ?? []).map((c) => <option key={c} value={c} />)}</datalist>
        {program && <Checkbox label="No seat limit" checked={f.unlimited} onChange={(v) => set('unlimited', v)} />}
        {placesReady && (f.mode === 'IN_PERSON' || f.mode === 'HYBRID' || f.location) && (
          <Input label="Where" maxLength={150} value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Bengaluru office, all branches" hint="Shown with the mode, e.g. In person · Bengaluru office" />
        )}
        <Textarea id={program ? 'pe-desc' : 'lp-desc'} label="Description" rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="What people learn, who it’s for" />
        {enrolled > 0 && <Callout tone="neutral">{`${enrolled} ${enrolled === 1 ? 'person is' : 'people are'} enrolled, so seats can’t go below ${enrolled}.`}</Callout>}
        {error && <Callout tone="danger" icon="alert"><span role="alert">{error}</span></Callout>}
      </div>
    </SidePanel>
  )
}

/**
 * A program's roster ("Enroll people", PgGrow): who's enrolled, with their department, score
 * and status; complete with a score, drop (confirmed), and enroll more people (server search).
 */
export function RosterPanel({ program, onClose }: { program: TrainingProgram; onClose: () => void }) {
  return (
    <SidePanel open onClose={onClose} width={720} title="Enroll people" sub={program.title}>
      <ProgramRoster program={program} />
    </SidePanel>
  )
}

export function ProgramRoster({ program }: { program: TrainingProgram }) {
  const toast = useToast()
  const { data: enrollments = [], isLoading, error, refetch } = useProgramEnrollments(program.id)
  const complete = useCompleteEnrollment()
  const adminDrop = useAdminDropEnrollment()
  const bulkEnroll = useBulkEnroll()
  const [scores, setScores] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [dropping, setDropping] = useState<Enrollment | null>(null)
  const closed = program.status === 'COMPLETED' || program.status === 'CANCELLED'
  const { data: dir, error: dirError } = useEmployeeDirectory({ companyId: program.companyId, search: q.trim() || undefined, pageSize: 200 }, { enabled: !!program.companyId && !closed })
  const seated = useMemo(() => new Set(enrollments.filter((e) => e.status !== 'DROPPED').map((e) => e.employeeId)), [enrollments])
  const candidates = useMemo(() => (dir?.content ?? []).filter((e) => !seated.has(e.id)), [dir, seated])
  const active = enrollments.filter((e) => e.status !== 'DROPPED').length
  const seatsLeft = program.capacity == null ? null : Math.max(program.capacity - program.enrolledCount, 0)
  // Why no one is listed: a failed load says so (its own reason), not "No employees in this company".
  const noOne = dirError ? ((dirError as { status?: number }).status === 403 ? 'You need access to the employee directory to enroll people.' : errorText(dirError, 'Couldn’t load the employees.'))
    : !program.companyId ? 'This program has no company, so no one can be listed.'
      : (dir?.content ?? []).length === 0 ? (q.trim() ? 'No one matches that search.' : 'No employees in this company.') : 'Everyone matching is already enrolled.'

  const onComplete = async (e: Enrollment) => {
    const raw = (scores[e.id] ?? '').trim()
    let score: number | null = null
    if (raw) {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > MAX_SCORE) { toast.error(`Score must be a number from 0 to ${MAX_SCORE}`); return }
      score = Math.round(n * 100) / 100
    }
    try {
      await complete.mutateAsync({ id: e.id, score })
      toast.success(score == null ? 'Marked complete' : `Marked complete · score ${score}`)
      setScores((s) => { const n = { ...s }; delete n[e.id]; return n })
    } catch (err) { toast.error('Couldn’t mark it complete', { detail: errorText(err, 'Try again.') }) }
  }
  const onDrop = async () => {
    if (!dropping) return
    const who = dropping.employeeName || 'this employee'
    try { await adminDrop.mutateAsync(dropping.id); toast.success(`${who} dropped from the program`); setDropping(null) }
    catch (err) { toast.error('Couldn’t drop the enrollment', { detail: errorText(err, 'Try again.') }) }
  }
  const onEnroll = async () => {
    if (!picked.length) { toast.error('Pick at least one person'); return }
    try {
      const r = await bulkEnroll.mutateAsync({ programId: program.id, employeeIds: picked })
      const parts = [`${r.enrolled} enrolled`]
      if (r.alreadyEnrolled) parts.push(`${r.alreadyEnrolled} already enrolled`)
      if (r.rejectedForCapacity) parts.push(`${r.rejectedForCapacity} turned away, program full`)
      if (r.enrolled === 0) toast.error(parts.join(' · ')); else toast.success(parts.join(' · '))
      setPicked([]); setQ('')
    } catch (err) { toast.error('Couldn’t enroll them', { detail: errorText(err, 'Try again.') }) }
  }
  const columns: TableColumn<Enrollment>[] = [
    { key: 'employee', header: 'Employee', primary: true, render: (e) => <CellPerson name={e.employeeName || 'Employee'} sub={e.department || undefined} /> },
    { key: 'score', header: 'Score', render: (e) => (isOpenEnrollment(e.status)
      ? <input type="number" min={0} max={MAX_SCORE} step="0.01" className="uko-input" style={{ width: 96, height: 32 }} value={scores[e.id] ?? ''} placeholder="Optional"
        aria-label={`Score for ${e.employeeName || 'employee'} (optional)`} onChange={(ev) => setScores((s) => ({ ...s, [e.id]: ev.target.value }))} />
      : <span className="grw-num">{e.score != null ? String(e.score) : '—'}</span>) },
    { key: 'status', header: 'Status', render: (e) => <StatusPill tone={ENROLLMENT_TONE[e.status]}>{ENROLLMENT_LABEL[e.status]}</StatusPill> },
    { key: 'act', header: <span className="uk-sr">Actions</span>, label: 'Actions', align: 'right', render: (e) => (isOpenEnrollment(e.status) ? (
      <CellActions>
        <Button variant="soft" size={30} disabled={complete.isPending} onClick={() => onComplete(e)}>Complete</Button>
        <Button variant="secondary" size={30} disabled={adminDrop.isPending} onClick={() => setDropping(e)}>Drop</Button>
      </CellActions>
    ) : null) },
  ]
  return (
    <div className="grw-stack">
      <h3 className="grw-sub">{`Roster · ${active} enrolled${seatsLeft != null ? ` · ${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left` : ''}`}</h3>
      {error ? <Callout tone="danger">Couldn’t load the roster. <Button size={30} variant="secondary" onClick={() => refetch()}>Try again</Button></Callout> : (
        <Table label="Enrollments" columns={columns} rows={enrollments} rowKey={(e) => e.id} loading={isLoading} mobile="cards" density="compact"
          empty={<EmptyState variant="plain" icon="users" title="Nobody has enrolled yet" hint={closed ? undefined : 'Add people below.'} />} />
      )}
      {closed ? <Callout tone="neutral">{`This program is ${PROGRAM_LABEL[program.status].toLowerCase()}, so it takes no more enrollments.`}</Callout> : (
        <div className="grw-stack grw-stack--tight">
          <h3 className="grw-sub">Enroll people</h3>
          <Input label="Search employees to enroll" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or code" />
          <div className="grw-results" role="group" aria-label="People to enroll">
            {candidates.length === 0 ? (
              <p className="grw-muted" style={{ margin: 0, padding: 12 }} role={dirError ? 'alert' : undefined}>{noOne}</p>
            ) : candidates.map((emp) => (
              <div key={emp.id} style={{ padding: '6px 12px', borderBottom: '1px solid var(--u-ln2, #EDF1EF)' }}>
                <Checkbox label={`${emp.firstName} ${emp.lastName ?? ''}`.trim()} description={emp.employeeCode || undefined}
                  checked={picked.includes(emp.id)} onChange={() => setPicked((p) => (p.includes(emp.id) ? p.filter((x) => x !== emp.id) : [...p, emp.id]))} />
              </div>
            ))}
          </div>
          <div className="grw-row grw-row--between">
            <span className="grw-muted">{`${picked.length} picked`}</span>
            <Button variant="primary" size={32} loading={bulkEnroll.isPending} disabled={picked.length === 0} onClick={onEnroll}>Enroll picked</Button>
          </div>
        </div>
      )}
      <Dialog open={!!dropping} onClose={() => setDropping(null)} busy={adminDrop.isPending} tone="danger" icon="userMinus"
        title={`Drop ${dropping?.employeeName || 'this person'}?`} sub={`From “${program.title}”. The enrollment is kept as dropped, and they can be enrolled again.`}
        footer={<>
          <PanelButton variant="secondary" onClick={() => setDropping(null)}>Cancel</PanelButton>
          <PanelButton variant="danger" busy={adminDrop.isPending} onClick={onDrop}>Drop</PanelButton>
        </>} />
    </div>
  )
}
