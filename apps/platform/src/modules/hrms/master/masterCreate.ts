// Add employee → "Create" beside a field, the Master side (MasterCreateField.tsx
// draws it). Which lists can be added to from the form, who may do it, how the
// Master page's own add form is pointed at the employee's company, and what the
// form selects once the new item is saved. No React and no API here, so it is
// tested on its own (masterCreate.test.ts).
import type { Rec } from './masterData'
import { needPermission } from '@/shared/components/inlineCreate/inlineCreateFlow'

/** The Master lists the Add employee form can add to, keyed as the Master design keys its collections. */
export type CreateKind = 'branches' | 'depts' | 'desigs' | 'classes' | 'shifts' | 'agencies'

export const CREATE_KINDS: Record<CreateKind, {
  /** The employee form field that shows the new item. */
  field: string
  /** "Create department". */
  noun: string
  /** What the missing permission lets you manage (POST checks: org.company.write, hrms.department.write,
   *  hrms.designation.write, hrms.employment-type.write, attendance.workforce.admin, hrms.contractor.write). */
  what: string
}> = {
  branches: { field: 'branch', noun: 'branch', what: 'companies and branches' },
  depts: { field: 'dept', noun: 'department', what: 'departments' },
  desigs: { field: 'desig', noun: 'designation', what: 'designations' },
  classes: { field: 'type', noun: 'employment type', what: 'employment types' },
  shifts: { field: 'shift', noun: 'shift', what: 'shifts' },
  agencies: { field: 'agency', noun: 'staffing agency', what: 'staffing agencies' },
}

/** Why Create can't be used right now, or null when it can. */
export function createBlockedReason(kind: CreateKind, allowed: boolean, co: string | null | undefined): string | null {
  if (!allowed) return needPermission(CREATE_KINDS[kind].what)
  if (!co) return 'Pick a company first.'
  return null
}

/** Lists whose records belong to one company (each record carries it as `co`). */
const PER_COMPANY = ['branches', 'depts', 'desigs', 'grades', 'agencies', 'classes', 'employees']

/**
 * The Master data as the hosted add form sees it: only the employee's company,
 * so its pickers (parent department, department, grade, sites) offer that
 * company's records and the new item is saved there. Shifts carry no company
 * here and stay as they are.
 */
export function scopeDb(db: Record<string, Rec[]>, co: string): Record<string, Rec[]> {
  const out: Record<string, Rec[]> = { ...db, companies: (db.companies || []).filter((c) => c.id === co) }
  for (const k of PER_COMPANY) out[k] = (db[k] || []).filter((r) => r.co === co)
  return out
}

/** A save the hosted form made, caught instead of sent: its new record and its own success message. */
export interface CaughtSave { k: string; rec: Rec; msg: string | null }

/**
 * The update / toast pair a hosted Master add form calls when it saves. Nothing
 * is sent from here: the new record and the toast text are kept in `box` for
 * the host, which saves them for the employee's company and keeps the panel
 * open until the server has answered.
 */
export function catchSave(db: Record<string, Rec[]>, box: { current: CaughtSave | null }) {
  return {
    update: (k: string, fn: Rec[] | ((list: Rec[]) => Rec[])) => {
      const prev = db[k] || []
      const next = typeof fn === 'function' ? fn(prev) : fn
      // The forms add with list.concat([rec]): the new record is the one that wasn't there before.
      const rec = next.find((r) => !prev.includes(r))
      if (rec) box.current = { k, rec, msg: null }
    },
    toast: (msg: string) => { if (box.current) box.current.msg = msg },
  }
}

const orList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`)

/** What the employee form sets once the new item is saved: [field, value] pairs, or a note on why nothing was selected. */
export interface Selection { set: [string, unknown][]; note?: string }

/**
 * `typeLabel` maps an employment-type code to the form's label (masterData TYPE_LABEL):
 * an employee record can only hold one of those types.
 */
export function selectionAfterCreate(kind: CreateKind, rec: Rec, id: string | null, values: Rec, typeLabel: Record<string, string>): Selection {
  const name = String(rec.name || '').trim() || 'It'
  if (kind === 'classes') {
    const label = typeLabel[String(rec.code || '')]
    return label ? { set: [['type', label]] }
      : { set: [], note: `${name} was added, but new people can only be given ${orList(Object.values(typeLabel))} for now, so it isn’t selected.` }
  }
  if (!id) return { set: [], note: `${name} was added. Pick it from the list.` }
  // A title belongs to a department: when it was added under another one, the form moves to that department first.
  if (kind === 'desigs' && rec.dept && rec.dept !== values.dept) return { set: [['dept', rec.dept], ['desig', id]] }
  return { set: [[CREATE_KINDS[kind].field, id]] }
}
