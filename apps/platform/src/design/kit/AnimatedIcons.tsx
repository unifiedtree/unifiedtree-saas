// The design's moving line icons (prototype UtQIcon + UtAniIcon).
//
// QuickIcon: the 44-unit scenes on quick-action tiles — a coin drops in, a page
// tears off, a clock sweeps. AniIcon: the 24-unit icons on stat cards — the
// people icon gains a "+", the check draws itself, the plane takes off.
// Both play from the --fx variable their tile sets on hover (motion.css), so
// they are still when motion is off or reduced. Decorative: aria-hidden.
import type { CSSProperties, ReactElement } from 'react'
import { cx } from './displayUtil'

const SPRING = 'cubic-bezier(.34,1.56,.64,1)'
const SWING = 'cubic-bezier(.65,0,.35,1)'
const EASE = 'cubic-bezier(.2,.8,.2,1)'
const FX = 'var(--fx,0)'

// Colours: the design's own tokens with their light fallbacks.
const BRT = 'var(--u-brt,#0F6E56)'
const BR = 'var(--u-br,#0F6E56)'
const SF = 'var(--u-sf,#fff)'
const GD = 'var(--u-gd,#C8912E)'
const GDS = 'var(--u-gds,#FAF1E1)'
const BRS2 = 'var(--u-brs2,#D2EADF)'
/** White on the brand-green fill: the same in both themes. */
const ON_BR = 'var(--u-onbr,#fff)'

const st = (s: CSSProperties) => s

export type QuickIconKind = 'user' | 'coins' | 'calendar' | 'clock' | 'megaphone' | 'chart' | 'home' | 'download' | 'swap' | 'mail'
export const QUICK_ICON_KINDS: readonly QuickIconKind[] = ['user', 'coins', 'calendar', 'clock', 'megaphone', 'chart', 'home', 'download', 'swap', 'mail']

function quickScene(kind: QuickIconKind): ReactElement {
  switch (kind) {
    case 'coins':
      return (<>
        <rect x="6" y="30" width="22" height="7" rx="3.5" style={{ fill: SF }} />
        <rect x="8" y="23" width="22" height="7" rx="3.5" style={{ fill: SF }} />
        <g style={st({ transform: `translateY(calc((1 - ${FX}) * -9px))`, opacity: `calc(.3 + ${FX} * .7)`, transition: `transform .6s ${SPRING},opacity .3s` })}>
          <rect x="7" y="16" width="22" height="7" rx="3.5" style={{ fill: GDS, stroke: GD }} />
        </g>
        <g style={st({ transformOrigin: '35px 12px', transform: `rotate(calc(${FX} * 360deg))`, transition: `transform .9s ${SWING}` })}>
          <circle cx="35" cy="12" r="7" style={{ fill: GDS, stroke: GD }} />
          <path d="M32.5 9.5h5M32.5 11.5h5M33 9.5c3 0 3 4 0 4l2.8 2.8" strokeWidth={1.4} style={{ stroke: GD }} />
        </g>
      </>)
    case 'calendar':
      return (<>
        <rect x="7" y="9" width="30" height="28" rx="5" style={{ fill: SF }} />
        <path d="M7 17h30M15 6v6M29 6v6" />
        <path d="M15 28l4.5 4.5 9-9.5" strokeWidth={2.2} pathLength={1} strokeDasharray="1" style={st({ stroke: BR, strokeDashoffset: `calc(1 - ${FX})`, transition: `stroke-dashoffset .5s .28s ${EASE}` })} />
        <g style={st({ transformOrigin: '22px 18px', transform: `scaleY(calc(1 - ${FX}))`, transition: `transform .45s ${SWING}` })}>
          <rect x="9" y="18.5" width="26" height="16.5" rx="3" stroke="none" style={{ fill: BRS2 }} />
          <path d="M14 23.5h2M21 23.5h2M28 23.5h2M14 29.5h2M21 29.5h2" strokeWidth={2.2} />
        </g>
      </>)
    case 'clock':
      return (<>
        <circle cx="22" cy="24" r="14" style={{ fill: SF }} />
        <path d="M18 5h8M22 5v5M34.5 11.5 37 9" />
        <path d="M22 13.5v1.5M22 33v1.5M11.5 24H13M31 24h1.5" strokeWidth={1.6} />
        <g style={st({ transformOrigin: '22px 24px', transform: `rotate(calc(${FX} * 360deg))`, transition: `transform 1.2s ${SWING}` })}>
          <path d="M22 24v-7.5" strokeWidth={2.2} style={{ stroke: BR }} />
        </g>
        <g style={st({ transformOrigin: '22px 24px', transform: `rotate(calc(${FX} * 60deg))`, transition: `transform 1.2s ${SWING}` })}>
          <path d="M22 24l4.5 3" strokeWidth={2.2} style={{ stroke: GD }} />
        </g>
        <circle cx="22" cy="24" r="1.8" stroke="none" style={{ fill: BR }} />
      </>)
    case 'megaphone':
      return (<>
        <path d="M8 19v7a2.5 2.5 0 0 0 2.5 2.5H13l9 6.5V10l-9 6.5h-2.5A2.5 2.5 0 0 0 8 19z" style={{ fill: SF }} />
        <path d="M14 28.5l2 6.5" />
        <path d="M27 18.5a6 6 0 0 1 0 8" style={st({ opacity: `calc(.4 + ${FX} * .6)`, transform: `translateX(calc(${FX} * 1.5px))`, transition: 'all .35s' })} />
        <path d="M30.5 15a11 11 0 0 1 0 15" style={st({ opacity: FX, transform: `translateX(calc(${FX} * 2px))`, transition: 'all .35s .08s' })} />
        <path d="M34 11.5a16 16 0 0 1 0 22" style={st({ stroke: GD, opacity: FX, transform: `translateX(calc(${FX} * 2.5px))`, transition: 'all .35s .16s' })} />
      </>)
    case 'chart': {
      const bar = (x: number, y: number, h: number, delay: string, fill: string) => (
        <rect x={x} y={y} width="4.5" height={h} rx="1.2" stroke="none" style={st({ fill, transformBox: 'fill-box', transformOrigin: 'bottom', transform: `scaleY(calc(.55 + ${FX} * .45))`, transition: `transform .5s ${delay} ${SPRING}` })} />
      )
      return (<>
        <rect x="6" y="7" width="32" height="30" rx="5" style={{ fill: SF }} />
        {bar(11, 23, 9, '0s', BRS2)}
        {bar(17.8, 18, 14, '.06s', BRS2)}
        {bar(24.6, 21, 11, '.12s', BRS2)}
        {bar(31.2, 14, 18, '.18s', BR)}
        <path d="M11 17l7-4 7 3 9-6" pathLength={1} strokeDasharray="1" style={st({ stroke: GD, strokeDashoffset: `calc(1 - ${FX})`, transition: 'stroke-dashoffset .6s .2s' })} />
      </>)
    }
    case 'home':
      return (<>
        <path d="M7 20.5 22 8l15 12.5V35a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2z" style={{ fill: SF }} />
        <rect x="12" y="22" width="8" height="7" rx="1.5" strokeWidth={1.6} style={st({ fill: GD, fillOpacity: `calc(${FX} * .55)`, transition: 'fill-opacity .35s' })} />
        <path d="M26 37v-9h6v9" />
        <path d="M30 12.5V7h4v8.8" />
        <path d="M32 4.5c-1.2-1.2 1.2-1.8 0-3" strokeWidth={1.4} style={st({ opacity: FX, transform: `translateY(calc((1 - ${FX}) * 3px))`, transition: 'all .5s .15s' })} />
      </>)
    case 'download':
      return (<>
        <path d="M11 6h14l8 8v22a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" style={{ fill: SF }} />
        <path d="M25 6v8h8M14 17h6" />
        <g style={st({ transform: `translateY(calc(${FX} * 3px))`, transition: `transform .45s ${SPRING}` })}>
          <path d="M21 21v9M17 26.5l4 4 4-4" strokeWidth={2.2} style={{ stroke: BR }} />
        </g>
        <path d="M15.5 34h11" style={st({ stroke: GD, opacity: `calc(.35 + ${FX} * .65)`, transition: 'opacity .3s .15s' })} />
      </>)
    case 'swap':
      return (<>
        <circle cx="22" cy="22" r="15" style={{ fill: SF }} />
        <g style={st({ transformOrigin: '22px 22px', transform: `rotate(calc(${FX} * 180deg))`, transition: `transform .7s ${SWING}` })}>
          <path d="M14 18.5h15l-4-4" strokeWidth={2} />
          <path d="M30 25.5H15l4 4" strokeWidth={2} style={{ stroke: GD }} />
        </g>
      </>)
    case 'mail':
      return (<>
        <rect x="6" y="17" width="32" height="20" rx="2.5" style={{ fill: SF }} />
        <g style={st({ transform: `translateY(calc(${FX} * -7px))`, transition: `transform .55s .08s ${SPRING}` })}>
          <rect x="11" y="9" width="22" height="20" rx="2" style={{ fill: SF }} />
          <path d="M15 14h14M15 18h9" strokeWidth={1.6} />
        </g>
        <path d="M6 19.5 22 30l16-10.5V34.5a2.5 2.5 0 0 1-2.5 2.5h-27A2.5 2.5 0 0 1 6 34.5z" style={{ fill: BRS2 }} />
      </>)
    case 'user':
    default:
      return (<>
        <circle cx="19" cy="16" r="6.5" style={{ fill: SF }} />
        <path d="M7 36c1.2-6.5 6-10 12-10s10.8 3.5 12 10z" style={{ fill: SF }} />
        <g style={st({ transformOrigin: '33px 13px', transform: `scale(calc(.85 + ${FX} * .2)) rotate(calc(${FX} * 90deg))`, transition: `transform .55s ${SPRING}` })}>
          <circle cx="33" cy="13" r="7" stroke="none" style={{ fill: BR }} />
          <path d="M33 10v6M30 13h6" strokeWidth={2} style={{ stroke: ON_BR }} />
        </g>
      </>)
  }
}

export interface QuickIconProps {
  kind: QuickIconKind
  /** Rendered size in px (the tile uses 44). */
  size?: number
  className?: string
}

/** A quick-action scene icon (UtQIcon). Plays when its tile is hovered. */
export function QuickIcon({ kind, size = 44, className }: QuickIconProps) {
  return (
    <svg className={cx('uk-qicon', className)} width={size} height={size} viewBox="0 0 44 44" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      style={{ color: BRT, overflow: 'visible' }}>
      {quickScene(kind)}
    </svg>
  )
}

export type AniIconKind = 'users' | 'present' | 'leave' | 'late' | 'half' | 'wfh' | 'none' | 'absent'
export const ANI_ICON_KINDS: readonly AniIconKind[] = ['users', 'present', 'leave', 'late', 'half', 'wfh', 'none', 'absent']

const PERSON_HEAD = <circle cx="9" cy="8" r="3.6" />
const PERSON_BODY = <path d="M2.5 20v-1.2A4.8 4.8 0 0 1 7.3 14h3.4a4.8 4.8 0 0 1 4.8 4.8V20" />

function aniScene(kind: AniIconKind): ReactElement {
  switch (kind) {
    case 'present':
      return (<>
        {PERSON_HEAD}{PERSON_BODY}
        <path className="ufx-draw" data-ufx-draw="" d="M15.4 11.4l2.3 2.3 4.5-4.8" pathLength={1} strokeDasharray="1" strokeWidth={2.3}
          style={st({ transformBox: 'fill-box', transformOrigin: 'center', transform: `scale(calc(1 + ${FX} * .2))`, transition: `transform .55s ${SPRING}` })} />
      </>)
    case 'leave':
      return (<>
        <g style={st({ transformBox: 'fill-box', transformOrigin: 'center', transform: `translate(calc(${FX} * 2.6px),calc(${FX} * -2.6px)) rotate(calc(${FX} * -6deg))`, transition: `transform .65s ${SPRING}` })}>
          <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" />
        </g>
        <path d="M1.5 22.5h4.5M1 19.5h2.5" strokeDasharray="2 2" style={st({ opacity: FX, transform: `translateX(calc((1 - ${FX}) * 3px))`, transition: `opacity .3s,transform .55s ${EASE}` })} />
      </>)
    case 'late':
      return (<>
        <g style={st({ transformOrigin: '12px 13px', transform: `rotate(calc(${FX} * -12deg))`, transition: `transform .5s ${SPRING}` })}>
          <circle cx="12" cy="13" r="8" />
          <path d="M5 3 2 6M22 6l-3-3M6.4 19.6 4.6 21.4M17.6 19.6l1.8 1.8" />
          <g style={st({ transformOrigin: '12px 13px', transform: `rotate(calc(${FX} * 300deg))`, transition: `transform 1.1s ${SWING}` })}>
            <path d="M12 13V8.4" strokeWidth={2.1} />
          </g>
          <path d="M12 13l2.7 1.6" strokeWidth={2.1} />
        </g>
        <path d="M.8 9.6l1.6.6M23.2 9.6l-1.6.6M12 1.2v1.4" style={st({ opacity: FX, transition: 'opacity .3s .1s' })} />
      </>)
    case 'half':
      return (
        <g style={st({ transformOrigin: '12px 12px', transform: `rotate(calc(${FX} * 180deg))`, transition: `transform .85s ${SWING}` })}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" style={st({ fillOpacity: `calc(.22 + ${FX} * .5)`, transition: 'fill-opacity .5s' })} />
          <path d="M12 3v18" />
        </g>
      )
    case 'wfh':
      return (<>
        <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
        <rect x="9.6" y="15.4" width="4.8" height="5.2" rx=".6" stroke="none" style={st({ fill: 'var(--u-fx-lamp,#E8B04B)', opacity: `calc(${FX} * .95)`, transition: 'opacity .4s' })} />
        <path d="M16.5 6.2V3.4h2.6v5" />
        <path d="M17.8 1.6c-.9-.9.9-1.3 0-2.2" strokeWidth={1.4} style={st({ opacity: FX, transform: `translateY(calc((1 - ${FX}) * 2px))`, transition: 'opacity .45s .12s,transform .6s .12s' })} />
      </>)
    case 'none':
      return (<>
        <circle cx="12" cy="12" r="9.5" strokeDasharray="3.2 2.4" style={st({ transformOrigin: '12px 12px', transform: `rotate(calc(${FX} * 120deg))`, transition: `transform 1s ${EASE}` })} />
        <g style={st({ transform: `translateY(calc(${FX} * -1.8px))`, transition: `transform .5s ${SPRING}` })}>
          <path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.6-2.8 2.6" />
          <path d="M12 16.6h.01" strokeWidth={2.6} />
        </g>
      </>)
    case 'absent':
      return (<>
        <g style={st({ opacity: `calc(1 - ${FX} * .35)`, transition: 'opacity .4s' })}>{PERSON_HEAD}{PERSON_BODY}</g>
        <path className="ufx-draw" data-ufx-draw="" d="M16.8 8.4l4.6 4.6" pathLength={1} strokeDasharray="1" strokeWidth={2.2} />
        <path className="ufx-draw" data-ufx-draw="" d="M21.4 8.4 16.8 13" pathLength={1} strokeDasharray="1" strokeWidth={2.2} />
      </>)
    case 'users':
    default:
      return (<>
        <g style={st({ transform: `translateX(calc(${FX} * -1px))`, transition: `transform .55s ${SPRING}` })}>{PERSON_HEAD}{PERSON_BODY}</g>
        <g style={st({ opacity: `calc(1 - ${FX} * .2)`, transform: `translateX(calc(${FX} * 1.8px))`, transition: `transform .55s ${SPRING},opacity .35s` })}>
          <path d="M15.5 4.6a3.6 3.6 0 0 1 0 6.8" />
          <path d="M18.5 14.4a4.8 4.8 0 0 1 3 4.4V20" />
        </g>
        <g style={st({ transformBox: 'fill-box', transformOrigin: 'center', transform: `scale(${FX}) rotate(calc(${FX} * 90deg))`, opacity: FX, transition: `transform .6s ${SPRING},opacity .3s` })}>
          <circle cx="20.5" cy="4" r="3.6" fill="currentColor" stroke="none" />
          <path d="M20.5 2.4v3.2M18.9 4h3.2" strokeWidth={1.6} style={{ stroke: ON_BR }} />
        </g>
      </>)
  }
}

export interface AniIconProps {
  kind: AniIconKind
  /** Rendered size in px (24 on row stat cards, 21 on stacked ones). */
  size?: number
  className?: string
}

/** A stat-card icon that moves on hover (UtAniIcon). Colour = currentColor. */
export function AniIcon({ kind, size = 24, className }: AniIconProps) {
  const thin = kind === 'leave'
  return (
    <svg className={cx('uk-aniicon', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={thin ? 1.8 : 1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"
      style={{ overflow: 'visible' }}>
      {aniScene(kind)}
    </svg>
  )
}
