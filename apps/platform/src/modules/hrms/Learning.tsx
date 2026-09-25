// Learning (/hrms/learning) on the module kit.
//   - hrms.learning.read: the program catalogue (every employee can browse).
//   - hrms.learning.enroll.self: enroll, My training, your own skills.
//   - hrms.learning.skill.read: colleagues' skills and certifications (V116 —
//     deliberately narrower than learning.read so the whole company's
//     proficiency scores aren't visible to everyone).
//   - hrms.learning.write: create and edit programs (each has a detail page,
//     /hrms/learning/programs/:id), change their status, the roster (enroll
//     others, complete with a score, drop) and editing skills.
//   - hrms.learning.skill.assess.self: propose a level for your own skills
//     (My training → My skills). Nothing changes until it's approved.
//   - hrms.learning.skill.approve: the Skill approvals view. Managers see their
//     team's proposals, learning.write holders (HR) everyone's.
import React, { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { usePermission } from '@unifiedtree/sdk'
import { HrButton, HrStatusPill, TableCard, HrAvatar, HrSelect, type PillTone } from '@/shared/components/hr'
import { HrPagination } from '@/shared/components/HrPagination'
import { ModulePage, Views, useView, StatRow, State, Panel, SubHeading, Note, RowList, Row, ApprovalList, useDesignToast, dmy, todayIso, stamp } from '@/design/module/ModuleKit'
import { dashIcon } from '@/design/dc/icons'
import { PerformanceEmployeePicker as EmployeePicker } from './performance/PerformanceEmployeePicker'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useTrainingPrograms, useCreateProgram, useChangeProgramStatus, useEnroll,
  useMyEnrollments, useEmployeeSkills, useUpsertSkill, useMySkills,
  useProgramEnrollments, useCompleteEnrollment, useBulkEnroll,
  useAdminDropEnrollment, useDropEnrollment,
  useMySkillAssessments, useProposeSkillLevel, useWithdrawSkillAssessment,
  useSkillAssessmentQueue, useDecideSkillAssessment,
  ALLOWED_TRANSITIONS, PROGRAM_MODE_LABEL,
  type ProgramStatus, type EnrollmentStatus, type TrainingProgram, type Enrollment, type ProgramMode,
  type SkillAssessment, type SkillAssessmentStatus,
} from './api/useLearning'

type Toast = (msg: string, err?: boolean, detail?: string) => void
export const PROGRAM_TONE: Record<ProgramStatus, PillTone> = { PLANNED: 'info', ONGOING: 'warn', COMPLETED: 'ok', CANCELLED: 'red' }
const ENROLLMENT_TONE: Record<EnrollmentStatus, PillTone> = { ENROLLED: 'warn', IN_PROGRESS: 'info', COMPLETED: 'ok', DROPPED: 'gray' }
export const PROGRAM_LABEL: Record<ProgramStatus, string> = { PLANNED: 'Planned', ONGOING: 'Ongoing', COMPLETED: 'Completed', CANCELLED: 'Cancelled' }
const ENROLLMENT_LABEL: Record<EnrollmentStatus, string> = { ENROLLED: 'Enrolled', IN_PROGRESS: 'In progress', COMPLETED: 'Completed', DROPPED: 'Dropped' }
/** score is NUMERIC(5,2) (V073); anything larger overflows into a 500. */
const MAX_SCORE = 999.99
/** COMPLETED and DROPPED are final: complete() answers ENROLLMENT_CLOSED, and admin-drop on a dropped row is a silent no-op. */
const isOpenEnrollment = (s: EnrollmentStatus) => s === 'ENROLLED' || s === 'IN_PROGRESS'
const ASSESSMENT_TONE: Record<SkillAssessmentStatus, PillTone> = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'red', WITHDRAWN: 'gray' }
const ASSESSMENT_LABEL: Record<SkillAssessmentStatus, string> = { PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Not approved', WITHDRAWN: 'Withdrawn' }
export const schedule = (p: TrainingProgram) => (p.startDate ? `${dmy(p.startDate)}${p.endDate ? ` – ${dmy(p.endDate)}` : ''}` : 'Dates not set')
const label = 'mb-1.5 block text-[13px] font-semibold text-text-secondary'

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <span aria-hidden="true" style={{ display: 'inline-block', width: 110, height: 7, borderRadius: 999, background: '#eef2f6', overflow: 'hidden', verticalAlign: 'middle' }}>
      <span style={{ display: 'block', height: '100%', width: `${(Math.min(Math.max(value, 0), max) / max) * 100}%`, background: '#059669', borderRadius: 999 }} />
    </span>
  )
}

type Tab = 'programs' | 'my' | 'skills' | 'certifications' | 'approvals'

export const Learning: React.FC = () => {
  const canRead = usePermission('hrms.learning.read')
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  const canViewSkills = usePermission('hrms.learning.skill.read')
  const canAssess = usePermission('hrms.learning.skill.assess.self')
  const canApprove = usePermission('hrms.learning.skill.approve')
  const pending = useSkillAssessmentQueue('PENDING', canApprove)
  const views = [
    ...(canRead ? [{ key: 'programs', label: 'Programs', icon: 'briefcase' }] : []),
    ...(canEnroll ? [{ key: 'my', label: 'My training', icon: 'checkCircle' }] : []),
    ...(canViewSkills ? [{ key: 'skills', label: 'Skill matrix', icon: 'chart' }, { key: 'certifications', label: 'Certifications', icon: 'shield' }] : []),
    ...(canApprove ? [{ key: 'approvals', label: 'Skill approvals', icon: 'userCheck', count: pending.data?.length ?? null, urgent: (pending.data?.length ?? 0) > 0 }] : []),
  ]
  const [tab, setTab] = useView(views.map((v) => v.key)) as [Tab, (k: string) => void]
  return (
    <ModulePage crumb="Learning" title="Learning"
      subtitle={canWrite ? 'Run training programs, follow enrollments and keep the team’s skills on record.' : 'Browse training, enroll, and see your own progress and skills.'}>
      <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
        {views.length > 1 && <Views items={views} active={tab} onChange={setTab} label="Learning views" />}
        {views.length === 0 && <State kind="empty" icon="lock" title="No learning access" description="Ask an admin if you should see training programs." />}
        {tab === 'programs' && canRead && <ProgramsTab canWrite={canWrite} canEnroll={canEnroll} />}
        {tab === 'my' && canEnroll && <MyTrainingTab canAssess={canAssess} />}
        {tab === 'skills' && canViewSkills && <SkillMatrixTab canWrite={canWrite} />}
        {tab === 'certifications' && canViewSkills && <SkillMatrixTab canWrite={canWrite} certificationsOnly />}
        {tab === 'approvals' && canApprove && <SkillApprovalsTab everyone={canWrite} />}
      </div>
    </ModulePage>
  )
}

// ── Programs ───────────────────────────────────────────────────────────────
function NewProgramPanel({ onDone, toast }: { onDone: () => void; toast: Toast }) {
  const { data: companies = [] } = useCompanies()
  const create = useCreateProgram()
  const [f, setF] = useState({ companyId: '', title: '', category: '', trainer: '', startDate: '', endDate: '', capacity: '', description: '', mode: '' })
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const companyId = f.companyId || (companies.length === 1 ? companies[0].id : '')
  const onCreate = async () => {
    if (!f.title.trim()) { toast('Give the program a title', true); return }
    if (!companyId) { toast('Choose a company', true); return }
    if (f.startDate && f.endDate && f.endDate < f.startDate) { toast('The end date is before the start date', true); return }
    if (f.capacity && !(Number.isInteger(Number(f.capacity)) && Number(f.capacity) >= 1)) { toast('Seats must be a whole number of at least 1. Leave it empty for no limit.', true); return }
    try {
      await create.mutateAsync({ companyId, title: f.title.trim(), category: f.category.trim() || undefined, trainer: f.trainer.trim() || undefined, startDate: f.startDate || undefined, endDate: f.endDate || undefined, capacity: f.capacity ? parseInt(f.capacity, 10) : null, description: f.description.trim() || undefined, mode: (f.mode || undefined) as ProgramMode | undefined })
      toast('Program created'); onDone()
    } catch (e) { toast('Couldn’t create the program', true, (e as Error)?.message) }
  }
  return (
    <Panel title="New training program" aside={<HrButton size="sm" variant="ghost" onClick={onDone}>Cancel</HrButton>}>
      <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
        {companies.length > 1 && <div className="sm:col-span-2"><span className={label}>Company</span><HrSelect value={companyId} onChange={(v) => set('companyId', v)} placeholder="Choose a company" options={companies.map((c) => ({ value: c.id, label: c.name }))} /></div>}
        <div className="sm:col-span-2"><label className={label} htmlFor="lp-title">Title</label><input id="lp-title" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Advanced React workshop" className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-cat">Category</label><input id="lp-cat" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Technical" className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-trainer">Trainer</label><input id="lp-trainer" value={f.trainer} onChange={(e) => set('trainer', e.target.value)} placeholder="Optional" className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-start">Starts</label><input id="lp-start" type="date" value={f.startDate} onChange={(e) => set('startDate', e.target.value)} className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-end">Ends</label><input id="lp-end" type="date" min={f.startDate || undefined} value={f.endDate} onChange={(e) => set('endDate', e.target.value)} className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-cap">Seats</label><input id="lp-cap" type="number" min={1} step={1} value={f.capacity} onChange={(e) => set('capacity', e.target.value)} placeholder="Unlimited" className="ut-input" /></div>
        <div><label className={label} htmlFor="lp-mode">Mode</label><select id="lp-mode" value={f.mode} onChange={(e) => set('mode', e.target.value)} className="ut-select"><option value="">Not set</option>{(Object.keys(PROGRAM_MODE_LABEL) as ProgramMode[]).map((m) => <option key={m} value={m}>{PROGRAM_MODE_LABEL[m]}</option>)}</select></div>
        <div className="sm:col-span-2"><label className={label} htmlFor="lp-desc">Description</label><textarea id="lp-desc" value={f.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="Optional" className="ut-input resize-y" /></div>
      </div>
      <div className="flex justify-end"><HrButton onClick={onCreate} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create program'}</HrButton></div>
    </Panel>
  )
}

function ProgramsTab({ canWrite, canEnroll }: { canWrite: boolean; canEnroll: boolean }) {
  const { show, node } = useDesignToast()
  const navigate = useNavigate()
  const [page, setPage] = useState(0)
  const { data, isLoading, isError, error, refetch } = useTrainingPrograms(page)
  const mine = useMyEnrollments(canEnroll)
  const changeStatus = useChangeProgramStatus()
  const enroll = useEnroll()
  const programs = useMemo(() => data?.content ?? [], [data])
  const [showForm, setShowForm] = useState(false)
  // One roster open at a time: it pulls the enrollment list plus a directory page.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const enrolledIn = useMemo(() => new Set((mine.data ?? []).filter((e) => isOpenEnrollment(e.status)).map((e) => e.programId)), [mine.data])
  const stats = useMemo(() => ({
    ongoing: programs.filter((p) => p.status === 'ONGOING').length,
    planned: programs.filter((p) => p.status === 'PLANNED').length,
    seats: programs.reduce((s, p) => s + (p.enrolledCount ?? 0), 0),
  }), [programs])
  const onEnroll = async (p: TrainingProgram) => {
    try { await enroll.mutateAsync(p.id); show(`You’re enrolled in ${p.title}`) } catch (e) { show('Couldn’t enroll you', true, (e as Error)?.message) }
  }
  const onStatus = async (id: string, status: ProgramStatus) => {
    try { await changeStatus.mutateAsync({ id, status }); show(`Program marked ${PROGRAM_LABEL[status].toLowerCase()}`) } catch (e) { show('Couldn’t change the status', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'briefcase', color: 'blue', label: 'Programs', value: String(data?.totalElements ?? 0), sub: 'In the catalogue' },
        { icon: 'clock', color: 'orange', label: 'Ongoing', value: String(stats.ongoing), sub: `${stats.planned} planned · on this page` },
        { icon: 'users', color: 'teal', label: 'Enrollments', value: String(stats.seats), sub: 'On this page' },
        ...(canEnroll ? [{ icon: 'checkCircle', color: 'green' as const, label: 'You’re enrolled in', value: String(enrolledIn.size), sub: 'Open programs' }] : []),
      ]} />}
      <SubHeading aside={canWrite && !showForm ? <HrButton size="sm" onClick={() => setShowForm(true)}><Plus size={14} /> New program</HrButton> : undefined}>Programs</SubHeading>
      {canWrite && showForm && <NewProgramPanel onDone={() => setShowForm(false)} toast={show} />}
      {isError ? <State kind="error" title="Couldn’t load programs" description={(error as Error)?.message} onRetry={() => refetch()} />
        : isLoading ? <State kind="loading" height={220} />
          : programs.length === 0 ? <State kind="empty" icon="briefcase" title="No training programs yet" description={canWrite ? 'Use “New program” to schedule the first one.' : 'Programs HR schedules appear here.'} />
            : (
              <TableCard footer={data && data.totalPages > 1 ? <HrPagination page={page} pageSize={20} totalElements={data.totalElements} totalPages={data.totalPages} onPageChange={setPage} /> : undefined}>
                <table className="hr-table">
                  <thead><tr><th>Program</th><th className="hidden sm:table-cell">Trainer</th><th className="hidden md:table-cell">When</th><th>Seats</th><th>Status</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {programs.map((p) => {
                      const full = p.capacity != null && p.enrolledCount >= p.capacity
                      const closed = p.status === 'COMPLETED' || p.status === 'CANCELLED'
                      const open = expandedId === p.id
                      const isIn = enrolledIn.has(p.id)
                      return (
                        <React.Fragment key={p.id}>
                          <tr>
                            <td>
                              <button type="button" className="text-left font-semibold text-text-primary hover:underline" onClick={() => navigate(`/hrms/learning/programs/${p.id}`)}>{p.title}</button>
                              <div className="text-xs text-text-tertiary">{[p.mode ? PROGRAM_MODE_LABEL[p.mode] : null, p.category, p.description].filter(Boolean).join(' · ') || '—'}</div>
                            </td>
                            <td className="hidden sm:table-cell text-text-secondary">{p.trainer || '—'}</td>
                            <td className="hidden md:table-cell text-text-secondary whitespace-nowrap">{schedule(p)}</td>
                            <td className="text-text-secondary tabular-nums">{p.capacity != null ? `${p.enrolledCount} / ${p.capacity}` : `${p.enrolledCount}`}</td>
                            <td>
                              {canWrite && !closed ? (
                                <select value={p.status} onChange={(e) => onStatus(p.id, e.target.value as ProgramStatus)} disabled={changeStatus.isPending} className="ut-select ut-select-sm w-auto" aria-label={`Status of ${p.title}`}>
                                  {ALLOWED_TRANSITIONS[p.status].map((s) => <option key={s} value={s}>{PROGRAM_LABEL[s]}</option>)}
                                </select>
                              ) : <HrStatusPill tone={PROGRAM_TONE[p.status]}>{PROGRAM_LABEL[p.status]}</HrStatusPill>}
                            </td>
                            <td>
                              <div className="flex flex-wrap justify-end gap-1.5">
                                {canEnroll && !closed && (isIn ? <HrStatusPill tone="ok">You’re enrolled</HrStatusPill>
                                  : <HrButton size="sm" onClick={() => onEnroll(p)} disabled={enroll.isPending || full}>{full ? 'Full' : 'Enroll'}</HrButton>)}
                                <HrButton size="sm" variant="ghost" onClick={() => navigate(`/hrms/learning/programs/${p.id}`)}>{canWrite && !closed ? 'Details & edit' : 'Details'}</HrButton>
                                {canWrite && <HrButton size="sm" variant="ghost" aria-expanded={open} onClick={() => setExpandedId(open ? null : p.id)}>{open ? 'Hide roster' : 'Roster'}</HrButton>}
                              </div>
                            </td>
                          </tr>
                          {open && canWrite && <tr><td colSpan={6} className="!p-0" style={{ background: '#f8fafc' }}><ProgramRoster program={p} toast={show} /></td></tr>}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </TableCard>
            )}
      {node}
    </div>
  )
}

/**
 * Enrollment roster for one program (learning.write only: learning.read is
 * held by every employee, and the roster carries colleagues' scores).
 *   GET  /v1/learning/programs/{id}/enrollments      hrms.learning.read
 *   POST /v1/learning/programs/{id}/enrollments/bulk hrms.learning.write
 *   POST /v1/learning/enrollments/{id}/complete      hrms.learning.write
 *   POST /v1/learning/enrollments/{id}/admin-drop    hrms.learning.write
 */
export function ProgramRoster({ program, toast }: { program: TrainingProgram; toast: Toast }) {
  const { data: enrollments = [], isLoading, isError, refetch } = useProgramEnrollments(program.id)
  const complete = useCompleteEnrollment()
  const adminDrop = useAdminDropEnrollment()
  const bulkEnroll = useBulkEnroll()
  // Raw strings so a half-typed "8." isn't coerced mid-keystroke; blank = no score.
  const [scores, setScores] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [empQuery, setEmpQuery] = useState('')
  // enroll/bulkEnroll throw PROGRAM_CLOSED on a finished program, so the picker is hidden.
  const closed = program.status === 'COMPLETED' || program.status === 'CANCELLED'
  // Server-side search: the directory is paged, so client filtering would silently miss people.
  const { data: dir } = useEmployeeDirectory({ companyId: program.companyId, search: empQuery.trim() || undefined, pageSize: 200 }, { enabled: !!program.companyId && !closed })
  // Dropped rows don't hold a seat, so a dropped employee can be enrolled again.
  const seatedIds = useMemo(() => new Set(enrollments.filter((e) => e.status !== 'DROPPED').map((e) => e.employeeId)), [enrollments])
  const candidates = useMemo(() => (dir?.content ?? []).filter((e) => !seatedIds.has(e.id)), [dir, seatedIds])
  const seatsLeft = program.capacity == null ? null : Math.max(program.capacity - program.enrolledCount, 0)

  const onComplete = async (e: Enrollment) => {
    const raw = (scores[e.id] ?? '').trim()
    let score: number | null = null
    if (raw) {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > MAX_SCORE) { toast(`Score must be a number from 0 to ${MAX_SCORE}`, true); return }
      score = Math.round(n * 100) / 100
    }
    try {
      await complete.mutateAsync({ id: e.id, score })
      toast(score == null ? 'Marked complete' : `Marked complete · score ${score}`)
      setScores((s) => { const next = { ...s }; delete next[e.id]; return next })
    } catch (err) { toast('Couldn’t mark it complete', true, (err as Error)?.message) }
  }
  const onDrop = async (e: Enrollment) => {
    const who = e.employeeName || 'this employee'
    if (!window.confirm(`Drop ${who} from “${program.title}”? The enrollment is kept as dropped, and they can be enrolled again.`)) return
    try { await adminDrop.mutateAsync(e.id); toast(`${who} dropped`) } catch (err) { toast('Couldn’t drop the enrollment', true, (err as Error)?.message) }
  }
  const onBulkEnroll = async () => {
    if (!picked.length) { toast('Pick at least one person', true); return }
    try {
      const r = await bulkEnroll.mutateAsync({ programId: program.id, employeeIds: picked })
      // Counts, not errors, for partial rejections: "0 enrolled" is reported as a failure.
      const parts = [`${r.enrolled} enrolled`]
      if (r.alreadyEnrolled) parts.push(`${r.alreadyEnrolled} already enrolled`)
      if (r.rejectedForCapacity) parts.push(`${r.rejectedForCapacity} turned away, program full`)
      toast(parts.join(' · '), r.enrolled === 0)
      setPicked([]); setEmpQuery('')
    } catch (err) { toast('Couldn’t enroll them', true, (err as Error)?.message) }
  }
  const active = enrollments.filter((e) => e.status !== 'DROPPED').length
  return (
    <div style={{ display: 'grid', gap: 12, padding: 16 }}>
      <SubHeading>{`Roster · ${active} enrolled${seatsLeft != null ? ` · ${seatsLeft} ${seatsLeft === 1 ? 'seat' : 'seats'} left` : ''}`}</SubHeading>
      {isLoading ? <State kind="loading" height={80} />
        : isError ? <State kind="error" title="Couldn’t load the roster" onRetry={() => refetch()} />
          : enrollments.length === 0 ? <Note>{`Nobody has enrolled yet.${closed ? '' : ' Add people below.'}`}</Note>
            : (
              <div className="overflow-x-auto rounded-xl border border-border-default bg-white">
                <table className="hr-table [&_tbody_td]:!py-2">
                  <thead><tr><th>Employee</th><th>Status</th><th>Score</th><th className="hidden sm:table-cell">Completed</th><th className="text-right"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {enrollments.map((e, i) => (
                      <tr key={e.id}>
                        <td><HrAvatar name={e.employeeName || 'Employee'} seed={i} /></td>
                        <td><HrStatusPill tone={ENROLLMENT_TONE[e.status]}>{ENROLLMENT_LABEL[e.status]}</HrStatusPill></td>
                        <td>{isOpenEnrollment(e.status)
                          ? <input type="number" min={0} max={MAX_SCORE} step="0.01" value={scores[e.id] ?? ''} onChange={(ev) => setScores((s) => ({ ...s, [e.id]: ev.target.value }))} placeholder="Optional" aria-label={`Score for ${e.employeeName || 'employee'} (optional)`} className="ut-input ut-input-sm w-24" />
                          : <span className="text-text-secondary">{e.score != null ? e.score : '—'}</span>}</td>
                        <td className="hidden sm:table-cell text-text-secondary">{e.completedAt ? dmy(e.completedAt) : '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-2">
                            {isOpenEnrollment(e.status) ? <>
                              <HrButton size="sm" onClick={() => onComplete(e)} disabled={complete.isPending}>Complete</HrButton>
                              <HrButton size="sm" variant="ghost" onClick={() => onDrop(e)} disabled={adminDrop.isPending}>Drop</HrButton>
                            </> : <span className="text-xs text-text-tertiary">—</span>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      {closed ? <Note>{`This program is ${PROGRAM_LABEL[program.status].toLowerCase()}, so it takes no more enrollments.`}</Note> : (
        <Panel title="Enroll people" pad={16}>
          <input value={empQuery} onChange={(ev) => setEmpQuery(ev.target.value)} placeholder="Search name or code" aria-label="Search employees to enroll" className="ut-input ut-input-sm" />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border-default">
            {candidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-tertiary">{(dir?.content ?? []).length === 0 ? (empQuery.trim() ? 'No one matches that search.' : 'No employees in this company.') : 'Everyone matching is already enrolled.'}</p>
            ) : candidates.map((emp) => (
              <label key={emp.id} className="flex cursor-pointer items-center gap-2 border-b border-border-default px-3 py-2 text-sm text-text-secondary last:border-b-0 hover:bg-bg-base/60">
                <input type="checkbox" checked={picked.includes(emp.id)} onChange={() => setPicked((p) => (p.includes(emp.id) ? p.filter((x) => x !== emp.id) : [...p, emp.id]))} className="h-4 w-4 accent-[#059669]" />
                <span className="text-text-primary">{`${emp.firstName} ${emp.lastName ?? ''}`.trim()}</span>
                {emp.employeeCode && <span className="text-xs text-text-tertiary">{emp.employeeCode}</span>}
              </label>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-tertiary">{`${picked.length} picked`}</span>
            <HrButton size="sm" onClick={onBulkEnroll} disabled={bulkEnroll.isPending || picked.length === 0}>{bulkEnroll.isPending ? 'Enrolling…' : 'Enroll picked'}</HrButton>
          </div>
        </Panel>
      )}
    </div>
  )
}

// ── My training ──────────────────────────────────────────────────────────────
function MyTrainingTab({ canAssess }: { canAssess: boolean }) {
  const { show, node } = useDesignToast()
  const { data: enrollments = [], isLoading, isError, error, refetch } = useMyEnrollments()
  // /enrollments/{id}/drop is enroll.self, and the service only lets you leave your own.
  const drop = useDropEnrollment()
  const active = enrollments.filter((e) => isOpenEnrollment(e.status))
  const completed = enrollments.filter((e) => e.status === 'COMPLETED')
  const onDrop = async (e: Enrollment) => {
    const what = e.programTitle || 'this program'
    if (!window.confirm(`Leave “${what}”? You can enroll again while it’s open.`)) return
    try { await drop.mutateAsync(e.id); show(`You’ve left ${what}`) } catch (err) { show('Couldn’t leave the program', true, (err as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {isLoading ? <State kind="loading" height={96} /> : <StatRow tiles={[
        { icon: 'briefcase', color: 'blue', label: 'Programs', value: String(enrollments.filter((e) => e.status !== 'DROPPED').length), sub: 'You’ve enrolled in' },
        { icon: 'clock', color: 'orange', label: 'In progress', value: String(active.length), sub: 'Still going' },
        { icon: 'checkCircle', color: 'green', label: 'Completed', value: String(completed.length), sub: 'Finished' },
      ]} />}
      <SubHeading>My programs</SubHeading>
      {isError ? <State kind="error" title="Couldn’t load your training" description={(error as Error)?.message} onRetry={() => refetch()} />
        : isLoading ? <State kind="loading" />
          : enrollments.length === 0 ? <State kind="empty" icon="briefcase" title="You’re not enrolled in any training" description="Enroll from Programs to get started." />
            : (
              <RowList>
                {enrollments.map((e) => (
                  <Row key={e.id} muted={e.status === 'DROPPED'} title={e.programTitle || 'Program'}
                    meta={[e.completedAt ? `Completed ${dmy(e.completedAt)}` : `Enrolled ${dmy(e.createdAt)}`, e.score != null ? `score ${e.score}` : null].filter(Boolean).join(' · ')}
                    trail={<>
                      <HrStatusPill tone={ENROLLMENT_TONE[e.status]}>{ENROLLMENT_LABEL[e.status]}</HrStatusPill>
                      {isOpenEnrollment(e.status) && <HrButton size="sm" variant="ghost" onClick={() => onDrop(e)} disabled={drop.isPending}>Leave</HrButton>}
                    </>} />
                ))}
              </RowList>
            )}
      <MySkillsPanel canAssess={canAssess} toast={show} />
      {canAssess && <MySkillProposals toast={show} />}
      {node}
    </div>
  )
}

/**
 * Your own skills: /skills/me resolves you from the token (enroll.self). You
 * can't edit them directly (that's learning.write); with skill.assess.self you
 * propose a level, and it changes only once your manager or HR approves it.
 */
function MySkillsPanel({ canAssess, toast }: { canAssess: boolean; toast: Toast }) {
  const { data: skills = [], isLoading, isError, refetch } = useMySkills()
  const propose = useProposeSkillLevel()
  const [form, setForm] = useState<{ skillName: string; level: string; note: string } | null>(null)
  const onPropose = async () => {
    if (!form) return
    const name = form.skillName.trim()
    if (!name) { toast('Name the skill', true); return }
    if (name.length > 120) { toast('A skill name can be at most 120 characters', true); return }
    if (form.note.trim().length > 1000) { toast('Keep the note under 1,000 characters', true); return }
    try {
      await propose.mutateAsync({ skillName: name, proposedProficiency: parseInt(form.level, 10), note: form.note.trim() || undefined })
      toast(`Sent for approval: ${name} at level ${form.level} of 5`); setForm(null)
    } catch (e) { toast('Couldn’t send it for approval', true, (e as Error)?.message) }
  }
  return (
    <Panel title="My skills"
      sub={canAssess ? 'Think a level is out of date, or a skill is missing? Propose it with a note. Your manager or HR approves it before it’s recorded.' : 'HR keeps this up to date from the skill matrix.'}
      aside={canAssess && !form ? <HrButton size="sm" variant="ghost" onClick={() => setForm({ skillName: '', level: '3', note: '' })}><Plus size={14} /> Propose a skill</HrButton> : undefined}>
      {isLoading ? <State kind="loading" height={80} />
        : isError ? <State kind="error" title="Couldn’t load your skills" onRetry={() => refetch()} />
          : skills.length === 0 ? <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>No skills recorded for you yet.</p>
            : (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 10 }}>
                {skills.map((s) => (
                  <li key={s.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13.5 }}>{s.skillName}</strong>
                      {s.certified && <span style={{ display: 'block', fontSize: 12, color: '#64748b' }}>{`${s.certificationName || 'Certified'}${s.certifiedOn ? ` · ${dmy(s.certifiedOn)}` : ''}`}</span>}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <Bar value={s.proficiency} max={5} /><span style={{ fontSize: 12.5, fontWeight: 700, color: '#475569' }}>{`${s.proficiency}/5`}</span>
                      {canAssess && <HrButton size="sm" variant="ghost" onClick={() => setForm({ skillName: s.skillName, level: String(Math.min(5, s.proficiency + 1)), note: '' })}>Propose a level</HrButton>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
      {canAssess && form && (
        <div style={{ display: 'grid', gap: 12, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div><label className={label} htmlFor="sa-skill">Skill</label><input id="sa-skill" maxLength={120} value={form.skillName} onChange={(e) => setForm({ ...form, skillName: e.target.value })} placeholder="e.g. TypeScript" list="sa-my-skills" className="ut-input" />
              <datalist id="sa-my-skills">{skills.map((s) => <option key={s.id} value={s.skillName} />)}</datalist></div>
            <div><label className={label} htmlFor="sa-level">Your level (1 = beginner, 5 = expert)</label><select id="sa-level" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value })} className="ut-select">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          <div><label className={label} htmlFor="sa-note">Note for your manager (optional)</label><textarea id="sa-note" rows={2} maxLength={1000} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Led the checkout rewrite in TypeScript this quarter" className="ut-input resize-y" /></div>
          <div className="flex justify-end gap-2">
            <HrButton variant="ghost" onClick={() => setForm(null)} disabled={propose.isPending}>Cancel</HrButton>
            <HrButton onClick={onPropose} disabled={propose.isPending}>{propose.isPending ? 'Sending…' : 'Send for approval'}</HrButton>
          </div>
        </div>
      )}
    </Panel>
  )
}

/** Your proposals and what happened to them: GET /v1/learning/skill-assessments/me. */
function MySkillProposals({ toast }: { toast: Toast }) {
  const { data = [], isLoading, isError, error, refetch } = useMySkillAssessments()
  const withdraw = useWithdrawSkillAssessment()
  const onWithdraw = async (a: SkillAssessment) => {
    if (!window.confirm(`Withdraw your proposal for ${a.skillName}? Nothing on your record changes.`)) return
    try { await withdraw.mutateAsync(a.id); toast('Proposal withdrawn') } catch (e) { toast('Couldn’t withdraw it', true, (e as Error)?.message) }
  }
  if (isLoading) return <State kind="loading" height={80} />
  if (isError) return <State kind="error" title="Couldn’t load your proposals" description={(error as Error)?.message} onRetry={() => refetch()} />
  if (!data.length) return null
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <SubHeading>My skill proposals</SubHeading>
      <RowList>
        {data.map((a) => (
          <Row key={a.id} muted={a.status === 'WITHDRAWN'}
            title={`${a.skillName}: ${a.currentProficiency == null ? 'new skill' : `${a.currentProficiency}/5`} → ${a.proposedProficiency}/5`}
            meta={[`Proposed ${stamp(a.createdAt)}`, a.decidedAt ? `${a.status === 'APPROVED' ? 'approved' : 'decided'} ${stamp(a.decidedAt)}${a.decidedByName ? ` by ${a.decidedByName}` : ''}` : null].filter(Boolean).join(' · ')}
            note={a.decisionNote ? `“${a.decisionNote}”` : a.employeeNote || undefined}
            trail={<>
              <HrStatusPill tone={ASSESSMENT_TONE[a.status]}>{ASSESSMENT_LABEL[a.status]}</HrStatusPill>
              {a.status === 'PENDING' && <HrButton size="sm" variant="ghost" onClick={() => onWithdraw(a)} disabled={withdraw.isPending}>Withdraw</HrButton>}
            </>} />
        ))}
      </RowList>
    </div>
  )
}

// ── Skill approvals ──────────────────────────────────────────────────────────
/**
 * Proposed skill levels waiting for a decision (hrms.learning.skill.approve).
 * Managers see their team (same team as My team); HR (learning.write) everyone.
 * Approving writes the level to the person's skill matrix straight away.
 */
function SkillApprovalsTab({ everyone }: { everyone: boolean }) {
  const { show, node } = useDesignToast()
  const pending = useSkillAssessmentQueue('PENDING')
  const decided = useSkillAssessmentQueue('DECIDED')
  const decide = useDecideSkillAssessment()
  const items = pending.data ?? []
  const onDecide = async (id: string, status: 'APPROVED' | 'REJECTED', note: string) => {
    const a = items.find((x) => x.id === id)
    if (status === 'REJECTED' && !note.trim()) { show('Add a note saying why', true, 'The employee sees it, so they know what to work on.'); return }
    try {
      await decide.mutateAsync({ id, decision: status, note: note.trim() || undefined })
      show(status === 'APPROVED' ? `Approved: ${a?.employeeName || 'their'} ${a?.skillName || 'skill'} is now level ${a?.proposedProficiency} of 5` : 'Not approved. They’ve been told why.')
    } catch (e) { show('Couldn’t save the decision', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <SubHeading>{`Waiting for your decision${items.length ? ` · ${items.length}` : ''}`}</SubHeading>
      <Note>{everyone
        ? 'You see everyone’s proposals. Approving updates the person’s skill matrix straight away; a rejection needs a note, which they see.'
        : 'You see proposals from your team: everyone in the departments you head, or your direct reports if you don’t head one. Approving updates their skill matrix straight away; a rejection needs a note, which they see.'}</Note>
      {pending.isLoading ? <State kind="loading" height={120} />
        : pending.isError ? <State kind="error" title="Couldn’t load the proposals" description={(pending.error as Error)?.message} onRetry={() => pending.refetch()} />
          : items.length === 0 ? <State kind="empty" icon="userCheck" title="Nothing to decide" description="Skill levels your team proposes appear here." />
            : <ApprovalList items={items.map((a) => ({
              id: a.id, name: a.employeeName || 'Employee', sub: [a.employeeCode, a.department].filter(Boolean).join(' · ') || undefined,
              facts: [
                { k: 'Skill', v: a.skillName },
                { k: 'Recorded', v: a.currentProficiency == null ? 'New skill' : `${a.currentProficiency} of 5` },
                { k: 'Proposed', v: `${a.proposedProficiency} of 5` },
              ],
              reason: a.employeeNote || undefined, raised: stamp(a.createdAt),
            }))} onDecide={onDecide} busy={decide.isPending} approveLabel="Approve level" approveTip="Approves it and updates their skill matrix" />}
      {(decided.data?.length ?? 0) > 0 && <>
        <SubHeading>Recently decided</SubHeading>
        <RowList>
          {(decided.data ?? []).map((a) => (
            <Row key={a.id} title={`${a.employeeName || 'Employee'} · ${a.skillName} → ${a.proposedProficiency}/5`}
              meta={[a.decidedAt ? stamp(a.decidedAt) : null, a.decidedByName ? `by ${a.decidedByName}` : null].filter(Boolean).join(' · ')}
              note={a.decisionNote || undefined}
              trail={<HrStatusPill tone={ASSESSMENT_TONE[a.status]}>{ASSESSMENT_LABEL[a.status]}</HrStatusPill>} />
          ))}
        </RowList>
      </>}
      {node}
    </div>
  )
}

// ── Skill matrix / certifications ────────────────────────────────────────────
function SkillMatrixTab({ canWrite, certificationsOnly = false }: { canWrite: boolean; certificationsOnly?: boolean }) {
  const { show, node } = useDesignToast()
  const [employeeId, setEmployeeId] = useState('')
  const [employeeName, setEmployeeName] = useState('')
  const { data: allSkills = [], isLoading, isError, error, refetch } = useEmployeeSkills(employeeId)
  const skills = certificationsOnly ? allSkills.filter((s) => s.certified) : allSkills
  const upsert = useUpsertSkill()
  const today = todayIso()
  const [skillName, setSkillName] = useState('')
  const [proficiency, setProficiency] = useState('3')
  const [certified, setCertified] = useState(certificationsOnly)
  const [certificationName, setCertificationName] = useState('')
  const [expiresOn, setExpiresOn] = useState('')
  const [certifiedOn, setCertifiedOn] = useState('')
  const reset = () => { setSkillName(''); setProficiency('3'); setCertified(certificationsOnly); setCertificationName(''); setCertifiedOn(''); setExpiresOn('') }
  const onSave = async () => {
    if (!skillName.trim()) { show('Name the skill', true); return }
    if (certifiedOn && expiresOn && expiresOn < certifiedOn) { show('The expiry is before the certification date', true); return }
    try {
      const isCert = certificationsOnly || certified
      await upsert.mutateAsync({ employeeId, skillName: skillName.trim(), proficiency: parseInt(proficiency, 10), certified: isCert, certificationName: isCert ? certificationName.trim() || undefined : undefined, certifiedOn: isCert ? certifiedOn || undefined : undefined, expiresOn: isCert ? expiresOn || undefined : undefined })
      show('Skill saved'); reset()
    } catch (e) { show('Couldn’t save the skill', true, (e as Error)?.message) }
  }
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title={certificationsOnly ? 'Whose certifications?' : 'Whose skills?'} sub={employeeId ? `Showing ${employeeName.trim()}` : 'Find a colleague to see their record.'}>
        <EmployeePicker value={employeeId} selectedLabel={employeeName} onChange={(e) => { setEmployeeId(e.id); setEmployeeName(`${e.firstName} ${e.lastName || ''}`); reset() }} />
      </Panel>
      {!employeeId ? <State kind="empty" icon={certificationsOnly ? 'shield' : 'chart'} title="No one picked yet" description="Search above to open someone’s record." />
        : isError ? <State kind="error" title="Couldn’t load their skills" description={(error as Error)?.message} onRetry={() => refetch()} />
          : isLoading ? <State kind="loading" />
            : skills.length === 0 ? <State kind="empty" icon={certificationsOnly ? 'shield' : 'chart'} title={certificationsOnly ? 'No certifications recorded' : 'No skills recorded'} description={canWrite ? 'Add the first one below.' : undefined} />
              : (
                <TableCard>
                  <table className="hr-table">
                    <thead><tr><th>Skill</th><th>Proficiency</th><th>Certification</th>{canWrite && <th><span className="sr-only">Actions</span></th>}</tr></thead>
                    <tbody>
                      {skills.map((s) => {
                        const expired = !!s.expiresOn && s.expiresOn < today
                        return (
                          <tr key={s.id}>
                            <td className="font-semibold text-text-primary">{s.skillName}</td>
                            <td><span className="inline-flex items-center gap-2"><Bar value={s.proficiency} max={5} /><span className="text-xs font-semibold text-text-secondary">{`${s.proficiency}/5`}</span></span></td>
                            <td>{s.certified ? (
                              <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-text-primary">
                                <span className="text-[#047857]" aria-hidden="true">{dashIcon('shield', 14)}</span>
                                {s.certificationName || 'Certified'}
                                {s.certifiedOn && <span className="text-xs text-text-tertiary">{`· ${dmy(s.certifiedOn)}`}</span>}
                                {s.expiresOn && <HrStatusPill tone={expired ? 'red' : 'gray'}>{`${expired ? 'Expired' : 'Expires'} ${dmy(s.expiresOn)}`}</HrStatusPill>}
                              </span>
                            ) : <span className="text-xs text-text-tertiary">Not certified</span>}</td>
                            {canWrite && <td><HrButton size="sm" variant="ghost" onClick={() => { setSkillName(s.skillName); setProficiency(String(s.proficiency)); setCertified(s.certified); setCertificationName(s.certificationName || ''); setCertifiedOn(s.certifiedOn || ''); setExpiresOn(s.expiresOn || '') }}>Edit</HrButton></td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </TableCard>
              )}
      {canWrite && employeeId && (
        <Panel title={`Add or update a ${certificationsOnly ? 'certification' : 'skill'} for ${employeeName.trim()}`} sub="Saving a skill name that already exists updates it.">
          <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
            <div><label className={label} htmlFor="sk-name">Skill</label><input id="sk-name" aria-label="Skill name" maxLength={120} value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="e.g. TypeScript" className="ut-input" /></div>
            <div><label className={label} htmlFor="sk-prof">Proficiency (1–5)</label><select id="sk-prof" aria-label="Proficiency" value={proficiency} onChange={(e) => setProficiency(e.target.value)} className="ut-select">{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          {!certificationsOnly && <label className="flex items-center gap-2 text-sm text-text-secondary"><input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="h-4 w-4 accent-[#059669]" /> Certified</label>}
          {(certified || certificationsOnly) && (
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-3">
              <div><label className={label} htmlFor="sk-cert">Certification</label><input id="sk-cert" aria-label="Certification name" maxLength={200} value={certificationName} onChange={(e) => setCertificationName(e.target.value)} placeholder="e.g. AWS Solutions Architect" className="ut-input" /></div>
              <div><label className={label} htmlFor="sk-on">Certified on</label><input id="sk-on" aria-label="Certified on" type="date" max={today} value={certifiedOn} onChange={(e) => setCertifiedOn(e.target.value)} className="ut-input" /></div>
              <div><label className={label} htmlFor="sk-exp">Expires on</label><input id="sk-exp" aria-label="Certification expiry" type="date" min={certifiedOn || undefined} value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} className="ut-input" /></div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            {skillName && <HrButton variant="ghost" onClick={reset}>Clear</HrButton>}
            <HrButton onClick={onSave} disabled={upsert.isPending}>{upsert.isPending ? 'Saving…' : 'Save'}</HrButton>
          </div>
        </Panel>
      )}
      {node}
    </div>
  )
}
