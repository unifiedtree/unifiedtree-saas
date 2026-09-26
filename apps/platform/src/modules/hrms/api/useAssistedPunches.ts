// "Punched by" for assisted face punches (V143.40): a manager or HR punched
// someone in or out by scanning that person's face on their own phone (mobile
// "Punch for team member"). Used by Daily Logs and an employee's attendance.
import { useQuery } from '@tanstack/react-query'
import { apiJson } from '@/core/api/client'

/** One assisted punch (GET /v1/attendance/assisted-punch/punched-by). */
export interface AssistedPunch {
  attendanceRecordId: string | null
  employeeId: string
  /** The attendance day the punch belongs to (a night shift's punch out is on the day it started). */
  attendanceDate: string
  punchType: 'CHECK_IN' | 'CHECK_OUT'
  punchedByName: string | null
  punchedAt: string
}

/** Who punched one person on one day: `short` for a list ("Dept Manager"), `detail` for a day's facts. */
export interface PunchedBy { short: string; detail: string }

/**
 * Assisted punches on these days, one employee's when `employeeId` is set.
 * Empty until V143.40 is applied; on an error the pages just show no label.
 */
export function useAssistedPunches(from: string | undefined, to: string | undefined, employeeId?: string, enabled = true) {
  return useQuery({
    queryKey: ['attendance', 'assisted-punch', 'punched-by', from, to, employeeId ?? null],
    queryFn: () => apiJson<AssistedPunch[]>(`/v1/attendance/assisted-punch/punched-by?${new URLSearchParams({
      from: from as string, to: to as string, ...(employeeId ? { employeeId } : {}),
    })}`),
    enabled: enabled && !!from && !!to,
    staleTime: 30_000,
  })
}

/**
 * "Punched by" per attendance day, keyed by `key` (for example the employee id,
 * or the attendance record id). Days with no assisted punch aren't in the map.
 */
export function punchedByMap(punches: AssistedPunch[] | undefined, key: (p: AssistedPunch) => string | null): Map<string, PunchedBy> {
  const byDay = new Map<string, { in?: string; out?: string }>()
  for (const p of punches ?? []) {
    const k = key(p)
    if (!k) continue
    const cur = byDay.get(k) || {}
    const name = p.punchedByName || 'a manager'
    if (p.punchType === 'CHECK_IN') cur.in = name
    else cur.out = name
    byDay.set(k, cur)
  }
  const out = new Map<string, PunchedBy>()
  byDay.forEach((d, k) => {
    const names = [...new Set([d.in, d.out].filter(Boolean) as string[])]
    const detail = d.in && d.out && d.in === d.out ? `${d.in} (in and out)`
      : [d.in ? `${d.in} (in)` : '', d.out ? `${d.out} (out)` : ''].filter(Boolean).join(', ')
    out.set(k, { short: names.join(' and '), detail })
  })
  return out
}
