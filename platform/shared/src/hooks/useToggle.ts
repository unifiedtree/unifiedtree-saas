import { useState, useCallback, Dispatch, SetStateAction } from 'react'

export function useToggle(
  initialState: boolean = false
): [boolean, () => void, Dispatch<SetStateAction<boolean>>] {
  const [state, setState] = useState(initialState)
  const toggle = useCallback(() => setState((s) => !s), [])
  return [state, toggle, setState]
}
