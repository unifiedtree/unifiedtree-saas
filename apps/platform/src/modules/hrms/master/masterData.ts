// API records → the record shapes the Master design reads (its sample data in
// docs/Designs/UnifiedTree Master (offline).html). Every record keeps the API
// row as `_raw` and its id as `_key`, so masterSync.ts can tell what changed.
// Nothing is invented: where the backend has no value the field is null and the
// design shows a dash or "Coming soon" (docs/Designs/STATIC-UI-TO-BUILD.md §6).
import type { Company, Branch, Department, Designation, Grade, EmploymentTypeRecord } from '../api/useOrg'
import type { WorkforceEmployee } from '../api/useWorkforce'
import type { ShiftPolicy } from '../api/useShiftPolicies'
import type { LeaveTypeResponse } from '../api/useLeave'
import type { Policy } from '../api/usePolicy'
import type { SalaryComponent, PayrollSettings, PtSlab } from '../api/usePayroll'
import type { HrConfigResponse } from '../api/useSettings'
import { lwfMonthsLabel } from '@/design/dc/PaySettings'

export interface Contractor {
  id: string; companyId: string; agencyName: string; registrationNumber?: string | null; gstin?: string | null
  contactPersonName?: string | null; contactEmail?: string | null; contactPhone?: string | null; city?: string | null
  /** Linked contract workers who work here now (counted by the API). */
  activeWorkersCount?: number | null; active: boolean
  licenceNumber?: string | null; licenceValidUntil?: string | null; serviceType?: string | null
  siteBranchIds?: string[]; workerIds?: string[]
}
export type Rec = Record<string, any> & { _key?: string }

// ── labels and looks ─────────────────────────────────────────────────────────
export const TYPE_LABEL: Record<string, string> = { FULL_TIME: 'Full-time', PART_TIME: 'Part-time', INTERN: 'Intern', CONTRACT: 'Contract', CONSULTANT: 'Consultant' }
export const TYPE_CODE: Record<string, string> = Object.fromEntries(Object.entries(TYPE_LABEL).map(([k, v]) => [v, k]))
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', PROBATION: 'Probation', NOTICE_PERIOD: 'On notice', EXITED: 'Exited', TERMINATED: 'Exited', SUSPENDED: 'Suspended' }
/** "GENERAL" → "General"; anything already in mixed case is left alone. */
export const pretty = (s?: string | null) => (!s ? '' : s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ') : s)

/** The design's colour tones: [background, text, line, solid]. */
export const TONE_HEX: Record<string, string> = {
  green: '#10b981', blue: '#3b82f6', amber: '#f59e0b', orange: '#f97316', red: '#ef4444', rose: '#f43f5e', violet: '#8b5cf6',
  indigo: '#6366f1', teal: '#14b8a6', cyan: '#06b6d4', pink: '#ec4899', slate: '#94a3b8', brand: '#0f6e56',
}
const rgb = (h: string) => { const x = h.replace('#', ''); const f = x.length === 3 ? x.split('').map((c) => c + c).join('') : x.slice(0, 6); return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) }
/** A stored department colour → the nearest design tone (colours saved here are the tone's own). */
export function toneOfHex(hex: string | null | undefined, fallback: string) {
  if (!hex || !/^#?[0-9a-f]{3,8}$/i.test(hex)) return TONE_HEX[hex || ''] ? hex! : fallback
  const [r, g, b] = rgb(hex)
  let best = fallback, dist = Infinity
  for (const [t, h] of Object.entries(TONE_HEX)) { const [R, G, B] = rgb(h); const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2; if (d < dist) { dist = d; best = t } }
  return best
}
const DEPT_TONES = ['blue', 'violet', 'teal', 'orange', 'pink', 'indigo', 'cyan', 'rose']
/** Icon keys the old Organisation Setup page stored, in the design's icon set. */
const OLD_ICON: Record<string, string> = { team: 'users', laptop: 'laptop', finance: 'wallet', brain: 'lightbulb' }
export const iconOfKey = (k: string | null | undefined, known: Set<string>) => (k && known.has(k) ? k : k && OLD_ICON[k]) || 'briefcase'

const CLS_LOOK: Record<string, [string, string]> = { FULL_TIME: ['green', 'briefcase'], PART_TIME: ['blue', 'clock'], INTERN: ['violet', 'graduation-cap'], CONTRACT: ['orange', 'hard-hat'], CONSULTANT: ['slate', 'user'] }
const LEAVE_LOOK: Record<string, [string, string, string]> = {
  CASUAL: ['Casual', 'amber', 'coffee'], SICK: ['Sick', 'rose', 'heart-pulse'], EARNED: ['Earned', 'teal', 'plane'], MATERNITY: ['Maternity', 'pink', 'baby'],
  PATERNITY: ['Paternity', 'blue', 'baby'], BEREAVEMENT: ['Bereavement', 'slate', 'calendar'], COMPENSATORY: ['Comp-off', 'violet', 'repeat'],
  UNPAID: ['Unpaid', 'red', 'minus-circle'], STUDY: ['Study', 'indigo', 'graduation-cap'], SABBATICAL: ['Sabbatical', 'cyan', 'umbrella'],
}
export const LEAVE_CAT_CODE: Record<string, string> = Object.fromEntries(Object.entries(LEAVE_LOOK).map(([k, v]) => [v[0], k]))
const COMP_CAT: Record<string, string> = { EARNING: 'Earning', DEDUCTION: 'Deduction', EMPLOYER_CONTRIBUTION: 'Employer', REIMBURSEMENT: 'Reimbursement' }
export const COMP_CAT_CODE: Record<string, string> = Object.fromEntries(Object.entries(COMP_CAT).map(([k, v]) => [v, k]))
const COMP_METHOD: Record<string, string> = { FIXED: 'fixed', PERCENT_OF_BASIC: 'pct_basic', PERCENT_OF_GROSS: 'pct_gross', FORMULA: 'formula', STATUTORY: 'statutory' }
export const COMP_METHOD_CODE: Record<string, string> = Object.fromEntries(Object.entries(COMP_METHOD).map(([k, v]) => [v, k]))
/** Branch types (V143.22) → the design's labels. */
const BRANCH_KIND: Record<string, string> = { HEAD_OFFICE: 'Head office', BRANCH: 'Branch', PLANT: 'Plant', WAREHOUSE: 'Warehouse', OFFICE: 'Office', STORE: 'Store', OTHER: 'Other' }
export const BRANCH_KIND_CODE: Record<string, string> = Object.fromEntries(Object.entries(BRANCH_KIND).map(([k, v]) => [v, k]))
const BRANCH_ICON: Record<string, string> = { 'Head office': 'building-2', Plant: 'factory', Warehouse: 'warehouse' }
const num = (x?: number | string | null) => (x == null || x === '' ? null : Number(x))

const hmToMin = (t?: string | null) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0) }
export const rateLabel = (x?: number | null) => (x == null ? null : `${+Number(x).toFixed(2)}×`)
const inr = (n?: number | null) => (n == null ? '—' : '₹' + Math.round(Number(n)).toLocaleString('en-IN'))
const pctText = (n?: number | null) => (n == null ? '—' : `${+Number(n).toFixed(3)}%`)
const months = (n?: number | null) => (n == null ? '—' : n === 0 ? 'None' : n === 1 ? '1 month' : `${n} months`)

// ── records ──────────────────────────────────────────────────────────────────
export function employeeRec(e: WorkforceEmployee, gradeOfDesig: Map<string, string>, shiftOf: Map<string, string>): Rec {
  const first = e.firstName || '', last = e.lastName || ''
  const name = [first, e.middleName, last].filter(Boolean).join(' ') || e.employeeCode || 'Employee'
  const st = e.employmentStatus || 'ACTIVE'
  const out = st === 'EXITED' || st === 'TERMINATED'
  return {
    _key: e.id, _raw: e, id: e.id, code: e.employeeCode || '—', name, first, last,
    desig: e.designationId || '', dept: e.departmentId || '', grade: (e.designationId && gradeOfDesig.get(e.designationId)) || '',
    branch: e.branchId || '', co: e.companyId, type: TYPE_LABEL[e.employmentType || ''] || pretty(e.employmentType) || 'Full-time',
    joined: e.dateOfJoining || '', status: STATUS_LABEL[st] || pretty(st), statusLabel: st === 'TERMINATED' ? 'Terminated' : undefined,
    lwd: out ? '' : e.lastWorkingDay || '', exitOn: out ? e.lastWorkingDay || '' : '',
    email: e.email || '', phone: e.phone || '', shift: shiftOf.get(e.id) || '', mgrId: e.reportingManagerId || '', probEnd: e.probationEndDate || '',
  }
}

const CO_TONES = ['brand', 'orange', 'blue', 'violet', 'teal', 'rose']
export function companyRec(c: Company, i: number, hq: Branch | undefined): Rec {
  return {
    _key: c.id, _raw: c, id: c.id, name: c.name, legal: c.legalName || '', industry: c.industry || '',
    hq: hq ? [hq.city, hq.state].filter(Boolean).join(', ') : '', since: c.incorporationDate ? c.incorporationDate.slice(0, 4) : '', inc: c.incorporationDate || '',
    desc: c.description || '', t: CO_TONES[i % CO_TONES.length], status: c.active === false ? 'Inactive' : 'Active',
    ids: { CIN: c.registrationNumber || '', PAN: c.panNumber || '', TAN: c.tanNumber || '', GSTIN: c.gstin || '' },
  }
}

export function branchRec(b: Branch): Rec {
  const kind = b.headquarters ? 'Head office' : BRANCH_KIND[b.branchType || ''] || 'Branch'
  return {
    _key: b.id, _raw: b, id: b.id, code: b.code || '', name: b.name, kind,
    city: b.city || '', state: b.state || '', co: b.companyId, icon: BRANCH_ICON[kind] || 'building', status: b.active === false ? 'Inactive' : 'Active',
  }
}

export function deptRec(d: Department, i: number, headName: string | null, knownIcons: Set<string>): Rec {
  return {
    _key: d.id, _raw: d, id: d.id, code: d.code || '', name: d.name, icon: iconOfKey(d.iconKey, knownIcons), t: toneOfHex(d.colorHex, DEPT_TONES[i % DEPT_TONES.length]),
    head: headName, headId: d.departmentHeadEmployeeId || null, parent: d.parentDepartmentId || null, status: d.active === false ? 'Inactive' : 'Active', co: d.companyId,
    branches: d.branchIds || [],
  }
}

export function desigRec(x: Designation): Rec {
  // `grade` is the linked grade's code (the grade record's id here), or legacy text that matches no grade (shown as a chip).
  return { _key: x.id, _raw: x, id: x.id, code: x.code || '', name: x.title, dept: x.departmentId || '', grade: x.grade || '', status: x.active === false ? 'Inactive' : 'Active', co: x.companyId }
}

const GRADE_TONES = ['slate', 'cyan', 'teal', 'green', 'blue', 'indigo', 'violet']
export function gradeRec(g: Grade, i: number): Rec {
  return {
    _key: g.id, _raw: g, id: g.code || g.name, name: g.name, min: num(g.minCtcAnnual), max: num(g.maxCtcAnnual), t: GRADE_TONES[Math.min(i, GRADE_TONES.length - 1)],
    status: g.active === false ? 'Inactive' : 'Active', level: g.level, co: g.companyId, hidden: g.bandVisible === false,
  }
}

const AG_TONES = ['orange', 'indigo', 'green', 'teal', 'blue', 'rose']
export function agencyRec(a: Contractor, i: number): Rec {
  return {
    _key: a.id, _raw: a, id: a.id, name: a.agencyName, reg: a.registrationNumber || '', since: '', contact: a.contactPersonName || '',
    phone: a.contactPhone || '', email: a.contactEmail || '', workers: a.activeWorkersCount ?? 0, sites: a.siteBranchIds || [],
    licence: a.licenceValidUntil || null, licenceNo: a.licenceNumber || '', service: a.serviceType || '',
    status: a.active === false ? 'Inactive' : 'Active', t: a.active === false ? 'slate' : AG_TONES[i % AG_TONES.length], co: a.companyId,
  }
}

/** Classification Rules are the employment types. Probation and notice are the company's (HR configuration). */
export function classRec(t: EmploymentTypeRecord, hr: HrConfigResponse | null | undefined, sub: string): Rec {
  const [tone, icon] = CLS_LOOK[t.code || ''] || ['teal', 'tags']
  return {
    _key: t.id, _raw: t, id: t.id, code: t.code || '', name: t.name, desc: '', sub, type: TYPE_LABEL[t.code || ''] || t.name,
    probation: months(hr?.probationPeriodMonths), notice: hr?.defaultNoticePeriodDays ?? null, pf: null, esi: null, gratuity: null, leave: 'All leave types',
    status: t.active === false ? 'Inactive' : 'Active', t: tone, icon, system: !!t.system, co: t.companyId,
  }
}

export function shiftRec(s: ShiftPolicy): Rec {
  const start = hmToMin(s.startTime), end = hmToMin(s.endTime)
  const kind = s.shiftType === 'FLEXIBLE' ? 'Flexible' : s.shiftType === 'ROTATIONAL' ? 'Rotational' : 'Fixed'
  const [icon, t] = kind === 'Flexible' ? ['timer', 'teal'] : start >= 1260 || start < 300 ? ['moon', 'indigo'] : start < 540 ? ['sunrise', 'orange'] : start < 720 ? ['sun', 'amber'] : ['sunset', 'rose']
  return {
    _key: s.id, _raw: s, id: s.id, code: '', name: s.name, kind, start, end, core: null, grace: s.gracePeriodMinutes ?? null, hours: s.workingHoursPerDay ?? 8,
    ot: !!s.overtimeApplicable, rate: s.overtimeApplicable ? rateLabel(s.overtimeMultiplier ?? null) : null, icon, t, offs: null, status: 'Active',
  }
}

export function leaveRec(l: LeaveTypeResponse): Rec {
  const [cat, t, icon] = LEAVE_LOOK[l.category] || [pretty(l.category), 'teal', 'calendar']
  return {
    _key: l.id, _raw: l, id: l.id, code: l.code, name: l.name, cat, quota: l.annualEntitlement, accrual: 'Upfront',
    carry: l.isCarryForwardAllowed ? l.maxCarryForwardDays || 0 : 0, encash: null, paid: !!l.isPaidLeave, icon, t, applies: null,
    gender: l.applicableGender || null, status: l.isActive === false ? 'Inactive' : 'Active',
  }
}

const POLICY_STATUS: Record<string, string> = { ACTIVE: 'Active', DRAFT: 'Draft', ARCHIVED: 'Archived' }
export function policyRec(p: Policy): Rec {
  return {
    _key: p.id, _raw: p, id: p.id, title: p.title, cat: pretty(p.category), ver: (p.version || '').replace(/^v/i, '') || '1.0', eff: p.effectiveDate || '',
    ack: p.acknowledgementCount || 0, status: POLICY_STATUS[p.status] || pretty(p.status), ackReq: true, content: p.content || '',
  }
}

/** What each statutory component works out to, from the payroll settings PayrollEngine uses. */
function statNote(code: string, s: PayrollSettings | null | undefined) {
  if (!s) return ''
  if (code === 'PF_EMPLOYEE') return `${pctText(s.pfEmployeePercent)} of Basic`
  if (code === 'PF_EMPLOYER') return `${pctText(s.pfEmployerPercent)} of Basic`
  if (code === 'ESI_EMPLOYEE') return `${pctText(s.esiEmployeePercent)} of Gross`
  if (code === 'ESI_EMPLOYER') return `${pctText(s.esiEmployerPercent)} of Gross`
  if (code === 'PT') return 'Per state PT slab'
  if (code === 'LWF_EMPLOYEE') return `${inr(s.lwfEmployeeAmount)} in ${lwfMonths(s)}`
  if (code === 'LWF_EMPLOYER') return `${inr(s.lwfEmployerAmount)} in ${lwfMonths(s)}`
  return ''
}
/** The months payroll deducts LWF in, e.g. "June and December". */
const lwfMonths = (s: PayrollSettings) => lwfMonthsLabel((s.lwfDeductionMonths?.length ? [...s.lwfDeductionMonths].sort((a, b) => a - b) : [6, 12]).join(','))
/** Lines payroll works out itself: no amount of their own, and they say where they come from. */
const MANAGED: Record<string, string> = { ADVANCE_RECOVERY: 'Salary advance instalments', PLI_INCENTIVE: 'Approved PLI awards' }
export function componentRec(c: SalaryComponent, s: PayrollSettings | null | undefined): Rec {
  const method = COMP_METHOD[c.computationType] || 'formula'
  return {
    _key: c.id, _raw: c, code: c.code, name: c.name, cat: COMP_CAT[c.category] || pretty(c.category), method,
    val: method === 'pct_basic' || method === 'pct_gross' ? (c.percentValue == null ? null : Number(c.percentValue))
      : method === 'fixed' && c.amount != null && Number(c.amount) > 0 ? Number(c.amount) : null,
    taxable: c.isTaxable ? 'Yes' : 'No', stat: !!c.isStatutory, payslip: c.showOnPayslip !== false, status: c.isActive === false ? 'Inactive' : 'Active', system: !!c.isSystem,
    managed: !!c.isStatutory || c.code in MANAGED, note: statNote(c.code, s) || MANAGED[c.code] || '',
  }
}

/** The four scheme cards on Statutory Settings, from the tenant's payroll settings. */
export function statutoryRecs(s: PayrollSettings, slabs: PtSlab[], compCodes: Set<string>): Rec[] {
  const has = (codes: string[]) => codes.filter((c) => compCodes.has(c))
  const tiers = slabs.filter((x) => Number(x.monthlyTax) > 0).sort((a, b) => Number(a.minSalary) - Number(b.minSalary))
  const ptRows: [string, string][] = !s.ptStateCode ? [['State', 'Not set']]
    : [['State', slabs[0]?.stateName || s.ptStateCode], ...tiers.slice(0, 3).map((x): [string, string] => [x.maxSalary ? `${inr(x.minSalary)} – ${inr(x.maxSalary)}` : `Above ${inr(x.minSalary)}`, `${inr(x.monthlyTax)} / month`])]
  return [
    { _key: 'PF', id: 'PF', name: 'Provident Fund (EPF)', icon: 'landmark', t: 'blue', on: !!s.pfEnabled, reg: s.pfEstablishmentCode || '—', note: '', comps: has(['PF_EMPLOYEE', 'PF_EMPLOYER']),
      rows: [['Employee share', `${pctText(s.pfEmployeePercent)} of Basic`], ['Employer share', `${pctText(s.pfEmployerPercent)} of Basic`], ['Wage ceiling', s.pfApplyCeiling ? `${inr(s.pfWageCeiling)} / month` : 'Not applied'], ['Admin charges', '—']] },
    { _key: 'ESI', id: 'ESI', name: 'Employee State Insurance', icon: 'heart-pulse', t: 'rose', on: !!s.esiEnabled, reg: s.esiEstablishmentCode || '—', note: '', comps: has(['ESI_EMPLOYEE', 'ESI_EMPLOYER']),
      rows: [['Employee share', `${pctText(s.esiEmployeePercent)} of Gross`], ['Employer share', `${pctText(s.esiEmployerPercent)} of Gross`], ['Eligibility', `Gross ≤ ${inr(s.esiWageCeiling)} / month`], ['Contribution periods', 'Apr–Sep · Oct–Mar']] },
    { _key: 'PT', id: 'PT', name: 'Professional Tax', icon: 'receipt', t: 'amber', on: !!s.ptEnabled, reg: '—', note: '', comps: has(['PT']), rows: ptRows },
    { _key: 'LWF', id: 'LWF', name: 'Labour Welfare Fund', icon: 'shield-check', t: 'teal', on: !!s.lwfEnabled, reg: '—', comps: has(['LWF_EMPLOYEE', 'LWF_EMPLOYER']),
      note: `Deducted in the ${lwfMonths(s)} runs`,
      rows: [['Employee share', inr(s.lwfEmployeeAmount)], ['Employer share', inr(s.lwfEmployerAmount)], ['Deducted in', lwfMonths(s)]] },
  ]
}
