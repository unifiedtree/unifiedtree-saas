// Leave guards: a page with unsaved changes asks before the app moves away from it.
//
//   useNavigationGuard(dirty ? (proceed) => { openMyDialog(proceed); return true } : null)
//
// A guard gets `proceed` (carry on with the move) and returns true when it stopped the move (it will
// call `proceed` itself if the person chooses to leave), false to let it through. The shell runs the
// guards before every move it makes (rail, Pages panel, More, the settings pages, Home), and a page's
// own section navigation can use runNavigationGuards() the same way.
//
// This replaces `window.__utLeaveGuard`. That global still works while pages move over: the shell
// asks it too, and payroll's section bar keeps reading it. The native `beforeunload` prompts and the
// employee form's click guard are separate and unchanged.
import { useEffect, useRef } from 'react'

export type NavigationGuard = (proceed: () => void) => boolean

declare global {
  interface Window { __utLeaveGuard?: ((proceed: () => void) => boolean) | null }
}

const guards: NavigationGuard[] = []

/** Adds a guard; the returned function removes it. The newest guard is asked first. */
export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.push(guard)
  return () => {
    const i = guards.lastIndexOf(guard)
    if (i >= 0) guards.splice(i, 1)
  }
}

/** True while any guard (or the legacy window guard) is set. */
export function hasNavigationGuard(): boolean {
  return guards.length > 0 || typeof legacyGuard() === 'function'
}

function legacyGuard(): NavigationGuard | null {
  if (typeof window === 'undefined') return null
  const g = window.__utLeaveGuard
  return typeof g === 'function' ? g : null
}

/**
 * Asks the guards about a move. True = a guard stopped it (and will call `proceed` if the person
 * decides to leave); false = nothing stopped it, so the caller moves now.
 */
export function runNavigationGuards(proceed: () => void): boolean {
  for (let i = guards.length - 1; i >= 0; i--) if (guards[i](proceed)) return true
  const legacy = legacyGuard()
  return !!legacy && legacy(proceed)
}

/** Moves unless a guard stops it; a guard that stops it calls `go` later if the person leaves anyway. */
export function guardedGo(go: () => void): void {
  let done = false
  const once = () => { if (!done) { done = true; go() } }
  if (!runNavigationGuards(once)) once()
}

/** Registers `guard` while the component is mounted and the guard is not null. */
export function useNavigationGuard(guard: NavigationGuard | null | undefined): void {
  const ref = useRef(guard)
  ref.current = guard
  const on = !!guard
  useEffect(() => {
    if (!on) return
    return registerNavigationGuard((proceed) => (ref.current ? ref.current(proceed) : false))
  }, [on])
}
