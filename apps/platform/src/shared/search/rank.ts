/**
 * Matching and ranking for the ⌘K palette.
 *
 * Plain functions over a small in-memory list (~150 pages and tabs, ~30
 * actions), kept out of the component so the rules can be tested without
 * rendering anything. Matching is partial and forgiving:
 *   exact label → label prefix → word prefix → anywhere in the label →
 *   initials ("wfh", "fnf") → keywords → every word of a multi-word query →
 *   one typo per word ("attendence") → letters in order ("atnd") → description.
 */

export interface Searchable {
  id: string
  label: string
  /** Extra terms the label does not contain. */
  keywords?: string[]
  /** Shown under the label; also weakly searchable. */
  description?: string
}

/** [start, end) character ranges of the label to highlight. */
export type Range = [number, number]

const norm = (s: string) => s.toLowerCase()
const WORD = /[a-z0-9]+/g

/** Words of a string with their start offsets. */
function words(s: string): { w: string; at: number }[] {
  const out: { w: string; at: number }[] = []
  for (const m of norm(s).matchAll(WORD)) out.push({ w: m[0], at: m.index ?? 0 })
  return out
}

/** Damerau-Levenshtein distance, capped: returns max+1 as soon as it can't be within `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      rowMin = Math.min(rowMin, d[i][j])
    }
    if (rowMin > max) return max + 1
  }
  return d[a.length][b.length]
}

/** How many typos a word of this length may carry. */
const typoBudget = (len: number) => (len >= 8 ? 2 : len >= 4 ? 1 : 0)

/** Does `token` match `word` allowing typos? Prefix typos count too ("attenda" ~ "attendance"). */
function fuzzyWord(token: string, word: string): boolean {
  const budget = typoBudget(token.length)
  if (!budget) return false
  if (editDistance(token, word, budget) <= budget) return true
  // A partly typed word: compare with the word's start of the same length.
  return word.length > token.length && editDistance(token, word.slice(0, token.length), budget) <= budget
}

/** Letters of `q` appear in order in `s` (gaps allowed); returns the matched positions. */
function subsequence(q: string, s: string): number[] | null {
  const hits: number[] = []
  let i = 0
  for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { hits.push(j); i++ }
  return i === q.length ? hits : null
}

/** Merge character positions into ranges. */
function toRanges(pos: number[]): Range[] {
  const out: Range[] = []
  for (const p of pos) {
    const last = out[out.length - 1]
    if (last && last[1] === p) last[1] = p + 1
    else out.push([p, p + 1])
  }
  return out
}

export interface Match { score: number; ranges: Range[] }

/** Score an item against the query. score 0 = no match. `ranges` highlight the label. */
export function matchItem(item: Searchable, rawQuery: string): Match {
  const q = norm(rawQuery.trim().replace(/\s+/g, ' '))
  if (!q) return { score: 0, ranges: [] }
  const label = norm(item.label)
  const lw = words(item.label)
  const span = (at: number, len: number): Range[] => [[at, at + len]]

  if (label === q) return { score: 1000, ranges: span(0, q.length) }
  if (label.startsWith(q)) return { score: 800 - label.length, ranges: span(0, q.length) }
  const wordHit = lw.find((x) => x.w.startsWith(q))
  if (wordHit) return { score: 600 - label.length, ranges: span(wordHit.at, q.length) }
  const at = label.indexOf(q)
  if (at >= 0) return { score: 400 - label.length, ranges: span(at, q.length) }

  // Initials: "wfh" → Work From Home, "fnf" → Full & Final.
  const compact = q.replace(/\s+/g, '')
  if (compact.length >= 2 && lw.length >= compact.length) {
    const initials = lw.map((x) => x.w[0]).join('')
    const i0 = initials.indexOf(compact)
    if (i0 >= 0) return { score: 380, ranges: lw.slice(i0, i0 + compact.length).map((x) => [x.at, x.at + 1] as Range) }
  }

  const kws = (item.keywords ?? []).map(norm)
  if (kws.some((k) => k === q)) return { score: 350, ranges: [] }
  if (kws.some((k) => k.startsWith(q) || k.split(/\s+/).some((w) => w.startsWith(q)))) return { score: 300, ranges: [] }
  if (kws.some((k) => k.includes(q))) return { score: 200, ranges: [] }

  // Every word of the query somewhere ("add emp", "leave apr"), typos allowed per word.
  const tokens = q.split(' ').filter(Boolean)
  const hayWords = [...lw.map((x) => x.w), ...kws.flatMap((k) => k.match(WORD) ?? []), ...(norm(item.description ?? '').match(WORD) ?? [])]
  const tokenHit = (t: string) => hayWords.some((w) => w.startsWith(t)) || hayWords.some((w) => fuzzyWord(t, w))
  if (tokens.every(tokenHit)) {
    const ranges: Range[] = []
    for (const t of tokens) {
      const w = lw.find((x) => x.w.startsWith(t))
      if (w) { ranges.push([w.at, w.at + t.length]); continue }
      const f = lw.find((x) => fuzzyWord(t, x.w))
      if (f) ranges.push([f.at, f.at + f.w.length])
    }
    const exactWords = tokens.filter((t) => hayWords.some((w) => w.startsWith(t))).length
    // A single word that only matched through a typo ranks below real keyword hits.
    return { score: tokens.length > 1 ? 150 + exactWords * 10 : 180, ranges: ranges.sort((a, b) => a[0] - b[0]) }
  }

  // Letters in order inside the label ("atnd" → Attendance), only when they sit close together.
  if (compact.length >= 3) {
    const hits = subsequence(compact, label)
    if (hits && hits[hits.length - 1] - hits[0] <= compact.length * 3) return { score: 120 - (hits[hits.length - 1] - hits[0]), ranges: toRanges(hits) }
  }

  if (norm(item.description ?? '').includes(q)) return { score: 100, ranges: [] }
  return { score: 0, ranges: [] }
}

/** Higher is better. 0 means "no match" and the item is dropped. */
export function scoreMatch(item: Searchable, rawQuery: string): number {
  return matchItem(item, rawQuery).score
}

export interface Ranked<T> { item: T; score: number; ranges: Range[] }

/** Score, drop non-matches, sort best-first (then alphabetically for stability), keep `limit`. */
export function rankWithRanges<T extends Searchable>(items: readonly T[], query: string, limit = 8): Ranked<T>[] {
  return items
    .map((item) => ({ item, ...matchItem(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
}

/** Score, drop non-matches, sort best-first, then alphabetically for stability. */
export function rank<T extends Searchable>(items: T[], query: string, limit = 8): T[] {
  return rankWithRanges(items, query, limit).map((r) => r.item)
}

/** Ranges of `text` matching the words of `query` (for highlighting text the server matched). */
export function highlightRanges(text: string, query: string): Range[] {
  const q = norm(query.trim())
  if (!q) return []
  const t = norm(text)
  const whole = t.indexOf(q)
  if (whole >= 0) return [[whole, whole + q.length]]
  const out: Range[] = []
  for (const token of q.split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(token)
    if (i >= 0) out.push([i, i + token.length])
  }
  return out.sort((a, b) => a[0] - b[0]).reduce<Range[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else acc.push([r[0], r[1]])
    return acc
  }, [])
}
