// The settings-page pattern from the Payroll Settings design
// (docs/Designs/UnifiedTree Payroll Settings.html, PaySettings.dc.html): a page
// header, a sticky "On this page" list that follows the scroll, one card per
// section with an on/off switch, a view-only note, loading / error / no-access
// states, a sticky "You have unsaved changes" bar and dark toasts. Every style
// value is copied from that design so other settings pages match it exactly.
import { createElement, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { HrButton, HrPageHeader } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { Field, Input, Modal } from '@unifiedtree/ui-kit'
import { dashIcon, dashIconComponent } from '@/design/dc/icons'
import { useIsMobile } from '@/design/dc/DesignFrame'

const FONT = 'Inter,-apple-system,sans-serif'
const CARD: CSSProperties = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 2px rgba(15,23,42,.04)', minWidth: 0 }

export interface SettingsNavItem { key: string; label: string; state: 'on' | 'off' | 'soon' | 'none'; errors?: number; meta?: string }

/** The scroll container the shell uses (the page scrolls inside it, not the window). */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement || null
  while (n) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; n = n.parentElement }
  return null
}

/** Toast state for a settings page: success disappears after 3.2 s, errors after 8 s. */
export function useSettingsToast() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; title: string; msg?: string } | null>(null)
  const t = useRef<ReturnType<typeof setTimeout>>()
  const show = useCallback((kind: 'ok' | 'error', title: string, msg?: string) => {
    clearTimeout(t.current); setToast({ kind, title, msg }); t.current = setTimeout(() => setToast(null), kind === 'error' ? 8000 : 3200)
  }, [])
  useEffect(() => () => clearTimeout(t.current), [])
  return { toast, show, dismiss: () => setToast(null) }
}

export function SettingsPage({
  crumb, title, subtitle, nav, access, status, onRetry, viewOnlyText, noAccessText, noAccessAction, entity,
  dirty, changeCount, errorCount, onGoToError, saving, onSave, onDiscard, toast, onDismissToast, children,
}: {
  crumb: string; title: string; subtitle: string; nav: SettingsNavItem[]
  access: 'edit' | 'view' | 'none'; status: 'loading' | 'error' | 'live'; onRetry?: () => void
  viewOnlyText?: string; noAccessText?: string; noAccessAction?: { label: string; onClick: () => void }
  /** "HR settings" — used in the leave-without-saving dialog. */
  entity: string
  dirty: boolean; changeCount: number; errorCount: number; onGoToError?: () => void
  saving: boolean; onSave: () => void; onDiscard: () => void
  toast: { kind: 'ok' | 'error'; title: string; msg?: string } | null; onDismissToast: () => void
  children: ReactNode
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mobile = useIsMobile()
  const [w, setW] = useState(1000)
  const [active, setActive] = useState(nav[0]?.key || '')
  const lockUntil = useRef(0)
  const narrow = mobile || w < 720, offset = narrow ? 132 : 88
  const live = access !== 'none' && status === 'live'
  const keys = nav.map((n) => n.key).join('|')

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((es) => { const x = Math.round(es[0].contentRect.width); if (x) setW(x) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Scroll spy: the last section whose top has passed the header line is the current one.
  useEffect(() => {
    const sc = scrollerOf(rootRef.current)
    let raf = 0
    const spy = () => {
      raf = 0
      if (lockUntil.current > Date.now()) return
      const top0 = sc ? sc.getBoundingClientRect().top : 0
      let act: string | null = null
      for (const k of keys.split('|')) { const el = document.getElementById('st-' + k); if (!el) continue; if (act === null) act = k; if (el.getBoundingClientRect().top - top0 - offset - 16 <= 0) act = k }
      if (sc && sc.scrollTop > 0 && sc.clientHeight + sc.scrollTop >= sc.scrollHeight - 2) act = keys.split('|').pop() || act
      if (act) setActive(act)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(spy) }
    ;(sc || window).addEventListener('scroll', onScroll, { passive: true })
    return () => { (sc || window).removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf) }
  }, [keys, offset])
  // A link to "#st-<section>" (from another page) opens at that section once it's drawn, and keeps
  // it there while sections above it finish loading (a card that fills in later would otherwise
  // push it down), until the person scrolls or two seconds pass.
  useEffect(() => {
    if (!live) return
    let t: ReturnType<typeof setTimeout> | undefined
    let ro: ResizeObserver | undefined
    let holdUntil = 0
    const place = (h: string) => {
      const el = document.getElementById(h), sc = scrollerOf(rootRef.current)
      if (el && sc) { lockUntil.current = Date.now() + 900; setActive(h.slice(3)); sc.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - offset) }) }
    }
    const release = () => { holdUntil = 0; ro?.disconnect(); ro = undefined }
    const go = () => {
      const h = window.location.hash.slice(1)
      if (!h.startsWith('st-')) return
      clearTimeout(t)
      t = setTimeout(() => {
        place(h)
        holdUntil = Date.now() + 2000
        const root = rootRef.current
        if (root && typeof ResizeObserver !== 'undefined') {
          ro?.disconnect()
          ro = new ResizeObserver(() => { if (Date.now() < holdUntil) place(h); else release() })
          ro.observe(root)
        }
      }, 60)
    }
    // The person scrolling takes over at once.
    const userScroll = () => { if (holdUntil) release() }
    go()
    window.addEventListener('hashchange', go)
    window.addEventListener('wheel', userScroll, { passive: true })
    window.addEventListener('touchmove', userScroll, { passive: true })
    window.addEventListener('keydown', userScroll)
    return () => {
      clearTimeout(t); release()
      window.removeEventListener('hashchange', go)
      window.removeEventListener('wheel', userScroll)
      window.removeEventListener('touchmove', userScroll)
      window.removeEventListener('keydown', userScroll)
    }
  }, [live]) // eslint-disable-line react-hooks/exhaustive-deps
  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const jump = (k: string) => {
    const el = document.getElementById('st-' + k), sc = scrollerOf(rootRef.current)
    if (!el) return
    lockUntil.current = Date.now() + 900
    setActive(k)
    if (sc) sc.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - offset), behavior: 'smooth' })
    ;(el.querySelector('h2') as HTMLElement | null)?.focus({ preventScroll: true })
  }
  const dot = (s: SettingsNavItem['state']) => s === 'on' ? <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, background: '#10b981' }} />
    : s === 'off' ? <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, borderRadius: 999, background: '#cbd5e1' }} />
      : s === 'soon' ? <span aria-hidden="true" style={{ flex: '0 0 auto', width: 7, height: 7, boxSizing: 'border-box', borderRadius: 999, border: '1.5px solid #cbd5e1' }} /> : null
  const tocItem = (t: SettingsNavItem) => {
    const on = t.key === active
    return (
      <a key={t.key} href={'#st-' + t.key} aria-current={on ? 'location' : undefined} onClick={(e) => { e.preventDefault(); jump(t.key) }} className={on ? undefined : 'ut-toc-idle'}
        style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36, padding: '0 12px', borderRadius: 10, background: on ? '#ecfdf5' : 'transparent', color: on ? '#0a5240' : '#475569', fontSize: 13.5, fontWeight: on ? 700 : 500, textDecoration: 'none', transition: 'background-color .15s,color .15s' }}>
        {dot(t.state)}
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>{t.label}</span>
        {t.errors ? <span aria-label={`${t.errors} to fix`} style={{ flex: '0 0 auto', minWidth: 18, height: 18, boxSizing: 'border-box', padding: '0 5px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{t.errors}</span> : null}
        {t.meta ? <span style={{ flex: '0 0 auto', fontSize: 11.5, fontWeight: 600, color: '#64748b' }}>{t.meta}</span> : null}
      </a>
    )
  }
  const bar = (
    <>
      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 8, height: 8, borderRadius: 999, background: '#10b981', boxShadow: '0 0 0 4px #d1fae5' }} />
      <div style={{ flex: '1 1 200px', minWidth: 0, display: 'grid', gap: 1 }}>
        <strong style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>You have unsaved changes</strong>
        {errorCount ? <button type="button" onClick={onGoToError} style={{ justifySelf: 'start', padding: 0, border: 0, background: 'none', font: 'inherit', fontSize: 12.5, fontWeight: 600, color: '#b91c1c', textDecoration: 'underline', textUnderlineOffset: 3, cursor: 'pointer' }}>{`Fix ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} to save`}</button>
          : <span style={{ fontSize: 12.5, color: '#64748b' }}>{`${changeCount} ${changeCount === 1 ? 'change' : 'changes'} · not saved yet`}</span>}
      </div>
    </>
  )
  const saveBtn = <HrButton onClick={onSave} aria-busy={saving} className={narrow ? 'w-full' : undefined}>{saving ? 'Saving…' : 'Save settings'}</HrButton>
  const discardBtn = <HrButton variant="ghost" onClick={onDiscard} disabled={saving} className={narrow ? 'w-full' : undefined}>Discard</HrButton>

  return (
    <div ref={rootRef} style={{ minWidth: 0, fontFamily: FONT, color: '#0f172a' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '24px 32px', minWidth: 0 }}>
        <div style={{ flex: '0 0 100%', minWidth: 0, display: 'flex', justifyContent: 'center', marginBottom: -32 }}>
          <div style={{ flex: '1 1 auto', maxWidth: 976, minWidth: 0 }}><HrPageHeader crumb={crumb} title={title} subtitle={subtitle} /></div>
        </div>
        {live && !narrow && nav.length > 1 && (
          <nav aria-label="On this page" style={{ flex: '0 0 176px', alignSelf: 'flex-start', position: 'sticky', top: 88, display: 'grid', gap: 2, minWidth: 0, boxSizing: 'border-box', padding: '14px 8px 10px', ...CARD }}>
            <p style={{ margin: '0 0 6px', padding: '0 12px', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#64748b' }}>On this page</p>
            {nav.map(tocItem)}
          </nav>
        )}
        <div style={{ flex: '1 1 480px', maxWidth: nav.length > 1 && !narrow ? 768 : 976, minWidth: 0, display: 'grid', gap: 16 }}>
          {live && narrow && nav.length > 1 && (
            <div role="navigation" aria-label="On this page" style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', gap: 8, overflowX: 'auto', padding: '8px 0', background: '#f8fafc', scrollbarWidth: 'none' }}>
              {nav.map((t) => (
                <button key={t.key} type="button" onClick={() => jump(t.key)} aria-current={t.key === active ? 'location' : undefined}
                  style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${t.key === active ? '#a7f3d0' : '#e2e8f0'}`, background: t.key === active ? '#ecfdf5' : '#fff', color: t.key === active ? '#0a5240' : '#475569', font: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {dot(t.state)}{t.label}
                </button>
              ))}
            </div>
          )}
          {access === 'view' && status === 'live' && (
            <div role="note" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', borderRadius: 14, background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 1px 2px rgba(15,23,42,.04)' }}>
              <span aria-hidden="true" style={{ flex: '0 0 auto', width: 32, height: 32, borderRadius: 10, background: '#f1f5f9', color: '#475569', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{dashIcon('lock', 16)}</span>
              <div style={{ display: 'grid', gap: 2, minWidth: 0, paddingTop: 1 }}>
                <strong style={{ fontSize: 13.5, fontWeight: 700 }}>View only</strong>
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: '#475569' }}>{viewOnlyText || 'You can view these settings. Ask an admin to change them.'}</p>
              </div>
            </div>
          )}
          {access !== 'none' && status === 'loading' && (
            <div role="status" aria-label={`Loading ${entity}`} style={{ display: 'grid', gap: 16 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={CARD}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px' }}>
                    <SkeletonBlock className="h-10 w-10 rounded-xl" />
                    <div style={{ flex: '1 1 auto', display: 'grid', gap: 8 }}><SkeletonBlock className="h-4 w-40" /><SkeletonBlock className="h-3 w-64" /></div>
                  </div>
                  {i < 2 && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,180px),1fr))', gap: 16, padding: 20, borderTop: '1px solid #f1f5f9' }}>{[0, 1, 2].map((j) => <div key={j} style={{ display: 'grid', gap: 8 }}><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-10 w-full rounded-xl" /></div>)}</div>}
                </div>
              ))}
            </div>
          )}
          {access !== 'none' && status === 'error' && (
            <div style={CARD}><EmptyState icon={dashIconComponent('alertTriangle') as any} title={`Couldn’t load ${entity}`} description="Something went wrong while loading. Nothing was changed — try again." action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined} /></div>
          )}
          {access === 'none' && (
            <div style={CARD}><EmptyState icon={dashIconComponent('lock') as any} title="Access restricted" description={noAccessText || 'These settings are only open to admins. Ask one of them if you need access.'} action={noAccessAction} /></div>
          )}
          {live && children}
          {live && dirty && !narrow && (
            <div role="region" aria-label="Unsaved changes" style={{ position: 'sticky', bottom: 16, zIndex: 6, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px 16px', padding: '12px 12px 12px 18px', borderRadius: 16, background: '#fff', border: '1px solid #d1fae5', boxShadow: '0 24px 48px -18px rgba(15,23,42,.32),0 2px 6px rgba(15,23,42,.06)' }}>
              {bar}
              <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, marginLeft: 'auto' }}>{discardBtn}{saveBtn}</div>
            </div>
          )}
          {live && dirty && narrow && (
            <div role="region" aria-label="Unsaved changes" style={{ position: 'sticky', bottom: 0, zIndex: 6, margin: '4px -16px -40px', display: 'grid', gap: 10, padding: '12px 16px calc(12px + env(safe-area-inset-bottom))', background: '#fff', borderTop: '1px solid #d1fae5', boxShadow: '0 -14px 28px -18px rgba(15,23,42,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>{bar}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 8 }}>{discardBtn}{saveBtn}</div>
            </div>
          )}
        </div>
      </div>
      {toast && (
        <div role={toast.kind === 'error' ? 'alert' : 'status'} aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
          style={{ position: 'fixed', left: '50%', bottom: toast.kind === 'error' && dirty ? 132 : 24, transform: 'translateX(-50%)', zIndex: 1400, display: 'flex', alignItems: toast.kind === 'error' ? 'flex-start' : 'center', gap: 10, width: 'max-content', maxWidth: 'min(460px,calc(100vw - 32px))', boxSizing: 'border-box', padding: '12px 12px 12px 14px', borderRadius: 14, background: '#0f172a', color: '#fff', boxShadow: '0 18px 36px -14px rgba(15,23,42,.6)' }}>
          <span aria-hidden="true" style={{ flex: '0 0 auto', display: 'inline-flex', marginTop: toast.kind === 'error' ? 1 : 0, color: toast.kind === 'error' ? '#fca5a5' : '#34d399' }}>{dashIcon(toast.kind === 'error' ? 'alertTriangle' : 'check', 18)}</span>
          <div style={{ flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 3 }}>
            <strong style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{toast.title}</strong>
            {toast.msg && <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#cbd5e1' }}>{toast.msg}</span>}
          </div>
          <button type="button" aria-label="Dismiss" onClick={onDismissToast} style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, margin: '-4px -4px -4px 0', border: 0, borderRadius: 8, background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>{dashIcon('x', 16)}</button>
        </div>
      )}
    </div>
  )
}

/** The design's switch: 44×24 track on a 56×44 hit area. */
export function SettingsSwitch({ on, onToggle, label, disabled, title }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} onClick={disabled ? undefined : onToggle} disabled={disabled}
      onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) { e.currentTarget.style.outline = '2px solid #10b981'; e.currentTarget.style.outlineOffset = '-4px' } }}
      onBlur={(e) => { e.currentTarget.style.outline = 'none' }}
      style={{ flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 44, margin: '-10px -6px', padding: 0, border: 0, borderRadius: 999, background: 'none', cursor: disabled ? 'default' : 'pointer' }}>
      <span aria-hidden="true" style={{ position: 'relative', display: 'block', width: 44, height: 24, borderRadius: 999, background: on ? '#0f6e56' : '#cbd5e1', transition: 'background-color .2s', opacity: disabled ? 0.6 : 1 }}>
        <span style={{ position: 'absolute', top: 2, left: 2, width: 20, height: 20, borderRadius: 999, background: '#fff', boxShadow: '0 1px 3px rgba(15,23,42,.28)', transform: on ? 'translateX(20px)' : 'translateX(0px)', transition: 'transform .2s cubic-bezier(.2,.8,.2,1)' }} />
      </span>
    </button>
  )
}

/**
 * One section card. `on`/`onToggle` give it the design's On/Off switch; `soon`
 * shows a "Coming soon" pill instead (no backend yet); `readOnly` shows an
 * Applied/Off pill. `icon` is a dashIcon name.
 */
export function SettingsSection({ id, icon, title, summary, on, onToggle, locked, soon, readOnly, children }: {
  id: string; icon: string; title: string; summary: string
  on?: boolean; onToggle?: () => void; locked?: boolean; soon?: boolean; readOnly?: boolean; children?: ReactNode
}) {
  const active = soon ? false : on !== false
  return (
    <section id={'st-' + id} aria-labelledby={`st-${id}-h`} style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px' }}>
        <span aria-hidden="true" style={{ flex: '0 0 auto', width: 40, height: 40, boxSizing: 'border-box', borderRadius: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${active ? '#d1fae5' : '#e2e8f0'}`, background: active ? '#ecfdf5' : '#f8fafc', color: active ? '#0f6e56' : '#94a3b8' }}>{dashIcon(icon, 20)}</span>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 3 }}>
          <h2 id={`st-${id}-h`} tabIndex={-1} style={{ margin: 0, fontFamily: "'Plus Jakarta Sans',Inter,sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.3, outline: 'none' }}>{title}</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: '#64748b', textWrap: 'pretty' as any }}>{summary}</p>
        </div>
        {soon ? <span style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#f8fafc', color: '#64748b', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>Coming soon</span>
          : onToggle && !readOnly ? (
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2 }}>
              <span aria-hidden="true" style={{ minWidth: 24, textAlign: 'right', fontSize: 12.5, fontWeight: 600, color: on ? '#0f6e56' : '#64748b' }}>{on ? 'On' : 'Off'}</span>
              <SettingsSwitch on={!!on} onToggle={onToggle} label={`Turn ${title} ${on ? 'off' : 'on'}`} disabled={locked} title={locked ? 'Always on' : undefined} />
            </div>
          ) : onToggle && readOnly ? (
            <span style={{ flex: '0 0 auto', padding: '3px 10px', borderRadius: 999, border: `1px solid ${on ? '#a7f3d0' : '#e2e8f0'}`, background: on ? '#ecfdf5' : '#f1f5f9', color: on ? '#0a5240' : '#475569', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>{on ? 'On' : 'Off'}</span>
          ) : null}
      </div>
      {children && active && <div style={{ display: 'grid', gap: 18, padding: 20, borderTop: '1px solid #f1f5f9' }}>{children}</div>}
    </section>
  )
}

/** The design's field grid (fields of 180px and up). */
export function SettingsGrid({ children, min = 180 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))`, gap: 16, alignItems: 'start' }}>{children}</div>
}

/** A labelled text input, or a read-only label/value when the viewer can't edit. */
export function SettingsInput({ label, value, onChange, readOnly, error, hint, suffix, prefix, placeholder, inputMode, mono, disabled, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; readOnly?: boolean; error?: string; hint?: string; suffix?: string; prefix?: string
  placeholder?: string; inputMode?: 'text' | 'numeric' | 'decimal'; mono?: boolean; disabled?: boolean; maxLength?: number
}) {
  if (readOnly) return <SettingsValue label={label} value={value ? `${prefix || ''}${value}${suffix ? ' ' + suffix : ''}` : '—'} />
  const affix = (t: string) => createElement('span', { style: { fontSize: 13, fontWeight: 600, color: '#64748b' } }, t)
  return (
    <div style={{ minWidth: 0 }}>
      <Field label={label} hint={hint} error={error}>
        <Input value={value} onChange={(e: any) => onChange(e.target.value)} inputMode={inputMode || 'text'} autoComplete="off" spellCheck={false} disabled={disabled} placeholder={placeholder} maxLength={maxLength}
          aria-invalid={error ? true : undefined} leftElement={prefix ? affix(prefix) : undefined} rightElement={suffix ? affix(suffix) : undefined}
          style={mono ? { fontFamily: "'JetBrains Mono',ui-monospace,SFMono-Regular,monospace", letterSpacing: '.02em' } : undefined} />
      </Field>
    </div>
  )
}

/** Label over value (the design's view-only rows). */
export function SettingsValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0, display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: '#64748b' }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{value}</span>
    </div>
  )
}

/** The design's inline switch row ("Apply ceiling" / "Sandwich rule"). */
export function SettingsToggleRow({ label, detail, on, onToggle, readOnly, disabled }: { label: string; detail: string; on: boolean; onToggle: () => void; readOnly?: boolean; disabled?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #eef2f6' }}>
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 2 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: '#0f172a' }}>{label}</span>
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: '#64748b' }}>{detail}</span>
      </div>
      {readOnly ? <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? '#0a5240' : '#475569' }}>{on ? 'On' : 'Off'}</span>
        : <SettingsSwitch on={on} onToggle={onToggle} label={label} disabled={disabled} />}
    </div>
  )
}

/** A quiet note inside a section (what a setting does, or what isn't built yet). */
export function SettingsNote({ children, tone }: { children: ReactNode; tone?: 'amber' }) {
  return <p style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: tone === 'amber' ? '#fffbeb' : '#f8fafc', border: `1px solid ${tone === 'amber' ? '#fde68a' : '#eef2f6'}`, fontSize: 12.5, lineHeight: 1.5, color: tone === 'amber' ? '#92400e' : '#475569' }}>{children}</p>
}

/** The leave-without-saving dialog. */
export function SettingsLeaveModal({ open, entity, onKeep, onDiscard }: { open: boolean; entity: string; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Modal open={open} onOpenChange={(o: boolean) => { if (!o) onKeep() }} title="Discard unsaved changes?" description={`You’ve changed ${entity} but haven’t saved them. If you leave now, those changes are lost.`} size="sm">
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 8, fontFamily: FONT }}>
        <HrButton variant="ghost" onClick={onKeep}>Keep editing</HrButton>
        <HrButton variant="danger" onClick={onDiscard}>Discard</HrButton>
      </div>
    </Modal>
  )
}
