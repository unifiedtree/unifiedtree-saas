// The org chart's board: the cards and their connectors on a dotted canvas that
// moves and zooms (Keka: drag to move, + / − / fit on the right). Moves are
// applied straight to the stage's transform, so dragging never re-renders the
// cards; the cards re-render only when the chart itself changes.
import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent,
} from 'react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { motionAllowed } from '@/design/theme/motion'
import { COMPANY_ROOT, METRICS, layoutTree, type OrgLayout, type OrgTree } from './orgTree'
import { CompanyCard, PersonCard, type CardHandlers } from './OrgCards'

/** Where the board is: shift in px and zoom. */
export interface View { x: number; y: number; k: number }

/** A move the page asks for: show a person (search, Me), the top, or everything. */
export interface MoveRequest { seq: number; id?: string | null; to: 'person' | 'top' | 'fit' }

interface OrgCanvasProps extends CardHandlers {
  tree: OrgTree
  expanded: ReadonlySet<string>
  /** Highlighted card (a search result, a "View in org chart" link). */
  found: string | null
  /** Connectors drawn in brand: the line from the top to you and to the found person ("a>b"). */
  pathEdges: ReadonlySet<string>
  companyName: string
  embedded?: boolean
  /** Where the board starts (kept from before a profile was opened), else chosen from the chart. */
  initialView?: View | null
  request: MoveRequest | null
  /** The card that must stay where it is on screen when the chart changes (the one just opened or closed). */
  anchorRef: MutableRefObject<string | null>
  /** After a move ends (to keep the view for Back). */
  onViewChange?: (v: View) => void
  /** Any drag or zoom: the page closes its pop-up. */
  onInteract?: () => void
}

const PAD = 40
const MIN_K = 0.15
const MAX_K = 2
const STEP = 1.25
const { cardW: CW, cardH: CH } = METRICS

const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k))
/** No empty board beside a chart wider than the board: its edges stay at the board's edges (a narrower chart may sit anywhere). */
const edgeClampX = (x: number, k: number, chartW: number, boardW: number) => {
  const w = chartW * k
  return w + 2 * PAD <= boardW ? x : Math.min(PAD, Math.max(boardW - PAD - w, x))
}

export function OrgCanvas({
  tree, expanded, found, pathEdges, companyName, embedded, initialView, request, anchorRef, onViewChange, onInteract, onOpen, onToggle,
}: OrgCanvasProps) {
  const viewRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const t = useRef<View>({ x: 0, y: 0, k: 1 })
  const [pct, setPct] = useState(100)
  const layout = useMemo(() => layoutTree(tree, expanded), [tree, expanded])
  const layoutRef = useRef<OrgLayout>(layout)
  const prevLayout = useRef<OrgLayout | null>(null)
  const started = useRef(false)
  const handled = useRef<number>(-1)
  const glideTimer = useRef<number>(0)
  const changeTimer = useRef<number>(0)
  const cb = useRef({ onViewChange, onInteract })
  cb.current = { onViewChange, onInteract }

  const size = () => {
    const r = viewRef.current?.getBoundingClientRect()
    return { w: r?.width ?? 0, h: r?.height ?? 0 }
  }

  /** Puts the board where `t` says; `glide` animates it (unless motion is off). */
  const apply = useCallback((glide = false) => {
    const st = stageRef.current, vw = viewRef.current
    if (!st || !vw) return
    const { x, y, k } = t.current
    window.clearTimeout(glideTimer.current)
    if (glide && motionAllowed()) {
      st.classList.add('is-gliding'); vw.classList.add('is-gliding')
      glideTimer.current = window.setTimeout(() => { st.classList.remove('is-gliding'); vw.classList.remove('is-gliding') }, 480)
    } else {
      st.classList.remove('is-gliding'); vw.classList.remove('is-gliding')
    }
    st.style.transform = `translate(${x}px, ${y}px) scale(${k})`
    vw.style.setProperty('--uoc-x', `${x}px`)
    vw.style.setProperty('--uoc-y', `${y}px`)
    vw.style.setProperty('--uoc-k', String(k))
    setPct(Math.round(k * 100))
    window.clearTimeout(changeTimer.current)
    changeTimer.current = window.setTimeout(() => cb.current.onViewChange?.({ ...t.current }), 250)
  }, [])

  /** Everything on screen, the top at the top. */
  const fit = useCallback((lay: OrgLayout, glide: boolean) => {
    const { w, h } = size()
    const k = clampK(Math.min((w - 2 * PAD) / lay.width, (h - 2 * PAD) / lay.height, 1))
    t.current = { k, x: (w - lay.width * k) / 2, y: Math.max(PAD / 2, Math.min(PAD, (h - lay.height * k) / 2)) }
    apply(glide)
  }, [apply])

  /** A person on screen, with the line above them in view when it fits. */
  const showPerson = useCallback((lay: OrgLayout, id: string, glide: boolean, keepZoom: boolean) => {
    const b = lay.boxes.get(id)
    if (!b) return
    const { w, h } = size()
    const need = b.y + CH + 32
    let k = keepZoom ? Math.max(t.current.k, 0.75) : Math.min(1, (h - 2 * PAD) / need)
    k = clampK(Math.max(Math.min(k, 1.25), 0.6))
    const x = edgeClampX(w / 2 - (b.x + CW / 2) * k, k, lay.width, w)
    // The top in view if the whole line fits; otherwise the person a little above the middle.
    const y = need * k <= h - 2 * PAD ? PAD : h * 0.42 - (b.y + CH / 2) * k
    t.current = { x, y, k }
    apply(glide)
  }, [apply])

  /** The top card at the top, in the middle. */
  const showTop = useCallback((lay: OrgLayout, glide: boolean) => {
    const b = lay.boxes.get(tree.rootId)
    if (!b) return
    const { w } = size()
    const k = clampK(Math.max(t.current.k, 0.6))
    t.current = { k, x: edgeClampX(w / 2 - (b.x + CW / 2) * k, k, lay.width, w), y: PAD }
    apply(glide)
  }, [apply, tree.rootId])

  /** The first view: as it was (Back), or the person asked for / you, or everything when it fits. */
  const start = useCallback(() => {
    if (started.current) return
    const { w, h } = size()
    if (w < 10 || h < 10) return
    started.current = true
    const lay = layoutRef.current
    if (request && request.seq !== handled.current && request.to === 'person' && request.id && lay.boxes.has(request.id)) {
      handled.current = request.seq
      showPerson(lay, request.id, false, false)
      return
    }
    if (initialView && Number.isFinite(initialView.k)) {
      t.current = { x: initialView.x, y: initialView.y, k: clampK(initialView.k) }
      apply(false)
      return
    }
    const fitK = Math.min((w - 2 * PAD) / lay.width, (h - 2 * PAD) / lay.height)
    if (tree.you && lay.boxes.has(tree.you) && fitK < 0.8) showPerson(lay, tree.you, false, false)
    else fit(lay, false)
  }, [apply, fit, initialView, request, showPerson, tree.you])

  // The chart changed: keep the card just opened or closed where it was on screen.
  useLayoutEffect(() => {
    const prev = prevLayout.current
    prevLayout.current = layout
    layoutRef.current = layout
    if (!started.current) { start(); return }
    const a = anchorRef.current
    anchorRef.current = null
    const o = a && prev ? prev.boxes.get(a) : null
    const n = a ? layout.boxes.get(a) : null
    if (o && n && (o.x !== n.x || o.y !== n.y)) {
      t.current = { ...t.current, x: t.current.x + (o.x - n.x) * t.current.k, y: t.current.y + (o.y - n.y) * t.current.k }
      apply(false)
    }
  }, [layout, anchorRef, apply, start])

  // A move the page asked for (after the chart opened the people on the way).
  useLayoutEffect(() => {
    if (!request || request.seq === handled.current || !started.current) return
    const lay = layoutRef.current
    if (request.to === 'fit') { handled.current = request.seq; fit(lay, true); return }
    if (request.to === 'top') { handled.current = request.seq; showTop(lay, true); return }
    if (request.id && lay.boxes.has(request.id)) { handled.current = request.seq; showPerson(lay, request.id, true, true) }
  }, [request, layout, fit, showTop, showPerson])

  // Start once the board has a size, and keep it in place when the window resizes.
  useEffect(() => {
    const el = viewRef.current
    if (!el || typeof ResizeObserver === 'undefined') { start(); return }
    const ro = new ResizeObserver(() => start())
    ro.observe(el)
    return () => ro.disconnect()
  }, [start])

  useEffect(() => () => { window.clearTimeout(glideTimer.current); window.clearTimeout(changeTimer.current) }, [])

  const zoomAt = useCallback((px: number, py: number, factor: number, glide = false) => {
    const k0 = t.current.k
    const k1 = clampK(k0 * factor)
    if (k1 === k0) return
    t.current = { k: k1, x: px - (px - t.current.x) * (k1 / k0), y: py - (py - t.current.y) * (k1 / k0) }
    apply(glide)
  }, [apply])

  const zoomCentre = (factor: number) => {
    const { w, h } = size()
    cb.current.onInteract?.()
    zoomAt(w / 2, h / 2, factor, true)
  }

  // Wheel: scroll moves the board; Ctrl/⌘ + scroll (and a trackpad pinch) zooms at the pointer.
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-no-pan]')) return
      e.preventDefault()
      cb.current.onInteract?.()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect()
        zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * unit * 0.0022))
      } else {
        const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
        const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY
        t.current = { ...t.current, x: t.current.x - dx * unit, y: t.current.y - dy * unit }
        apply(false)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [apply, zoomAt])

  // Drag to move (from anywhere, cards too); two fingers pinch to zoom. The pointer is captured only
  // once it has moved, so a plain click still reaches the card; a drag never opens one.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null)
  const pinch = useRef<{ d: number; mx: number; my: number; k: number; tx: number; ty: number } | null>(null)
  const dragged = useRef(false)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as Element).closest('[data-no-pan]')) return
    dragged.current = false
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 1) {
      drag.current = { x: e.clientX, y: e.clientY, tx: t.current.x, ty: t.current.y, moved: false }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const r = viewRef.current!.getBoundingClientRect()
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2 - r.left, my: (a.y + b.y) / 2 - r.top, k: t.current.k, tx: t.current.x, ty: t.current.y }
      drag.current = null
      try { viewRef.current!.setPointerCapture(e.pointerId) } catch { /* the pointer is gone */ }
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = pinch.current
    if (p && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const k = clampK(p.k * (Math.hypot(a.x - b.x, a.y - b.y) / p.d))
      const r = viewRef.current!.getBoundingClientRect()
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top
      t.current = { k, x: mx - (p.mx - p.tx) * (k / p.k), y: my - (p.my - p.ty) * (k / p.k) }
      dragged.current = true
      apply(false)
      return
    }
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return
      d.moved = true
      dragged.current = true
      cb.current.onInteract?.()
      viewRef.current?.classList.add('is-panning')
      try { viewRef.current?.setPointerCapture(e.pointerId) } catch { /* the pointer is gone */ }
    }
    t.current = { ...t.current, x: d.tx + dx, y: d.ty + dy }
    apply(false)
  }

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(e.pointerId)) return
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()]
      drag.current = { x: rest.x, y: rest.y, tx: t.current.x, ty: t.current.y, moved: true }
    } else if (pointers.current.size === 0) {
      drag.current = null
      viewRef.current?.classList.remove('is-panning')
    }
  }

  // A drag that ends on a card is not a click on it.
  const onClickCapture = (e: ReactMouseEvent) => {
    if (dragged.current) { e.stopPropagation(); e.preventDefault(); dragged.current = false }
  }

  // Focus moving to a card off screen (Tab) scrolls the board's box; turn that into a move of the board.
  const onScroll = () => {
    const el = viewRef.current
    if (!el || (!el.scrollLeft && !el.scrollTop)) return
    const sx = el.scrollLeft, sy = el.scrollTop
    el.scrollLeft = 0; el.scrollTop = 0
    t.current = { ...t.current, x: t.current.x - sx, y: t.current.y - sy }
    apply(false)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('input, textarea, select, [data-no-pan]')) return
    const step = 80
    const pan = (dx: number, dy: number) => { e.preventDefault(); t.current = { ...t.current, x: t.current.x + dx, y: t.current.y + dy }; apply(true) }
    switch (e.key) {
      case 'ArrowLeft': return pan(step, 0)
      case 'ArrowRight': return pan(-step, 0)
      case 'ArrowUp': return pan(0, step)
      case 'ArrowDown': return pan(0, -step)
      case '+': case '=': e.preventDefault(); return zoomCentre(STEP)
      case '-': case '_': e.preventDefault(); return zoomCentre(1 / STEP)
      case '0': e.preventDefault(); return fit(layoutRef.current, true)
      default:
    }
  }

  return (
    <div ref={viewRef} className={`uoc-view${embedded ? ' uoc-view--embedded' : ''}`} tabIndex={0} role="region"
      aria-label="Org chart board. Drag, scroll or use the arrow keys to move; plus and minus to zoom; 0 to fit."
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}
      onClickCapture={onClickCapture} onScroll={onScroll} onKeyDown={onKeyDown} data-zoom={pct}>
      <div ref={stageRef} className="uoc-stage" style={{ width: layout.width, height: layout.height }}>
        <Lines layout={layout} pathEdges={pathEdges} />
        <Cards tree={tree} layout={layout} expanded={expanded} found={found} companyName={companyName} onOpen={onOpen} onToggle={onToggle} />
      </div>
      <div className="uoc-zoom" data-no-pan="" role="group" aria-label="Zoom">
        <button type="button" onClick={() => zoomCentre(STEP)} disabled={pct >= MAX_K * 100} aria-label="Zoom in" title="Zoom in"><Plus size={17} strokeWidth={2} /></button>
        <button type="button" onClick={() => zoomCentre(1 / STEP)} disabled={pct <= MIN_K * 100} aria-label="Zoom out" title="Zoom out"><Minus size={17} strokeWidth={2} /></button>
        <button type="button" onClick={() => { cb.current.onInteract?.(); fit(layoutRef.current, true) }} aria-label="Fit to screen" title="Fit to screen"><Maximize size={15} strokeWidth={2} /></button>
        <button type="button" className="uoc-zoom__pct" onClick={() => zoomCentre(1 / t.current.k)} aria-label={`Zoom ${pct}%. Reset to 100%`} title="Reset to 100%">{pct}%</button>
      </div>
      <div className="uoc-hint" aria-hidden="true">Drag to move · Ctrl + scroll to zoom</div>
    </div>
  )
}

/** The connectors: grey, and brand on the line from the top to you and to the person found. */
const Lines = memo(function Lines({ layout, pathEdges }: { layout: OrgLayout; pathEdges: ReadonlySet<string> }) {
  const plain = layout.connectors.filter((c) => !pathEdges.has(`${c.from}>${c.to}`))
  const lit = layout.connectors.filter((c) => pathEdges.has(`${c.from}>${c.to}`))
  return (
    <svg className="uoc-lines" width={layout.width} height={layout.height} aria-hidden="true">
      {plain.map((c) => <path key={`${c.from}>${c.to}`} d={c.d} />)}
      {lit.map((c) => <path key={`${c.from}>${c.to}`} d={c.d} className="is-path" />)}
    </svg>
  )
})

interface CardsProps extends CardHandlers {
  tree: OrgTree
  layout: OrgLayout
  expanded: ReadonlySet<string>
  found: string | null
  companyName: string
}

const Cards = memo(function Cards({ tree, layout, expanded, found, companyName, onOpen, onToggle }: CardsProps) {
  return (
    <>
      {tree.order.map((id) => {
        const b = layout.boxes.get(id)
        const n = tree.nodes.get(id)
        if (!b || !n) return null
        const style = { left: b.x, top: b.y, width: CW, height: CH }
        if (id === COMPANY_ROOT) {
          return <CompanyCard key={id} id={id} name={companyName} people={tree.size} tops={n.children.length} open={expanded.has(id)} style={style} onToggle={onToggle} />
        }
        return (
          <PersonCard key={id} person={n.person!} reports={n.children.length} open={expanded.has(id)} you={id === tree.you}
            found={id === found} style={style} onOpen={onOpen} onToggle={onToggle} />
        )
      })}
    </>
  )
})
