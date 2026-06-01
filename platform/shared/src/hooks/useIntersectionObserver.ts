import { useState, useCallback, useRef } from 'react'

type RefCallback<T> = (node: T | null) => void

/**
 * Observe when an element enters/leaves the viewport.
 * Returns [refCallback, isVisible]
 * Useful for lazy loading and scroll-triggered animations.
 */
export function useIntersectionObserver(
  options?: IntersectionObserverInit
): [RefCallback<Element>, boolean] {
  const [isVisible, setIsVisible] = useState(false)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const ref = useCallback(
    (node: Element | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }

      if (!node) return

      observerRef.current = new IntersectionObserver(([entry]) => {
        setIsVisible(entry.isIntersecting)
      }, options)

      observerRef.current.observe(node)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.root, options?.rootMargin, options?.threshold]
  )

  return [ref, isVisible]
}
