// The top bar's search button (prototype HrmsPlatform header, default look):
// a green search tile, "Search" and a hint that rolls through what the person
// can look for, and the ⌘ K keys. It only opens the search dialog — the shell
// owns the dialog and the Ctrl/⌘+K shortcut.
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useMotionAllowed, useHoverFx } from '@/design/theme/motion'
import { cx } from './displayUtil'
import './display.css'

export interface SearchPillProps {
  onOpen: () => void
  /** The rolling hint words, e.g. ["people", "payslips", "leave requests", "reports"]. Pass only what this person can search. */
  hints?: readonly string[]
  /** The word before the hints (default "Search"). */
  lead?: string
  /** Key caps; default ⌘ K on Apple devices, Ctrl K elsewhere. */
  keys?: readonly string[]
  /** Accessible name (default "Search everything"). */
  ariaLabel?: string
  className?: string
  style?: CSSProperties
}

function isApple(): boolean {
  if (typeof navigator === 'undefined') return false
  const p = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || navigator.userAgent
  return /mac|iphone|ipad|ipod/i.test(p)
}

/** Rolls the hint list one word every 2.6 s (the design's ticker). Returns the index to show. */
function useTicker(count: number, run: boolean): [number, boolean] {
  const [i, setI] = useState(0)
  const [animate, setAnimate] = useState(true)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => {
    setI(0)
    if (!run || count < 2) return
    const id = window.setInterval(() => {
      setAnimate(true)
      setI((v) => v + 1)
    }, 2600)
    return () => window.clearInterval(id)
  }, [count, run])
  // After the copy of the first word, jump back to the start without animating.
  useEffect(() => {
    if (i < count) return
    timer.current = window.setTimeout(() => {
      setAnimate(false)
      setI(0)
    }, 620)
    return () => window.clearTimeout(timer.current)
  }, [i, count])
  return [i, animate]
}

export function SearchPill({ onOpen, hints = [], lead = 'Search', keys, ariaLabel = 'Search everything', className, style }: SearchPillProps) {
  const moving = useMotionAllowed()
  const fx = useHoverFx<HTMLButtonElement>('spot')
  const words = hints.filter(Boolean)
  const [i, animate] = useTicker(words.length, moving)
  const caps = keys ?? (isApple() ? ['⌘', 'K'] : ['Ctrl', 'K'])
  const list = words.length > 1 ? [...words, words[0]] : words
  return (
    <button type="button" className={cx('uk-search', 'ufx-spot', className)} style={style} onClick={onOpen}
      aria-label={ariaLabel} aria-haspopup="dialog" aria-keyshortcuts={caps[0] === '⌘' ? 'Meta+K' : 'Control+K'} {...fx}>
      <span aria-hidden="true" className="uk-fx-spot" />
      <span className="uk-search__icon" aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3" />
        </svg>
      </span>
      <span className="uk-search__text" aria-hidden="true">
        {lead}
        {list.length > 0 && (
          <span className="uk-search__win">
            <span className="uk-search__roll" style={{ transform: `translateY(${-i * 20}px)`, transition: animate && moving ? 'transform .55s cubic-bezier(.2,.8,.2,1)' : 'none' }}>
              {list.map((w, k) => <span key={k} className="uk-search__word">{w}</span>)}
            </span>
          </span>
        )}
      </span>
      <span className="uk-search__keys" aria-hidden="true">
        {caps.map((k) => <kbd key={k} className="uk-kbd">{k}</kbd>)}
      </span>
    </button>
  )
}
