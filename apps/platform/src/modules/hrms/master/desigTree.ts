// The designation ladder (audit H-56): each designation may name the designation it reports to
// (hrms.designations.reports_to_designation_id, already in the API). These rules back the Master page's
// "Reports to" field and its Hierarchy view. Pure, and safe on bad data: a loop or a link to a missing
// or other-company designation never hangs the page — that designation simply starts its own branch.

export interface DesigLike {
  id: string
  /** Saved designations carry their API id here; new, unsaved ones don't (they can't be linked to yet). */
  _key?: string
  name: string
  co?: string
  reportsTo?: string | null
  status?: string
}

/** Every designation below `id` (its reports, their reports…), loops included only once. */
export function descendantsOf(list: readonly DesigLike[], id: string): Set<string> {
  const kids = new Map<string, string[]>()
  for (const d of list) if (d.reportsTo) kids.set(d.reportsTo, [...(kids.get(d.reportsTo) ?? []), d.id])
  const out = new Set<string>()
  const stack = [...(kids.get(id) ?? [])]
  while (stack.length) {
    const n = stack.pop()!
    if (out.has(n) || n === id) continue
    out.add(n)
    stack.push(...(kids.get(n) ?? []))
  }
  return out
}

/**
 * What a designation may report to: a saved, active designation of the same company that is not
 * itself and not below it (which would make a loop). `self` is null for a new designation.
 */
export function reportsToOptions(list: readonly DesigLike[], self: string | null, co: string | null | undefined): DesigLike[] {
  const below = self ? descendantsOf(list, self) : new Set<string>()
  return list
    .filter((d) => !!d._key && d.id !== self && !below.has(d.id) && d.status !== 'Inactive' && (!co || !d.co || d.co === co))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface DesigNode<T extends DesigLike = DesigLike> { d: T; depth: number; children: number }

/**
 * The ladder as rows, top to bottom (depth-first, names A–Z at each level). A designation whose
 * "reports to" is missing, in another company or part of a loop starts at the top.
 */
export function desigTree<T extends DesigLike>(list: readonly T[]): DesigNode<T>[] {
  const byId = new Map(list.map((d) => [d.id, d]))
  const parentOf = (d: T): string | null => {
    const p = d.reportsTo ? byId.get(d.reportsTo) : undefined
    if (!p || p.id === d.id || (d.co && p.co && d.co !== p.co)) return null
    return p.id
  }
  // A designation inside a loop: walking up from it comes back to it.
  const inLoop = (d: T): boolean => {
    const seen = new Set<string>([d.id])
    let cur = parentOf(d)
    while (cur) {
      // Back at the start: a loop through `d`. Another seen one: a loop above `d`, which isn't `d`'s.
      if (seen.has(cur)) return cur === d.id
      seen.add(cur)
      const next = byId.get(cur)
      cur = next ? parentOf(next) : null
    }
    return false
  }
  const kids = new Map<string | null, T[]>()
  for (const d of list) {
    const p = inLoop(d) ? null : parentOf(d)
    kids.set(p, [...(kids.get(p) ?? []), d])
  }
  for (const v of kids.values()) v.sort((a, b) => a.name.localeCompare(b.name))
  const out: DesigNode<T>[] = []
  const placed = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const d of kids.get(parent) ?? []) {
      if (placed.has(d.id)) continue
      placed.add(d.id)
      out.push({ d, depth, children: (kids.get(d.id) ?? []).length })
      walk(d.id, depth + 1)
    }
  }
  walk(null, 0)
  // Anything still unplaced (a branch hanging off a loop) starts at the top.
  for (const d of list) if (!placed.has(d.id)) { placed.add(d.id); out.push({ d, depth: 0, children: (kids.get(d.id) ?? []).length }); walk(d.id, 1) }
  return out
}
