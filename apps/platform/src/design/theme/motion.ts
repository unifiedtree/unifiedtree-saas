// Motion for the HRMS redesign — the React side of the design's hrms-fx.js.
//
// motion.css holds the animations themselves (rise, pop-in, bar grow, stroke
// draw, ring draw, float, the tile spotlight / tilt / border light). This file
// holds the timings, the hooks that read the motion level
// (<html data-ufx="full|subtle|off">) and the reader's reduced-motion setting,
// count-up for figures, and the pointer handlers that feed the tilt and
// spotlight variables (--mx, --my, --rx, --ry) on hover.
//
// Rules, same as the design: "full" plays everything; "subtle" drops the tilt
// and the light running round the border; "off" and prefers-reduced-motion
// play nothing (no entrance, no count-up, no draw, no hover lift).
import './motion.css'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'

/** The design's easing for every entrance and hover move. */
export const UFX_EASE = 'cubic-bezier(.2,.8,.2,1)'

/** Timings from hrms-fx.js, in milliseconds. */
export const UFX_MS = {
  rise: 520, riseStep: 40, riseMaxIndex: 14,
  pop: 260,
  count: 950,
  grow: 750, growDelay: 120, growStep: 35, growMaxIndex: 16,
  draw: 1100, drawDelay: 150, drawStep: 60, drawHoverDelay: 60,
  ring: 1000, ringDelay: 150, ringStep: 90,
} as const

export type MotionLevel = 'full' | 'subtle' | 'off'

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'

function mediaQuery(): MediaQueryList | null {
  try {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
    return window.matchMedia(REDUCE_QUERY)
  } catch {
    return null
  }
}

/** The reader's prefers-reduced-motion setting right now (false when unknown). */
export function prefersReducedMotion(): boolean {
  return !!mediaQuery()?.matches
}

function subscribeReduced(onChange: () => void): () => void {
  const mq = mediaQuery()
  if (!mq) return () => {}
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
  // Safari < 14
  mq.addListener?.(onChange)
  return () => mq.removeListener?.(onChange)
}

/** Live prefers-reduced-motion value; re-renders when the setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, prefersReducedMotion)
}

/** The motion level from <html data-ufx>; anything unknown or missing is "full". */
export function getMotionLevel(): MotionLevel {
  if (typeof document === 'undefined' || !document.documentElement) return 'full'
  const v = document.documentElement.getAttribute('data-ufx')
  return v === 'subtle' || v === 'off' ? v : 'full'
}

function subscribeLevel(onChange: () => void): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {}
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ufx'] })
  return () => mo.disconnect()
}

/** Live motion level; re-renders when <html data-ufx> changes. */
export function useMotionLevel(): MotionLevel {
  return useSyncExternalStore(subscribeLevel, getMotionLevel, getMotionLevel)
}

/** True when entrance, draw and count-up animations may play right now. */
export function motionAllowed(): boolean {
  return !prefersReducedMotion() && getMotionLevel() !== 'off'
}

/** Live version of {@link motionAllowed}. */
export function useMotionAllowed(): boolean {
  const reduced = useReducedMotion()
  const level = useMotionLevel()
  return !reduced && level !== 'off'
}

/** Sets the level (what the design's Tweaks → Card motion does). */
export function setMotionLevel(level: MotionLevel): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-ufx', level)
}

/**
 * The stagger index for an animated element: rise, grow, draw and ring delays
 * all read `--i`. Without it, siblings stagger by their position (nth-child).
 */
export function fxIndex(i: number | undefined, style?: CSSProperties): CSSProperties | undefined {
  if (i == null || !Number.isFinite(i)) return style
  return { ...style, ['--i' as string]: Math.max(0, Math.floor(i)) } as CSSProperties
}

// ── Count-up ────────────────────────────────────────────────────────────────

export const easeOutCubic = (k: number): number => 1 - Math.pow(1 - k, 3)

/** The figure shown `elapsed` ms into a count from `from` to `to` (ease-out cubic, like hrms-fx.js). */
export function countUpAt(from: number, to: number, elapsed: number, duration: number = UFX_MS.count): number {
  if (!(duration > 0)) return to
  const k = Math.min(1, Math.max(0, elapsed / duration))
  return k >= 1 ? to : from + (to - from) * easeOutCubic(k)
}

/** A figure worth animating: a finite, non-zero number (hrms-fx.js leaves 0 alone). */
function animatable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v !== 0
}

export interface CountUpOptions {
  /** Default 950 ms. */
  duration?: number
}

/**
 * Counts a figure up from 0 when it first appears (950 ms, ease-out), and from
 * the previous figure when it changes (a refetch, another date). Returns the
 * number to draw this frame. With reduced motion or data-ufx="off" it returns
 * the value unchanged, straight away.
 */
export function useCountUp<T extends number | null | undefined>(value: T, options?: CountUpOptions): T | number {
  const duration = options?.duration ?? UFX_MS.count
  const allowed = useMotionAllowed()
  const [shown, setShown] = useState<T | number>(() => (animatable(value) && motionAllowed() ? 0 : value))
  const shownRef = useRef<T | number>(shown)

  useEffect(() => {
    if (!animatable(value) || !allowed) {
      shownRef.current = value
      setShown(value)
      return
    }
    const cur = shownRef.current
    const from = typeof cur === 'number' && Number.isFinite(cur) ? cur : 0
    if (from === value) {
      setShown(value)
      return
    }
    let raf = 0
    let t0 = -1
    const step = (t: number) => {
      if (t0 < 0) t0 = t
      const v = countUpAt(from, value, t - t0, duration)
      shownRef.current = v
      setShown(v)
      if (v !== value) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, allowed, duration])

  return shown
}

/** A figure inside a formatted string: "₹53,77,700", "6.5", "92%", "3 of 6". */
export interface CountText {
  pre: string
  num: number
  post: string
  decimals: number
  /** The integer part had thousands separators. */
  grouped: boolean
  /** …in the Indian style (12,34,567). */
  indian: boolean
  /** Width of the integer part when it had leading zeros ("09"), else 0. */
  pad: number
}

/** Finds the first figure in a string, the way hrms-fx.js does. Null when there is none. */
export function parseCountText(src: string): CountText | null {
  const m = /(\d[\d,]*)(\.\d+)?/.exec(src)
  if (!m) return null
  const ip = m[1]
  const num = parseFloat((ip + (m[2] || '')).replace(/,/g, ''))
  if (!Number.isFinite(num)) return null
  return {
    pre: src.slice(0, m.index),
    num,
    post: src.slice(m.index + m[0].length),
    decimals: m[2] ? m[2].length - 1 : 0,
    grouped: ip.includes(','),
    indian: /\d,\d\d,\d{3}/.test(ip),
    pad: ip.length > 1 && ip[0] === '0' && !ip.includes(',') ? ip.length : 0,
  }
}

/** Writes `v` back into the string's format (same decimals, grouping and leading zeros). */
export function formatCountText(p: CountText, v: number): string {
  const s = Math.abs(v) < 1e-9 ? (0).toFixed(p.decimals) : v.toFixed(p.decimals)
  const [int, dec] = s.split('.')
  let body = int
  if (p.grouped) body = Number(int).toLocaleString(p.indian ? 'en-IN' : 'en-US')
  else if (p.pad) body = int.padStart(p.pad, '0')
  return p.pre + (dec ? body + '.' + dec : body) + p.post
}

/**
 * Count-up for a formatted figure: animates the first number in the string and
 * keeps everything around it ("₹", "%", " of 6"). Returns the text to draw.
 */
export function useCountUpText(text: string | number | null | undefined, options?: CountUpOptions): string {
  const src = text == null ? '' : String(text)
  const parts = useMemo(() => parseCountText(src), [src])
  const v = useCountUp(parts ? parts.num : null, options)
  if (!parts || typeof v !== 'number' || v === parts.num) return src
  return formatCountText(parts, v)
}

// ── Hover: spotlight, tilt, border light ────────────────────────────────────

export type HoverFxKind = 'tilt' | 'spot'

/** Replays the stroke draw of an element's [data-ufx-draw] paths (sparklines redraw on hover). */
function redraw(root: HTMLElement): void {
  if (!motionAllowed()) return
  root.querySelectorAll<SVGElement>('[data-ufx-draw]').forEach((p) => {
    if (typeof p.animate !== 'function') return
    p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: UFX_MS.draw, delay: UFX_MS.drawHoverDelay, easing: UFX_EASE, fill: 'backwards',
    })
  })
}

/** Sets the spotlight position and, for "tilt" at the full level, the tilt on a hovered element. */
function track(el: HTMLElement, kind: HoverFxKind, clientX: number, clientY: number): void {
  const lvl = getMotionLevel()
  if (lvl === 'off' || prefersReducedMotion()) return
  const r = el.getBoundingClientRect()
  if (!r.width || !r.height) return
  const x = clientX - r.left
  const y = clientY - r.top
  el.style.setProperty('--mx', Math.round(x) + 'px')
  el.style.setProperty('--my', Math.round(y) + 'px')
  if (kind === 'tilt' && lvl === 'full') {
    const m = Math.min(4.5, 640 / Math.max(r.width, 120))
    el.style.setProperty('--rx', ((y / r.height - 0.5) * -m).toFixed(2) + 'deg')
    el.style.setProperty('--ry', ((x / r.width - 0.5) * m).toFixed(2) + 'deg')
  }
}

function untilt(el: HTMLElement): void {
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

let uninstall: (() => void) | null = null

/**
 * The document-wide hover engine from hrms-fx.js, for markup converted from
 * the prototype that carries data-fx="tilt|spot" (kit components don't need
 * it — they use useHoverFx). Call once at start-up; calling again is a no-op.
 * Returns a function that removes it. Also replays [data-draw] strokes on enter
 * and turns the border light (--ang) while a tilt tile is hovered.
 */
export function installMotion(): () => void {
  if (uninstall) return uninstall
  if (typeof document === 'undefined') return () => {}
  let cur: HTMLElement | null = null
  let raf = 0
  let last = 0
  let ang = 0
  const spin = (t: number) => {
    if (!cur) { raf = 0; return }
    const dt = last ? Math.min(40, t - last) : 16
    last = t
    ang = (ang + dt * 0.16) % 360
    cur.style.setProperty('--ang', ang.toFixed(1) + 'deg')
    raf = requestAnimationFrame(spin)
  }
  const enter = (el: HTMLElement) => {
    cur = el
    if (!motionAllowed()) return
    el.querySelectorAll<SVGElement>('[data-draw]').forEach((p) => {
      if (typeof p.animate === 'function') p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: UFX_MS.draw, delay: UFX_MS.drawHoverDelay, easing: UFX_EASE, fill: 'backwards' })
    })
    if (getMotionLevel() === 'full' && el.getAttribute('data-fx') === 'tilt' && !raf) { last = 0; raf = requestAnimationFrame(spin) }
  }
  const leave = (el: HTMLElement) => {
    untilt(el)
    if (cur === el) cur = null
  }
  const over = (e: PointerEvent) => {
    const t = e.target as Element | null
    const el = t && typeof t.closest === 'function' ? (t.closest('[data-fx]') as HTMLElement | null) : null
    if (el === cur) return
    if (cur) leave(cur)
    if (el) enter(el)
  }
  const out = (e: PointerEvent) => { if (!e.relatedTarget && cur) leave(cur) }
  const move = (e: PointerEvent) => {
    if (!cur || e.pointerType === 'touch') return
    track(cur, cur.getAttribute('data-fx') === 'tilt' ? 'tilt' : 'spot', e.clientX, e.clientY)
  }
  document.addEventListener('pointerover', over, { passive: true })
  document.addEventListener('pointerout', out, { passive: true })
  document.addEventListener('pointermove', move, { passive: true })
  uninstall = () => {
    document.removeEventListener('pointerover', over)
    document.removeEventListener('pointerout', out)
    document.removeEventListener('pointermove', move)
    cancelAnimationFrame(raf)
    uninstall = null
  }
  return uninstall
}

export interface HoverFxHandlers<E extends HTMLElement> {
  onPointerEnter: (e: ReactPointerEvent<E>) => void
  onPointerMove: (e: ReactPointerEvent<E>) => void
  onPointerLeave: (e: ReactPointerEvent<E>) => void
}

/**
 * Pointer handlers for a hover-fx element (class `ufx-tilt` or `ufx-spot`).
 * CSS lifts the element and fades in the spotlight on :hover (--fx); these
 * handlers move the spotlight with the pointer (--mx/--my) and, for "tilt" at
 * the full level, tip the card toward it (--rx/--ry, up to 4.5°). Sparklines
 * inside redraw on enter. Nothing happens at "off" or with reduced motion.
 */
export function useHoverFx<E extends HTMLElement = HTMLElement>(kind: HoverFxKind = 'tilt'): HoverFxHandlers<E> {
  return useMemo(() => ({
    onPointerEnter(e: ReactPointerEvent<E>) {
      if (e.pointerType === 'touch') return
      redraw(e.currentTarget)
    },
    onPointerMove(e: ReactPointerEvent<E>) {
      if (e.pointerType === 'touch') return
      track(e.currentTarget, kind, e.clientX, e.clientY)
    },
    onPointerLeave(e: ReactPointerEvent<E>) {
      untilt(e.currentTarget)
    },
  }), [kind])
}
