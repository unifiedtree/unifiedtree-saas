// Salary advances, overtime and skill levels waiting for the signed-in person: approvals the server's inbox
// (GET /v1/team/approvals) doesn't list. Read from the same lists and with the same permissions as their own pages,
// shaped as inbox rows (extraApprovals.ts) so the Approvals page shows and decides them with the rest, like the
// phone app (hooks/useExtraApprovals.ts there):
//   advances   GET /v1/advance/requests/approvals              hrms.advance.approve
//   overtime   GET /v1/attendance/overtime, …/overtime/requests attendance.overtime.approve + attendance.team.read
//   skills     GET /v1/learning/skill-assessments?view=PENDING  hrms.learning.skill.approve
// A list that isn't on this server yet comes back empty; one that fails is named in `unavailable`. The keys sit
// under SHARED_KEYS.approvalsInbox, so a decision's refresh reads them again.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usePermission } from '@unifiedtree/sdk'
import { apiJson } from '@/core/api/client'
import { addDays, istToday } from '@/design/dc/dates'
import { useCurrentUser } from '@/shared/hooks/useCurrentUser'
import { SHARED_KEYS, type ApprovalKind, type InboxRow } from '../api/shared/contracts'
import { asAvailable } from '../api/shared/available'
import type { AdvanceRequest, Page } from '../api/useAdvance'
import { loadOvertime, type OvertimeRequest } from '../api/useOvertime'
import type { SkillAssessment } from '../api/useLearning'
import { advanceRows, overtimeRows, skillRows } from './extraApprovals'

const NONE: InboxRow[] = []
const POLL = 30_000

export interface ExtraApprovalsAccess {
  canAdvances: boolean
  canOvertime: boolean
  canSkills: boolean
}

/** Who may see which extra list: the permission each page decides it with (overtime also needs its list). */
export function useExtraApprovalsAccess(): ExtraApprovalsAccess {
  const canAdvances = usePermission('hrms.advance.approve')
  const canOvertimeApprove = usePermission('attendance.overtime.approve')
  const canTeam = usePermission('attendance.team.read')
  const canSkills = usePermission('hrms.learning.skill.approve')
  return { canAdvances, canOvertime: canOvertimeApprove && canTeam, canSkills }
}

async function loadAdvances(): Promise<AdvanceRequest[]> {
  const out: AdvanceRequest[] = []
  const r = await asAvailable(async () => {
    for (let page = 0; page < 10; page++) {
      const p = await apiJson<Page<AdvanceRequest>>(`/v1/advance/requests/approvals?page=${page}&size=100`)
      const content = p?.content ?? []
      out.push(...content)
      if (p?.last !== false || content.length < 100) break
    }
  })
  return r.available ? out : []
}

/** Overtime as the Overtime page reads it: from punches since the start of last month, asked for up to 30 days ahead. */
async function loadOvertimeWaiting(today: string): Promise<{ entries: Awaited<ReturnType<typeof loadOvertime>>; asks: OvertimeRequest[] }> {
  const from = `${addDays(`${today.slice(0, 8)}01`, -1).slice(0, 8)}01`
  const [entries, asks] = await Promise.all([
    asAvailable(() => loadOvertime(from, today)),
    asAvailable(() => apiJson<OvertimeRequest[]>(`/v1/attendance/overtime/requests?from=${from}&to=${addDays(today, 30)}`)),
  ])
  return {
    entries: entries.available ? entries.value : [],
    asks: asks.available && Array.isArray(asks.value) ? asks.value : [],
  }
}

async function loadSkills(): Promise<SkillAssessment[]> {
  const r = await asAvailable(() => apiJson<SkillAssessment[]>('/v1/learning/skill-assessments?view=PENDING'))
  return r.available && Array.isArray(r.value) ? r.value : []
}

export function useExtraApprovals(opts?: { enabled?: boolean }): {
  rows: InboxRow[]
  unavailable: ApprovalKind[]
  isLoading: boolean
  refetch: () => Promise<unknown>
} {
  const on = opts?.enabled ?? true
  const access = useExtraApprovalsAccess()
  const user = useCurrentUser()
  // "Never your own": wait for who you are before any row can be decided.
  const ready = on && user.isSuccess
  const me = user.data?.employeeId ?? null
  const today = istToday()

  const advances = useQuery({
    queryKey: [...SHARED_KEYS.approvalsInbox, 'extra', 'advances'],
    queryFn: loadAdvances,
    enabled: ready && access.canAdvances,
    refetchInterval: POLL,
  })
  const overtime = useQuery({
    queryKey: [...SHARED_KEYS.approvalsInbox, 'extra', 'overtime', today],
    queryFn: () => loadOvertimeWaiting(today),
    enabled: ready && access.canOvertime,
    refetchInterval: POLL,
  })
  const skills = useQuery({
    queryKey: [...SHARED_KEYS.approvalsInbox, 'extra', 'skills'],
    queryFn: loadSkills,
    enabled: ready && access.canSkills,
    refetchInterval: POLL,
  })

  const advData = ready && access.canAdvances ? advances.data : undefined
  const otData = ready && access.canOvertime ? overtime.data : undefined
  const skData = ready && access.canSkills ? skills.data : undefined
  const rows = useMemo(() => {
    if (!advData && !otData && !skData) return NONE
    return [
      ...(advData ? advanceRows(advData, me) : []),
      ...(otData ? overtimeRows(otData.entries, otData.asks, me) : []),
      ...(skData ? skillRows(skData, me) : []),
    ]
  }, [advData, otData, skData, me])

  const unavailable: ApprovalKind[] = [
    ...(ready && access.canAdvances && advances.isError ? ['ADVANCE' as const] : []),
    ...(ready && access.canOvertime && overtime.isError ? ['OVERTIME' as const] : []),
    ...(ready && access.canSkills && skills.isError ? ['SKILL' as const] : []),
  ]
  const isLoading = on && (user.isLoading
    || (access.canAdvances && advances.isLoading) || (access.canOvertime && overtime.isLoading) || (access.canSkills && skills.isLoading))

  const { refetch: refetchAdvances } = advances
  const { refetch: refetchOvertime } = overtime
  const { refetch: refetchSkills } = skills
  const { canAdvances, canOvertime, canSkills } = access
  const refetch = useMemo(() => () => Promise.all([
    ready && canAdvances ? refetchAdvances() : null,
    ready && canOvertime ? refetchOvertime() : null,
    ready && canSkills ? refetchSkills() : null,
  ]), [ready, canAdvances, canOvertime, canSkills, refetchAdvances, refetchOvertime, refetchSkills])

  return { rows, unavailable, isLoading, refetch }
}
