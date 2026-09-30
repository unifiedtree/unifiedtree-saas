// The page frame every redesigned screen sits in (the prototype's content
// container, PgGeneric): max width 1440 for admin pages and 1320 for
// self-service and team pages (README "Page max-width"), the design's padding
// 28px clamp(16px,2.4vw,36px) 56px at every width, and the app font.
// A plain block (not the kit PageFrame's flex column), so the pages inside
// keep their own spacing.
import { useEffect, useState, type ReactNode } from 'react'

const MOBILE = '(max-width: 767px)'

export function useIsMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}

/** Self-service and team addresses get the narrower frame; everything else the admin one. */
const SELF_SERVICE = /^\/(me|team|hrms\/ess)(\/|$)/

export function DesignFrame({ children, width }: { children: ReactNode; /** Overrides the width picked from the address. */ width?: 'wide' | 'narrow' }) {
  const narrow = width ? width === 'narrow' : typeof window !== 'undefined' && SELF_SERVICE.test(window.location.pathname)
  return (
    <div data-frame={narrow ? 'narrow' : 'wide'} style={{ maxWidth: narrow ? 1320 : 1440, margin: '0 auto', padding: '28px clamp(16px,2.4vw,36px) 56px', minWidth: 0, boxSizing: 'border-box', fontFamily: "var(--u-font,'Plus Jakarta Sans',system-ui,sans-serif)" }}>
      {children}
    </div>
  )
}
