// Test data shaped exactly like the frozen contract (rosterTypes.ts): the owner's example shifts A/B/C/G, a few people
// by designation, and plan answers built by hand. Used by the planner's unit and render tests only.
import type { Checks, Issue, PlanCell, PlanResponse, PlanRow, PlannerPerson, RosterDetail, RosterSummary } from '../../../api/rosterTypes'
import type { ShiftPolicy } from '../../../api/useShiftPolicies'
import { periodDates, isoWeekday } from '../plannerModel'

export const COMPANY = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
export const SH = { A: 'a0000000-0000-0000-0000-00000000000a', B: 'b0000000-0000-0000-0000-00000000000b', C: 'c0000000-0000-0000-0000-00000000000c', G: 'd0000000-0000-0000-0000-00000000000d' }
export const DES = { TE: 'e1000000-0000-0000-0000-000000000001', HV: 'e2000000-0000-0000-0000-000000000002' }

const policy = (id: string, name: string, code: string | null, start: string, end: string, hours: number, people: number, type: ShiftPolicy['shiftType'] = 'FIXED'): ShiftPolicy => ({
  id, name, code, shiftType: type, startTime: `${start}:00`, endTime: `${end}:00`, gracePeriodMinutes: 15, workingHoursPerDay: hours, employeeCount: people,
})
export const POLICIES: ShiftPolicy[] = [
  policy(SH.G, 'General', 'G', '09:00', '18:00', 8, 3),
  policy(SH.B, 'Evening', 'B', '14:00', '22:00', 7.5, 4),
  policy(SH.A, 'Morning', 'A', '06:00', '14:00', 7.5, 5),
  policy(SH.C, 'Night', 'C', '22:00', '06:00', 7.5, 2, 'NIGHT'),
]

export const emp = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const person = (n: number, name: string, designationId: string | null, designationName: string | null, o?: Partial<PlannerPerson>): PlannerPerson => ({
  employeeId: emp(n), name, code: `EMP${String(n).padStart(3, '0')}`, designationId, designationName, departmentId: 'dddddddd-0000-0000-0000-000000000001',
  departmentName: 'Technical', branchId: null, branchName: null, joinedOn: '2024-01-01', lastWorkingDay: null, otherRosters: [], ...o,
})
export const PEOPLE: PlannerPerson[] = [
  person(1, 'Surender Rao', DES.TE, 'Technical Executive'),
  person(2, 'Rakesh Kumar', DES.TE, 'Technical Executive'),
  person(3, 'Shiva Prasad', DES.TE, 'Technical Executive'),
  person(4, 'Praveen Reddy', DES.TE, 'Technical Executive'),
  person(5, 'Anil Varma', DES.HV, 'HVAC Technician'),
  person(6, 'Bhavana Iyer', DES.HV, 'HVAC Technician', { otherRosters: [{ rosterId: 'f0000000-0000-0000-0000-0000000000f0', name: 'October – HVAC', startDate: '2026-10-01', endDate: '2026-10-31' }] }),
  person(7, 'Chandra Sekhar', null, null),
]

export const cell = (token: string | null, code: string | null, o?: Partial<PlanCell>): PlanCell => ({ token, code, edited: false, overlay: null, outside: false, issueIds: [], ...o })
export const issue = (key: string, id: Issue['id'], level: Issue['level'], o?: Partial<Issue>): Issue => ({
  key, id, level, employeeId: null, dates: [], shiftPolicyId: null, designationId: null, message: `${id} message`, ...o,
})
export const checks = (o?: Partial<Checks>): Checks => ({ errors: [], warnings: [], infos: [], summary: [], ...o })

/** A plan answer for the given rows (token per day), with the period's days. */
export function planOf(start: string, end: string, rows: { employeeId: string; name?: string; designationId?: string | null; cells: PlanCell[]; offset?: number }[], o?: Partial<PlanResponse>): PlanResponse {
  const dates = periodDates(start, end)
  return {
    days: dates.map((date) => ({ date, weekday: isoWeekday(date), holidayName: null })),
    rows: rows.map((r): PlanRow => ({
      employeeId: r.employeeId, employeeName: r.name ?? 'Someone', employeeCode: null, designationId: r.designationId ?? null, designationName: null,
      departmentName: null, branchName: null, rotationOffset: r.offset ?? 0, cells: r.cells,
      totals: { working: r.cells.filter((c) => c.token && c.token !== 'WO').length, weeklyOff: r.cells.filter((c) => c.token === 'WO').length, holiday: 0, leave: 0, unplanned: r.cells.filter((c) => !c.token).length },
    })),
    coverage: [], checks: checks(), members: rows.map((r) => ({ employeeId: r.employeeId, rotationOffset: r.offset ?? 0 })),
    ...o,
  }
}

export function summary(o?: Partial<RosterSummary>): RosterSummary {
  return {
    id: '11111111-2222-3333-4444-555555555555', companyId: COMPANY, name: 'October 2026 – Technical', periodType: 'MONTH', startDate: '2026-10-01', endDate: '2026-10-31',
    departmentId: 'dddddddd-0000-0000-0000-000000000001', departmentName: 'Technical', branchId: null, branchName: null, status: 'DRAFT', source: 'PLANNER',
    hasUnpublishedChanges: false, version: 0, memberCount: 4, publishedByName: null, publishedAt: null, updatedByName: 'Hema Rao', updatedAt: '2026-10-09T10:00:00Z',
    canEdit: true, canPublish: true, ...o,
  }
}

export function detail(o?: { roster?: Partial<RosterSummary> & { lockVersion?: number }; rows?: RosterDetail['rows']; members?: RosterDetail['members']; plan?: PlanResponse }): RosterDetail {
  const r = summary(o?.roster)
  return {
    roster: { ...r, lockVersion: o?.roster?.lockVersion ?? 3, config: { templateId: null, pattern: [{ shiftPolicyId: SH.A, weeklyOff: false }, { shiftPolicyId: null, weeklyOff: true }], repeats: true, weeklyOffMode: 'ROTATIONAL', staggerMode: 'SPREAD', continueFromRosterId: null, shiftIds: [SH.A, SH.B, SH.C], designationIds: [DES.TE] } },
    members: o?.members ?? [{ employeeId: emp(1), rotationOffset: 0 }, { employeeId: emp(2), rotationOffset: 1 }],
    staffing: [{ designationId: DES.TE, shiftPolicyId: SH.A, required: 1 }],
    rows: o?.rows ?? [],
    plan: o?.plan ?? planOf(r.startDate, r.endDate, []),
  }
}
