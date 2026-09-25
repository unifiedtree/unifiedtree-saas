/**
 * Recently opened search results, kept per person and workspace in this
 * browser only (a convenience, like a remembered tab). Storage can be
 * unavailable (private windows, blocked site data); every read and write is
 * guarded and the palette works without it.
 *
 * What's stored is only what the person already saw in their own results
 * (a label, a subtitle and a route). The palette re-checks each one against
 * the current permissions before showing it, so a role change never
 * resurfaces a page or a person the viewer can no longer open.
 */
export type RecentKind = 'person' | 'page' | 'action'

export interface RecentItem {
  kind: RecentKind
  id: string
  label: string
  description?: string
  path: string
  /** When it was opened (epoch ms). */
  at: number
}

const MAX = 8
const keyFor = (tenantId: string, userId: string) => `ut.search.recent.v1:${tenantId}:${userId}`

export function readRecent(tenantId: string | undefined, userId: string | undefined): RecentItem[] {
  if (!tenantId || !userId) return []
  try {
    const raw = window.localStorage.getItem(keyFor(tenantId, userId))
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : []
    return Array.isArray(list)
      ? list.filter((r) => r && typeof r.path === 'string' && r.path.startsWith('/') && typeof r.label === 'string').slice(0, MAX)
      : []
  } catch {
    return []
  }
}

/** Put `item` first (replacing an older copy of the same destination) and keep the newest few. */
export function pushRecent(list: RecentItem[], item: RecentItem): RecentItem[] {
  return [item, ...list.filter((r) => !(r.kind === item.kind && r.path === item.path))].slice(0, MAX)
}

export function writeRecent(tenantId: string | undefined, userId: string | undefined, list: RecentItem[]): void {
  if (!tenantId || !userId) return
  try { window.localStorage.setItem(keyFor(tenantId, userId), JSON.stringify(list.slice(0, MAX))) } catch { /* storage unavailable: recents just aren't kept */ }
}

export function clearRecent(tenantId: string | undefined, userId: string | undefined): void {
  if (!tenantId || !userId) return
  try { window.localStorage.removeItem(keyFor(tenantId, userId)) } catch { /* nothing to clear */ }
}
