import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'

type Theme = 'dark' | 'light'

interface UseThemeReturn {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
}

function applyTheme(theme: Theme) {
  if (typeof document !== 'undefined') {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }
}

export function useTheme(): UseThemeReturn {
  const [theme, setThemeInStorage] = useLocalStorage<Theme>('erp-theme', 'dark')

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeInStorage(newTheme)
      applyTheme(newTheme)
    },
    [setThemeInStorage]
  )

  const toggleTheme = useCallback(() => {
    const newTheme: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(newTheme)
  }, [theme, setTheme])

  return { theme, toggleTheme, setTheme }
}
