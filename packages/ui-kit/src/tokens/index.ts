export { colors } from './colors'
export type { ColorToken } from './colors'

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
} as const

export const borderRadius = {
  sm: '0.5rem',
  md: '0.75rem',
  lg: '1rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  full: '9999px',
} as const

export const fontSize = {
  xs: '0.75rem',
  sm: '0.875rem',
  base: '1rem',
  lg: '1.125rem',
  xl: '1.25rem',
  '2xl': '1.5rem',
  '3xl': '1.875rem',
  '4xl': '2.25rem',
} as const

export const fontWeight = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
  extrabold: 800,
} as const

export const shadows = {
  sm: '0 1px 2px 0 rgba(0,0,0,0.4)',
  md: '0 4px 6px -1px rgba(0,0,0,0.5)',
  lg: '0 10px 15px -3px rgba(0,0,0,0.5)',
  glow: '0 0 20px rgba(99,102,241,0.3)',
} as const

export type SpacingToken = typeof spacing
export type BorderRadiusToken = typeof borderRadius
export type FontSizeToken = typeof fontSize
export type FontWeightToken = typeof fontWeight
export type ShadowToken = typeof shadows
