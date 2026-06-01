// ─── Class Name Utility ───────────────────────────────────────
export { cn } from './cn'

// ─── Formatting ───────────────────────────────────────────────
export {
  formatCurrency,
  formatDate,
  formatRelativeTime,
  formatNumber,
  formatFileSize,
  formatPercentage,
  formatDuration,
  truncate,
  capitalize,
  titleCase,
  slugify,
  maskEmail,
  maskPhone,
} from './format'

// ─── Validation ───────────────────────────────────────────────
export {
  isValidEmail,
  isValidSubdomain,
  isValidPassword,
  isValidUrl,
  isValidPhone,
  isUUID,
  isEmpty,
  isValidDate,
  validatePasswordStrength,
  matchesPattern,
  isInRange,
} from './validate'
export type { PasswordValidationResult, PasswordStrength } from './validate'

// ─── Array Utilities ──────────────────────────────────────────
export {
  groupBy,
  sortBy,
  paginate,
  unique,
  chunk,
  flatMap,
  sum,
  average,
  min,
  max,
  first,
  last,
  range,
  zip,
  toggle,
  move,
} from './array'

// ─── Object Utilities ─────────────────────────────────────────
export {
  pick,
  omit,
  deepMerge,
  deepClone,
  isEqual,
  isEmpty as isEmptyObject,
  flatten,
  fromEntries,
  mapValues,
  filterValues,
  compact,
} from './object'

// ─── Tenant Utilities ─────────────────────────────────────────
export {
  getSubdomainFromUrl,
  buildWorkspaceUrl,
  isValidSubdomain as isValidTenantSubdomain,
  generateSubdomain,
  extractTenantFromHeader,
  buildApiUrl,
  parseTenantFromRequest,
} from './tenant'

// ─── Color Utilities ──────────────────────────────────────────
export {
  stringToColor,
  stringToGradient,
  getInitials,
  hexToRgb,
  rgbToHex,
  lighten,
  darken,
  isLight,
  getContrastColor,
  parseRgba,
  MODULE_COLORS,
  getModuleColor,
} from './color'

// ─── Storage ──────────────────────────────────────────────────
export {
  safeLocalStorage,
  safeSessionStorage,
  createStorageStore,
} from './storage'
