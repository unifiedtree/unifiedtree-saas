import { useState, useCallback } from 'react'

interface CounterOptions {
  min?: number
  max?: number
  step?: number
}

interface UseCounterReturn {
  count: number
  increment: () => void
  decrement: () => void
  reset: () => void
  set: (value: number) => void
}

export function useCounter(
  initialValue: number = 0,
  options: CounterOptions = {}
): UseCounterReturn {
  const { min, max, step = 1 } = options
  const [count, setCount] = useState(initialValue)

  const clamp = useCallback(
    (val: number) => {
      let clamped = val
      if (min !== undefined) clamped = Math.max(min, clamped)
      if (max !== undefined) clamped = Math.min(max, clamped)
      return clamped
    },
    [min, max]
  )

  const increment = useCallback(() => setCount((c) => clamp(c + step)), [clamp, step])
  const decrement = useCallback(() => setCount((c) => clamp(c - step)), [clamp, step])
  const reset = useCallback(() => setCount(initialValue), [initialValue])
  const set = useCallback((value: number) => setCount(clamp(value)), [clamp])

  return { count, increment, decrement, reset, set }
}
