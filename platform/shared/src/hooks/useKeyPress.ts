import { useEffect } from 'react'

interface KeyPressOptions {
  ctrlKey?: boolean
  metaKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
}

/**
 * Listen for a specific key press with optional modifier keys.
 * @example useKeyPress('k', openSearch, { metaKey: true })
 */
export function useKeyPress(
  key: string,
  handler: () => void,
  options: KeyPressOptions = {}
): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== key) return
      if (options.ctrlKey && !event.ctrlKey) return
      if (options.metaKey && !event.metaKey) return
      if (options.shiftKey && !event.shiftKey) return
      if (options.altKey && !event.altKey) return

      event.preventDefault()
      handler()
    }

    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [key, handler, options.ctrlKey, options.metaKey, options.shiftKey, options.altKey])
}
