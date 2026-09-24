// Runtime pieces the generated MasterDesign.tsx imports in place of the
// prototype's globals: today's date (the prototype froze it at 24 Sep 2026),
// the element its drawers, modals and menus portal into, and the stand-ins it
// shows when a real record has no department, designation or branch.
import { istToday } from '../dc/dates'

/** Today in India, as the prototype's TODAY_ISO / TODAY (10:00 local on that day). */
export const TODAY_ISO = istToday()
export const TODAY = new Date(TODAY_ISO + 'T10:00:00')
/** The 1st of next month — the date the leave preview shows a new joiner starting on. */
export const NEXT_MONTH = (() => { const y = +TODAY_ISO.slice(0, 4), m = +TODAY_ISO.slice(5, 7); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01` })()

/** "1 company", "3 companies". */
export const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * The design's layers (drawers, modals, dropdowns) render into document.body.
 * Its CSS is scoped under .utm, so they go into one body-level .utm host instead.
 */
export function portalHost(): HTMLElement {
  let el = document.getElementById('utm-portal')
  if (!el) {
    el = document.createElement('div')
    el.id = 'utm-portal'
    el.className = 'utm utm-portal'
    document.body.appendChild(el)
  }
  return el
}

/**
 * In the prototype every employee had a department, designation and branch, so
 * it looked them up without checks. Real records can leave them empty; these
 * dash records stand in for the missing one.
 */
export const NONE = {
  dept: { id: '', code: '', name: '—', t: 'slate', icon: 'layers', parent: null, head: null, headId: null, co: '' },
  desig: { id: '', code: '', name: '—', dept: '', grade: '' },
  branch: { id: '', code: '', name: '—', city: '', state: '', co: '' },
  cls: { id: '', code: '', name: 'Employee', type: '', probation: '—', notice: null, pf: null, esi: null, gratuity: null, leave: '—' },
}

/** A lookup map that answers `fallback` for a missing key. */
export function orNone<T extends object>(map: Record<string, T>, fallback: T): Record<string, T> {
  return new Proxy(map, { get: (t, k) => (typeof k === 'string' && !(k in t) ? fallback : (t as any)[k]) })
}
