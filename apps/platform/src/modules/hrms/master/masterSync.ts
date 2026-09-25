// Turns the Master design's in-memory edits into API calls. The design changes
// its data with update(collection, fn); MasterContainer diffs the collection
// before and after (by `_key`, the API id) and hands the added / changed /
// removed records to the handler here. A handler throws when the server refuses
// (the container then puts the data back and shows why) and returns the query
// keys to refetch when it succeeds.
import { apiJson } from '@/core/api/client'
import { assignEmployeeShift } from '../api/useOrg'
import { sendInvite } from '../employees/api/useInvitation'
import type { PayrollSettings } from '../api/usePayroll'
import { TYPE_CODE, TONE_HEX, LEAVE_CAT_CODE, COMP_CAT_CODE, COMP_METHOD_CODE, BRANCH_KIND_CODE, ACCRUAL_CODE, WEEK, pretty, type Rec } from './masterData'

export interface Diff { added: Rec[]; changed: [Rec, Rec][]; removed: Rec[] }
export interface SyncEnv {
  today: string
  defaultCo: string
  /** The company a department belongs to (for designations and sub-teams). */
  coOfDept: (id: string) => string | undefined
  branches: Rec[]
  settings: PayrollSettings | null
  nextGradeLevel: number
  canInvite: boolean
  canAssignShift: boolean
  /** May see and set grade pay bands (hrms.grade.band.read). */
  canBands: boolean
  /** The id of a company's grade with this code (the design keys grades by code). */
  gradeIdOf: (code: string, co: string) => string | undefined
  /** A side step failed after the main save worked (shift, invitation). */
  warn: (msg: string) => void
}

/** Compare records by `_key`. A record without one (or a second copy of one) is new. */
export function diff(prev: Rec[], next: Rec[]): Diff {
  const before = new Map(prev.filter((r) => r._key).map((r) => [r._key!, r]))
  const seen = new Set<string>(), added: Rec[] = [], changed: [Rec, Rec][] = []
  for (const r of next) {
    if (!r._key || seen.has(r._key) || !before.has(r._key)) { added.push(r); continue }
    seen.add(r._key)
    const o = before.get(r._key)!
    if (o !== r) changed.push([o, r])
  }
  return { added, changed, removed: prev.filter((r) => r._key && !seen.has(r._key)) }
}

const json = (method: string, body?: unknown) => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
const q = (params: Record<string, string | undefined | null>) => Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&')
const blank = (s: unknown) => (s == null || String(s).trim() === '' ? undefined : String(s).trim())
const errMsg = (e: unknown) => (e instanceof Error && e.message) || 'Please try again.'
/** Run each save; if any fail, report how many and the first reason. */
async function each<T>(items: T[], fn: (x: T) => Promise<unknown>, noun: string) {
  const errors: string[] = []
  for (const x of items) { try { await fn(x) } catch (e) { errors.push(errMsg(e)) } }
  if (errors.length) throw new Error(items.length > 1 ? `${errors.length} of ${items.length} ${noun} couldn’t be saved: ${errors[0]}` : errors[0])
}
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
const changedAny = (o: Rec, r: Rec, keys: string[]) => keys.some((k) => JSON.stringify(o[k] ?? null) !== JSON.stringify(r[k] ?? null))

// ── employees ────────────────────────────────────────────────────────────────
async function saveEmployee(o: Rec, r: Rec, env: SyncEnv) {
  const id = r._key!
  const map: [string, string, (v: any) => unknown][] = [
    ['first', 'firstName', (v) => String(v || '').trim()], ['last', 'lastName', (v) => String(v || '').trim()], ['email', 'email', (v) => String(v || '').trim()],
    ['phone', 'phone', (v) => String(v || '').trim()], ['dept', 'departmentId', (v) => v || undefined], ['desig', 'designationId', (v) => v || undefined],
    ['branch', 'branchId', (v) => v || undefined], ['type', 'employmentType', (v) => TYPE_CODE[v] || undefined], ['joined', 'dateOfJoining', (v) => v || undefined],
  ]
  const patch: Record<string, unknown> = {}
  for (const [k, api, f] of map) if ((o[k] ?? '') !== (r[k] ?? '')) patch[api] = f(r[k])
  if (Object.keys(patch).length) await apiJson(`/v1/hrms/employees/${id}`, json('PUT', patch))
  // The staffing agency of a contract worker (after the type change above, which it depends on).
  const oldAgency = o.agency || '', newAgency = (r.type === 'Contract' && r.agency) || ''
  if (oldAgency !== newAgency) {
    if (oldAgency) await apiJson(`/v1/hrms/contractors/${oldAgency}/workers/${id}`, json('DELETE'))
    if (newAgency) await apiJson(`/v1/hrms/contractors/${newAgency}/workers/${id}`, json('PUT'))
  }
  if (r.shift && r.shift !== o.shift) await assignEmployeeShift(id, r.shift)
  if (r.status !== o.status) {
    const base = `/v1/hrms/employees/${id}`
    if (r.status === 'Exited') await apiJson(`${base}/exit?${q({ lastWorkingDay: r.exitOn })}`, json('POST'))
    else if (r.status === 'On notice') await apiJson(`${base}/notice?${q({ noticeStart: env.today, lastWorkingDay: r.lwd })}`, json('POST'))
    else if (r.status === 'Active' && o.status === 'Probation') await apiJson(`${base}/confirm?${q({ confirmationDate: env.today })}`, json('POST'))
    else if (r.status === 'Active' && o.status === 'On notice') await apiJson(`${base}/cancel-notice`, json('POST'))
    else if (r.status === 'Active' || r.status === 'Probation') await apiJson(base, json('PUT', { employmentStatus: r.status === 'Active' ? 'ACTIVE' : 'PROBATION' }))
  }
}
async function employees({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) {
    const body = {
      companyId: r.co, firstName: String(r.first || '').trim(), lastName: blank(r.last), email: blank(r.email), phone: blank(r.phone),
      departmentId: r.dept || undefined, designationId: r.desig || undefined, branchId: r.branch || undefined,
      employmentType: TYPE_CODE[r.type] || 'FULL_TIME', dateOfJoining: r.joined || undefined,
      // The backend still needs a role on create; access is raised later in Users & Access (as in the Add Employee wizard).
      roleCode: 'EMPLOYEE',
    }
    const created = await apiJson<{ id: string; email?: string }>('/v1/hrms/employees', json('POST', body))
    const name = [body.firstName, body.lastName].filter(Boolean).join(' ')
    if (r.shift && env.canAssignShift) {
      try { await assignEmployeeShift(created.id, r.shift) } catch (e) { env.warn(`${name} was added, but the shift couldn’t be assigned: ${errMsg(e)}`) }
    }
    if (r.type === 'Contract' && r.agency) {
      try { await apiJson(`/v1/hrms/contractors/${r.agency}/workers/${created.id}`, json('PUT')) } catch (e) { env.warn(`${name} was added, but couldn’t be linked to the agency: ${errMsg(e)}`) }
    }
    if (env.canInvite && created.email) {
      try { await sendInvite(created.id) } catch { env.warn(`${name} was added, but the invitation couldn’t be sent — resend it from Users & Access`) }
    }
  }
  await each(changed, ([o, r]) => saveEmployee(o, r, env), 'employees')
  return [['hrms', 'employees'], ['hrms', 'employee'], ['hrms', 'employee-counts'], ['master', 'schedule'], ['shifts', 'employee'], ['master', 'contractors']]
}

// ── organisation ─────────────────────────────────────────────────────────────
const companyBody = (r: Rec) => ({
  name: String(r.name).trim(), legalName: r.legal ?? '', registrationNumber: r.ids?.CIN ?? '', panNumber: r.ids?.PAN ?? '', gstin: r.ids?.GSTIN ?? '', industry: r.industry ?? '',
  // A blank value clears these three on the server.
  tanNumber: r.ids?.TAN ?? '', incorporationDate: r.inc ?? '', description: String(r.desc ?? '').trim(),
})
async function companies({ added, changed }: Diff) {
  for (const r of added) {
    const b = companyBody(r)
    await apiJson('/v1/hrms/companies', json('POST', { ...b, legalName: blank(b.legalName), registrationNumber: blank(b.registrationNumber), panNumber: blank(b.panNumber), gstin: blank(b.gstin), industry: blank(b.industry), tanNumber: blank(b.tanNumber), incorporationDate: blank(b.incorporationDate), description: blank(b.description) }))
  }
  await each(changed, ([, r]) => apiJson(`/v1/hrms/companies/${r._key}`, json('PUT', companyBody(r))), 'companies')
  return [['hrms', 'companies']]
}

// One head office per company: the server switches the previous one back to a
// branch in the same save (BranchService, V143.14), so no second call is needed.
async function branches({ added, changed }: Diff) {
  for (const r of added) {
    const hq = r.kind === 'Head office'
    await apiJson<{ id: string }>('/v1/hrms/branches', json('POST', { companyId: r.co, name: String(r.name).trim(), code: blank(r.code), city: blank(r.city), state: blank(r.state), isHeadquarters: hq, branchType: BRANCH_KIND_CODE[r.kind] || 'BRANCH' }))
  }
  await each(changed, async ([o, r]) => {
    const hq = r.kind === 'Head office'
    if (changedAny(o, r, ['name', 'code', 'city', 'state', 'kind'])) await apiJson(`/v1/hrms/branches/${r._key}`, json('PUT', { name: String(r.name).trim(), code: r.code ?? '', city: r.city ?? '', state: r.state ?? '', isHeadquarters: hq, branchType: BRANCH_KIND_CODE[r.kind] || 'BRANCH' }))
    if (o.status !== r.status) await apiJson(`/v1/hrms/branches/${r._key}`, json('PUT', { isActive: r.status === 'Active' }))
  }, 'branches')
  return [['hrms', 'branches']]
}

async function depts({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) {
    await apiJson('/v1/hrms/departments', json('POST', {
      companyId: (r.parent && env.coOfDept(r.parent)) || env.defaultCo, name: String(r.name).trim(), code: blank(r.code),
      parentDepartmentId: r.parent || undefined, colorHex: TONE_HEX[r.t] || undefined, iconKey: r.icon || undefined,
      branchIds: r.branches?.length ? r.branches : undefined,
    }))
  }
  await each(changed, async ([o, r]) => {
    const base = `/v1/hrms/departments/${r._key}`
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(base, json('DELETE')); return }
    if ((r.parent || null) !== (o.parent || null)) await apiJson(`${base}/parent${r.parent ? '?parentId=' + r.parent : ''}`, json('PATCH'))
    if (JSON.stringify(r.branches || []) !== JSON.stringify(o.branches || [])) await apiJson(`${base}/branches`, json('PUT', { branchIds: r.branches || [] }))
    if (r.name !== o.name) await apiJson(`${base}/name?${q({ name: String(r.name).trim() })}`, json('PATCH'))
    if ((r.code || '') !== (o.code || '')) await apiJson(`${base}/details?code=${encodeURIComponent(r.code || '')}`, json('PATCH'))
    if (r.icon !== o.icon || r.t !== o.t) await apiJson(`${base}/appearance?${q({ colorHex: TONE_HEX[r.t], iconKey: r.icon })}`, json('PATCH'))
    if ((r.headId || null) !== (o.headId || null)) await apiJson(`${base}/head${r.headId ? '?employeeId=' + r.headId : ''}`, json('PATCH'))
  }, 'departments')
  return [['hrms', 'departments']]
}

async function desigs({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) {
    await apiJson('/v1/hrms/designations', json('POST', { companyId: (r.dept && env.coOfDept(r.dept)) || env.defaultCo, title: String(r.name).trim(), gradeId: env.gradeIdOf(r.grade, (r.dept && env.coOfDept(r.dept)) || env.defaultCo), grade: blank(r.grade), code: blank(r.code), departmentId: r.dept || undefined }))
  }
  await each(changed, async ([o, r]) => {
    const base = `/v1/hrms/designations/${r._key}`
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(base, json('DELETE')); return }
    if (r.status !== o.status) throw new Error('Deactivated designations can’t be switched back on yet')
    // A full replace: fields this page doesn't show are sent back as they were.
    // The grade goes by id; text that matches no grade (a legacy chip) is sent back as it was.
    await apiJson(base, json('PUT', { title: String(r.name).trim(), gradeId: env.gradeIdOf(r.grade, r.co || env.defaultCo) ?? null, grade: blank(r.grade), code: String(r.code || '').trim(), departmentId: r.dept || null, reportsToDesignationId: r._raw?.reportsToDesignationId ?? null, jobResponsibilities: r._raw?.jobResponsibilities ?? null }))
  }, 'designations')
  return [['hrms', 'designations']]
}

async function grades({ added, changed }: Diff, env: SyncEnv) {
  let level = env.nextGradeLevel
  // The band is only sent by someone who may see it; the server keeps it for anyone else.
  const band = (r: Rec) => (env.canBands ? { minCtcAnnual: r.min ?? null, maxCtcAnnual: r.max ?? null } : {})
  for (const r of added) await apiJson('/v1/hrms/grades', json('POST', { companyId: env.defaultCo, code: String(r.id).trim(), name: String(r.name).trim(), level: level++, active: true, ...band(r) }))
  await each(changed, async ([o, r]) => {
    const base = `/v1/hrms/grades/${r._key}`
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(base, json('DELETE')); return }
    await apiJson(base, json('PUT', { companyId: r._raw?.companyId, code: String(r.id).trim(), name: String(r.name).trim(), level: r._raw?.level ?? 1, description: r._raw?.description ?? null, active: true, ...band(r) }))
  }, 'grades')
  // A grade's code shows on designations; a new grade can also link old free-text titles.
  return [['hrms', 'org', 'grades'], ['hrms', 'designations'], ['hrms', 'pay-bands']]
}

// ── workforce setup ──────────────────────────────────────────────────────────
/** The agency form's fields. Blank clears a field on the server; GSTIN and the address aren't on the form, so they're left alone. */
const agencyBody = (r: Rec) => ({
  agencyName: String(r.name).trim(), registrationNumber: r.reg ?? '', contactPersonName: r.contact ?? '', contactPhone: r.phone ?? '', contactEmail: r.email ?? '',
  serviceType: r.service ?? '', licenceNumber: r.licenceNo ?? '', licenceValidUntil: r.licence ?? '', siteBranchIds: r.sites || [],
})
async function agencies({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) {
    const b = agencyBody(r)
    await apiJson('/v1/hrms/contractors', json('POST', {
      ...b, companyId: env.defaultCo, registrationNumber: blank(b.registrationNumber), contactPersonName: blank(b.contactPersonName), contactEmail: blank(b.contactEmail),
      contactPhone: blank(b.contactPhone), serviceType: blank(b.serviceType), licenceNumber: blank(b.licenceNumber), licenceValidUntil: blank(b.licenceValidUntil),
    }))
  }
  await each(changed, async ([o, r]) => {
    const base = `/v1/hrms/contractors/${r._key}`
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(base, json('DELETE')); return }
    if (r.status !== o.status) await apiJson(`${base}/restore`, json('POST'))
    if (changedAny(o, r, ['name', 'reg', 'contact', 'phone', 'email', 'service', 'licenceNo', 'licence', 'sites'])) await apiJson(base, json('PUT', agencyBody(r)))
  }, 'agencies')
  return [['master', 'contractors']]
}

async function classes({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) await apiJson('/v1/hrms/employment-types', json('POST', { companyId: env.defaultCo, name: String(r.name).trim(), code: String(r.code || '').trim().toUpperCase(), payrollEligible: true, active: true }))
  await each(changed, async ([o, r]) => {
    if (!changedAny(o, r, ['name', 'code', 'status'])) return
    if (r._raw?.system) throw new Error('Built-in employment types can’t be changed')
    await apiJson(`/v1/hrms/employment-types/${r._key}`, json('PUT', { companyId: r._raw?.companyId, name: String(r.name).trim(), code: String(r.code || '').trim().toUpperCase(), payrollEligible: r._raw?.payrollEligible ?? true, active: r.status === 'Active' }))
  }, 'classifications')
  return [['hrms', 'org', 'employment-types']]
}

// ── rules ────────────────────────────────────────────────────────────────────
/** An overnight fixed shift is a NIGHT shift to the backend (a FIXED shift may not wrap midnight). */
const shiftType = (r: Rec) => r.kind === 'Flexible' ? 'FLEXIBLE' : r.kind === 'Rotational' ? 'ROTATIONAL' : r.end < r.start || r._raw?.shiftType === 'NIGHT' ? 'NIGHT' : 'FIXED'
const rate = (s?: string | null) => (s ? Number(String(s).replace(/[^\d.]/g, '')) || undefined : undefined)
const shiftBody = (r: Rec) => ({
  name: String(r.name).trim(), shiftType: shiftType(r), startTime: hhmm(r.start), endTime: hhmm(r.end),
  gracePeriodMinutes: r.grace ?? undefined, workingHoursPerDay: Number(r.hours), overtimeApplicable: !!r.ot, overtimeMultiplier: r.ot ? rate(r.rate) : undefined,
  // V143.23: "" clears the code; [] clears the weekly offs; core hours only for a flexible shift.
  code: String(r.code || '').trim().toUpperCase(),
  coreStartTime: r.kind === 'Flexible' && r.core ? hhmm(r.core[0]) : undefined,
  coreEndTime: r.kind === 'Flexible' && r.core ? hhmm(r.core[1]) : undefined,
  weeklyOffDays: Array.isArray(r.offs) ? r.offs.map((d: string) => WEEK.indexOf(d) + 1).filter((d: number) => d > 0) : undefined,
})
async function shifts({ added, changed }: Diff, env: SyncEnv) {
  for (const r of added) await apiJson(`/v1/shifts?companyId=${env.defaultCo}`, json('POST', { ...shiftBody(r), gracePeriodMinutes: r.grace ?? 0 }))
  await each(changed, async ([o, r]) => {
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(`/v1/shifts/${r._key}`, json('DELETE')); return }
    await apiJson(`/v1/shifts/${r._key}`, json('PUT', shiftBody(r)))
  }, 'shifts')
  return [['hrms', 'shift-policies'], ['shifts'], ['master', 'schedule']]
}

async function leaves({ added, changed }: Diff, env: SyncEnv) {
  const body = (r: Rec) => ({
    name: String(r.name).trim(), code: String(r.code || '').trim().toUpperCase(), category: LEAVE_CAT_CODE[r.cat] || r._raw?.category || 'CASUAL',
    annualEntitlement: Number(r.quota), isPaidLeave: !!r.paid, isCarryForwardAllowed: Number(r.carry) > 0, maxCarryForwardDays: Number(r.carry) || 0,
    // A full replace: fields this page doesn't show are sent back as they were.
    maxConsecutiveDays: r._raw?.maxConsecutiveDays ?? undefined, minNoticeDays: r._raw?.minNoticeDays ?? undefined,
    applicableGender: r._raw?.applicableGender ?? undefined, description: r._raw?.description ?? undefined,
    // V143.23: how the quota is credited, and encashment (0 clears the yearly limit).
    accrualFrequency: ACCRUAL_CODE[r.accrual] || 'YEARLY', isEncashable: !!r.encash, maxEncashDays: r.encash && r.encashMax ? Number(r.encashMax) : 0,
  })
  for (const r of added) await apiJson(`/v1/leave/types?companyId=${env.defaultCo}`, json('POST', body(r)))
  await each(changed, async ([o, r]) => {
    if (r.status !== o.status && r.status !== 'Active') { await apiJson(`/v1/leave/types/${r._key}`, json('DELETE')); return }
    await apiJson(`/v1/leave/types/${r._key}`, json('PUT', body(r)))
  }, 'leave types')
  return [['hrms', 'leave', 'types']]
}

/** V143.23 distribution settings: acknowledgement, the automatic reminder (0 = off) and email on publish. */
const distribution = (r: Rec) => ({
  acknowledgementRequired: r.ackReq !== false, notifyOnPublish: !!r.notify,
  autoRemindAfterDays: r.ackReq !== false && r.remindAfter !== '' && r.remindAfter != null ? Number(r.remindAfter) : 0,
})
/** Keep the stored spelling ("v1.0", "GENERAL") unless the person changed it. */
const verOut = (r: Rec, o?: Rec) => (o && r.ver === o.ver && r._raw?.version ? r._raw.version : (/^v/i.test(r._raw?.version || '') ? 'v' : '') + String(r.ver || '1.0').replace(/^v/i, ''))
const catOut = (r: Rec) => (r._raw?.category && pretty(r._raw.category) === r.cat ? r._raw.category : r.cat || undefined)
async function policies({ added, changed, removed }: Diff, env: SyncEnv) {
  for (const r of added) {
    await apiJson(`/v1/policy/policies?companyId=${env.defaultCo}`, json('POST', { title: String(r.title).trim(), category: catOut(r), content: r.content || '', version: verOut(r), effectiveDate: r.eff || undefined, status: r.status === 'Draft' ? 'DRAFT' : 'ACTIVE', ...distribution(r) }))
  }
  await each(changed, async ([o, r]) => {
    const base = `/v1/policy/policies/${r._key}`
    if (changedAny(o, r, ['title', 'cat', 'ver', 'eff', 'content', 'ackReq', 'notify', 'remindAfter'])) {
      await apiJson(base, json('PUT', { title: String(r.title).trim(), category: catOut(r), content: r.content || '', version: verOut(r, o), effectiveDate: r.eff || undefined, ...distribution(r) }))
    }
    if (r.status === o.status) return
    if (r.status === 'Archived') await apiJson(`${base}/archive`, json('POST'))
    else if (r.status === 'Active' && o.status === 'Draft') await apiJson(`${base}/publish`, json('POST'))
    else if (r.status === 'Active' && o.status === 'Archived') await apiJson(`${base}/unarchive`, json('POST'))
  }, 'policies')
  // "Discard draft": a draft is deleted for good (the server archives a published one instead).
  await each(removed, (r) => apiJson(`/v1/policy/policies/${r._key}`, json('DELETE')), 'policies')
  return [['hrms', 'policy']]
}

// ── payroll configuration ────────────────────────────────────────────────────
async function components({ added, changed, removed }: Diff) {
  const pct = (r: Rec) => r.method === 'pct_basic' || r.method === 'pct_gross'
  // A fixed component's own monthly amount (payroll applies it); none when empty or ₹0.
  const amount = (r: Rec) => (r.method === 'fixed' && !r.managed && Number(r.val) > 0 ? Number(r.val) : null)
  for (const r of added) {
    await apiJson('/v1/payroll/components', json('POST', {
      code: String(r.code).trim().toUpperCase(), name: String(r.name).trim(), category: COMP_CAT_CODE[r.cat], isStatutory: false, isTaxable: r.taxable !== 'No',
      computationType: COMP_METHOD_CODE[r.method] || 'FIXED', percentValue: pct(r) ? Number(r.val) : null, displayOrder: 100,
      amount: amount(r), showOnPayslip: r.payslip !== false, isActive: r.status !== 'Inactive',
    }))
  }
  await each(changed, async ([o, r]) => {
    if (!changedAny(o, r, ['name', 'cat', 'method', 'val', 'taxable', 'payslip', 'status'])) return
    await apiJson(`/v1/payroll/components/${r._key}`, json('PUT', {
      code: r._raw?.code || r.code, name: String(r.name).trim(), category: COMP_CAT_CODE[r.cat], isStatutory: !!r._raw?.isStatutory, isTaxable: r.taxable !== 'No',
      computationType: COMP_METHOD_CODE[r.method] || r._raw?.computationType, percentValue: pct(r) ? Number(r.val) : r._raw?.percentValue ?? null, displayOrder: r._raw?.displayOrder ?? 100,
      amount: amount(r), showOnPayslip: r.payslip !== false, isActive: r.status !== 'Inactive',
    }))
  }, 'components')
  await each(removed, (r) => apiJson(`/v1/payroll/components/${r._key}`, json('DELETE')), 'components')
  return [['hrms', 'payroll', 'components']]
}

const FLAG: Record<string, keyof PayrollSettings> = { PF: 'pfEnabled', ESI: 'esiEnabled', PT: 'ptEnabled', LWF: 'lwfEnabled' }
async function statutory({ changed }: Diff, env: SyncEnv) {
  if (!env.settings) throw new Error('Payroll settings haven’t loaded yet')
  // PUT replaces the settings (an omitted late-mark threshold is cleared), so the whole row goes back.
  const next: PayrollSettings = { ...env.settings }
  for (const [, r] of changed) (next as any)[FLAG[r.id]] = !!r.on
  await apiJson('/v1/payroll/settings', json('PUT', next))
  return [['hrms', 'payroll', 'settings']]
}

export const SYNC: Record<string, (d: Diff, env: SyncEnv) => Promise<unknown[][]>> = {
  employees, companies, branches, depts, desigs, grades, agencies, classes, shifts, leaves, policies, components, statutory,
}
