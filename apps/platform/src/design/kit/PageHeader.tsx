// The page frame and the title row every page starts with (prototype
// PgGeneric / TeamToday / PgCompanies headers, and the dashboard / Home
// greeting). Order: context line → title → one-line summary, actions on the
// right. No card behind it.
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { motionAllowed } from '@/design/theme/motion'
import { cx } from './displayUtil'
import './display.css'

export interface PageHeaderProps {
  /** Small context line above the title ("Company", "Attendance & time"). */
  eyebrow?: ReactNode
  /** The page title. For greetings pass the whole line built with greetingName(), e.g. "Good afternoon, Priya". */
  title: ReactNode
  /** One-line summary under the title (real figures from the page's data). */
  sub?: ReactNode
  /** Buttons on the right (primary last). */
  actions?: ReactNode
  /** page = 28/34 title; greeting = the dashboard / Home greeting at 30/38. */
  size?: 'page' | 'greeting'
  /** Greeting only: the waving hand after the title (waves once on load and on hover). */
  wave?: boolean
  /** Vertical alignment of title and actions: center (dashboard greeting, default for greetings) or end (pages, Home). */
  align?: 'center' | 'end'
  /** Title id, for aria-labelledby on the page. */
  id?: string
  className?: string
}

const WAVE: Keyframe[] = [
  { transform: 'rotate(0deg)' }, { transform: 'rotate(16deg)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(16deg)' },
  { transform: 'rotate(-4deg)' }, { transform: 'rotate(10deg)' }, { transform: 'rotate(0deg)' },
]

export function PageHeader({ eyebrow, title, sub, actions, size = 'page', wave, align, id, className }: PageHeaderProps) {
  const hand = useRef<HTMLSpanElement>(null)
  const waving = useRef(false)
  const greet = size === 'greeting'

  const doWave = useCallback(() => {
    const el = hand.current
    if (!el || waving.current || !motionAllowed() || typeof el.animate !== 'function') return
    waving.current = true
    el.animate(WAVE, { duration: 1300, easing: 'ease-in-out' }).onfinish = () => { waving.current = false }
  }, [])

  useEffect(() => {
    if (!greet || !wave) return
    const t = window.setTimeout(doWave, 700)
    return () => window.clearTimeout(t)
  }, [greet, wave, doWave])

  return (
    <header className={cx('uk-ph', greet && 'uk-ph--greet', greet && align === 'end' && 'uk-ph--end', !greet && align === 'center' && 'uk-ph--center', className)}>
      <div className="uk-ph__main" onMouseEnter={greet && wave ? doWave : undefined}>
        {eyebrow != null && eyebrow !== '' && <div className="uk-ph__eyebrow">{eyebrow}</div>}
        <h1 id={id} className="uk-ph__title">
          {title}
          {greet && wave && <span ref={hand} className="uk-ph__wave" aria-hidden="true">👋</span>}
        </h1>
        {sub != null && sub !== '' && <p className="uk-ph__sub">{sub}</p>}
      </div>
      {actions != null && <div className="uk-ph__actions">{actions}</div>}
    </header>
  )
}

export interface PageFrameProps {
  children: ReactNode
  /** wide = 1440 (admin, companies, profiles); narrow = 1320 (self-service, team). */
  width?: 'wide' | 'narrow'
  /** Gap between blocks in px (20 on most pages; the dashboard uses 40 between groups). */
  gap?: number
  /** Top padding in px (28; the dashboard and Home use 22). */
  top?: number
  /** Accessible name of the page region. */
  label?: string
  className?: string
  style?: CSSProperties
}

/** The page container: max width, the design's padding (28px clamp(16px,2.4vw,36px) 56px) and vertical rhythm. */
export function PageFrame({ children, width = 'wide', gap = 20, top, label, className, style }: PageFrameProps) {
  return (
    <div className={cx('uk-page', width === 'narrow' && 'uk-page--narrow', className)} aria-label={label} role={label ? 'region' : undefined}
      style={{ ...style, ['--uk-gap' as string]: `${gap}px`, ...(top != null ? { paddingTop: top } : null) } as CSSProperties}>
      {children}
    </div>
  )
}
