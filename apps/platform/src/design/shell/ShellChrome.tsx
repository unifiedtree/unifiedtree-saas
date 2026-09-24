// App chrome (icon rail, top bar, section tabs, mobile bar + drawer) built to
// the Claude Design prototype HrmsPrototype.dc.html. Every style value below is
// copied from the design; behaviour (routing, roles, search, notifications,
// profile menu) is supplied by PlatformShell.
import { useEffect, useRef, type ReactNode } from 'react'
import { dashIcon } from '../dc/icons'
import './shell.css'

export const CHROME_FONT = 'Inter,-apple-system,sans-serif'

export interface RailEntry {
  key: string
  label: string
  title: string
  icon: ReactNode
  active: boolean
  divider?: boolean
  onClick: () => void
}

function RailButton({ n }: { n: RailEntry }) {
  if (n.active) {
    return (
      <button type="button" aria-current="page" onClick={n.onClick} title={n.title}
        style={{ position: 'relative', overflow: 'hidden', width: '72px', height: '58px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', border: '0', borderRadius: '12px', background: 'rgba(255,255,255,.13)', color: '#fff', fontFamily: 'inherit', fontSize: '11px', fontWeight: 700, cursor: 'pointer', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14),0 8px 16px -10px rgba(0,0,0,.55)' }}>
        <span aria-hidden="true" style={{ position: 'absolute', left: '0', top: '0', bottom: '0', width: '3px', background: '#6ee7b7', boxShadow: '0 0 12px rgba(110,231,183,.9)' }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6ee7b7' }}>{n.icon}</span>
        <span style={{ letterSpacing: '.01em' }}>{n.label}</span>
      </button>
    )
  }
  return (
    <button type="button" onClick={n.onClick} title={n.title} className="ds-rail-idle"
      style={{ width: '72px', height: '54px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px', border: '0', borderRadius: '12px', background: 'transparent', color: 'rgba(255,255,255,.82)', fontFamily: 'inherit', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}>
      {n.icon}
      <span>{n.label}</span>
    </button>
  )
}

export function BrandMark({ size = 23, dot = 8 }: { size?: number; dot?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: '2px', fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontWeight: 800, fontSize: `${size}px`, letterSpacing: '-.05em', lineHeight: '.9', color: '#fff' }}>
      ut
      <i style={{ width: `${dot}px`, height: `${dot}px`, borderRadius: '999px', background: '#6ee7b7', display: 'inline-block', marginBottom: '3px' }} />
    </span>
  )
}

export function DesignRail({ top, bottom, onHome }: { top: RailEntry[]; bottom: RailEntry[]; onHome: () => void }) {
  return (
    <nav aria-label="Primary" className="hidden md:flex"
      style={{ width: '88px', flexShrink: 0, height: '100vh', background: '#0c5a45', flexDirection: 'column', alignItems: 'center', zIndex: 40, boxShadow: 'inset -1px 0 0 rgba(255,255,255,.08)', fontFamily: CHROME_FONT }}>
      <button type="button" onClick={onHome} aria-label="UnifiedTree home" title="Dashboard"
        style={{ height: '64px', width: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px', background: 'none', border: '0', borderBottom: '1px solid rgba(255,255,255,.1)', cursor: 'pointer', color: '#fff', fontFamily: 'inherit' }}>
        <BrandMark />
        <span style={{ fontSize: '10px', fontWeight: 600, color: 'rgba(255,255,255,.85)' }}>UnifiedTree</span>
      </button>
      <div className="ds-rail-scroll" style={{ flex: '1', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', padding: '10px 0', overflowY: 'auto', minHeight: 0 }}>
        {top.map((n) => (
          <div key={n.key} style={{ display: 'contents' }}>
            {n.divider ? <span aria-hidden="true" style={{ display: 'block', width: '36px', height: '1px', background: 'rgba(255,255,255,.14)', margin: '5px 0', flexShrink: 0 }} /> : null}
            <div style={{ position: 'relative', flexShrink: 0 }}><RailButton n={n} /></div>
          </div>
        ))}
      </div>
      {bottom.length > 0 && (
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 12px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          {bottom.map((n) => <div key={n.key} style={{ position: 'relative' }}><RailButton n={n} /></div>)}
        </div>
      )}
    </nav>
  )
}

/** The white search field in the top bar. It opens the ⌘K palette. */
export function HeaderSearch({ onOpen }: { onOpen: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  return (
    <label onMouseDown={(e) => { e.preventDefault(); onOpen() }}
      style={{ flex: '1 1 auto', maxWidth: '560px', minWidth: '0', display: 'flex', alignItems: 'center', gap: '10px', height: '40px', padding: '0 8px 0 14px', background: '#fff', borderRadius: '12px', boxShadow: '0 1px 2px rgba(0,0,0,.08)', color: '#64748b', cursor: 'text' }}>
      {dashIcon('search', 17)}
      <input ref={ref} type="search" aria-label="Search" readOnly placeholder="Search employees, leaves, reports, settings…"
        onFocus={() => { ref.current?.blur(); onOpen() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } }}
        style={{ flex: '1', minWidth: '0', border: '0', outline: 'none', font: 'inherit', fontSize: '14px', color: '#0f172a', background: 'transparent', cursor: 'text' }} />
      <kbd style={{ fontFamily: 'Inter,sans-serif', fontSize: '11px', fontWeight: 600, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '2px 6px', whiteSpace: 'nowrap' }}>⌘ K</kbd>
    </label>
  )
}

export function HeaderIconButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: ReactNode }) {
  return active ? (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="ds-hdr-active"
      style={{ width: '40px', height: '40px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'rgba(255,255,255,.18)', color: '#fff', cursor: 'pointer', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.22)' }}>
      {children}
    </button>
  ) : (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="ds-hdr-icon"
      style={{ width: '40px', height: '40px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
      {children}
    </button>
  )
}

/** Bell button; the dot shows only when something is unread. */
export function HeaderBellButton({ unread, onClick, mobile }: { unread: boolean; onClick: () => void; mobile?: boolean }) {
  const s = mobile ? 44 : 40
  return (
    <button type="button" aria-label={unread ? 'Notifications, unread' : 'Notifications'} onClick={onClick} className={mobile ? undefined : 'ds-hdr-icon'}
      style={{ position: 'relative', width: `${s}px`, height: `${s}px`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
      {dashIcon('bell', 19)}
      {unread && <span style={{ position: 'absolute', top: mobile ? '11px' : '9px', right: mobile ? '12px' : '10px', width: '8px', height: '8px', borderRadius: '999px', background: '#fbbf24', boxShadow: '0 0 0 2px #0f6e56' }} />}
    </button>
  )
}

export function HeaderProfileButton({ initials, name, role, onClick, expanded }: { initials: string; name: string; role: string; onClick: () => void; expanded: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-haspopup="menu" aria-expanded={expanded} aria-label="Account" className="ds-hdr-profile"
      style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px 4px 4px', borderRadius: '12px', border: '0', background: 'transparent', cursor: 'pointer', color: '#fff', fontFamily: 'inherit' }}>
      <span style={{ width: '36px', height: '36px', borderRadius: '999px', background: '#0a5240', boxShadow: '0 0 0 2px rgba(255,255,255,.3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700 }}>{initials}</span>
      <span className="hidden sm:flex" style={{ flexDirection: 'column', alignItems: 'flex-start', lineHeight: '1.25' }}>
        <span style={{ fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}>{name}</span>
        <span style={{ fontSize: '11px', color: 'rgba(255,255,255,.75)', whiteSpace: 'nowrap' }}>{role}</span>
      </span>
      {dashIcon('chevronDown', 16)}
    </button>
  )
}

export function DesignHeader({ search, right }: { search: ReactNode; right: ReactNode }) {
  return (
    <header className="hidden md:flex"
      style={{ position: 'relative', height: '64px', flexShrink: 0, background: '#0f6e56', alignItems: 'center', gap: '20px', padding: '0 20px 0 24px', zIndex: 35, boxShadow: '0 1px 0 rgba(255,255,255,.08),0 4px 16px -8px rgba(10,82,64,.5)', fontFamily: CHROME_FONT }}>
      {search}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>{right}</div>
    </header>
  )
}

export const HeaderDivider = () => <span aria-hidden="true" style={{ width: '1px', height: '28px', background: 'rgba(255,255,255,.22)', margin: '0 10px' }} />

export interface SubNavEntry { label: string; path: string; active: boolean; onClick: () => void }

/** Section tabs under the top bar (the prototype's sibling-page nav). */
export function DesignSubNav({ label, items }: { label: string; items: SubNavEntry[] }) {
  return (
    <nav aria-label={label} style={{ position: 'relative', flexShrink: 0, background: '#fff', fontFamily: CHROME_FONT, zIndex: 1 }}>
      <span aria-hidden="true" style={{ position: 'absolute', left: '0', right: '0', bottom: '0', height: '1px', background: '#e2e8f0' }} />
      <div className="ds-subnav-scroll" style={{ position: 'relative', maxWidth: '1320px', margin: '0 auto', padding: '0 clamp(16px,2.5vw,28px)', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch', gap: '24px', overflowX: 'auto' }}>
        {items.map((s) => s.active ? (
          <button key={s.path} type="button" aria-current="page"
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', height: '56px', padding: '0 4px', border: '0', background: 'none', font: 'inherit', fontSize: '14px', fontWeight: 700, color: '#0f6e56', whiteSpace: 'nowrap', cursor: 'default', boxShadow: 'inset 0 -3px 0 #0f6e56' }}>
            {s.label}
          </button>
        ) : (
          <button key={s.path} type="button" onClick={s.onClick} className="ds-subnav-idle"
            style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', height: '56px', padding: '0 4px', border: '0', background: 'none', font: 'inherit', fontSize: '14px', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap', cursor: 'pointer', boxShadow: 'inset 0 -3px 0 transparent', transition: 'color .15s,box-shadow .15s' }}>
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  )
}

export function DesignMobileHeader({ onMenu, onSearch, bell, avatar }: { onMenu: () => void; onSearch: () => void; bell: ReactNode; avatar: ReactNode }) {
  return (
    <header className="flex md:hidden"
      style={{ position: 'sticky', top: '0', zIndex: 35, height: '56px', flexShrink: 0, background: '#0f6e56', alignItems: 'center', gap: '4px', padding: '0 8px', fontFamily: CHROME_FONT }}>
      <button type="button" aria-label="Open navigation" onClick={onMenu}
        style={{ width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
        {dashIcon('menu', 22)}
      </button>
      <BrandMark size={21} dot={7} />
      <span style={{ flex: '1' }} />
      <button type="button" aria-label="Search" onClick={onSearch}
        style={{ width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
        {dashIcon('search', 20)}
      </button>
      {bell}
      {avatar}
    </header>
  )
}

export interface MobileNavEntry { key: string; label: string; icon: ReactNode; active: boolean; onClick: () => void }

export function DesignMobileNav({ items, onClose }: { items: MobileNavEntry[]; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} className="md:hidden" style={{ position: 'fixed', inset: '0', background: 'rgba(15,23,42,.45)', zIndex: 65 }} />
      <nav aria-label="Primary" className="md:hidden"
        style={{ position: 'fixed', top: '0', bottom: '0', left: '0', width: 'min(300px,85vw)', background: '#0c5a45', zIndex: 66, display: 'flex', flexDirection: 'column', overflowY: 'auto', boxShadow: '12px 0 32px rgba(15,23,42,.25)', fontFamily: CHROME_FONT }}>
        <div style={{ height: '56px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px 0 16px', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
          <BrandMark size={21} dot={7} />
          <button type="button" aria-label="Close navigation" onClick={onClose}
            style={{ width: '44px', height: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', border: '0', background: 'transparent', color: '#fff', cursor: 'pointer' }}>
            {dashIcon('x', 20)}
          </button>
        </div>
        <div style={{ padding: '8px', display: 'grid', gap: '2px' }}>
          {items.map((n) => n.active ? (
            <button key={n.key} type="button" aria-current="page" onClick={n.onClick}
              style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '46px', padding: '0 12px', border: '0', borderRadius: '10px', background: 'rgba(255,255,255,.16)', color: '#fff', fontFamily: 'inherit', fontSize: '14px', fontWeight: 700, cursor: 'pointer', textAlign: 'left' }}>
              {n.icon}{n.label}
            </button>
          ) : (
            <button key={n.key} type="button" onClick={n.onClick} className="ds-mnav-idle"
              style={{ display: 'flex', alignItems: 'center', gap: '12px', height: '46px', padding: '0 12px', border: '0', borderRadius: '10px', background: 'transparent', color: 'rgba(255,255,255,.86)', fontFamily: 'inherit', fontSize: '14px', fontWeight: 500, cursor: 'pointer', textAlign: 'left' }}>
              {n.icon}{n.label}
            </button>
          ))}
        </div>
      </nav>
    </>
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
    const over = (e: MouseEvent) => {
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
  return (
    <div ref={tipRef} role="tooltip" aria-hidden="true"
      style={{ position: 'fixed', zIndex: 9999, pointerEvents: 'none', left: '0', top: '0', opacity: 0, background: '#0f172a', color: '#e2e8f0', font: "600 11.5px/1.35 'JetBrains Mono',ui-monospace,monospace", padding: '5px 9px', borderRadius: '7px', boxShadow: '0 8px 20px -8px rgba(15,23,42,.55)', maxWidth: '380px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', transition: 'opacity .12s' }} />
  )
}
