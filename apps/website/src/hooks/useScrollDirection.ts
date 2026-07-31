import { useEffect, useRef, useState } from 'react'

/**
 * Hide-on-scroll-down / show-on-tiny-scroll-up.
 *
 * Replaces the earlier "shrink header on scroll" pattern the client explicitly
 * rejected in favour of the WhatsApp / iOS Safari behaviour: the header slides
 * OFF as the reader scrolls down, and comes back the moment they scroll up.
 * Even a small upward flick (`upThreshold`) reveals it — matches the client's
 * words "when user scrolls just little up then header should show".
 *
 * Notes:
 * - `revealOffset` is the near-top zone (default 80 px). Inside it the header
 *   is always visible, so anchor jumps that land near the top don't leave the
 *   header stuck hidden.
 * - Uses rAF to coalesce scroll bursts on touch devices; passive listener so
 *   we never block the scroll thread.
 * - `disabled: true` short-circuits and forces visible. Pass this when a
 *   modal / mobile drawer is open so the header doesn't vanish under the
 *   overlay while the user still expects to see the close button.
 */
export function useScrollDirection(opts?: {
  upThreshold?: number
  revealOffset?: number
  disabled?: boolean
}) {
  const upThreshold = opts?.upThreshold ?? 6
  const revealOffset = opts?.revealOffset ?? 80
  const disabled = opts?.disabled ?? false

  const [hidden, setHidden] = useState(false)
  const lastY = useRef(typeof window !== 'undefined' ? window.scrollY : 0)
  const ticking = useRef(false)

  useEffect(() => {
    if (disabled) {
      setHidden(false)
      return
    }

    const update = () => {
      const y = window.scrollY
      const dy = y - lastY.current

      if (y <= revealOffset) {
        setHidden(false)
      } else if (dy > 0) {
        setHidden(true)
      } else if (-dy > upThreshold) {
        setHidden(false)
      }

      lastY.current = y
      ticking.current = false
    }

    const onScroll = () => {
      if (!ticking.current) {
        window.requestAnimationFrame(update)
        ticking.current = true
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [disabled, upThreshold, revealOffset])

  return { hidden }
}
