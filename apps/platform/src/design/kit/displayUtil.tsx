// Small helpers shared by the display half of the kit (not exported to pages
// except through display.ts where noted).
import type { MouseEvent, ReactNode } from 'react'
import { dashIcon } from '@/design/dc/icons'
// Every kit piece uses the motion classes (ufx-*), so load them with the kit.
import '@/design/theme/motion.css'

/** Joins class names, skipping empty ones. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** An icon for a kit piece: a name from the repo's icon set (design/dc/icons) or any element (lucide-react). */
export type KitIcon = string | ReactNode

/** Draws a KitIcon: names go through dashIcon at the given size; elements pass through. */
export function renderIcon(icon: KitIcon | undefined | null, size: number): ReactNode {
  if (icon == null || icon === false || icon === '') return null
  if (typeof icon === 'string') return dashIcon(icon, size)
  return icon
}

/**
 * Up to two initials for a monogram: first letters of the first and last words.
 * Works for any script (combining marks stay with their letter); never throws on null/empty names ("?").
 */
export function initialsOf(name: string | null | undefined): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (!words.length) return '?'
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] ?? '' : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * Props for a real link that stays in the app on a plain click: open-in-new-tab,
 * middle click and modifier clicks keep the browser's behaviour; a plain left
 * click calls onClick (e.g. react-router navigate) instead of reloading.
 */
export function linkClick(onClick?: (e: MouseEvent<HTMLAnchorElement>) => void) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onClick) return
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    onClick(e)
  }
}

/** Clamps a percentage to 0–100 (NaN → 0). */
export function clampPct(v: number | null | undefined): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** Share of `value` in `max` as a 0–100 percentage (0 when max is 0 or missing). */
export function pctOf(value: number | null | undefined, max: number | null | undefined): number {
  const v = Number(value)
  const m = Number(max)
  if (!Number.isFinite(v) || !Number.isFinite(m) || m <= 0) return 0
  return clampPct((v / m) * 100)
}

/** Indian-grouped figure for plain numbers ("1,23,456"); up to 2 decimals. */
export function formatFigure(v: number): string {
  return v.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}
