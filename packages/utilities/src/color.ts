/**
 * Generate a consistent color gradient string from a string (e.g., for avatars)
 */
const GRADIENT_PALETTE = [
  'from-indigo-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-emerald-500 to-teal-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-violet-500 to-purple-600',
  'from-teal-500 to-cyan-600',
  'from-orange-500 to-red-600',
  'from-blue-500 to-indigo-600',
  'from-green-500 to-emerald-600',
]

const HEX_PALETTE = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#14b8a6', '#f97316',
  '#3b82f6', '#22c55e',
]

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
    hash |= 0 // Convert to 32-bit int
  }
  return Math.abs(hash)
}

export function stringToColor(str: string): string {
  return HEX_PALETTE[hashString(str) % HEX_PALETTE.length]
}

export function stringToGradient(str: string): string {
  return GRADIENT_PALETTE[hashString(str) % GRADIENT_PALETTE.length]
}

/**
 * Get initials from a name: "John Smith" → "JS", "Alice" → "AL"
 */
export function getInitials(name: string, maxChars = 2): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, maxChars).toUpperCase()
  return parts
    .slice(0, maxChars)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

/**
 * Convert a hex color to RGB components
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean
  const num = parseInt(full, 16)
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  }
}

/**
 * Lighten a hex color by a given amount (0–1)
 */
export function lighten(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const clamp = (v: number) => Math.min(255, Math.round(v + (255 - v) * amount))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Darken a hex color by a given amount (0–1)
 */
export function darken(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex)
  const clamp = (v: number) => Math.max(0, Math.round(v * (1 - amount)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * Determine if a hex color is "light" (luminance > 0.5)
 */
export function isLight(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex)
  // Perceived luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.5
}

/**
 * Get the best contrasting text color (black or white) for a given background
 */
export function getContrastColor(bg: string): '#000' | '#fff' {
  return isLight(bg) ? '#000' : '#fff'
}

/**
 * Consistent module colors keyed by module key
 */
export const MODULE_COLORS: Record<string, string> = {
  hrms: '#6366f1',
  crm: '#06b6d4',
  accounts: '#10b981',
  projects: '#f59e0b',
  inventory: '#f97316',
  helpdesk: '#ec4899',
  analytics: '#8b5cf6',
  procurement: '#14b8a6',
}

/**
 * Get a module's color (falls back to string hash color)
 */
export function getModuleColor(moduleKey: string): string {
  return MODULE_COLORS[moduleKey] ?? stringToColor(moduleKey)
}

/**
 * Convert RGB to hex
 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * Parse an rgba() string to its components
 */
export function parseRgba(rgba: string): { r: number; g: number; b: number; a: number } | null {
  const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/)
  if (!match) return null
  return {
    r: parseInt(match[1]),
    g: parseInt(match[2]),
    b: parseInt(match[3]),
    a: match[4] !== undefined ? parseFloat(match[4]) : 1,
  }
}
