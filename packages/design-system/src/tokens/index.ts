export const colors = {
  brand: {
    50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe',
    300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1',
    600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81',
  },
  success: { 50: '#f0fdf4', 500: '#22c55e', 600: '#16a34a' },
  warning: { 50: '#fffbeb', 500: '#f59e0b', 600: '#d97706' },
  error: { 50: '#fef2f2', 500: '#ef4444', 600: '#dc2626' },
  info: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb' },
  dark: {
    bg: '#0A0F1E', card: '#111827', sidebar: '#0D1421',
    border: 'rgba(148,163,184,0.08)', borderActive: 'rgba(99,102,241,0.3)',
  },
} as const

export const spacing = {
  xs: '0.25rem', sm: '0.5rem', md: '1rem',
  lg: '1.5rem', xl: '2rem', '2xl': '3rem', '3xl': '4rem',
} as const

export const borderRadius = {
  sm: '0.375rem', md: '0.5rem', lg: '0.75rem',
  xl: '1rem', '2xl': '1.5rem', full: '9999px',
} as const

export const fontSize = {
  xs: '0.75rem', sm: '0.875rem', base: '1rem',
  lg: '1.125rem', xl: '1.25rem', '2xl': '1.5rem',
  '3xl': '1.875rem', '4xl': '2.25rem', '5xl': '3rem',
} as const

export const fontWeight = {
  normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800,
} as const

export const shadows = {
  sm: '0 1px 2px 0 rgba(0,0,0,0.3)',
  md: '0 4px 6px -1px rgba(0,0,0,0.4)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.4)',
  xl: '0 20px 25px -5px rgba(0,0,0,0.4)',
  brand: '0 4px 20px rgba(99,102,241,0.25)',
  brandLg: '0 8px 40px rgba(99,102,241,0.35)',
} as const

export const zIndex = {
  dropdown: 10, sticky: 20, fixed: 30, modal: 50, toast: 100, tooltip: 200,
} as const

export const breakpoints = {
  sm: '640px', md: '768px', lg: '1024px', xl: '1280px', '2xl': '1536px',
} as const
