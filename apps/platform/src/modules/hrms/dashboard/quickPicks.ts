// Quick-action customisation (audit G-59, BW-112): the rules behind "Customise" on the Dashboard and Home quick
// actions. A person picks and orders up to 6 of the actions they are allowed; the picks are saved per person on
// the server (GET/PUT /v1/me/dashboard/quick-actions, useUiPrefs). No picks = the default tiles, today's set.
import { MAX_PICKED_QUICK_ACTIONS } from '../api/shared/useUiPrefs'

export const MAX_PICKS = MAX_PICKED_QUICK_ACTIONS

/**
 * The tiles to show: the picked ones that are still allowed, in the picked order; the default tiles (all of
 * them, in today's order) when nothing is picked or none of the picks is allowed any more.
 */
export function applyPicks<T extends { key: string }>(all: readonly T[], picked: readonly string[] | null | undefined): T[] {
  if (!picked || picked.length === 0) return [...all]
  const byKey = new Map(all.map((t) => [t.key, t]))
  const out: T[] = []
  for (const k of picked) {
    const t = byKey.get(k)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= MAX_PICKS) break
  }
  return out.length ? out : [...all]
}

/** What the Customise dialog starts from: the keys shown now (at most 6). */
export function startDraft(all: readonly { key: string }[], picked: readonly string[] | null | undefined): string[] {
  return applyPicks(all, picked).slice(0, MAX_PICKS).map((t) => t.key)
}

/** Ticks or unticks an action; a new one goes last, and no more than 6 can be ticked. */
export function togglePick(draft: readonly string[], key: string): string[] {
  if (draft.includes(key)) return draft.filter((k) => k !== key)
  return draft.length >= MAX_PICKS ? [...draft] : [...draft, key]
}

/** Moves a ticked action one place up (-1) or down (+1). */
export function movePick(draft: readonly string[], key: string, by: -1 | 1): string[] {
  const i = draft.indexOf(key)
  const j = i + by
  if (i < 0 || j < 0 || j >= draft.length) return [...draft]
  const next = [...draft]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/**
 * What Save sends: null (the default tiles) when the draft is exactly the default, so actions the person gains
 * later still show; otherwise the picks.
 */
export function picksToSave(all: readonly { key: string }[], draft: readonly string[]): string[] | null {
  const defaults = all.map((t) => t.key)
  const same = defaults.length === draft.length && defaults.every((k, i) => k === draft[i])
  return same ? null : [...draft]
}

/** The order the dialog lists the actions in: the ticked ones in their order, then the rest in today's order. */
export function dialogOrder<T extends { key: string }>(all: readonly T[], draft: readonly string[]): T[] {
  const ticked = draft.map((k) => all.find((t) => t.key === k)).filter((t): t is T => !!t)
  return [...ticked, ...all.filter((t) => !draft.includes(t.key))]
}
