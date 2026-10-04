// Pure helpers for the Onboarding & assets pages (labels, tones, dates, counts), kept out of the
// components so vitest covers them without a DOM. Everything here works on API values only.
import type { StatusTone } from '@/design/kit/display'
import { MON, WD, WDL, dt } from '@/design/dc/dates'
import type { OnboardingInstance, OnboardingInstanceTask, OnboardingOverviewCounts, OnboardingOverviewRow } from './api/useOnboarding'

// ── Onboarding runs ───────────────────────────────────────────────────────────

/** The run statuses the server sets. The column is free text, so anything else is shown as it is. */
export type RunStatusKey = 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED'
export const RUN_STATUS_KEYS: readonly RunStatusKey[] = ['IN_PROGRESS', 'ON_HOLD', 'COMPLETED']
export const RUN_STATUS: Record<RunStatusKey, { label: string; tone: StatusTone }> = {
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  ON_HOLD: { label: 'On hold', tone: 'danger' },
  COMPLETED: { label: 'Completed', tone: 'success' },
}

export function runStatusKey(status: string | null | undefined): RunStatusKey | null {
  return status === 'IN_PROGRESS' || status === 'ON_HOLD' || status === 'COMPLETED' ? status : null
}

/** "IN_PROGRESS" → "In progress"; an unknown value reads as itself ("SOME_STATE" → "Some state"), never a wrong label. */
export function runStatusLabel(status: string | null | undefined): string {
  const k = runStatusKey(status)
  if (k) return RUN_STATUS[k].label
  const raw = (status ?? '').replace(/_/g, ' ').trim().toLowerCase()
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '—'
}

export function runStatusTone(status: string | null | undefined): StatusTone {
  const k = runStatusKey(status)
  return k ? RUN_STATUS[k].tone : 'neutral'
}

/** Whole days from `from` to `to` (yyyy-MM-dd); NaN when either isn't a date. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

/**
 * The New hires status pill. A run still in progress whose hire hasn't joined yet says when they
 * start ("Starts tomorrow", "Starts Monday" within the week, else "Starts 12 Oct"), as the design
 * shows; every other run shows its status.
 */
export function runPill(status: string, joiningDate: string | null | undefined, today: string): { label: string; tone: StatusTone } {
  if (status === 'IN_PROGRESS' && joiningDate) {
    const days = daysBetween(today, joiningDate)
    if (days === 1) return { label: 'Starts tomorrow', tone: 'warning' }
    if (days > 1 && days < 7) return { label: `Starts ${WDL[dt(joiningDate).getDay()]}`, tone: 'warning' }
    if (days >= 7) return { label: `Starts ${dayMonth(joiningDate)}`, tone: 'warning' }
  }
  return { label: runStatusLabel(status), tone: runStatusTone(status) }
}

/** "2 of 12 tasks", "1 of 1 task", "No tasks". */
export function tasksText(done: number, total: number): string {
  if (!total) return 'No tasks'
  return `${done} of ${total} ${total === 1 ? 'task' : 'tasks'}`
}

/** "12 Oct". */
export function dayMonth(iso: string): string {
  const d = dt(iso)
  return `${d.getDate()} ${MON[d.getMonth()]}`
}

/** "Mon, 28 Sep" this year, "Mon, 28 Sep 2025" otherwise; "—" when there's no date. */
export function joiningText(iso: string | null | undefined, today: string): string {
  if (!iso) return '—'
  const d = dt(iso)
  const year = iso.slice(0, 4) === today.slice(0, 4) ? '' : ` ${d.getFullYear()}`
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}${year}`
}

/** "28 Sep 2026" (the ModuleKit's dmy, without importing the old kit). */
export function fullDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = dt(iso)
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`
}

/** A task's pill on a run's checklist: Done, Skipped, Overdue (past its due day) or To do. */
export function taskPill(task: Pick<OnboardingInstanceTask, 'status' | 'dueDate'>, today: string): { label: string; tone: StatusTone; closed: boolean } {
  if (task.status === 'COMPLETED') return { label: 'Done', tone: 'success', closed: true }
  if (task.status === 'SKIPPED') return { label: 'Skipped', tone: 'muted', closed: true }
  if (task.dueDate && task.dueDate.slice(0, 10) < today) return { label: 'Overdue', tone: 'danger', closed: false }
  return { label: 'To do', tone: 'warning', closed: false }
}

/** Done = completed or skipped; the run completes itself when the last task is done. */
export function progressOf(tasks: readonly Pick<OnboardingInstanceTask, 'status'>[]): { done: number; total: number } {
  const done = tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED').length
  return { done, total: tasks.length }
}

/**
 * The New hires rows from the plain run list, for a server without the overview (BW-69): names
 * from the directory (only with hrms.employee.read), departments from the lookups, template names
 * from the templates list. Counts the way the server does.
 */
export function rowsFromInstances(
  runs: readonly OnboardingInstance[],
  lookups: {
    person: (employeeId: string) => { name?: string; code?: string; companyId?: string; departmentId?: string | null; dateOfJoining?: string | null } | undefined
    department: (departmentId: string) => string | undefined
    template: (templateId: string) => string | undefined
  },
  today: string,
): { rows: OnboardingOverviewRow[]; counts: OnboardingOverviewCounts } {
  const rows = runs.map((r): OnboardingOverviewRow => {
    const p = lookups.person(r.employeeId)
    const tasks = r.instanceTasks ?? []
    const pending = tasks.filter((t) => t.status === 'PENDING')
    const due = pending.map((t) => t.dueDate?.slice(0, 10)).filter((d): d is string => !!d).sort()
    return {
      instanceId: r.id, employeeId: r.employeeId, employeeName: p?.name || null, employeeCode: p?.code || null,
      companyId: p?.companyId || null, departmentId: p?.departmentId ?? null,
      departmentName: p?.departmentId ? lookups.department(p.departmentId) ?? null : null,
      dateOfJoining: p?.dateOfJoining ?? null, templateId: r.templateId, templateName: lookups.template(r.templateId) ?? null,
      status: r.status, startedAt: r.startedAt, completedAt: r.completedAt,
      tasksTotal: tasks.length, tasksDone: progressOf(tasks).done,
      tasksOverdue: due.filter((d) => d < today).length, nextDueOn: due[0] ?? null,
    }
  })
  return { rows, counts: countRows(rows, today) }
}

/** The page's counts over every run (OnboardingOverviewService.count, in the browser). */
export function countRows(rows: readonly OnboardingOverviewRow[], today: string): OnboardingOverviewCounts {
  const c: OnboardingOverviewCounts = { all: rows.length, inProgress: 0, onHold: 0, completed: 0, joiningThisMonth: 0, tasksOverdue: 0 }
  for (const r of rows) {
    if (r.status === 'IN_PROGRESS') { c.inProgress += 1; c.tasksOverdue += r.tasksOverdue }
    else if (r.status === 'ON_HOLD') c.onHold += 1
    else if (r.status === 'COMPLETED') c.completed += 1
    if (r.dateOfJoining && r.dateOfJoining.slice(0, 7) === today.slice(0, 7)) c.joiningThisMonth += 1
  }
  return c
}

// ── Checklist templates ───────────────────────────────────────────────────────

/** HR_MANAGER → "HR manager", DEPT_MANAGER → "Dept manager". */
export const roleLabel = (code: string) => code.split('_')
  .map((w, i) => (['HR', 'IT'].includes(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))
  .join(' ')

/** When a template task is due, from its offset in days: before joining, on the day, or after. */
export function dueLabel(offsetDays: number): string {
  if (offsetDays < 0) { const n = -offsetDays; return `${n} ${n === 1 ? 'day' : 'days'} before joining` }
  if (offsetDays === 0) return 'On the joining day'
  return `Day ${offsetDays} after joining`
}

/** The Add task form's "When" and "Days" back to the stored offset (before = negative, on the day = 0). */
export function offsetOf(when: 'before' | 'on' | 'after', days: number): number {
  if (when === 'on') return 0
  const n = Math.max(1, Math.round(Math.abs(days) || 1))
  return when === 'before' ? -n : n
}

/** "Used by 4 hires", "Used by 1 hire", "Not used yet". */
export function usedByText(usedBy: number | null | undefined): string {
  if (usedBy == null) return '—'
  if (usedBy === 0) return 'Not used yet'
  return `${usedBy} ${usedBy === 1 ? 'hire' : 'hires'}`
}

// ── Assets ────────────────────────────────────────────────────────────────────

/** The design's two states: with an employee, or in store (new or handed back). Unknown values read as themselves. */
export function assetPill(status: string): { label: string; tone: StatusTone } {
  if (status === 'ASSIGNED') return { label: 'With employee', tone: 'success' }
  if (status === 'AVAILABLE' || status === 'RETURNED') return { label: 'In store', tone: 'info' }
  return { label: runStatusLabel(status), tone: 'neutral' }
}

export type AssetFilter = 'all' | 'with' | 'store'
export function assetMatches(status: string, filter: AssetFilter): boolean {
  if (filter === 'with') return status === 'ASSIGNED'
  if (filter === 'store') return status !== 'ASSIGNED'
  return true
}

/** The Dates column: "Since 12 Mar 2022", "Returned 18 Sep 2026 by Deepak Verma", "Not handed out yet". */
export function assetDates(a: { status: string; assignedAt?: string | null; returnedAt?: string | null; lastHolderName?: string | null }): string {
  if (a.status === 'ASSIGNED') return a.assignedAt ? `Since ${fullDate(a.assignedAt)}` : 'Handed out'
  if (a.returnedAt) return `Returned ${fullDate(a.returnedAt)}${a.lastHolderName ? ` by ${a.lastHolderName}` : ''}`
  return 'Not handed out yet'
}

/** A reported problem's kind in plain words. */
export function issueKindLabel(kind: string): string {
  switch (kind) {
    case 'LOST': return 'Lost'
    case 'DAMAGED': return 'Damaged'
    case 'NOT_WORKING': return 'Not working'
    case 'OTHER': return 'Other problem'
    default: return runStatusLabel(kind)
  }
}
