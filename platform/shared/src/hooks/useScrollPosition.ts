import { useState, useEffect, useRef } from 'react'

interface ScrollPosition {
  x: number
  y: number
  direction: 'up' | 'down' | null
  isScrolled: boolean
}

export function useScrollPosition(): ScrollPosition {
  const [position, setPosition] = useState<ScrollPosition>({
    x: 0,
    y: 0,
    direction: null,
    isScrolled: false,
  })
  const prevY = useRef(0)

  useEffect(() => {
    const handleScroll = () => {
      const x = window.scrollX
      const y = window.scrollY
      const direction: 'up' | 'down' = y > prevY.current ? 'down' : 'up'
      prevY.current = y

      setPosition({
        x,
        y,
        direction,
        isScrolled: y > 10,
      })
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return position
}
