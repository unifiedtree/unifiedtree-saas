// A page's own tabs and views, inside the page under the top bar: the kit's
// in-page pills, quiet text pills with the chosen one a soft brand tint. They are
// lighter on purpose: the top bar's module tabs (design/shell ModuleTabs) are
// outlined pills with a solid green one, so the two levels never look alike
// (DECISIONS 21). They scroll sideways when they don't fit, with a fade on the
// side that has more. PagePill is the top bar's one solid pill (module icon +
// page name) for a page that is its module's only page.
//
// Semantics (the look is the same):
//   "tabs"   role="tablist" / role="tab" / aria-selected, arrows move between
//            tabs (default — today's tab bars and their tests use tab roles)
//   "toggle" role="group" + buttons with aria-pressed (ModuleKit Views today)
//   "nav"    <nav> + links with aria-current (page = page tabs, location = in-page sections)
// Tabs with an href are real links (open in new tab works); a plain click
// calls onSelect so the app navigates without reloading.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import './display.css'

// Layout effect in the browser (no flicker), plain effect when rendered on a server or in tests.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export interface PillTab {
  key: string
  label: ReactNode
  /** Icon name (design/dc/icons) or element, shown before the label (dashboard section pills). */
  icon?: KitIcon
  /** The tab's URL. Without it the tab is a button. */
  href?: string
  /** Accessible name when the label isn't plain text. */
  ariaLabel?: string
  /** Tabs mode: the id of the panel this tab shows (aria-controls). */
  controls?: string
  disabled?: boolean
}

export type PillTabsSemantics = 'tabs' | 'toggle' | 'nav'

export interface PillTabsProps {
  items: readonly PillTab[]
  /** The active tab's key (null = none active). */
  activeKey: string | null | undefined
  onSelect: (key: string, e?: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>) => void
  /** Accessible name of the bar ("Sections", "Dashboard sections"). */
  label: string
  semantics?: PillTabsSemantics
  /** Nav mode: aria-current for the active item, "page" (default) or "location" (in-page sections). */
  current?: 'page' | 'location'
  /** Hover / focus on a tab (e.g. preload its code). */
  onIntent?: (key: string) => void
  className?: string
}

export function PillTabs({ items, activeKey, onSelect, label, semantics = 'tabs', current = 'page', onIntent, className }: PillTabsProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<{ start: boolean; end: boolean }>({ start: false, end: false })

  // Fade only the side that has more tabs to scroll to.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth
      setFade({ start: el.scrollLeft > 2, end: max - el.scrollLeft > 2 })
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      ro?.disconnect()
    }
  }, [items.length])

  // Keep the active tab in view (a deep link to the last tab on a phone).
  useIsoLayoutEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[data-active="true"]')
    if (!el || !on) return
    const l = on.offsetLeft - el.offsetLeft
    if (l < el.scrollLeft || l + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, l - 24)
  }, [activeKey])

  const enabled = items.filter((t) => !t.disabled)
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (semantics !== 'tabs' || !enabled.length) return
    const i = enabled.findIndex((t) => t.key === activeKey)
    let n = -1
    if (e.key === 'ArrowRight') n = (i + 1) % enabled.length
    else if (e.key === 'ArrowLeft') n = (i - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') n = 0
    else if (e.key === 'End') n = enabled.length - 1
    if (n < 0) return
    e.preventDefault()
    const next = enabled[n]
    onSelect(next.key, e)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(next.key)}"]`)?.focus())
  }

  const cls = cx('uk-ptabs', fade.start && 'is-fade-start', fade.end && 'is-fade-end', className)
  const tabs = items.map((t) => {
    const on = t.key === activeKey
    const icon = renderIcon(t.icon, 17)
    const content = (
      <>
        {icon && <span className="uk-ptab__icon" aria-hidden="true">{icon}</span>}
        {t.label}
      </>
    )
    const a11y =
      semantics === 'tabs'
        ? { role: 'tab' as const, 'aria-selected': on, 'aria-controls': t.controls, tabIndex: on || (activeKey == null && t === enabled[0]) ? 0 : -1 }
        : semantics === 'toggle'
          ? { 'aria-pressed': on }
          : { 'aria-current': on ? current : undefined }
    const common = {
      className: cx('uk-ptab', on ? 'is-on' : 'ufx-spot', !!icon && 'has-icon'),
      'aria-label': t.ariaLabel,
      'data-key': t.key,
      'data-active': on ? 'true' : undefined,
      onMouseEnter: onIntent ? () => onIntent(t.key) : undefined,
      onFocus: onIntent ? () => onIntent(t.key) : undefined,
      ...a11y,
    }
    return t.href && !t.disabled ? (
      <a key={t.key} {...common} href={t.href} onClick={linkClick((e) => onSelect(t.key, e))}>{content}</a>
    ) : (
      <button key={t.key} {...common} type="button" disabled={t.disabled} onClick={(e) => onSelect(t.key, e)}>{content}</button>
    )
  })

  if (semantics === 'nav') {
    return <nav ref={ref} aria-label={label} className={cls}>{tabs}</nav>
  }
  return (
    <div ref={ref} role={semantics === 'tabs' ? 'tablist' : 'group'} aria-label={label} className={cls} onKeyDown={onKeyDown}>
      {tabs}
    </div>
  )
}

export interface PagePillProps {
  label: ReactNode
  /** The module's icon (name or element). */
  icon?: KitIcon
  className?: string
}

/** The single solid pill for pages without tabs: module icon + page name. */
export function PagePill({ label, icon, className }: PagePillProps) {
  const ic = renderIcon(icon, 17)
  return (
    <span className={cx('uk-ppill', className)}>
      {ic && <span className="uk-ptab__icon" aria-hidden="true">{ic}</span>}
      <span className="uk-ppill__label">{label}</span>
    </span>
  )
}
