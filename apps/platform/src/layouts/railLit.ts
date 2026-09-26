// Which rail item is lit (PlatformShell).
//
// Some pages belong to two rail items: a manager's Leave, Attendance and Team
// pages are both their own rail item and a tab of "Me" (Employee Self Service).
// The rail item the person came through stays lit: Leave → Leave, Me → its
// Leave tab → Me. With nothing to go on (a link, search, a notification, a
// fresh tab) the page's own rail item is lit, not "Me".

/** The "Me" rail items: the self-service group and the flat My workspace link. */
export const SELF_SERVICE_RAIL: ReadonlySet<string> = new Set(['ess', 'myworkspace'])

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
