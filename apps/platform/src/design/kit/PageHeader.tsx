// The page frame and the title row every page starts with (prototype
// PgGeneric / TeamToday / PgCompanies headers, and the dashboard / Home
// greeting). Order: context line → title → one-line summary, actions on the
// right. No card behind it — until the page has sub-section tabs.
//
// Hero (the Master "Organization Setup" look, DECISIONS 4 Oct): a page whose
// sub-section tabs sit right under its header draws the header as a white
// rounded card with a soft green glow top-right, an uppercase green eyebrow,
// a big title, the summary, the primary action on the right and, below the
// summary inside the same card, the tabs as a segmented control (grey track,
// the chosen one a white pill). Measurements are the Master's (design/master/
// master.css .hero / .seg), colours the kit's tokens, so both look the same in
// light and dark. The header turns into the hero by itself:
//   • a PillTabs with placement="auto" (the default for "tabs" / "toggle"
//     semantics; ModuleKit Views too) rendered anywhere in the same PageFrame /
//     ModulePage claims the header's tab slot and moves into it — no per-page
//     wiring; the first bar in the page wins, later ones stay where they are;
//   • or the page passes its bar explicitly as `tabs` (useful when the bar sits
//     in a row with filters and must not be the first PillTabs in the page);
//   • `hero` forces the card on (a page with no tabs that wants the card) or off
//     (`hero={false}`: the tabs stay inline in the plain layout).
// Greeting headers (size="greeting") never become the hero.
import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { motionAllowed } from '@/design/theme/motion'
import { cx } from './displayUtil'
import { PageTabsHost, PageTabsInline, usePageTabsSlot } from './pageTabs'
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
  /**
   * The page's sub-section tabs, drawn inside the hero card under the summary (a PillTabs, usually).
   * Not needed when the bar is the first PillTabs in the page's frame: it joins the header by itself.
   */
  tabs?: ReactNode
  /** Force the hero card on or off; by default it's on exactly when tabs join the header. */
  hero?: boolean
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

export function PageHeader({ eyebrow, title, sub, actions, tabs, hero, size = 'page', wave, align, id, className }: PageHeaderProps) {
  const hand = useRef<HTMLSpanElement>(null)
  const waving = useRef(false)
  const greet = size === 'greeting'
  const slot = usePageTabsSlot()
  // The slot is offered to the page's bars only from a page header (never the greeting), and only
  // when the page has none passed explicitly.
  const hosts = !greet && !!slot && tabs == null
  const joined = hosts && slot.owner != null
  const isHero = !greet && (hero ?? (tabs != null || joined))

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
    <header className={cx('uk-ph', isHero && 'uk-ph--hero', greet && 'uk-ph--greet', greet && align === 'end' && 'uk-ph--end', !greet && align === 'center' && 'uk-ph--center', className)}>
      <div className="uk-ph__main" onMouseEnter={greet && wave ? doWave : undefined}>
        {eyebrow != null && eyebrow !== '' && <div className="uk-ph__eyebrow">{eyebrow}</div>}
        <h1 id={id} className="uk-ph__title">
          {title}
          {greet && wave && <span ref={hand} className="uk-ph__wave" aria-hidden="true">👋</span>}
        </h1>
        {sub != null && sub !== '' && <p className="uk-ph__sub">{sub}</p>}
      </div>
      {actions != null && <div className="uk-ph__actions">{actions}</div>}
      {tabs != null && <div className="uk-ph__tabs"><PageTabsInline>{tabs}</PageTabsInline></div>}
      {hosts && <div className="uk-ph__tabs" ref={slot.setEl} />}
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

/**
 * The page container: max width, the design's padding (28px clamp(16px,2.4vw,36px) 56px) and vertical rhythm.
 * It also hosts the header's tab slot, so a PageHeader and the page's PillTabs inside it join as the hero card.
 */
export function PageFrame({ children, width = 'wide', gap = 20, top, label, className, style }: PageFrameProps) {
  return (
    <div className={cx('uk-page', width === 'narrow' && 'uk-page--narrow', className)} aria-label={label} role={label ? 'region' : undefined}
      style={{ ...style, ['--uk-gap' as string]: `${gap}px`, ...(top != null ? { paddingTop: top } : null) } as CSSProperties}>
      <PageTabsHost>{children}</PageTabsHost>
    </div>
  )
}
