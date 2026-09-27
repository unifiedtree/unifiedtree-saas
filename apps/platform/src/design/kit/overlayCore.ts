// Shared plumbing for the overlay kit (SidePanel, Dialog, Popover, Menu, Dropdown):
// one stack of open layers so Escape and Tab only ever act on the top-most one,
// a focus trap that returns focus where it came from, and the icon helper.
import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { dashIcon } from '@/design/dc/icons'

/** An icon given as a design icon name (see design/dc/icons) or as a node. */
export type KitIcon = ReactNode | string

export function kitIcon(icon: KitIcon | undefined, size = 18): ReactNode {
  if (icon == null || icon === false || icon === '') return null
  return typeof icon === 'string' ? dashIcon(icon, size) : icon
}

// ── Layer stack ──────────────────────────────────────────────────────────────
// Every open overlay pushes itself; only the last one reacts to Escape / Tab, so
// Escape in a menu inside a side panel closes the menu and leaves the panel open.
const stack: number[] = []
let seq = 0

/** Registers an open layer; returns a stable `isTop()` check. */
export function useLayer(active: boolean): () => boolean {
  const id = useRef(0)
  useEffect(() => {
    if (!active) return
    const me = ++seq
    id.current = me
    stack.push(me)
    return () => {
      const i = stack.lastIndexOf(me)
      if (i >= 0) stack.splice(i, 1)
      if (id.current === me) id.current = 0
    }
  }, [active])
  return useCallback(() => id.current !== 0 && stack[stack.length - 1] === id.current, [])
}

/** Escape closes the top-most layer only, and never one an inner widget already handled. */
export function useEscape(active: boolean, isTop: () => boolean, onEscape: () => void) {
  const cb = useRef(onEscape)
  cb.current = onEscape
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || !isTop()) return
      e.preventDefault()
      cb.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, isTop])
}

// ── Focus ────────────────────────────────────────────────────────────────────
const CANDIDATES = 'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable="true"]'

/** Elements Tab can reach inside `root`, in DOM order (skips hidden, disabled and tabindex=-1). */
export function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CANDIDATES)).filter((el) => {
    if ((el as HTMLButtonElement).disabled) return false
    if (el.tabIndex < 0) return false
    if (el instanceof HTMLInputElement && el.type === 'hidden') return false
    if (el.closest('[hidden],[inert]')) return false
    if (!el.getClientRects().length) return false
    return getComputedStyle(el).visibility !== 'hidden'
  })
}

/** Where focus goes when a modal layer opens. */
export type InitialFocus = 'container' | 'first' | RefObject<HTMLElement | null>

/**
 * Modal focus handling: focuses the layer when it opens, keeps Tab inside it while it is the
 * top layer, and puts focus back on whatever had it before when it closes.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  isTop: () => boolean,
  initialFocus: InitialFocus = 'container',
) {
  const initial = useRef(initialFocus)
  initial.current = initialFocus

  useEffect(() => {
    if (!active) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = ref.current
    if (root) {
      const want = initial.current
      const target = typeof want === 'object' ? want.current : want === 'first' ? tabbables(root)[0] : null
      ;(target || root).focus({ preventScroll: true })
    }
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [active, ref])

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented || !isTop()) return
      const root = ref.current
      if (!root) return
      const current = document.activeElement as HTMLElement | null
      const inside = !!current && root.contains(current)
      // Focus inside a nested layer (a calendar, a Radix modal, a portalled list) is that layer's business.
      if (!inside && current && current !== document.body && current.closest('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[data-uko-layer]')) return
      const list = tabbables(root)
      if (!list.length) { e.preventDefault(); root.focus({ preventScroll: true }); return }
      const first = list[0], last = list[list.length - 1]
      if (!inside) { e.preventDefault(); (e.shiftKey ? last : first).focus(); return }
      if (e.shiftKey && (current === first || current === root)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, isTop, ref])
}

/** Calls `onOutside` for a pointer press outside every given element (used by non-modal popovers). */
export function useOutsidePress(active: boolean, refs: RefObject<HTMLElement | null>[], onOutside: () => void) {
  const cb = useRef(onOutside)
  cb.current = onOutside
  const list = useRef(refs)
  list.current = refs
  useEffect(() => {
    if (!active) return
    const onDown = (e: PointerEvent) => {
      const t = e.target
      if (!(t instanceof Node)) return
      if (list.current.some((r) => r.current?.contains(t))) return
      // The shared calendar portals its picker to <body>; a pick there is not an outside press.
      if (t instanceof Element && t.closest('.utc-pop,.utc-backdrop')) return
      cb.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [active])
}
