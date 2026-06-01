import { useState, useCallback } from 'react'

type SetValue<T> = (value: T | ((val: T) => T)) => void
type RemoveValue = () => void

export function useSessionStorage<T>(
  key: string,
  initialValue: T
): [T, SetValue<T>, RemoveValue] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.sessionStorage.getItem(key)
      return item !== null ? (JSON.parse(item) as T) : initialValue
    } catch {
      return initialValue
    }
  })

  const setValue: SetValue<T> = useCallback(
    (value) => {
      try {
        const valueToStore =
          typeof value === 'function'
            ? (value as (val: T) => T)(storedValue)
            : value
        setStoredValue(valueToStore)
        window.sessionStorage.setItem(key, JSON.stringify(valueToStore))
      } catch {
        // silently fail
      }
    },
    [key, storedValue]
  )

  const removeValue: RemoveValue = useCallback(() => {
    try {
      window.sessionStorage.removeItem(key)
      setStoredValue(initialValue)
    } catch {
      // silently fail
    }
  }, [key, initialValue])

  return [storedValue, setValue, removeValue]
}
