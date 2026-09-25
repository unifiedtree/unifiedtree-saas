/**
 * "/" path navigation for the ⌘K palette.
 *
 * Typing "/attendance" opens Attendance & Time (its first page this person
 * may open); "/attendance/daily-logs" (or "/attendance/dailylogs",
 * "/attendance/daily logs") opens that exact tab. Every path comes from the
 * page registry, so only pages the person may open are ever suggested.
 * Real routes work too ("/hrms/leave").
 */
import { editDistance, type Range } from './rank'
import { SLASH_MODULES, firstOpenIn, type VisibleEntry } from '../navigation/pageRegistry'

export interface SlashTarget {
  id: string
  /** Canonical path, without the leading slash: "attendance/daily-logs". */
  slash: string
  label: string
  /** Where it sits, e.g. "Attendance & Time › Daily Tracking". */
  trail: string
  /** The route it opens. */
  path: string
  icon: string
  /** Not in the plan (plan admins only): opens the plan page's upsell. */
  locked: boolean
  comingSoon: boolean
  /** An app area with pages under it (Tab completes to "area/"). */
  isModule: boolean
  /** Registry order, for stable sorting. */
  order: number
}

export interface SlashHit { target: SlashTarget; score: number; shown: string; ranges: Range[] }

/** Lower-case letters and digits only: "Daily Logs" → "dailylogs". */
export const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export const isSlashQuery = (q: string) => q.trimStart().startsWith('/')

/** The real route as a "/" path ("hrms/leave"), for pages without a tab query. */
const routeOf = (e: VisibleEntry) => (e.parent || e.path.includes('?') ? [] : [e.path.replace(/^\//, '')])

/** Everything this person can reach by path: app areas first, then pages and tabs. */
export function buildSlashTargets(visible: readonly VisibleEntry[]): { target: SlashTarget; paths: string[] }[] {
  const out: { target: SlashTarget; paths: string[] }[] = []
  let order = 0
  for (const m of SLASH_MODULES) {
    const inArea = visible.filter((e) => e.slash.split('/')[0] === m.key)
    if (!inArea.length) continue
    const own = inArea.find((e) => e.slash === m.key)
    const first = own ?? firstOpenIn(m.key, visible) ?? inArea[0]
    out.push({
      target: {
        id: `area:${m.key}`, slash: m.key, label: own ? own.label : m.label, trail: own ? own.area : 'Opens the first page you can use',
        path: first.path, icon: own ? own.icon : m.icon, locked: first.state === 'locked', comingSoon: !!first.comingSoon, isModule: inArea.length > 1, order: order++,
      },
      paths: [m.key, ...m.aliases, ...(own ? [...own.aliases, ...routeOf(own)] : [])],
    })
  }
  for (const e of visible) {
    if (SLASH_MODULES.some((m) => m.key === e.slash)) continue
    out.push({
      target: { id: e.id, slash: e.slash, label: e.label, trail: e.area, path: e.path, icon: e.icon, locked: e.state === 'locked', comingSoon: !!e.comingSoon, isModule: false, order: order++ },
      paths: [e.slash, ...e.aliases, ...routeOf(e)],
    })
  }
  return out
}

/** How well one typed segment matches one path segment. 0 = no match. */
function segScore(typed: string, want: string, last: boolean): number {
  if (!typed) return last ? 0.5 : 0
  if (typed === want) return 4
  if (want.startsWith(typed)) return last ? 3 : 2.5
  if (want.includes(typed) && typed.length >= 2) return 2
  const budget = typed.length >= 8 ? 2 : typed.length >= 4 ? 1 : 0
  if (budget && (editDistance(typed, want, budget) <= budget || (last && want.length > typed.length && editDistance(typed, want.slice(0, typed.length), budget) <= budget))) return 1.5
  return 0
}

/** Highlight the typed part of each segment of `shown` (dashes and spaces skipped). */
function rangesFor(shown: string, typed: string[]): Range[] {
  const out: Range[] = []
  let offset = 1 // after the leading "/"
  const parts = shown.split('/')
  parts.forEach((part, i) => {
    const t = typed[i]
    if (t) {
      const want = seg(part)
      const exactish = want.startsWith(t) ? t.length : want === t ? want.length : 0
      if (exactish > 0) {
        // Walk the original segment until `exactish` letters/digits are covered.
        let seen = 0, end = 0
        for (; end < part.length && seen < exactish; end++) if (/[a-z0-9]/i.test(part[end])) seen++
        out.push([offset, offset + end])
      } else if (segScore(t, want, i === typed.length - 1) > 0) out.push([offset, offset + part.length])
    }
    offset += part.length + 1
  })
  return out
}

/** Suggestions for a "/" query, best first. */
export function suggestSlash(query: string, targets: readonly { target: SlashTarget; paths: string[] }[], limit = 8): SlashHit[] {
  const raw = query.trim().replace(/^\/+/, '')
  const typed = raw.split('/').map(seg)
  if (!raw) {
    return targets.filter((t) => t.target.id.startsWith('area:')).slice(0, 40)
      .map((t) => ({ target: t.target, score: 1, shown: '/' + t.target.slash, ranges: [] }))
  }
  const hits: SlashHit[] = []
  for (const { target, paths } of targets) {
    let best: SlashHit | null = null
    for (const p of paths) {
      const segs = p.split('/').filter(Boolean)
      const want = segs.map(seg)
      // One level deeper than typed is fine (typing the area lists its pages); two is noise.
      if (typed.length > want.length || want.length - typed.length > 1) continue
      let score = 0, ok = true
      for (let i = 0; i < typed.length; i++) {
        const s = segScore(typed[i], want[i], i === typed.length - 1)
        if (!s) { ok = false; break }
        score += s
      }
      if (!ok) continue
      if (want.length > typed.length) score *= 0.45
      else score += 1
      if (p === target.slash) score += 0.3
      const shown = '/' + (p === target.slash || !target.slash ? p : target.slash)
      const cand = { target, score, shown, ranges: p === target.slash ? rangesFor(shown, typed) : [] }
      if (!best || cand.score > best.score) best = cand
    }
    if (best) hits.push(best)
  }
  // One row per destination: a page and the tab it opens by default can share a route.
  const seen = new Set<string>()
  return hits
    .sort((a, b) => b.score - a.score || a.target.order - b.target.order)
    .filter((h) => { if (seen.has(h.target.path)) return false; seen.add(h.target.path); return true })
    .slice(0, limit)
}
