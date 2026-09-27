// The design's popover (notifications, role menu, company switcher): 12px radius, hairline
// border, the popover shadow and a pop-in. Anchored to an element, portalled to <body>, kept
// inside the viewport (flips above when there's no room below). Escape and a press outside
// close it; Escape and Tab-out put focus back on the anchor.
import {
  useCallback, useLayoutEffect, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { tabbables, useEscape, useLayer, useOutsidePress } from './overlayCore'
import './overlays.css'

export type PopoverPlacement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top-end' | 'top'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** The element the popover hangs from (usually its trigger button). */
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  placement?: PopoverPlacement
  /** Gap to the anchor in px (default 8). */
  offset?: number
  /** Width in px, or 'anchor' to match the anchor. Default: the content's width. */
  width?: number | 'anchor'
  /** Upper limit for the height in px; it never grows past the viewport either. */
  maxHeight?: number
  role?: 'dialog' | 'menu' | 'listbox' | 'group'
  'aria-label'?: string
  'aria-labelledby'?: string
  id?: string
  className?: string
  style?: CSSProperties
  /** Where focus goes on open: the popover (default for role=dialog), its first control, nowhere, or an element. */
  initialFocus?: 'container' | 'first' | 'none' | RefObject<HTMLElement | null>
  /** Put focus back on the anchor after Escape or Tab-out (default true). */
  returnFocus?: boolean
  /** A press outside closes it (default true). */
  closeOnOutside?: boolean
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void
  zIndex?: number
}

interface Pos { top: number; left: number; width?: number; maxHeight: number; side: 'top' | 'bottom'; ready: boolean }
const MARGIN = 16

export function Popover(props: PopoverProps) {
  if (!props.open || typeof document === 'undefined') return null
  return <OpenPopover {...props} />
}

function OpenPopover({
  onClose, anchorRef, children, placement = 'bottom-start', offset = 8, width, maxHeight, role, id, className, style,
  initialFocus, returnFocus = true, closeOnOutside = true, onKeyDown, zIndex = 1200, ...aria
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<Pos>({ top: 0, left: 0, maxHeight: 0, side: 'bottom', ready: false })
  const isTop = useLayer(true)

  const dismiss = useCallback((refocus: boolean) => {
    onClose()
    if (refocus && returnFocus) anchorRef.current?.focus({ preventScroll: true })
  }, [onClose, returnFocus, anchorRef])

  useEscape(true, isTop, () => dismiss(true))
  useOutsidePress(closeOnOutside, [ref, anchorRef], () => onClose())

  const place = useCallback(() => {
    const a = anchorRef.current, el = ref.current
    if (!a || !el) return
    const r = a.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const w = width === 'anchor' ? r.width : typeof width === 'number' ? Math.min(width, vw - MARGIN * 2) : undefined
    const natural = el.scrollHeight
    const below = vh - r.bottom - offset - MARGIN, above = r.top - offset - MARGIN
    const wantBottom = !placement.startsWith('top')
    const side: 'top' | 'bottom' = wantBottom
      ? (natural > below && above > below ? 'top' : 'bottom')
      : (natural > above && below > above ? 'bottom' : 'top')
    const room = Math.max(120, side === 'bottom' ? below : above)
    const maxH = Math.min(maxHeight ?? Infinity, room)
    const h = Math.min(natural, maxH)
    const popW = w ?? el.offsetWidth
    const align = placement.endsWith('-end') ? 'end' : placement.endsWith('-start') ? 'start' : 'center'
    let left = align === 'start' ? r.left : align === 'end' ? r.right - popW : r.left + r.width / 2 - popW / 2
    left = Math.max(MARGIN, Math.min(left, vw - popW - MARGIN))
    const top = side === 'bottom' ? r.bottom + offset : Math.max(MARGIN, r.top - offset - h)
    setPos((p) => (p.ready && p.top === top && p.left === left && p.width === w && p.maxHeight === maxH && p.side === side
      ? p
      : { top, left, width: w, maxHeight: maxH, side, ready: true }))
  }, [anchorRef, width, offset, placement, maxHeight])

  useLayoutEffect(() => {
    place()
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && ref.current?.contains(e.target))) place() }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => place()) : null
    if (ro && ref.current) ro.observe(ref.current)
    if (ro && anchorRef.current) ro.observe(anchorRef.current)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
      ro?.disconnect()
    }
  }, [place, anchorRef])

  // Initial focus once placed.
  const focused = useRef(false)
  useLayoutEffect(() => {
    if (!pos.ready || focused.current) return
    focused.current = true
    const el = ref.current
    if (!el) return
    const want = initialFocus ?? (role === 'dialog' ? 'container' : 'none')
    if (want === 'none') return
    const target = typeof want === 'object' ? want.current : want === 'first' ? tabbables(el)[0] : el
    ;(target || el).focus({ preventScroll: true })
  }, [pos.ready, initialFocus, role])

  const keyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (e.defaultPrevented || e.key !== 'Tab' || !ref.current) return
    // Leaving the popover with Tab closes it and goes back to the anchor, so focus never gets lost at the end of <body>.
    const list = tabbables(ref.current)
    const current = document.activeElement
    const atEnd = !list.length || current === list[list.length - 1]
    const atStart = !list.length || current === list[0] || current === ref.current
    if (!e.shiftKey && atEnd) { onClose(); if (returnFocus) anchorRef.current?.focus({ preventScroll: true }) }
    else if (e.shiftKey && atStart) { e.preventDefault(); dismiss(true) }
  }

  return createPortal(
    <div
      ref={ref}
      id={id}
      role={role}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      aria-modal={role === 'dialog' ? false : undefined}
      tabIndex={-1}
      className={['uko-pop', className].filter(Boolean).join(' ')}
      data-side={pos.side}
      data-uko-layer=""
      onKeyDown={keyDown}
      style={{
        ...style,
        zIndex,
        top: pos.top,
        left: pos.left,
        width: pos.width ?? style?.width,
        maxHeight: pos.ready ? pos.maxHeight : undefined,
        visibility: pos.ready ? undefined : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
