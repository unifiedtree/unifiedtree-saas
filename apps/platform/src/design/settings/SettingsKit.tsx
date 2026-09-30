// The settings-page pattern in the redesign's look (design_handoff_hrms_redesign:
// PgSetup "HR configuration", PgAdmin "Settings", UtSection): the kit page
// header, a sticky "On this page" list that follows the scroll, one card per
// section with an on/off switch, a view-only note, loading / error / no-access
// states, a sticky "You have unsaved changes" bar and the kit toast. Colours are
// the design tokens only (SettingsKit.css), so light and dark both work.
import { createElement, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { HrButton } from '@/shared/components/hr'
import { EmptyState } from '@/shared/components/EmptyState'
import { SkeletonBlock } from '@/shared/components/SkeletonCard'
import { Modal } from '@unifiedtree/ui-kit'
import { dashIcon, dashIconComponent } from '@/design/dc/icons'
import { useIsMobile } from '@/design/dc/DesignFrame'
import { ToastSlot, TOAST_MS } from '@/design/kit/Toast'
import { PageHeader } from '@/design/kit/PageHeader'
import { StatusPill } from '@/design/kit/StatusPill'
import '@/design/module/ModuleKit.css'
import './SettingsKit.css'

const FONT = "var(--u-font,'Plus Jakarta Sans',system-ui,sans-serif)"

export interface SettingsNavItem { key: string; label: string; state: 'on' | 'off' | 'soon' | 'none'; errors?: number; meta?: string }

/** The scroll container the shell uses (the page scrolls inside it, not the window). */
function scrollerOf(el: HTMLElement | null): HTMLElement | null {
  let n = el?.parentElement || null
  while (n) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; n = n.parentElement }
  return null
}

/** Toast state for a settings page (shown with the shared kit Toast): success disappears after 2.6 s, errors after 8 s. */
export function useSettingsToast() {
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; title: string; msg?: string } | null>(null)
  const t = useRef<ReturnType<typeof setTimeout>>()
  const show = useCallback((kind: 'ok' | 'error', title: string, msg?: string) => {
    clearTimeout(t.current); setToast({ kind, title, msg }); t.current = setTimeout(() => setToast(null), kind === 'error' ? 8000 : TOAST_MS.success)
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
  const dot = (s: SettingsNavItem['state']) => s === 'on' || s === 'off' || s === 'soon' ? <span aria-hidden="true" className="uks-dot" data-state={s} /> : null
  const tocItem = (t: SettingsNavItem) => {
    const on = t.key === active
    return (
      <a key={t.key} href={'#st-' + t.key} aria-current={on ? 'location' : undefined} onClick={(e) => { e.preventDefault(); jump(t.key) }} className="uks-toc__item">
        {dot(t.state)}
        <span style={{ flex: '1 1 auto', minWidth: 0 }}>{t.label}</span>
        {t.errors ? <span aria-label={`${t.errors} to fix`} className="uks-toc__errors">{t.errors}</span> : null}
        {t.meta ? <span className="uks-toc__meta">{t.meta}</span> : null}
      </a>
    )
  }
  const bar = (
    <>
      <span aria-hidden="true" className="uks-bar__dot" />
      <div style={{ flex: '1 1 200px', minWidth: 0, display: 'grid', gap: 1 }}>
        <strong className="uks-bar__title">You have unsaved changes</strong>
        {errorCount ? <button type="button" onClick={onGoToError} className="uks-bar__fix">{`Fix ${errorCount} ${errorCount === 1 ? 'error' : 'errors'} to save`}</button>
          : <span className="uks-bar__meta">{`${changeCount} ${changeCount === 1 ? 'change' : 'changes'} · not saved yet`}</span>}
      </div>
    </>
  )
  const saveBtn = <HrButton onClick={onSave} aria-busy={saving} className={narrow ? 'w-full' : undefined}>{saving ? 'Saving…' : 'Save settings'}</HrButton>
  const discardBtn = <HrButton variant="ghost" onClick={onDiscard} disabled={saving} className={narrow ? 'w-full' : undefined}>Discard</HrButton>

  return (
    <div ref={rootRef} className="uks" style={{ minWidth: 0, fontFamily: FONT, color: 'var(--u-ink,#0E1B16)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: '20px 32px', minWidth: 0 }}>
        <div style={{ flex: '0 0 100%', minWidth: 0, display: 'flex', justifyContent: 'center' }}>
          <div style={{ flex: '1 1 auto', maxWidth: 976, minWidth: 0 }}><PageHeader eyebrow={crumb} title={title} sub={subtitle} /></div>
        </div>
        {live && !narrow && nav.length > 1 && (
          <nav aria-label="On this page" className="uks-toc">
            <p className="uks-toc__head">On this page</p>
            {nav.map(tocItem)}
          </nav>
        )}
        <div style={{ flex: '1 1 480px', maxWidth: nav.length > 1 && !narrow ? 768 : 976, minWidth: 0, display: 'grid', gap: 16 }}>
          {live && narrow && nav.length > 1 && (
            <div role="navigation" aria-label="On this page" className="uks-chips">
              {nav.map((t) => (
                <button key={t.key} type="button" onClick={() => jump(t.key)} aria-current={t.key === active ? 'location' : undefined} className="uks-chip">
                  {dot(t.state)}{t.label}
                </button>
              ))}
            </div>
          )}
          {access === 'view' && status === 'live' && (
            <div role="note" className="uks-viewonly">
              <span aria-hidden="true" className="uks-viewonly__icon">{dashIcon('lock', 16)}</span>
              <div style={{ display: 'grid', gap: 2, minWidth: 0, paddingTop: 1 }}>
                <strong className="uks-viewonly__title">View only</strong>
                <p className="uks-viewonly__text">{viewOnlyText || 'You can view these settings. Ask an admin to change them.'}</p>
              </div>
            </div>
          )}
          {access !== 'none' && status === 'loading' && (
            <div role="status" aria-label={`Loading ${entity}`} style={{ display: 'grid', gap: 16 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="uks-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '18px 20px' }}>
                    <SkeletonBlock className="h-9 w-9 rounded-[11px]" />
                    <div style={{ flex: '1 1 auto', display: 'grid', gap: 8 }}><SkeletonBlock className="h-4 w-40" /><SkeletonBlock className="h-3 w-64 max-w-full" /></div>
                  </div>
                  {i < 2 && <div className="uks-card__body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(100%,180px),1fr))', gap: 16 }}>{[0, 1, 2].map((j) => <div key={j} style={{ display: 'grid', gap: 8 }}><SkeletonBlock className="h-3 w-24" /><SkeletonBlock className="h-10 w-full rounded-[11px]" /></div>)}</div>}
                </div>
              ))}
            </div>
          )}
          {access !== 'none' && status === 'error' && (
            <div className="uks-card"><EmptyState icon={dashIconComponent('alertTriangle') as any} title={`Couldn’t load ${entity}`} description="Something went wrong while loading. Nothing was changed — try again." action={onRetry ? { label: 'Try again', onClick: onRetry } : undefined} /></div>
          )}
          {access === 'none' && (
            <div className="uks-card"><EmptyState icon={dashIconComponent('lock') as any} title="Access restricted" description={noAccessText || 'These settings are only open to admins. Ask one of them if you need access.'} action={noAccessAction} /></div>
          )}
          {live && children}
          {live && dirty && !narrow && (
            <div role="region" aria-label="Unsaved changes" className="uks-bar">
              {bar}
              <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, marginLeft: 'auto' }}>{discardBtn}{saveBtn}</div>
            </div>
          )}
          {live && dirty && narrow && (
            <div role="region" aria-label="Unsaved changes" className="uks-bar uks-bar--phone">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>{bar}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 8 }}>{discardBtn}{saveBtn}</div>
            </div>
          )}
        </div>
      </div>
      {toast && (
        // useSettingsToast owns the lifetime (duration 0 = no second timer); errors sit above the unsaved-changes bar.
        <ToastSlot tone={toast.kind === 'error' ? 'error' : 'success'} message={toast.title} detail={toast.msg} duration={0}
          bottom={toast.kind === 'error' && dirty ? 132 : 24} onDone={onDismissToast} />
      )}
    </div>
  )
}

/** The design's switch (42×24, brand when on) on a 56×44 hit area. */
export function SettingsSwitch({ on, onToggle, label, disabled, title }: { on: boolean; onToggle: () => void; label: string; disabled?: boolean; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={title} onClick={disabled ? undefined : onToggle} disabled={disabled} className="uks-switch">
      <span aria-hidden="true" className="uks-switch__track"><span className="uks-switch__knob" /></span>
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
    <section id={'st-' + id} aria-labelledby={`st-${id}-h`} className="uks-card uks-sec">
      <div className="uks-sec__head">
        <span aria-hidden="true" className="uks-sec__icon" data-off={active ? undefined : ''}>{dashIcon(icon, 18)}</span>
        <div style={{ flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 3 }}>
          <h2 id={`st-${id}-h`} tabIndex={-1} className="uks-sec__title">{title}</h2>
          <p className="uks-sec__sub">{summary}</p>
        </div>
        {soon ? <StatusPill tone="neutral" className="uks-sec__pill">Coming soon</StatusPill>
          : onToggle && !readOnly ? (
            <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 2 }}>
              <span aria-hidden="true" className="uks-sec__state" data-on={on ? '' : undefined}>{on ? 'On' : 'Off'}</span>
              <SettingsSwitch on={!!on} onToggle={onToggle} label={`Turn ${title} ${on ? 'off' : 'on'}`} disabled={locked} title={locked ? 'Always on' : undefined} />
            </div>
          ) : onToggle && readOnly ? (
            <StatusPill tone={on ? 'brand' : 'neutral'} className="uks-sec__pill">{on ? 'On' : 'Off'}</StatusPill>
          ) : null}
      </div>
      {children && active && <div className="uks-card__body" style={{ display: 'grid', gap: 18 }}>{children}</div>}
    </section>
  )
}

/** The design's field grid (fields of 180px and up). */
export function SettingsGrid({ children, min = 180 }: { children: ReactNode; min?: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${min}px),1fr))`, gap: 16, alignItems: 'start' }}>{children}</div>
}

/** A labelled text input (the design's 40px field), or a read-only label/value when the viewer can't edit. */
export function SettingsInput({ label, value, onChange, readOnly, error, hint, suffix, prefix, placeholder, inputMode, mono, disabled, maxLength }: {
  label: string; value: string; onChange: (v: string) => void; readOnly?: boolean; error?: string; hint?: string; suffix?: string; prefix?: string
  placeholder?: string; inputMode?: 'text' | 'numeric' | 'decimal'; mono?: boolean; disabled?: boolean; maxLength?: number
}) {
  const id = useId()
  if (readOnly) return <SettingsValue label={label} value={value ? `${prefix || ''}${value}${suffix ? ' ' + suffix : ''}` : '—'} />
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const input = createElement('input', {
    id, value, onChange: (e: any) => onChange(e.target.value), inputMode: inputMode || 'text', autoComplete: 'off', spellCheck: false, disabled, placeholder, maxLength,
    'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy, className: mono ? 'uks-input is-mono' : 'uks-input',
  })
  return (
    <div className="uks-field">
      <label className="uks-label" htmlFor={id}>{label}</label>
      {prefix || suffix ? (
        <span className="uks-group" data-invalid={error ? '' : undefined} data-disabled={disabled ? '' : undefined}>
          {prefix ? <span className="uks-affix">{prefix}</span> : null}
          {input}
          {suffix ? <span className="uks-affix">{suffix}</span> : null}
        </span>
      ) : input}
      {hint && !error && <p id={hintId} className="uks-hint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="uks-error">{error}</p>}
    </div>
  )
}

/** Label over value (the design's view-only rows). */
export function SettingsValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="uks-value">
      <span className="uk-kv__k">{label}</span>
      <span className="uk-kv__v">{value}</span>
    </div>
  )
}

/** The design's inline switch row ("Apply ceiling" / "Sandwich rule"). */
export function SettingsToggleRow({ label, detail, on, onToggle, readOnly, disabled }: { label: string; detail: string; on: boolean; onToggle: () => void; readOnly?: boolean; disabled?: boolean }) {
  return (
    <div className="uks-toggle">
      <div style={{ flex: '1 1 auto', minWidth: 0, display: 'grid', gap: 2 }}>
        <span className="uks-toggle__label">{label}</span>
        <span className="uks-toggle__detail">{detail}</span>
      </div>
      {readOnly ? <span className="uks-toggle__state" data-on={on ? '' : undefined}>{on ? 'On' : 'Off'}</span>
        : <SettingsSwitch on={on} onToggle={onToggle} label={label} disabled={disabled} />}
    </div>
  )
}

/** A quiet note inside a section (what a setting does, or what isn't built yet). */
export function SettingsNote({ children, tone }: { children: ReactNode; tone?: 'amber' }) {
  return <p className={`umk-note uk-tone--${tone === 'amber' ? 'warning' : 'neutral'}`}>{children}</p>
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
