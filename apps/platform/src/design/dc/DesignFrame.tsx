// The page frame every redesigned screen sits in (the prototype's content
// container): 1320px max width, Inter body text, and the design's desktop /
// mobile padding.
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

export function DesignFrame({ children }: { children: ReactNode }) {
  const mobile = useIsMobile()
  return (
    <div style={{ maxWidth: '1320px', margin: '0 auto', padding: mobile ? '16px 16px 40px' : '24px clamp(16px,2.5vw,28px) 48px', minWidth: 0, boxSizing: 'border-box', fontFamily: 'Inter,-apple-system,sans-serif' }}>
      {children}
    </div>
  )
}
