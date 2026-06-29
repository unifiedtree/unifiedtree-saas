import React, { useMemo, useState } from 'react'
import { Plus, GraduationCap, Users, CheckCircle2, Award, BookOpen, Star } from 'lucide-react'
import { format } from 'date-fns'
import { usePermission } from '@unifiedtree/sdk'
import { useToast } from '@/shared/hooks/useToast'
import {
  HrPageHeader, HrButton, HrStatCard, HrStatusPill, TableCard, HrAvatar, type PillTone,
} from '@/shared/components/hr'
import { useCompanies } from './api/useOrg'
import { useEmployeeDirectory } from './api/useWorkforce'
import {
  useTrainingPrograms, useCreateProgram, useChangeProgramStatus, useEnroll,
  useMyEnrollments, useEmployeeSkills, useUpsertSkill,
  PROGRAM_STATUSES,
  type ProgramStatus, type EnrollmentStatus,
} from './api/useLearning'

const PROGRAM_TONE: Record<ProgramStatus, PillTone> = {
  PLANNED: 'info', ONGOING: 'warn', COMPLETED: 'ok', CANCELLED: 'red',
}
const ENROLLMENT_TONE: Record<EnrollmentStatus, PillTone> = {
  ENROLLED: 'warn', COMPLETED: 'ok', DROPPED: 'gray',
}

const fmtDate = (d?: string) => (d ? format(new Date(d), 'd MMM yyyy') : '—')
const inputCls = 'w-full rounded-lg border border-border-default bg-white px-3 py-2 text-sm text-text-primary focus:border-[#FF9D00] focus:outline-none focus:ring-2 focus:ring-[#FF9D00]/20'

type Tab = 'programs' | 'my' | 'skills'

export const Learning: React.FC = () => {
  const canRead = usePermission('hrms.learning.read')
  const canWrite = usePermission('hrms.learning.write')
  const canEnroll = usePermission('hrms.learning.enroll.self')
  const [tab, setTab] = useState<Tab>(canRead ? 'programs' : 'my')

  const tabs: { key: Tab; label: string }[] = [
    ...(canRead ? [{ key: 'programs' as Tab, label: 'Programs' }] : []),
    ...(canEnroll ? [{ key: 'my' as Tab, label: 'My Training' }] : []),
    ...(canRead ? [{ key: 'skills' as Tab, label: 'Skill Matrix' }] : []),
  ]

  return (
    <div className="mx-auto max-w-5xl p-6 sm:p-8">
      <HrPageHeader crumb="Learning & Development" title="Learning Center" subtitle="Run training programs, track enrollments, and map team skills" />

      <div className="mb-5 flex gap-1 border-b border-border-default">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
              tab === t.key ? 'border-[#FF9D00] text-[#C16E00]' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'programs' && canRead && <ProgramsTab canWrite={canWrite} canEnroll={canEnroll} />}
      {tab === 'my' && canEnroll && <MyTrainingTab />}
      {tab === 'skills' && canRead && <SkillMatrixTab canWrite={canWrite} />}
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
        <div className="space-y-3 rounded-2xl border border-border-default bg-white p-5 shadow-sm">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-text-secondary">Program Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Advanced React Workshop" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Category</label>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Technical" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Trainer</label>
              <input value={trainer} onChange={(e) => setTrainer(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Start Date</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">End Date</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Capacity</label>
              <input type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Unlimited" className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Optional" className={inputCls} />
            </div>
          </div>
          <div className="flex justify-end">
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
              return (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-text-primary">{p.title}</div>
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
                        className="rounded-lg border border-border-default bg-white px-2 py-1 text-xs font-semibold text-text-primary focus:border-[#FF9D00] focus:outline-none"
                      >
                        {PROGRAM_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
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
              )
            })}
          </tbody>
        </table>
      </TableCard>
    </div>
  )
}

// ── My Training ──────────────────────────────────────────────────────────────

function MyTrainingTab() {
  const { data: enrollments = [], isLoading } = useMyEnrollments()

  const stats = useMemo(() => {
    const active = enrollments.filter((e) => e.status === 'ENROLLED').length
    const completed = enrollments.filter((e) => e.status === 'COMPLETED').length
    return { active, completed }
  }, [enrollments])

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
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => <tr key={i}><td colSpan={4} className="py-3"><div className="h-5 w-full animate-pulse rounded bg-bg-base" /></td></tr>)
            ) : enrollments.length === 0 ? (
              <tr><td colSpan={4} className="py-14 text-center"><p className="text-sm font-semibold text-text-secondary">You are not enrolled in any training</p><p className="mt-1 text-xs text-text-tertiary">Enroll from the Programs tab to start learning.</p></td></tr>
            ) : enrollments.map((e) => (
              <tr key={e.id}>
                <td className="font-medium text-text-primary">{e.programTitle || 'Program'}</td>
                <td><HrStatusPill tone={ENROLLMENT_TONE[e.status]}>{e.status}</HrStatusPill></td>
                <td className="hidden sm:table-cell text-text-secondary">{e.score != null ? e.score : '—'}</td>
                <td className="hidden sm:table-cell text-text-secondary">{e.completedAt ? fmtDate(e.completedAt) : '—'}</td>
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
      <div className="rounded-2xl border border-border-default bg-white p-4 shadow-sm">
        <label className="mb-1 block text-xs font-semibold text-text-secondary">Employee</label>
        <select value={activeEmployee} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
          {employees.length === 0 && <option value="">No employees</option>}
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{`${e.firstName} ${e.lastName ?? ''}`.trim()} {e.employeeCode ? `(${e.employeeCode})` : ''}</option>
          ))}
        </select>
      </div>

      {canWrite && activeEmployee && (
        <div className="space-y-3 rounded-2xl border border-border-default bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Add / update skill for {empLabel(activeEmployee)}</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Skill name</label>
              <input value={skillName} onChange={(e) => setSkillName(e.target.value)} placeholder="e.g. TypeScript" className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">Proficiency (1–5)</label>
              <select value={proficiency} onChange={(e) => setProficiency(e.target.value)} className={inputCls}>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={certified} onChange={(e) => setCertified(e.target.checked)} className="h-4 w-4 rounded border-border-default text-[#FF9D00] focus:ring-[#FF9D00]" />
            Certified
          </label>
          {certified && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Certification name</label>
                <input value={certificationName} onChange={(e) => setCertificationName(e.target.value)} placeholder="e.g. AWS Solutions Architect" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text-secondary">Certified on</label>
                <input type="date" value={certifiedOn} onChange={(e) => setCertifiedOn(e.target.value)} className={inputCls} />
              </div>
            </div>
          )}
          <div className="flex justify-end">
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
                      <div className="h-full rounded-full bg-[#FF9D00]" style={{ width: `${(Math.min(Math.max(s.proficiency, 0), 5) / 5) * 100}%` }} />
                    </div>
                    <span className="text-xs font-semibold text-text-secondary">{s.proficiency}/5</span>
                  </div>
                </td>
                <td>
                  {s.certified ? (
                    <span className="inline-flex items-center gap-1.5 text-sm text-text-primary">
                      <Award size={14} className="text-[#C16E00]" />
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
