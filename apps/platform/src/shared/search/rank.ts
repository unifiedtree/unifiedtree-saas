/**
 * Matching and ranking for the ⌘K palette.
 *
 * Deliberately a plain function over a small in-memory list: there are ~30
 * actions and ~50 pages, so a fuzzy-search dependency would be more code than
 * the thing it replaces. Kept out of the component so the rules can be reasoned
 * about (and tested) without rendering anything.
 */

export interface Searchable {
  id: string
  label: string
  /** Extra terms the label does not contain. */
  keywords?: string[]
  /** Shown under the label; also weakly searchable. */
  description?: string
}

/** Higher is better. 0 means "no match" and the item is dropped. */
export function scoreMatch(item: Searchable, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase()
  if (!q) return 0

  const label = item.label.toLowerCase()
  const words = label.split(/\s+/)

  // Exact label — always first.
  if (label === q) return 1000
  // Label starts with the query: "leave" → "Leave Management".
  if (label.startsWith(q)) return 800 - label.length
  // A word inside the label starts with it: "pay" → "Run Payroll".
  if (words.some((w) => w.startsWith(q))) return 600 - label.length
  // Anywhere in the label.
  if (label.includes(q)) return 400 - label.length

  // Keywords. An exact keyword is a strong signal — someone typing
  // "regularize" means the corrections screen even though no label says it.
  const kws = (item.keywords ?? []).map((k) => k.toLowerCase())
  if (kws.some((k) => k === q)) return 350
  if (kws.some((k) => k.startsWith(q))) return 300
  if (kws.some((k) => k.includes(q))) return 200

  // Description is the weakest signal, so it can never outrank a label hit.
  if ((item.description ?? '').toLowerCase().includes(q)) return 100

  // Multi-word queries: every token must land somewhere ("add emp").
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1) {
    const hay = [label, ...(item.keywords ?? []), item.description ?? ''].join(' ').toLowerCase()
    if (tokens.every((t) => hay.includes(t))) return 150
  }

  return 0
}

/** Score, drop non-matches, sort best-first, then alphabetically for stability. */
export function rank<T extends Searchable>(items: T[], query: string, limit = 8): T[] {
  return items
    .map((item) => ({ item, score: scoreMatch(item, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .slice(0, limit)
    .map((r) => r.item)
}
