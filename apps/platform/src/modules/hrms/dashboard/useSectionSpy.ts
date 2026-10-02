// The dashboard's section pills (in the page, stuck under the top bar) follow the scroll (prototype PgDashboard:
// spy / jump). The page scrolls inside the shell's #workspace-content (the window when shown outside the shell).
// A pill click scrolls to its section and keeps the pill lit while the smooth scroll runs; the section's name
// goes into the URL hash (#people), so a link or a refresh opens on it once the sections above have loaded.
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { DashSection } from './dashboardModel'

const OFFSET = 90

function scrollerOf(root: HTMLElement | null): HTMLElement | null {
  return (root?.closest('#workspace-content') as HTMLElement | null) ?? null
}

export function useSectionSpy(rootRef: RefObject<HTMLElement | null>, keys: readonly DashSection[], ready: boolean) {
  const [active, setActive] = useState<DashSection>('overview')
  const lock = useRef(0)
  const keyStr = keys.join(',')

  const view = useCallback(() => {
    const sc = scrollerOf(rootRef.current)
    return sc
      ? { top: sc.getBoundingClientRect().top, y: sc.scrollTop, h: sc.clientHeight, H: sc.scrollHeight, sc }
      : { top: 0, y: window.scrollY, h: window.innerHeight, H: document.documentElement.scrollHeight, sc: null }
  }, [rootRef])

  const spy = useCallback(() => {
    const root = rootRef.current
    if (!root || performance.now() < lock.current) return
    const secs = Array.from(root.querySelectorAll<HTMLElement>('[data-sec]'))
    if (!secs.length) return
    const v = view()
    let cur = secs[0].dataset.sec as DashSection
    for (const el of secs) if (el.getBoundingClientRect().top - v.top <= OFFSET) cur = el.dataset.sec as DashSection
    if (v.y > 0 && v.y + v.h >= v.H - 4) cur = secs[secs.length - 1].dataset.sec as DashSection
    setActive(cur)
  }, [rootRef, view])

  useEffect(() => {
    const sc = scrollerOf(rootRef.current)
    const tgt: HTMLElement | Window = sc ?? window
    let raf = 0
    const on = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; spy() }) }
    tgt.addEventListener('scroll', on, { passive: true })
    return () => { tgt.removeEventListener('scroll', on); if (raf) cancelAnimationFrame(raf) }
  }, [rootRef, spy, keyStr])

  const jump = useCallback((key: DashSection, smooth = true) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-sec="${key}"]`)
    setActive(key)
    lock.current = performance.now() + 1000
    try { window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}${key === 'overview' ? '' : '#' + key}`) } catch { /* ignore */ }
    if (!el) return
    const v = view()
    // The section pills stay stuck at the top of the page while it scrolls: land the section just under them.
    const bar = rootRef.current?.querySelector<HTMLElement>('[data-dash-nav]')?.offsetHeight ?? 0
    const y = key === 'overview' ? 0 : Math.max(0, el.getBoundingClientRect().top - v.top + v.y - 18 - bar)
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ;(v.sc ?? window).scrollTo({ top: y, behavior: smooth && !reduce ? 'smooth' : 'auto' })
  }, [rootRef, view])

  // A #section in the URL: go there once the page's data has loaded (so the sections above have their height).
  const done = useRef(false)
  useEffect(() => {
    if (done.current || !ready) return
    const h = window.location.hash.slice(1) as DashSection
    if (!h || !keys.includes(h)) { done.current = true; return }
    done.current = true
    const t = window.setTimeout(() => jump(h, false), 60)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, keyStr, jump])

  return { active, jump }
}
