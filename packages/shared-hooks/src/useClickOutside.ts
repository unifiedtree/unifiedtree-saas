import { useEffect, RefObject } from 'react'

export function useClickOutside<T extends HTMLElement>(ref: RefObject<T>, handler: () => void): void {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) handler()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}
