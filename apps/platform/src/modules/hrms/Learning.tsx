import React, { useMemo, useState } from 'react'
import {
  Plus, GraduationCap, Users, CheckCircle2, Award, BookOpen, Star,
  ChevronDown, ChevronRight, UserMinus, UserPlus, LogOut,
} from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, HrTabs, HrTabPanel, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useTrainingPrograms, useCreateProgram, useChangeProgramStatus, useEnroll,
  useMyEnrollments, useEmployeeSkills, useUpsertSkill,
  useProgramEnrollments, useCompleteEnrollment, useBulkEnroll,
  useAdminDropEnrollment, useDropEnrollment,
  ALLOWED_TRANSITIONS,
  type ProgramStatus, type EnrollmentStatus, type TrainingProgram, type Enrollment,
} from './api/useLearning'

const PROGRAM_TONE: Record<ProgramStatus, PillTone> = {
  PLANNED: 'info', ONGOING: 'warn', COMPLETED: 'ok', CANCELLED: 'red',
}
const ENROLLMENT_TONE: Record<EnrollmentStatus, PillTone> = {
  ENROLLED: 'warn', IN_PROGRESS: 'info', COMPLETED: 'ok', DROPPED: 'gray',
}

/** score is NUMERIC(5,2) in V073 — anything larger is a Postgres numeric
 *  overflow, which surfaces as a 500 rather than a readable 400. */
const MAX_SCORE = 999.99

/** Rows an admin can still act on. COMPLETED and DROPPED are terminal: the
 *  service answers ENROLLMENT_CLOSED for complete(), and admin-drop on an
 *  already-dropped row updates nothing and returns 200, i.e. a silent no-op. */
const isOpenEnrollment = (s: EnrollmentStatus) => s === 'ENROLLED' || s === 'IN_PROGRESS'

const fmtDate = (d?: string) => (d ? format(new Date(d), 'd MMM yyyy') : '—')

type Tab = 'programs' | 'my' | 'skills'

export const Learning: React.FC = () => {
  const canRead = usePermission('hrms.learning.read')
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  // Reading colleagues' proficiency + certifications is its own permission
  // (V116). hrms.learning.read is held by every employee so they can browse
  // the catalogue — gating the matrix on it would expose the whole company's
  // skill records to everyone. Admins widen this per role in Settings.
  const canViewSkills = usePermission('hrms.learning.skill.read')

  const tabs: { key: Tab; label: string }[] = [
    ...(canRead ? [{ key: 'programs' as Tab, label: 'Programs' }] : []),
    ...(canEnroll ? [{ key: 'my' as Tab, label: 'My Training' }] : []),
    ...(canViewSkills ? [{ key: 'skills' as Tab, label: 'Skill Matrix' }] : []),
  ]

  // Land on the first tab this role actually has. The old default hard-coded
  // 'programs' or 'my', so a role granted only the skill matrix opened the
  // page on a tab that was not in the list and saw an empty body.
  const [tab, setTab] = useState<Tab | null>(null)
  const activeTab = tab && tabs.some((t) => t.key === tab) ? tab : tabs[0]?.key

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Learning & Development" title="Learning Center" subtitle="Run training programs, track enrollments, and map team skills" />

      <HrTabs tabs={tabs} active={activeTab ?? ''} onChange={(k) => setTab(k as Tab)} />

      {tabs.length === 0 && (
        <div className="ut-card p-10 text-center">
          <p className="text-sm font-semibold text-text-secondary">No access to Learning</p>
          <p className="mt-1 text-xs text-text-tertiary">Ask your administrator to grant a Learning permission.</p>
        </div>
      )}

      {activeTab === 'programs' && canRead && <HrTabPanel tabKey="programs"><ProgramsTab canWrite={canWrite} canEnroll={canEnroll} /></HrTabPanel>}
      {activeTab === 'my' && canEnroll && <HrTabPanel tabKey="my"><MyTrainingTab /></HrTabPanel>}
      {activeTab === 'skills' && canViewSkills && <HrTabPanel tabKey="skills"><SkillMatrixTab canWrite={canWrite} /></HrTabPanel>}
    </div>
  )
}

// ── Programs ──────────────────────────────────────────────────────────────────

function ProgramsTab({ canWrite, canEnroll }: { canWrite: boolean; canEnroll: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const { data, isLoading } = useTrainingPrograms(0)
  const create = useCreateProgram()
  const changeStatus = useChangeProgramStatus()
  const enroll = useEnroll()
  const programs = data?.content ?? []

  const [showForm, setShowForm] = useState(false)
  // Which program's roster is open. One at a time — the roster pulls the
  // enrollment list plus a 200-row employee directory, so expanding every row
  // at once would be a needless fan-out.
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [trainer, setTrainer] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [capacity, setCapacity] = useState('')
  const [description, setDescription] = useState('')

  const stats = useMemo(() => {
    const ongoing = programs.filter((p) => p.status === 'ONGOING').length
    const completed = programs.filter((p) => p.status === 'COMPLETED').length
    const seats = programs.reduce((s, p) => s + (p.enrolledCount ?? 0), 0)
    return { ongoing, completed, seats }
  }, [programs])

  const resetForm = () => {
    setTitle(''); setCategory(''); setTrainer(''); setStartDate(''); setEndDate(''); setCapacity(''); setDescription('')
  }

  const onCreate = async () => {
    if (!title.trim()) { toast('Program title is required', 'error'); return }
    try {
      await create.mutateAsync({
        companyId: companies[0]?.id,
        title: title.trim(),
        category: category.trim() || undefined,
        trainer: trainer.trim() || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        capacity: capacity ? parseInt(capacity, 10) : null,
        description: description.trim() || undefined,
      })
      toast('Training program created', 'success')
      resetForm(); setShowForm(false)
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to create program', 'error')
    }
  }

  const onEnroll = async (id: string) => {
    try {
      await enroll.mutateAsync(id)
      toast('Enrolled successfully', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to enroll', 'error')
    }
  }

  const onStatus = async (id: string, status: ProgramStatus) => {
    try {
      await changeStatus.mutateAsync({ id, status })
      toast('Status updated', 'success')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to update status', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <HrStatCard icon={<BookOpen size={18} />} color="blue" value={programs.length} label="Programs" loading={isLoading} />
        <HrStatCard icon={<GraduationCap size={18} />} color="orange" value={stats.ongoing} label="Ongoing" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={stats.completed} label="Completed" loading={isLoading} />
        <HrStatCard icon={<Users size={18} />} color="teal" value={stats.seats} label="Enrollments" loading={isLoading} />
      </div>

      {canWrite && (
        <div className="flex justify-end">
          <HrButton variant={showForm ? 'ghost' : 'primary'} onClick={() => setShowForm((s) => !s)}>
            <Plus size={15} /> {showForm ? 'Close' : 'New Program'}
          </HrButton>
        </div>
      )}

      {canWrite && showForm && (
        <div className="ut-card p-5">
          <h3 className="mb-4 text-[15px] font-semibold text-text-primary">New Training Program</h3>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Program Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Advanced React Workshop" className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Technical" className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Trainer</label>
              <input value={trainer} onChange={(e) => setTrainer(e.target.value)} placeholder="Optional" className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Capacity</label>
              <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" className="ut-input" />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" className="w-full rounded-xl border border-border-default bg-white px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-[#059669] focus:outline-none focus:ring-2 focus:ring-[#059669]/20" />
            </div>
          </div>
          <div className="mt-5 flex justify-end border-t border-border-default pt-4">
            <HrButton onClick={onCreate} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create Program'}</HrButton>
          </div>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Program</th>
              <th className="hidden sm:table-cell">Trainer</th>
              <th className="hidden sm:table-cell">Schedule</th>
              <th>Seats</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(4)].map((_, i) => <tr key={i}><td colSpan={6} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : programs.length === 0 ? (
              <tr><td colSpan={6} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">No training programs yet</p><p className="mt-1 text-xs text-text-tertiary">{canWrite ? 'Use “New Program” to schedule your first training.' : 'Programs scheduled by HR will appear here.'}</p></td></tr>
            ) : programs.map((p) => {
              const full = p.capacity != null && p.enrolledCount >= p.capacity
              const closed = p.status === 'COMPLETED' || p.status === 'CANCELLED'
              const open = expandedId === p.id
              return (
                <React.Fragment key={p.id}>
                <tr>
                  <td>
                    {/* The roster is the only way to see WHO enrolled and to
                        mark anyone complete, so the title doubles as the
                        expander for anyone who can manage programs. */}
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => setExpandedId(open ? null : p.id)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} enrolled employees for ${p.title}`}
                        className="inline-flex items-center gap-1.5 text-left font-medium text-[#047857] hover:text-[#064E3B]"
                      >
                        {open ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
                        {p.title}
                      </button>
                    ) : (
                      <div className="font-medium text-text-primary">{p.title}</div>
                    )}
                    {p.category && <div className="text-xs text-text-tertiary">{p.category}</div>}
                  </td>
                  <td className="hidden sm:table-cell text-text-secondary">{p.trainer || '—'}</td>
                  <td className="hidden sm:table-cell text-text-secondary">{p.startDate ? `${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}` : '—'}</td>
                  <td className="text-text-secondary">{p.enrolledCount}{p.capacity != null ? ` / ${p.capacity}` : ''}</td>
                  <td>
                    {canWrite && !closed ? (
                      <select
                        value={p.status}
                        onChange={(e) => onStatus(p.id, e.target.value as ProgramStatus)}
                        disabled={changeStatus.isPending}
                        className="ut-select ut-select-sm w-auto"
                        aria-label="Change program status"
                      >
                        {ALLOWED_TRANSITIONS[p.status].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <HrStatusPill tone={PROGRAM_TONE[p.status]}>{p.status}</HrStatusPill>
                    )}
                  </td>
                  <td>
                    <div className="flex justify-end">
                      {canEnroll && !closed && (
                        <HrButton size="sm" onClick={() => onEnroll(p.id)} disabled={enroll.isPending || full}>
                          {full ? 'Full' : 'Enroll'}
                        </HrButton>
                      )}
                    </div>
                  </td>
                </tr>
                {open && canWrite && (
                  <tr>
                    <td colSpan={6} className="bg-bg-base/40 p-0">
                      <ProgramRoster program={p} />
                    </td>
                  </tr>
                )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

/**
 * Enrollment roster for one program, fetched only when its row is expanded.
 *
 * Why this exists: useProgramEnrollments and useCompleteEnrollment had ZERO
 * callers (2026-09-09 dead-hook sweep). HR could create a program and staff
 * could self-enrol, but nobody could ever see who was on it, mark anyone
 * complete, record a score, or enrol somebody who had not enrolled themselves.
 * The training lifecycle dead-ended at "ENROLLED" and no score was ever
 * written by any code path in the product.
 *
 * Permissions used here, all read off LearningController:
 *   GET  /v1/learning/programs/{id}/enrollments      hrms.learning.read
 *   POST /v1/learning/programs/{id}/enrollments/bulk hrms.learning.write
 *   POST /v1/learning/enrollments/{id}/complete      hrms.learning.write
 *   POST /v1/learning/enrollments/{id}/admin-drop    hrms.learning.write
 *
 * The caller mounts this only for hrms.learning.write holders — deliberately
 * narrower than the hrms.learning.read the list endpoint enforces. learning.read
 * is granted to EMPLOYEE and DEPT_MANAGER (V073) so everyone can browse the
 * catalogue; opening the roster to it would put every colleague's training
 * score in front of the whole company, which is the exact leak the narrower
 * skill.read (V116) was introduced to close. Being stricter than the server can
 * only ever show less — it can never produce a 403.
 */
function ProgramRoster({ program }: { program: TrainingProgram }) {
  const { toast } = useToast()
  const { data: enrollments = [], isLoading, isError, refetch } = useProgramEnrollments(program.id)
  const complete = useCompleteEnrollment()
  const adminDrop = useAdminDropEnrollment()
  const bulkEnroll = useBulkEnroll()

  // Score box per row, held as raw strings so a half-typed "8." is not coerced
  // to a number mid-keystroke. Score is optional — blank submits null.
  const [scores, setScores] = useState<Record<string, string>>({})
  const [picked, setPicked] = useState<string[]>([])
  const [empQuery, setEmpQuery] = useState('')

  // enroll()/bulkEnroll() both throw PROGRAM_CLOSED on a COMPLETED or
  // CANCELLED program, so the picker is hidden rather than offered as a
  // control that is guaranteed to fail.
  const closed = program.status === 'COMPLETED' || program.status === 'CANCELLED'

  // Search is pushed to the server rather than filtered client-side: the
  // directory is paged and a tenant with more than 200 employees would
  // otherwise have people who simply never appear in the picker, with no hint
  // that the list was truncated. useEmployeeDirectory keeps the previous page
  // while the next one loads, so the box does not lose focus per keystroke.
  const { data: dir } = useEmployeeDirectory(
    { companyId: program.companyId, search: empQuery.trim() || undefined, pageSize: 200 },
    { enabled: !!program.companyId && !closed },
  )

  // DROPPED rows do not occupy a seat server-side (enrolledCount excludes them
  // and the dedupe check ignores them), so a dropped employee is offerable again.
  const seatedIds = useMemo(
    () => new Set(enrollments.filter((e) => e.status !== 'DROPPED').map((e) => e.employeeId)),
    [enrollments],
  )

  const candidates = useMemo(
    () => (dir?.content ?? []).filter((e) => !seatedIds.has(e.id)),
    [dir, seatedIds],
  )

  const seatsLeft = program.capacity == null ? null : Math.max(program.capacity - program.enrolledCount, 0)

  const onComplete = async (e: Enrollment) => {
    const raw = (scores[e.id] ?? '').trim()
    let score: number | null = null
    if (raw) {
      const n = Number(raw)
      if (!Number.isFinite(n) || n < 0 || n > MAX_SCORE) {
        toast(`Score must be a number between 0 and ${MAX_SCORE}`, 'error'); return
      }
      // NUMERIC(5,2) keeps two decimals; round here so what the user typed and
      // what the row shows after the refetch agree.
      score = Math.round(n * 100) / 100
    }
    try {
      await complete.mutateAsync({ id: e.id, score })
      toast(score == null ? 'Marked complete' : `Marked complete · score ${score}`, 'success')
      setScores((s) => { const next = { ...s }; delete next[e.id]; return next })
    } catch (err) {
      toast((err as Error)?.message ?? 'Failed to complete enrollment', 'error')
    }
  }

  const onDrop = async (e: Enrollment) => {
    const who = e.employeeName || 'this employee'
    if (!window.confirm(`Drop ${who} from “${program.title}”? The enrollment is kept as DROPPED for audit, and they can be enrolled again afterwards.`)) return
    try {
      await adminDrop.mutateAsync(e.id)
      toast(`${who} dropped from the program`, 'success')
    } catch (err) {
      toast((err as Error)?.message ?? 'Failed to drop enrollment', 'error')
    }
  }

  const onBulkEnroll = async () => {
    if (picked.length === 0) { toast('Select at least one employee to enrol', 'error'); return }
    try {
      const r = await bulkEnroll.mutateAsync({ programId: program.id, employeeIds: picked })
      // The endpoint returns counts instead of throwing on a partial or total
      // rejection, so a batch that enrolled nobody would otherwise look like a
      // success. Report all three numbers and treat "0 enrolled" as an error.
      const parts = [`${r.enrolled} enrolled`]
      if (r.alreadyEnrolled) parts.push(`${r.alreadyEnrolled} already enrolled`)
      if (r.rejectedForCapacity) parts.push(`${r.rejectedForCapacity} rejected — program full`)
      toast(parts.join(' · '), r.enrolled > 0 ? 'success' : 'error')
      setPicked([])
      setEmpQuery('')
    } catch (err) {
      toast((err as Error)?.message ?? 'Failed to enrol employees', 'error')
    }
  }

  const togglePicked = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-text-primary">
          Enrolled employees
          <span className="ml-2 font-normal text-text-tertiary">
            {enrollments.filter((e) => e.status !== 'DROPPED').length} active
            {seatsLeft != null && ` · ${seatsLeft} seat${seatsLeft === 1 ? '' : 's'} left`}
          </span>
        </p>
      </div>

      {isLoading ? (
        <div className="h-5 w-full animate-pulse rounded bg-bg-base" />
      ) : isError ? (
        <p className="py-4 text-center text-xs text-red-700">
          Couldn&rsquo;t load the enrollment list.{' '}
          <button type="button" onClick={() => refetch()} className="font-semibold underline underline-offset-2">Try again</button>
        </p>
      ) : enrollments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border-default px-3 py-4 text-center text-xs text-text-tertiary">
          Nobody has enrolled yet.{!closed && ' Use “Enrol employees” below to add them.'}
        </p>
      ) : (
        <table className="hr-table [&_tbody_td]:!py-2">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Score</th>
              <th className="hidden sm:table-cell">Completed</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {enrollments.map((e, i) => (
              <tr key={e.id}>
                <td><HrAvatar name={e.employeeName || 'Employee'} seed={i} /></td>
                <td><HrStatusPill tone={ENROLLMENT_TONE[e.status]}>{e.status}</HrStatusPill></td>
                <td>
                  {isOpenEnrollment(e.status) ? (
                    <input
                      type="number"
                      min={0}
                      max={MAX_SCORE}
                      step="0.01"
                      value={scores[e.id] ?? ''}
                      onChange={(ev) => setScores((s) => ({ ...s, [e.id]: ev.target.value }))}
                      placeholder="Score"
                      aria-label={`Score for ${e.employeeName || 'employee'} (optional)`}
                      className="ut-input ut-input-sm w-24"
                    />
                  ) : (
                    <span className="text-text-secondary">{e.score != null ? e.score : '—'}</span>
                  )}
                </td>
                <td className="hidden sm:table-cell text-text-secondary">{e.completedAt ? fmtDate(e.completedAt) : '—'}</td>
                <td>
                  <div className="flex items-center justify-end gap-2">
                    {isOpenEnrollment(e.status) ? (
                      <>
                        <HrButton size="sm" onClick={() => onComplete(e)} disabled={complete.isPending}>
                          <CheckCircle2 size={14} /> Complete
                        </HrButton>
                        <HrButton size="sm" variant="ghost" onClick={() => onDrop(e)} disabled={adminDrop.isPending}>
                          <UserMinus size={14} /> Drop
                        </HrButton>
                      </>
                    ) : (
                      <span className="text-xs text-text-tertiary">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {closed ? (
        <p className="text-xs text-text-tertiary">
          This program is {program.status} — no further enrollments are accepted.
        </p>
      ) : (
        <div className="rounded-xl border border-border-default bg-white p-4">
          <p className="mb-2 text-[13px] font-semibold text-text-secondary">Enrol employees</p>
          <input
            value={empQuery}
            onChange={(ev) => setEmpQuery(ev.target.value)}
            placeholder="Search name or code…"
            aria-label="Search employees to enrol"
            className="ut-input ut-input-sm mb-2"
          />
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border-default">
            {candidates.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-text-tertiary">
                {(dir?.content ?? []).length === 0
                  ? (empQuery.trim() ? 'No employees match that search.' : 'No employees in this company.')
                  : 'Everyone matching is already enrolled.'}
              </p>
            ) : candidates.map((emp) => (
              <label key={emp.id} className="flex cursor-pointer items-center gap-2 border-b border-border-default px-3 py-2 text-sm text-text-secondary last:border-b-0 hover:bg-bg-base/60">
                <input
                  type="checkbox"
                  checked={picked.includes(emp.id)}
                  onChange={() => togglePicked(emp.id)}
                  className="h-4 w-4 rounded border-border-default text-[#059669] focus:ring-[#059669]"
                />
                <span className="text-text-primary">{`${emp.firstName} ${emp.lastName ?? ''}`.trim()}</span>
                {emp.employeeCode && <span className="text-xs text-text-tertiary">({emp.employeeCode})</span>}
              </label>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-text-tertiary">{picked.length} selected</span>
            <HrButton size="sm" onClick={onBulkEnroll} disabled={bulkEnroll.isPending || picked.length === 0}>
              <UserPlus size={14} /> {bulkEnroll.isPending ? 'Enrolling…' : 'Enrol selected'}
            </HrButton>
          </div>
        </div>
      )}
    </div>
  )
}

// ── My Training ──────────────────────────────────────────────────────────────

function MyTrainingTab() {
  const { toast } = useToast()
  const { data: enrollments = [], isLoading } = useMyEnrollments()
  // POST /v1/learning/enrollments/{id}/drop is gated on
  // hrms.learning.enroll.self — the same permission that gates this whole tab
  // in Learning above, so reaching this component already implies it. The
  // service also rejects dropping an enrollment that is not the caller's own
  // (the 2026-08-11 IDOR fix), so this can only ever leave your own program.
  const drop = useDropEnrollment()

  const stats = useMemo(() => {
    const active = enrollments.filter((e) => isOpenEnrollment(e.status)).length
    const completed = enrollments.filter((e) => e.status === 'COMPLETED').length
    return { active, completed }
  }, [enrollments])

  const onDrop = async (e: Enrollment) => {
    const what = e.programTitle || 'this program'
    if (!window.confirm(`Leave “${what}”? Your enrollment is kept as DROPPED and you can enrol again while the program is open.`)) return
    try {
      await drop.mutateAsync(e.id)
      toast('You have left the program', 'success')
    } catch (err) {
      toast((err as Error)?.message ?? 'Failed to leave the program', 'error')
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <HrStatCard icon={<BookOpen size={18} />} color="blue" value={enrollments.length} label="Enrolled Programs" loading={isLoading} />
        <HrStatCard icon={<GraduationCap size={18} />} color="orange" value={stats.active} label="In Progress" loading={isLoading} />
        <HrStatCard icon={<CheckCircle2 size={18} />} color="green" value={stats.completed} label="Completed" loading={isLoading} />
      </div>

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Program</th>
              <th>Status</th>
              <th className="hidden sm:table-cell">Score</th>
              <th className="hidden sm:table-cell">Completed</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={5} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : enrollments.length === 0 ? (
              <tr><td colSpan={5} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">You are not enrolled in any training</p><p className="mt-1 text-xs text-text-tertiary">Enroll from the Programs tab to start learning.</p></td></tr>
            ) : enrollments.map((e) => (
              <tr key={e.id}>
                <td className="font-medium text-text-primary">{e.programTitle || 'Program'}</td>
                <td><HrStatusPill tone={ENROLLMENT_TONE[e.status]}>{e.status}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{e.score != null ? e.score : '—'}</td>
                <td className="hidden sm:table-cell text-text-secondary">{e.completedAt ? fmtDate(e.completedAt) : '—'}</td>
                <td>
                  <div className="flex justify-end">
                    {isOpenEnrollment(e.status) ? (
                      <HrButton size="sm" variant="ghost" onClick={() => onDrop(e)} disabled={drop.isPending}>
                        <LogOut size={14} /> Leave
                      </HrButton>
                    ) : (
                      <span className="text-xs text-text-tertiary">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

// ── Skill Matrix ─────────────────────────────────────────────────────────────

function SkillMatrixTab({ canWrite }: { canWrite: boolean }) {
  const { toast } = useToast()
  const { data: companies = [] } = useCompanies()
  const companyId = companies[0]?.id || ''
  const { data: dir } = useEmployeeDirectory({ companyId, pageSize: 200 }, { enabled: !!companyId })
  const employees = dir?.content ?? []

  const [employeeId, setEmployeeId] = useState('')
  const activeEmployee = employeeId || employees[0]?.id || ''
  const { data: skills = [], isLoading } = useEmployeeSkills(activeEmployee)
  const upsert = useUpsertSkill()

  const [skillName, setSkillName] = useState('')
  const [proficiency, setProficiency] = useState('3')
  const [certified, setCertified] = useState(false)
  const [certificationName, setCertificationName] = useState('')
  const [certifiedOn, setCertifiedOn] = useState('')

  const onAdd = async () => {
    if (!activeEmployee) { toast('Select an employee first', 'error'); return }
    if (!skillName.trim()) { toast('Skill name is required', 'error'); return }
    try {
      await upsert.mutateAsync({
        employeeId: activeEmployee,
        skillName: skillName.trim(),
        proficiency: parseInt(proficiency, 10),
        certified,
        certificationName: certified ? certificationName.trim() || undefined : undefined,
        certifiedOn: certified ? certifiedOn || undefined : undefined,
      })
      toast('Skill saved', 'success')
      setSkillName(''); setProficiency('3'); setCertified(false); setCertificationName(''); setCertifiedOn('')
    } catch (e) {
      toast((e as Error)?.message ?? 'Failed to save skill', 'error')
    }
  }

  const empLabel = (id: string) => {
    const e = employees.find((x) => x.id === id)
    return e ? `${e.firstName} ${e.lastName ?? ''}`.trim() : ''
  }

  return (
    <div className="space-y-5">
      <div className="ut-card p-4">
        <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Employee</label>
        <select value={activeEmployee} onChange={(e) => setEmployeeId(e.target.value)} className="ut-select">
          {employees.length === 0 && <option value="">No employees</option>}
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName ?? ''}`.trim()} {e.employeeCode ? `(${e.employeeCode})` : ''}</option>
          ))}
        </select>
      </div>

      {canWrite && activeEmployee && (
        <div className="ut-card space-y-3 p-5">
          <h3 className="text-[15px] font-semibold text-text-primary">Add / update skill for {empLabel(activeEmployee)}</h3>
          <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Skill name</label>
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="e.g. TypeScript" className="ut-input" />
            </div>
            <div>
              <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Proficiency (1–5)</label>
              <select value={proficiency} onChange={(e) => setProficiency(e.target.value)} className="ut-select">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="h-4 w-4 rounded border-border-default text-[#059669] focus:ring-[#059669]" />
            Certified
          </label>
          {certified && (
            <div className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Certification name</label>
                <input value={certificationName} onChange={(e) => setCertificationName(e.target.value)} placeholder="e.g. AWS Solutions Architect" className="ut-input" />
              </div>
              <div>
                <label className="mb-1.5 block text-[13px] font-semibold text-text-secondary">Certified on</label>
                <input type="date" value={certifiedOn} onChange={(e) => setCertifiedOn(e.target.value)} className="ut-input" />
              </div>
            </div>
          )}
          <div className="flex justify-end border-t border-border-default pt-4">
            <HrButton onClick={onAdd} disabled={upsert.isPending}><Plus size={15} /> {upsert.isPending ? 'Saving…' : 'Save Skill'}</HrButton>
          </div>
        </div>
      )}

      <TableCard>
        <table className="hr-table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Proficiency</th>
              <th>Certification</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={3} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : skills.length === 0 ? (
              <tr><td colSpan={3} className="py-14 text-center text-sm text-text-tertiary">No skills recorded for this employee yet.</td></tr>
            ) : skills.map((s) => (
              <tr key={s.id}>
                <td className="font-medium text-text-primary">{s.skillName}</td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="flex h-2 w-28 overflow-hidden rounded-full bg-bg-base">
                      <div className="h-full rounded-full bg-[#059669]" style={{ width: `${(Math.min(Math.max(s.proficiency, 0), 5) / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-text-secondary">{s.proficiency}/5</span>
                  </div>
                </td>
                <td>
                  {s.certified ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-text-primary">
                      <Award size={14} className="text-[#047857]" />
                      {s.certificationName || 'Certified'}
                      {s.certifiedOn && <span className="text-xs text-text-tertiary">· {fmtDate(s.certifiedOn)}</span>}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-text-tertiary"><Star size={12} /> Not certified</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}
