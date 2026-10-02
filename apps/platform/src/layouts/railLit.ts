// Which rail item is lit (PlatformShell).
//
// Some pages belong to two rail items: a manager's Leave and Attendance pages
// are both their own admin rail item and a page of "My work" (My leave, My
// time). The rail item the person came through stays lit: Leave → Leave,
// My leave → My leave. With nothing to go on (a link, search, a notification,
// a fresh tab) the page's own admin item is lit, not the My work item.
//
// The More button stands in for what the rail doesn't show: settings pages,
// My profile and All apps (all reached through More), and a module that didn't
// fit the rail's height and moved into More.

/** The self-service rail items: My work (and the old "Me" keys, for a session remembered from before). */
export const SELF_SERVICE_RAIL: ReadonlySet<string> = new Set(['mytime', 'myleave', 'mypay', 'mydocs', 'mygrowth', 'ess', 'myworkspace'])

/** A rail item that owns the current page, in rail order, with how many pages it lists. */
export interface ActiveRailItem { key: string; tabs: number }

/**
 * The key of the rail item to light.
 * `via` is the rail item the person came through (a rail click or a tab in its section row).
 */
export function litRailKey(active: readonly ActiveRailItem[], via?: string | null): string | undefined {
  if (via && active.some(i => i.key === via)) return via
  const others = active.filter(i => !SELF_SERVICE_RAIL.has(i.key))
  const pool = others.length ? others : active
  // Several match: prefer the one whose pages show as tabs (an employee's /me).
  return (pool.find(i => i.tabs > 1) ?? pool[0])?.key
}

export interface LitRail {
  /** The rail item to light, when it shows on the rail. */
  key: string | undefined
  /** The module the page belongs to, even when it sits in More (its pages still show as the top bar's tabs). */
  module: string | undefined
  /** Light More instead: a page reached through More, or a module that moved into More. */
  more: boolean
}

/**
 * The lit rail item, or More.
 * `morePage`: the page is reached through More (settings, My profile, All apps).
 * `overflow`: the modules that didn't fit the rail and show in More.
 */
export function litRail(active: readonly ActiveRailItem[], via: string | null | undefined, opts: { morePage: boolean; overflow: ReadonlySet<string> }): LitRail {
  if (opts.morePage) return { key: undefined, module: undefined, more: true }
  const key = litRailKey(active, via)
  if (key && opts.overflow.has(key)) return { key: undefined, module: key, more: true }
  return { key, module: key, more: false }
}

/** A rail click (or a tab in its row, or the phone menu): the rail item and the page it opened. */
export interface RailVia { key: string; path: string }

export const railViaTo = (key: string, to: string): RailVia => ({ key, path: to.split(/[?#]/)[0] })

/**
 * The clicked rail item while the person is still on the page that click opened
 * (its own tabs and pages under it included). Any other way onto a page (a link on
 * the page, search, a notification, Back, a new sign-in) goes by the page alone.
 */
export function railViaOn(via: RailVia | null, pathname: string): string | null {
  if (!via) return null
  return pathname === via.path || pathname.startsWith(via.path + '/') ? via.key : null
}

// Kept per browser tab, so a refresh keeps the same rail item lit.
const VIA_KEY = 'ut:rail-via'

export function readRailVia(): RailVia | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(VIA_KEY) ?? 'null') as Partial<RailVia> | null
    return v && typeof v.key === 'string' && typeof v.path === 'string' ? { key: v.key, path: v.path } : null
  } catch {
    return null
  }
}

export function saveRailVia(via: RailVia | null) {
  try {
    if (via) sessionStorage.setItem(VIA_KEY, JSON.stringify(via))
    else sessionStorage.removeItem(VIA_KEY)
  } catch {
    /* private mode: the rail still lights, from the page alone */
  }
}
