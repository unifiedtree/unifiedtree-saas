// The open module's pages as tabs along the top bar (DECISIONS 21: the left Pages panel is gone).
//
// A quiet label with the module's icon and name, a hairline, then one pill per page; the page on screen
// is the solid brand-green one (aria-current="page"). These are the module's PAGES: a page's own views
// sit inside the page, under the top bar, in the lighter in-page pills (ModuleKit Views, kit PillTabs),
// so the two levels never look alike.
//
// Every tab is a real link (open in a new tab works); a plain click moves in the app through the shell
// (onSelect: the leave guards, the rail item stays lit). When the pages don't fit, the row scrolls
// sideways: the side with more fades out and shows a round arrow (pointer only: the keyboard reaches
// every tab, and a focused tab scrolls into view), the mouse wheel scrolls it, and the page on screen
// is kept in view. On a phone it is the second row of the top bar, a plain sideways scroller.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { ShellIcon } from './shellIcons'

export interface ModuleTab {
  label: string
  href: string
  /** The page on screen. */
  active: boolean
}

export interface ModuleTabsProps {
  /** The module (or Settings): its name names the row ("Workforce pages"). */
  module: { label: string; icon: string }
  pages: ModuleTab[]
  onSelect: (href: string) => void
  /** Pointer or focus on a tab: fetch its page's code ahead of the click. */
  onIntent?: (href: string) => void
}

// Layout effect in the browser (no jump after paint), plain effect elsewhere.
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/** A plain left click stays in the app; modified clicks (new tab, new window) are the browser's. */
function inApp(e: MouseEvent, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function ModuleTabs({ module, pages, onSelect, onIntent }: ModuleTabsProps) {
  const navRef = useRef<HTMLElement>(null)
  const [more, setMore] = useState<{ start: boolean; end: boolean }>({ start: false, end: false })

  // Which sides have more tabs to scroll to.
  const measure = useCallback(() => {
    const el = navRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    const next = { start: el.scrollLeft > 2, end: max - el.scrollLeft > 2 }
    setMore((cur) => (cur.start === next.start && cur.end === next.end ? cur : next))
  }, [])

  useEffect(() => {
    const el = navRef.current
    if (!el) return
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    // The mouse wheel scrolls the row sideways while it has somewhere to go.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return
      const before = el.scrollLeft
      el.scrollLeft += e.deltaY
      if (el.scrollLeft !== before) e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('scroll', measure)
      el.removeEventListener('wheel', onWheel)
      ro?.disconnect()
    }
  }, [measure, pages.length])

  // Keep the page on screen in view (a deep link to the last page, a phone): centre it when it is cut off.
  const activeHref = pages.find((p) => p.active)?.href ?? null
  useIsoLayoutEffect(() => {
    const el = navRef.current
    const on = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !on) return
    const left = on.offsetLeft, right = left + on.offsetWidth
    if (left < el.scrollLeft + 8 || right > el.scrollLeft + el.clientWidth - 8) {
      el.scrollLeft = Math.max(0, left - (el.clientWidth - on.offsetWidth) / 2)
    }
    measure()
  }, [activeHref, measure])

  const nudge = (dir: -1 | 1) => {
    const el = navRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.6), behavior: reducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <div className="ut-mtabs">
      <span className="ut-mtabs__mod" aria-hidden="true" title={module.label}>
        <span className="ut-mtabs__ic"><ShellIcon name={module.icon} size={16} /></span>
        <span className="ut-mtabs__name">{module.label}</span>
      </span>
      <span className="ut-mtabs__rule" aria-hidden="true" />
      <div className="ut-mtabs__track" data-start={more.start ? '' : undefined} data-end={more.end ? '' : undefined}>
        <nav ref={navRef} aria-label={`${module.label} pages`} className="ut-mtabs__nav">
          {pages.map((p) => (
            <a key={p.href} href={p.href} className="ut-mtab" aria-current={p.active ? 'page' : undefined}
              onClick={(e) => inApp(e, () => onSelect(p.href))}
              onMouseEnter={onIntent ? () => onIntent(p.href) : undefined} onFocus={onIntent ? () => onIntent(p.href) : undefined}>
              <span className="ut-mtab__label">{p.label}</span>
            </a>
          ))}
        </nav>
        {/* Pointer conveniences: the tabs themselves are all in the keyboard order. */}
        {more.start && (
          <button type="button" className="ut-mtabs__arrow ut-mtabs__arrow--start" tabIndex={-1} aria-hidden="true" title="Earlier pages" onClick={() => nudge(-1)}>
            <ShellIcon name="chevronLeft" size={16} strokeWidth={2.2} />
          </button>
        )}
        {more.end && (
          <button type="button" className="ut-mtabs__arrow ut-mtabs__arrow--end" tabIndex={-1} aria-hidden="true" title="More pages" onClick={() => nudge(1)}>
            <ShellIcon name="chevronRight" size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>
    </div>
  )
}
