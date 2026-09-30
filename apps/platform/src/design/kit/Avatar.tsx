// Avatars and monograms: initials on a tinted or brand-green disc, a photo when
// there is one, and an optional presence dot (More panel, profile header).
// Square monograms are the company marks on Companies & branches.
import { useState, type CSSProperties } from 'react'
import { cx, initialsOf } from './displayUtil'
import './display.css'

export { initialsOf }

/**
 * soft    brand soft 2 fill, brand text — list rows (default)
 * pale    brand soft fill — Team today / Home team rows
 * solid   brand green fill, white text — the signed-in user, profiles, the first company
 * info    blue fill — a company monogram
 * purple  purple fill — a company monogram
 */
export type AvatarTone = 'soft' | 'pale' | 'solid' | 'info' | 'purple'

export interface AvatarProps {
  /** The person's or company's name — used for the initials and the alt text. Null-safe. */
  name?: string | null
  /** Your own initials/short name (e.g. a company's "DT"), instead of deriving them. */
  initials?: string
  /** Photo URL. Falls back to initials if it fails to load. */
  src?: string | null
  /** Diameter in px (default 34). */
  size?: number
  tone?: AvatarTone
  /** circle (people) or square with soft corners (company monograms). */
  shape?: 'circle' | 'square'
  /** Presence: online (green dot, More panel) or in (checked in, mint dot, profile). */
  status?: 'online' | 'in' | null
  /** Wording for the dot, e.g. "Checked in". */
  statusLabel?: string
  /** surface = white 3px ring (on tinted cards), brand = soft brand 4px ring (profile). */
  ring?: 'surface' | 'brand'
  /** The company monogram's drop shadow in its own colour. */
  raised?: boolean
  /** The company monogram's slow idle float (still when motion is reduced). */
  float?: boolean
  /** Text weight; defaults to 500 for soft, 600 otherwise. */
  weight?: 500 | 600
  /** Hide from assistive tech when the name is already written next to it (default true). */
  decorative?: boolean
  className?: string
  style?: CSSProperties
}

const FONT: Array<[number, number]> = [[32, 11.5], [34, 12], [36, 12], [38, 12.5], [40, 13], [42, 14], [44, 15], [48, 16], [54, 17], [56, 18], [64, 21], [76, 24]]

function fontFor(size: number): number {
  for (const [s, f] of FONT) if (size <= s) return f
  return Math.round(size * 0.32 * 2) / 2
}

function squareRadius(size: number): number {
  if (size >= 60) return 18
  if (size >= 44) return 12
  return 11
}

export function Avatar({
  name, initials, src, size = 34, tone = 'soft', shape = 'circle', status, statusLabel, ring, raised, float, weight, decorative = true, className, style,
}: AvatarProps) {
  const [broken, setBroken] = useState(false)
  const text = (initials && initials.trim()) || initialsOf(name)
  const showImg = !!src && !broken
  const dot = size <= 40 ? 10 : size <= 56 ? 13 : 14
  const label = name ? String(name) : undefined
  const a11y = decorative ? { 'aria-hidden': true as const } : { role: 'img' as const, 'aria-label': label ? label + (status && statusLabel ? ', ' + statusLabel : '') : statusLabel }
  return (
    <span
      className={cx('uk-av', `uk-av--${tone}`, shape === 'square' && 'uk-av--square', ring && `uk-av--ring-${ring}`, raised && 'uk-av--raised', float && 'ufx-float', className)}
      style={{
        width: size, height: size, fontSize: fontFor(size), fontWeight: weight ?? (tone === 'soft' ? 500 : 600),
        borderRadius: shape === 'square' ? squareRadius(size) : '50%', ...style,
      }}
      {...a11y}
    >
      {showImg ? <img className="uk-av__img" src={src!} alt="" onError={() => setBroken(true)} draggable={false} /> : text}
      {status && (
        <span className={cx('uk-av__dot', `uk-av__dot--${status}`)} title={statusLabel}
          style={{ width: dot, height: dot, ['--uk-dot-ring' as string]: size <= 56 ? '2.5px' : '3px', right: size > 60 ? 2 : 0, bottom: size > 60 ? 2 : 1 } as CSSProperties} />
      )}
    </span>
  )
}
