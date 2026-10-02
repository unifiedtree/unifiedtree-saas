// The org chart's tree logic, pure (no React), so every rule is unit-tested:
// building the tree from the API's flat list, which people start opened,
// where every card sits (top person at the top, reports in a row below,
// Keka-style elbow connectors), the phone list's rows, and search.
//
// The API already places everyone (parentId) and cuts reporting loops; this
// file still never trusts that: unknown parents, self-parents and loops all
// end at the top level, and nobody is drawn twice.
import type { OrgChartData, OrgPerson } from './useOrgChart'

/** The id of the company card drawn above several top-level people. */
export const COMPANY_ROOT = '__company__'

export interface OrgNode {
  id: string
  /** Null for the company card. */
  person: OrgPerson | null
  parent: string | null
  /** In name order. */
  children: string[]
  depth: number
}

export interface OrgTree {
  nodes: Map<string, OrgNode>
  /** The top of the chart: the one top-level person, or the company card when there are several. */
  rootId: string
  /** True when the top is the company card. */
  companyRoot: boolean
  /** Every id, top first, depth first in name order. */
  order: string[]
  /** The viewer's own card, when they are on the chart. */
  you: string | null
  /** People in the company card's sub-line ("12 people"). */
  size: number
}

const byName = (a: OrgPerson, b: OrgPerson) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Builds the tree; null when nobody is on the chart. */
export function buildTree(data: OrgChartData | null | undefined): OrgTree | null {
  const list = data?.people ?? []
  const people = new Map<string, OrgPerson>()
  for (const p of list) if (p && p.id && !people.has(p.id)) people.set(p.id, p)
  if (!people.size) return null

  // Parent as given, unless it's unknown or the person themself.
  const parentOf = new Map<string, string | null>()
  for (const p of people.values()) {
    const par = p.parentId && p.parentId !== p.id && people.has(p.parentId) ? p.parentId : null
    parentOf.set(p.id, par)
  }
  // Anyone whose line upward loops never reaches the top: cut them loose (the first by name in each loop).
  const sorted = [...people.values()].sort(byName)
  const settled = new Set<string>()
  for (const p of sorted) {
    const walk: string[] = []
    const onWalk = new Set<string>()
    let x: string | null = p.id
    while (x && !settled.has(x) && !onWalk.has(x)) { walk.push(x); onWalk.add(x); x = parentOf.get(x) ?? null }
    if (x && onWalk.has(x)) {
      // x is on a loop: cut it at its first member by name.
      const loop: string[] = []
      let y: string = x
      do { loop.push(y); y = parentOf.get(y) as string } while (y !== x)
      const cut = loop.map((id) => people.get(id)!).sort(byName)[0].id
      parentOf.set(cut, null)
    }
    for (const id of walk) settled.add(id)
  }

  const kids = new Map<string, OrgPerson[]>()
  const tops: OrgPerson[] = []
  for (const p of people.values()) {
    const par = parentOf.get(p.id)
    if (par) { const l = kids.get(par); if (l) l.push(p); else kids.set(par, [p]) } else tops.push(p)
  }
  for (const l of kids.values()) l.sort(byName)
  tops.sort(byName)

  const nodes = new Map<string, OrgNode>()
  const companyRoot = tops.length !== 1
  const rootId = companyRoot ? COMPANY_ROOT : tops[0].id
  if (companyRoot) nodes.set(COMPANY_ROOT, { id: COMPANY_ROOT, person: null, parent: null, children: tops.map((t) => t.id), depth: 0 })

  // Depth first from the top, iteratively (very deep lines can't overflow).
  const order: string[] = []
  const stack: Array<{ p: OrgPerson; parent: string | null; depth: number }> = []
  const startDepth = companyRoot ? 1 : 0
  if (companyRoot) order.push(COMPANY_ROOT)
  for (let i = tops.length - 1; i >= 0; i--) stack.push({ p: tops[i], parent: companyRoot ? COMPANY_ROOT : null, depth: startDepth })
  while (stack.length) {
    const { p, parent, depth } = stack.pop()!
    if (nodes.has(p.id)) continue
    const children = (kids.get(p.id) ?? []).map((c) => c.id)
    nodes.set(p.id, { id: p.id, person: p, parent, children, depth })
    order.push(p.id)
    const ks = kids.get(p.id) ?? []
    for (let i = ks.length - 1; i >= 0; i--) stack.push({ p: ks[i], parent: p.id, depth: depth + 1 })
  }
  const you = data?.viewerEmployeeId && nodes.has(data.viewerEmployeeId) ? data.viewerEmployeeId : null
  return { nodes, rootId, companyRoot, order, you, size: people.size }
}

/** The ids from the top down to `id`, both included; empty when `id` isn't on the chart. */
export function pathTo(tree: OrgTree, id: string | null | undefined): string[] {
  if (!id || !tree.nodes.has(id)) return []
  const path: string[] = []
  const seen = new Set<string>()
  let x: string | null = id
  while (x && !seen.has(x)) { seen.add(x); path.push(x); x = tree.nodes.get(x)?.parent ?? null }
  return path.reverse()
}

/**
 * Who starts opened: the top, and everyone above the person to show (the
 * viewer, or `focus` from a "View in org chart" link) plus that person, so
 * their own reports show too. As Keka: the view starts on you and your team.
 */
export function defaultExpanded(tree: OrgTree, focus?: string | null): Set<string> {
  const open = new Set<string>([tree.rootId])
  for (const id of [tree.you, focus]) for (const x of pathTo(tree, id)) open.add(x)
  return open
}

/** `expanded` plus everyone above `id`, so `id` is on screen. */
export function revealed(tree: OrgTree, expanded: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(expanded)
  const path = pathTo(tree, id)
  for (const x of path.slice(0, -1)) next.add(x)
  return next
}

// ── layout ──────────────────────────────────────────────────────────────────

export interface OrgMetrics {
  /** Card size. */
  cardW: number
  cardH: number
  /** Between cards in a row. */
  gapX: number
  /** From a card's bottom to its reports' top (the elbow sits halfway). */
  gapY: number
  /** Leaf-only teams at least this big stack in two columns either side of a line (Keka's stacked reports). */
  stackMin: number
  /** Between the two stacked columns (the line runs down the middle). */
  stackGap: number
  /** Between stacked rows. */
  stackRowGap: number
  /** Corner radius of the connector elbows. */
  radius: number
}

export const METRICS: OrgMetrics = { cardW: 236, cardH: 96, gapX: 24, gapY: 64, stackMin: 5, stackGap: 56, stackRowGap: 16, radius: 10 }

export interface CardBox { id: string; x: number; y: number }
export interface Connector { from: string; to: string; d: string }
export interface OrgLayout {
  boxes: Map<string, CardBox>
  connectors: Connector[]
  width: number
  height: number
}

type Mode = 'leaf' | 'row' | 'stack'
interface Size { w: number; h: number; mode: Mode; rowW: number }

/** The reports that are drawn: the node's, when it is opened. */
export function shownChildren(tree: OrgTree, expanded: ReadonlySet<string>, id: string): string[] {
  const n = tree.nodes.get(id)
  return n && expanded.has(id) ? n.children : []
}

/**
 * Where every card sits. The top card is centred over its reports; reports
 * stand in a row with a bus line above them, except a big team of people
 * with no reports of their own, which stacks in two columns either side of a
 * line down from the manager. Iterative, so deep lines can't overflow.
 */
export function layoutTree(tree: OrgTree, expanded: ReadonlySet<string>, m: OrgMetrics = METRICS): OrgLayout {
  const size = new Map<string, Size>()
  // Post-order: children before parents.
  const post: string[] = []
  const stack: Array<{ id: string; done: boolean }> = [{ id: tree.rootId, done: false }]
  const seen = new Set<string>()
  while (stack.length) {
    const top = stack.pop()!
    if (top.done) { post.push(top.id); continue }
    if (seen.has(top.id)) continue
    seen.add(top.id)
    stack.push({ id: top.id, done: true })
    const ks = shownChildren(tree, expanded, top.id)
    for (let i = ks.length - 1; i >= 0; i--) if (!seen.has(ks[i])) stack.push({ id: ks[i], done: false })
  }
  for (const id of post) {
    const ks = shownChildren(tree, expanded, id)
    if (!ks.length) { size.set(id, { w: m.cardW, h: m.cardH, mode: 'leaf', rowW: 0 }); continue }
    if (ks.length >= m.stackMin && ks.every((k) => (tree.nodes.get(k)?.children.length ?? 0) === 0)) {
      const rows = Math.ceil(ks.length / 2)
      const blockW = 2 * m.cardW + m.stackGap
      const blockH = rows * m.cardH + (rows - 1) * m.stackRowGap
      size.set(id, { w: Math.max(m.cardW, blockW), h: m.cardH + m.gapY + blockH, mode: 'stack', rowW: blockW })
      continue
    }
    const sizes = ks.map((k) => size.get(k)!)
    const rowW = sizes.reduce((s, z) => s + z.w, 0) + m.gapX * (ks.length - 1)
    const childH = Math.max(...sizes.map((z) => z.h))
    size.set(id, { w: Math.max(m.cardW, rowW), h: m.cardH + m.gapY + childH, mode: 'row', rowW })
  }

  const boxes = new Map<string, CardBox>()
  const connectors: Connector[] = []
  const place: Array<{ id: string; left: number; top: number }> = [{ id: tree.rootId, left: 0, top: 0 }]
  while (place.length) {
    const { id, left, top } = place.pop()!
    const z = size.get(id)
    if (!z || boxes.has(id)) continue
    const x = left + (z.w - m.cardW) / 2
    boxes.set(id, { id, x, y: top })
    if (z.mode === 'leaf') continue
    const ks = shownChildren(tree, expanded, id)
    const cx = x + m.cardW / 2
    const y0 = top + m.cardH
    const childTop = y0 + m.gapY
    if (z.mode === 'stack') {
      const blockLeft = left + (z.w - z.rowW) / 2
      ks.forEach((k, i) => {
        const row = Math.floor(i / 2)
        const right = i % 2 === 1
        const kx = right ? blockLeft + m.cardW + m.stackGap : blockLeft
        const ky = childTop + row * (m.cardH + m.stackRowGap)
        boxes.set(k, { id: k, x: kx, y: ky })
        connectors.push({ from: id, to: k, d: sideElbow(cx, y0, right ? kx : kx + m.cardW, ky + m.cardH / 2, m.radius) })
      })
      continue
    }
    let childLeft = left + (z.w - z.rowW) / 2
    const busY = y0 + m.gapY / 2
    for (const k of ks) {
      const kz = size.get(k)!
      place.push({ id: k, left: childLeft, top: childTop })
      const kcx = childLeft + kz.w / 2
      connectors.push({ from: id, to: k, d: busElbow(cx, y0, kcx, busY, childTop, m.radius) })
      childLeft += kz.w + m.gapX
    }
  }
  const root = size.get(tree.rootId)!
  return { boxes, connectors, width: root.w, height: root.h }
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** Down from the parent to the bus line, along it, and down into the report: rounded elbows. */
export function busElbow(x0: number, y0: number, x1: number, busY: number, y1: number, radius: number): string {
  const dx = x1 - x0
  if (Math.abs(dx) < 0.5) return `M${r1(x0)},${r1(y0)}V${r1(y1)}`
  const r = Math.min(radius, Math.abs(dx) / 2, (busY - y0), (y1 - busY))
  const s = Math.sign(dx)
  return `M${r1(x0)},${r1(y0)}V${r1(busY - r)}Q${r1(x0)},${r1(busY)} ${r1(x0 + s * r)},${r1(busY)}`
    + `H${r1(x1 - s * r)}Q${r1(x1)},${r1(busY)} ${r1(x1)},${r1(busY + r)}V${r1(y1)}`
}

/** Down the line between the stacked columns, then across into the report's side: one rounded elbow. */
export function sideElbow(x0: number, y0: number, x1: number, y1: number, radius: number): string {
  const dx = x1 - x0
  const r = Math.min(radius, Math.abs(dx), Math.max(0, y1 - y0))
  const s = Math.sign(dx) || 1
  return `M${r1(x0)},${r1(y0)}V${r1(y1 - r)}Q${r1(x0)},${r1(y1)} ${r1(x0 + s * r)},${r1(y1)}H${r1(x1)}`
}

/** The connectors to highlight: the line from the top down to each of `ids`. */
export function pathEdges(tree: OrgTree, ids: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const id of ids) {
    const p = pathTo(tree, id)
    for (let i = 1; i < p.length; i++) out.add(`${p[i - 1]}>${p[i]}`)
  }
  return out
}

// ── the phone list ─────────────────────────────────────────────────────────

export interface ListRow { id: string; depth: number; hasChildren: boolean; open: boolean }

/** The rows of the indented list: depth first, opened people's reports under them. */
export function listRows(tree: OrgTree, expanded: ReadonlySet<string>): ListRow[] {
  const rows: ListRow[] = []
  const stack: string[] = [tree.rootId]
  const seen = new Set<string>()
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    const n = tree.nodes.get(id)
    if (!n) continue
    const open = expanded.has(id)
    rows.push({ id, depth: n.depth, hasChildren: n.children.length > 0, open })
    if (open) for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i])
  }
  return rows
}

// ── search ──────────────────────────────────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')

/**
 * People matching the words typed, best first: names starting with them,
 * then names containing them, then designation or department. Every word
 * must match somewhere.
 */
export function searchPeople(tree: OrgTree, query: string, limit = 8): OrgPerson[] {
  const words = norm(query).split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const scored: Array<{ p: OrgPerson; score: number }> = []
  for (const id of tree.order) {
    const p = tree.nodes.get(id)?.person
    if (!p) continue
    const name = norm(p.name)
    const nameWords = name.split(/\s+/)
    const rest = `${norm(p.designation)} ${norm(p.department)}`
    let score = 0
    let all = true
    for (const w of words) {
      if (nameWords.some((nw) => nw.startsWith(w))) score += 3
      else if (name.includes(w)) score += 2
      else if (rest.includes(w)) score += 1
      else { all = false; break }
    }
    if (all) scored.push({ p, score })
  }
  scored.sort((a, b) => b.score - a.score || byName(a.p, b.p))
  return scored.slice(0, limit).map((s) => s.p)
}

// ── words ──────────────────────────────────────────────────────────────────

/** A status worth a pill on the card (Active needs none). */
export function statusLabel(status: string | null | undefined): { label: string; tone: 'info' | 'warning' | 'danger' } | null {
  switch (status) {
    case 'PROBATION': return { label: 'Probation', tone: 'info' }
    case 'NOTICE_PERIOD': return { label: 'On notice', tone: 'warning' }
    case 'SUSPENDED': return { label: 'Suspended', tone: 'danger' }
    default: return null
  }
}

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`
