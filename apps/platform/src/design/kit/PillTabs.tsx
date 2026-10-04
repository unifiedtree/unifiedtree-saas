// A page's own tabs and views, inside the page under the top bar. The top bar's
// module tabs (design/shell ModuleTabs) are outlined pills with a solid green
// one, so the two levels never look alike (DECISIONS 21). PagePill is the top
// bar's one solid pill (module icon + page name) for a page that is its
// module's only page.
//
// Two looks, chosen by where the bar ends up:
//   • joined to the page header (the default for a page's sub-section tabs):
//     the Master "Organization Setup" segmented control inside the header's
//     hero card — a grey track, the chosen tab a white pill with dark text,
//     the rest plain text; the segments wrap onto a second row on a phone;
//   • where it stands (filters inside a card, a bar with no header above it):
//     quiet text pills, the chosen one a soft brand tint, scrolling sideways
//     when they don't fit, with a fade on the side that has more.
//
// placement (see pageTabs.tsx):
//   "auto"   (default) "tabs" and "toggle" bars claim the page header's tab
//            slot when the page hosts one (PageFrame / ModulePage) and no other
//            bar has it yet, and render into it through a portal; "nav" bars
//            (in-page section links) never do
//   "hero"   claim the slot whatever the semantics
//   "inline" never claim: the bar stays where it is rendered (a filter bar
//            inside a card, status pills)
//
// Semantics (the look is the same):
//   "tabs"   role="tablist" / role="tab" / aria-selected, arrows move between
//            tabs (default — today's tab bars and their tests use tab roles)
//   "toggle" role="group" + buttons with aria-pressed (ModuleKit Views today)
//   "nav"    <nav> + links with aria-current (page = page tabs, location = in-page sections)
// Tabs with an href are real links (open in new tab works); a plain click
// calls onSelect so the app navigates without reloading.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx, linkClick, renderIcon, type KitIcon } from './displayUtil'
import { usePageTabsSlot } from './pageTabs'
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
  /** A short tooltip (the shell's data-tip tooltip). */
  tip?: string
  disabled?: boolean
}

export type PillTabsSemantics = 'tabs' | 'toggle' | 'nav'
export type PillTabsPlacement = 'auto' | 'hero' | 'inline'

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
  /** Where the bar goes: into the page header's hero card ("auto" / "hero") or where it is rendered ("inline"). */
  placement?: PillTabsPlacement
  /** Hover / focus on a tab (e.g. preload its code). */
  onIntent?: (key: string) => void
  className?: string
}

export function PillTabs({ items, activeKey, onSelect, label, semantics = 'tabs', current = 'page', placement = 'auto', onIntent, className }: PillTabsProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState<{ start: boolean; end: boolean }>({ start: false, end: false })

  // Joining the page header: claim its tab slot (first bar wins), render into it once it is on screen.
  const slot = usePageTabsSlot()
  const id = useId()
  const wants = !!slot && (placement === 'hero' || (placement === 'auto' && semantics !== 'nav'))
  const claim = slot?.claim
  const release = slot?.release
  useIsoLayoutEffect(() => {
    if (!wants || !claim || !release) return
    if (!claim(id)) return
    return () => release(id)
  }, [wants, claim, release, id])
  const host = wants && slot && slot.owner === id ? slot.el : null

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
  }, [items.length, host])

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

  const seg = host != null
  const cls = cx('uk-ptabs', seg && 'uk-ptabs--seg', !seg && fade.start && 'is-fade-start', !seg && fade.end && 'is-fade-end', className)
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
      'data-tip': t.tip || undefined,
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

  const bar = semantics === 'nav'
    ? <nav ref={ref} aria-label={label} className={cls}>{tabs}</nav>
    : (
      <div ref={ref} role={semantics === 'tabs' ? 'tablist' : 'group'} aria-label={label} className={cls} onKeyDown={onKeyDown}>
        {tabs}
      </div>
    )
  return host ? createPortal(bar, host) : bar
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
