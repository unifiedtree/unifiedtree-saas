// Workforce analytics' breakdowns and joiners, worked out from the server's
// answers (GET /v1/reports/headcount/breakdown, /v1/reports/attrition/joiners,
// /v1/reports/headcount/change). Pure, so every rule is unit-tested.
import type { Cell } from '@/shared/export/fileExport'

/** One line of a breakdown; `none` marks the "No branch" / "Not recorded" line. */
export interface BreakdownGroup { name: string; none: boolean; total: number; active: number; probation: number; onNotice: number }

/** GET /v1/reports/headcount/breakdown (hrms.report.headcount; gender only with hrms.report.diversity). */
export interface HeadcountBreakdown {
  asOf: string
  total: number
  active: number
  probation: number
  onNotice: number
  byBranch: BreakdownGroup[]
  byDesignation: BreakdownGroup[]
  byEmploymentType: BreakdownGroup[]
  byAgeBand: BreakdownGroup[]
  byTenureBand: BreakdownGroup[]
  genderIncluded: boolean
  byGender: BreakdownGroup[] | null
}

/** GET /v1/reports/attrition/joiners (hrms.report.attrition): every month of the period. */
export interface JoinersMonth { month: string; joined: number }

export type BreakdownKey = 'branch' | 'designation' | 'type' | 'gender' | 'age' | 'tenure'

const FIELD: Record<BreakdownKey, keyof HeadcountBreakdown> = {
  branch: 'byBranch', designation: 'byDesignation', type: 'byEmploymentType', gender: 'byGender', age: 'byAgeBand', tenure: 'byTenureBand',
}
const LABEL: Record<BreakdownKey, { label: string; column: string }> = {
  branch: { label: 'Branch', column: 'Branch' },
  designation: { label: 'Designation', column: 'Designation' },
  type: { label: 'Employment type', column: 'Employment type' },
  gender: { label: 'Gender', column: 'Gender' },
  age: { label: 'Age', column: 'Age band' },
  tenure: { label: 'Time with us', column: 'Time with us' },
}

/** The breakdowns this answer has, in menu order (gender only when the server included it). */
export function breakdownOptions(b: HeadcountBreakdown | undefined): { value: BreakdownKey; label: string }[] {
  if (!b) return []
  return (Object.keys(FIELD) as BreakdownKey[])
    .filter((k) => k !== 'gender' || (b.genderIncluded && Array.isArray(b.byGender)))
    .map((k) => ({ value: k, label: LABEL[k].label }))
}

/** The chosen breakdown's lines; an unknown or unavailable choice falls back to the first one. */
export function breakdownGroups(b: HeadcountBreakdown | undefined, key: string | null): { key: BreakdownKey; groups: BreakdownGroup[] } | null {
  const options = breakdownOptions(b)
  if (!b || !options.length) return null
  const k = (options.find((o) => o.value === key) ?? options[0]).value
  const groups = b[FIELD[k]]
  return { key: k, groups: Array.isArray(groups) ? groups : [] }
}

export const breakdownColumn = (k: BreakdownKey) => LABEL[k].column
export const breakdownLabel = (k: BreakdownKey) => LABEL[k].label

/** Header plus one row per line plus a total, as the table shows it. */
export function breakdownRows(b: HeadcountBreakdown, k: BreakdownKey): Cell[][] {
  const groups = (b[FIELD[k]] as BreakdownGroup[] | null) ?? []
  const pct = (n: number) => (b.total ? Math.round((n / b.total) * 100) : 0)
  return [
    [breakdownColumn(k), 'Total', 'Active', 'Probation', 'On notice', 'Share %'],
    ...groups.map((g) => [g.name, g.total, g.active, g.probation, g.onNotice, pct(g.total)] as Cell[]),
    ['Total', b.total, b.active, b.probation, b.onNotice, b.total ? 100 : 0],
  ]
}

/** Every breakdown the answer has, one sheet each (for the workbook). */
export function breakdownSheets(b: HeadcountBreakdown): { name: string; rows: Cell[][] }[] {
  return breakdownOptions(b).map((o) => ({ name: `By ${LABEL[o.value].column.toLowerCase()}`.slice(0, 31), rows: breakdownRows(b, o.value) }))
}

/** True when nobody in the breakdown has the value recorded (all on the "Not recorded" line). */
export const nothingRecorded = (groups: BreakdownGroup[]) => groups.length > 0 && groups.every((g) => g.none || g.total === 0) && groups.some((g) => g.none && g.total > 0)

/** Joiners per month keyed by "yyyy-MM"; null when the endpoint isn't there. */
export function joinersByMonth(rows: JoinersMonth[] | undefined | null): Map<string, number> | null {
  if (!rows) return null
  return new Map(rows.map((r) => [r.month, Number(r.joined) || 0]))
}

/** The change endpoint's window for "this month so far": from the day before the month starts to the date. */
export function monthToDate(asOf: string): { from: string; to: string } {
  const [y, m] = asOf.split('-').map(Number)
  const prev = new Date(Date.UTC(y, m - 1, 0))
  return { from: prev.toISOString().slice(0, 10), to: asOf }
}

/** "+3", "−2", "0". */
export const signed = (n: number) => (n > 0 ? `+${n.toLocaleString('en-IN')}` : n < 0 ? `−${Math.abs(n).toLocaleString('en-IN')}` : '0')
