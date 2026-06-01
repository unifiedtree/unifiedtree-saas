import { useState, useCallback } from 'react'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

export function useAsync<T>(asyncFn: (...args: unknown[]) => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: false, error: null })

  const execute = useCallback(
    async (...args: unknown[]) => {
      setState({ data: null, loading: true, error: null })
      try {
        const data = await asyncFn(...args)
        setState({ data, loading: false, error: null })
        return data
      } catch (error) {
        setState({ data: null, loading: false, error: error as Error })
        throw error
      }
    },
    [asyncFn]
  )

  return { ...state, execute }
}
