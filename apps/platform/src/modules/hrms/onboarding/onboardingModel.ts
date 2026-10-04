// What Onboarding & assets says about its rows (P-HIRE; prototype PgTalent h-onb): onboarding
// and asset status pills, checklist progress, task due days and asset dates. Pure functions
// only, so the rules are unit-tested.
import type { StatusTone } from '@/design/kit/display'
import { dayMon, weekdayDay } from '../hiring/hiringModel'
import type { WorkforceEmployee } from '../api/useWorkforce'
import type { OnboardingInstance, OnboardingOverviewCounts, OnboardingOverviewRow, OnboardingTemplate } from './api/useOnboarding'

export type InstanceStatusKey = 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD'
export const INSTANCE_STATUS_LABEL: Record<InstanceStatusKey, string> = { IN_PROGRESS: 'In progress', COMPLETED: 'Completed', ON_HOLD: 'On hold' }

export function statusKeyOf(status: string): InstanceStatusKey | null {
  return status === 'IN_PROGRESS' || status === 'COMPLETED' || status === 'ON_HOLD' ? status : null
}

/** An unknown status reads as itself ("Cancelled"), never as a wrong label. */
export function statusLabel(status: string): string {
  const k = statusKeyOf(status)
  return k ? INSTANCE_STATUS_LABEL[k] : status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())
}

const DAY = 86_400_000
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / DAY)

/**
 * The design's status pill for a new hire: "Starts Monday" (or "Starts 12 Oct") before the
 * joining day, then In progress, Done or On hold.
 */
export function instanceState(status: string, dateOfJoining: string | null | undefined, today: string): { label: string; tone: StatusTone } {
  switch (statusKeyOf(status)) {
    case 'COMPLETED': return { label: 'Done', tone: 'success' }
    case 'ON_HOLD': return { label: 'On hold', tone: 'danger' }
    case 'IN_PROGRESS': {
      const ahead = dateOfJoining ? daysBetween(today, dateOfJoining) : 0
      if (ahead > 0 && dateOfJoining) {
        const d = new Date(`${dateOfJoining.slice(0, 10)}T00:00:00Z`)
        return { label: ahead === 1 ? 'Starts tomorrow' : ahead < 7 ? `Starts ${DOW_LONG[d.getUTCDay()]}` : `Starts ${dayMon(dateOfJoining, today)}`, tone: 'warning' }
      }
      return { label: 'In progress', tone: 'info' }
    }
    default: return { label: statusLabel(status), tone: 'neutral' }
  }
}

/** "7 of 10 tasks"; "No tasks" for an empty checklist. */
export function progressText(done: number, total: number): string {
  return total ? `${done} of ${total} ${total === 1 ? 'task' : 'tasks'}` : 'No tasks'
}

/** The joining day as the design writes it: "Mon, 28 Sep". */
export const joiningLabel = (day: string | null | undefined, today: string) => weekdayDay(day, today)

/**
 * A template task's due day from its offset in days: before the joining day (negative), on
 * it (0) or after it. Every new hire's due date is their joining date plus this.
 */
export function dueOffsetLabel(n: number): string {
  if (n < 0) return `${-n} ${n === -1 ? 'day' : 'days'} before joining`
  if (n === 0) return 'On the joining day'
  return `Day ${n} after joining`
}

/** HR_MANAGER → "HR manager". */
export const roleLabel = (code: string) => code.split('_').map((w, i) => (['HR', 'IT'].includes(w) ? w : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase())).join(' ')

/** Asset pills: In store (new, or never handed out), With employee, Returned (kept, as today). */
export function assetState(status: string): { label: string; tone: StatusTone } {
  switch (status) {
    case 'AVAILABLE': return { label: 'In store', tone: 'info' }
    case 'ASSIGNED': return { label: 'With employee', tone: 'success' }
    case 'RETURNED': return { label: 'Returned', tone: 'neutral' }
    default: return { label: status.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), tone: 'neutral' }
  }
}

/** "Since 12 Mar 2022" while it's handed out, "Returned 18 Sep" once it's back. */
export function assetDates(a: { status: string; assignedAt?: string | null; returnedAt?: string | null }, today: string): string {
  if (a.status === 'ASSIGNED' && a.assignedAt) return `Since ${dayMon(a.assignedAt, today)}`
  if (a.returnedAt) return `Returned ${dayMon(a.returnedAt, today)}`
  return '—'
}

/** In store = never handed out or back in the store (the design's filter). */
export const inStore = (status: string) => status !== 'ASSIGNED'

type Person = Pick<WorkforceEmployee, 'id' | 'firstName' | 'lastName' | 'employeeCode' | 'dateOfJoining'>

/**
 * The New hires rows and counts built in the browser, as the page did before the overview
 * endpoint (BW-69): for a server that doesn't have it yet. Same rules as the server: done =
 * completed or skipped; overdue = still pending after its due day; counts over every row.
 * Names and joining days come from `people` (only with employee read), checklist names from
 * `templates` (only with template read); without them the row says less, never something wrong.
 */
export function overviewFromInstances(
  runs: readonly Pick<OnboardingInstance, 'id' | 'employeeId' | 'templateId' | 'status' | 'startedAt' | 'completedAt' | 'instanceTasks'>[],
  people: readonly Person[], templates: readonly Pick<OnboardingTemplate, 'id' | 'name'>[], today: string,
): { counts: OnboardingOverviewCounts; rows: OnboardingOverviewRow[] } {
  const byId = new Map(people.map((p) => [p.id, p]))
  const tplName = new Map(templates.map((t) => [t.id, t.name]))
  const rows: OnboardingOverviewRow[] = runs.map((r) => {
    const p = byId.get(r.employeeId)
    const tasks = r.instanceTasks ?? []
    const pending = tasks.filter((t) => t.status === 'PENDING')
    const dues = pending.map((t) => t.dueDate?.slice(0, 10)).filter((d): d is string => !!d).sort()
    return {
      instanceId: r.id, employeeId: r.employeeId, employeeName: p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || null : null,
      employeeCode: p?.employeeCode ?? null, companyId: null, departmentId: null, departmentName: null, dateOfJoining: p?.dateOfJoining ?? null,
      templateId: r.templateId ?? null, templateName: (r.templateId && tplName.get(r.templateId)) || null, status: r.status,
      startedAt: r.startedAt ?? null, completedAt: r.completedAt ?? null, tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t.status === 'COMPLETED' || t.status === 'SKIPPED').length,
      tasksOverdue: dues.filter((d) => d < today).length, nextDueOn: dues[0] ?? null,
    }
  })
  const month = today.slice(0, 7)
  const counts: OnboardingOverviewCounts = {
    all: rows.length,
    inProgress: rows.filter((r) => r.status === 'IN_PROGRESS').length,
    onHold: rows.filter((r) => r.status === 'ON_HOLD').length,
    completed: rows.filter((r) => r.status === 'COMPLETED').length,
    joiningThisMonth: rows.filter((r) => r.dateOfJoining?.slice(0, 7) === month).length,
    tasksOverdue: rows.filter((r) => r.status === 'IN_PROGRESS').reduce((n, r) => n + r.tasksOverdue, 0),
  }
  return { counts, rows }
}
