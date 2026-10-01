// Shell pieces shared by the desktop and phone chrome: the workspace tile (rail top block, phone bar,
// drawer), the phone navigation drawer (the open module's pages, the expanded rail, then More), and the
// hover tooltip for `data-tip` attributes. The rail, the top bar (and its module tabs) and More panel
// are their own files.
import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { useWorkspaceBranding } from '@/core/tenant/workspaceBranding'
import { useEscape, useFocusTrap, useLayer } from '@/design/kit/overlayCore'
import type { RailGroupView } from './AppRail'
import { MoreContent, type MoreContentProps } from './MorePanel'
import { ShellIcon } from './shellIcons'
import './shell.css'

export const CHROME_FONT = "var(--u-font,'Inter',system-ui,sans-serif)"

/**
 * The workspace's mark in the design's white tile (white label: never the vendor's). Its uploaded mark,
 * else its logo, else its monogram (the first letter of the workspace name) with the gold dot.
 */
export function WorkspaceTile() {
  const b = useWorkspaceBranding()
  const [failed, setFailed] = useState<string | null>(null)
  const src = b.markUrl || b.logoUrl
  if (src && failed !== src) {
    return <img className="ut-tile__img" src={src} alt="" aria-hidden="true" onError={() => setFailed(src)} />
  }
  return (
    <span className="ut-tile__mono">
      {b.monogram}
      <i className="ut-tile__dot" />
    </span>
  )
}

/** The open module's pages, for the phone drawer (the same list as the top bar's tabs). */
export interface DrawerPages {
  /** The module's key (or Settings'). */
  key: string
  /** Its name ("Workforce", "My pay", "Settings"): the list is "<name> pages". */
  label: string
  items: { label: string; href: string; active: boolean }[]
}

export interface MobileDrawerProps extends MoreContentProps {
  groups: RailGroupView[]
  workspaceName: string | null
  onClose: () => void
  onItem: (key: string) => void
  /** The open module's pages, listed first (a module with one page lists none). */
  pages?: DrawerPages | null
  onPage?: (href: string) => void
}

function inApp(e: MouseEvent, go: () => void) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  go()
}

/**
 * The phone's navigation: the open module's pages first (where you are, and the pages next to it), then
 * the rail expanded (every group, nothing overflows) with More's content under it. Mount only while open.
 */
export function MobileDrawer({ groups, workspaceName, onClose, onItem, pages, onPage, ...more }: MobileDrawerProps) {
  const ref = useRef<HTMLDivElement>(null)
  const isTop = useLayer(true)
  useEscape(true, isTop, onClose)
  useFocusTrap(ref, true, isTop, 'container')
  return (
    <div className="ut-drawer-layer">
      <div className="ut-backdrop ut-backdrop--left" aria-hidden="true" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Navigation" tabIndex={-1} className="ut-drawer">
        <div className="ut-drawer__rail">
          <div className="ut-drawer__head">
            <span className="ut-rail__tile" aria-hidden="true"><WorkspaceTile /></span>
            <span className="ut-drawer__ws">{workspaceName ?? ''}</span>
            <button type="button" className="ut-drawer__close" onClick={onClose} aria-label="Close navigation">
              <ShellIcon name="x" size={20} strokeWidth={2} />
            </button>
          </div>
          {pages && pages.items.length > 1 && (
            <nav aria-label={`${pages.label} pages`} className="ut-drawer__pages">
              <div className="ut-drawer__label ut-drawer__label--pages" aria-hidden="true">{pages.label}</div>
              {pages.items.map((p) => (
                <a key={p.href} href={p.href} className="ut-drawer__page" aria-current={p.active ? 'page' : undefined}
                  onClick={(e) => inApp(e, () => onPage?.(p.href))}>
                  <span className="ut-drawer__pagelabel">{p.label}</span>
                </a>
              ))}
            </nav>
          )}
          <nav aria-label="Primary" className="ut-drawer__nav">
            {groups.map((g, gi) => (
              <div key={g.key} role="group" aria-label={g.label} className="ut-drawer__grp">
                {gi > 0 && <div className="ut-drawer__label" aria-hidden="true">{g.label}</div>}
                {g.items.map((n) => (
                  <a key={n.key} href={n.href} className="ut-rail__item" data-lit={n.lit ? '' : undefined} aria-current={n.lit ? 'page' : undefined}
                    aria-label={n.name !== n.label ? n.name : undefined} onClick={(e) => inApp(e, () => onItem(n.key))}>
                    <ShellIcon name={n.icon} size={20} />
                    <span className="ut-rail__label">{n.label}</span>
                    {n.soon && <span className="ut-rail__soon">Soon</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
        </div>
        <div className="ut-drawer__more">
          <MoreContent {...more} />
        </div>
      </div>
    </div>
  )
}

/**
 * Hover tooltip for `data-tip` / `data-row-tips` attributes, styled as in the
 * design. Route hints ("→ /hrms/…") were a prototype-only navigation aid and
 * are not shown.
 */
export function DesignTooltip() {
  const tipRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tip = tipRef.current
    if (!tip) return
    let current: Element | null = null
    const hide = () => { current = null; tip.style.opacity = '0' }
    const show = (el: Element, text: string) => {
      tip.textContent = text
      tip.style.opacity = '1'
      const r = el.getBoundingClientRect(), w = tip.offsetWidth, th = tip.offsetHeight
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      let y = r.top - th - 8
      if (y < 8) y = r.bottom + 8
      tip.style.left = x + 'px'
      tip.style.top = y + 'px'
    }
    const over = (e: globalThis.MouseEvent) => {
      const t = e.target
      if (!(t instanceof Element)) return
      let el: Element | null = t.closest('[data-tip]')
      let text = el ? el.getAttribute('data-tip') : null
      if (!el) {
        const tr = t.closest('tbody tr'), box = tr && tr.closest('[data-row-tips]')
        if (tr && box) {
          try { text = JSON.parse(box.getAttribute('data-row-tips') || '[]')[Array.prototype.indexOf.call(tr.parentNode!.children, tr)]; el = tr } catch { /* ignore */ }
        }
      }
      if (el && text && !text.startsWith('→')) { if (el !== current) { current = el; show(el, text) } } else if (current) hide()
    }
    document.addEventListener('mouseover', over)
    window.addEventListener('scroll', hide, true)
    return () => { document.removeEventListener('mouseover', over); window.removeEventListener('scroll', hide, true) }
  }, [])
  return <div ref={tipRef} role="tooltip" aria-hidden="true" className="ut-tooltip" />
}

