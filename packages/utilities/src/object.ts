/**
 * Pick specified keys from an object
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>
  for (const key of keys) {
    if (key in obj) result[key] = obj[key]
  }
  return result
}

/**
 * Omit specified keys from an object
 */
export function omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const result = { ...obj }
  for (const key of keys) {
    delete result[key]
  }
  return result as Omit<T, K>
}

/**
 * Deeply merge source into target (shallow-merge at each level)
 */
export function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target }
  for (const key in source) {
    const sourceVal = source[key]
    const targetVal = result[key]
    if (
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal !== null &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal as object, sourceVal as object) as T[Extract<keyof T, string>]
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[Extract<keyof T, string>]
    }
  }
  return result
}

/**
 * Deep clone an object (JSON-safe, no undefined/function/Date precision loss warning)
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return (obj as unknown[]).map(deepClone) as unknown as T
  return Object.fromEntries(
    Object.entries(obj as object).map(([k, v]) => [k, deepClone(v)])
  ) as T
}

/**
 * Structural equality check (JSON-safe)
 */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object' || a === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const entriesA = Object.entries(a as object)
  const entriesB = Object.entries(b as object)
  if (entriesA.length !== entriesB.length) return false
  return entriesA.every(([k, v]) => isEqual(v, (b as Record<string, unknown>)[k]))
}

/**
 * Check if an object has no own enumerable properties
 */
export function isEmpty(obj: object): boolean {
  return Object.keys(obj).length === 0
}

/**
 * Flatten a nested object to dot-notation keys
 * { a: { b: 1 } } → { 'a.b': 1 }
 */
export function flatten(
  obj: object,
  prefix = '',
  result: Record<string, unknown> = {}
): Record<string, unknown> {
  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as object, newKey, result)
    } else {
      result[newKey] = value
    }
  }
  return result
}

/**
 * Create an object from an array of [key, value] pairs
 */
export function fromEntries<T>(entries: [string, T][]): Record<string, T> {
  return Object.fromEntries(entries)
}

/**
 * Transform values of an object using a mapping function
 */
export function mapValues<T, R>(
  obj: Record<string, T>,
  fn: (val: T, key: string) => R
): Record<string, R> {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fn(v, k)]))
}

/**
 * Filter entries in an object by predicate
 */
export function filterValues<T>(
  obj: Record<string, T>,
  fn: (val: T, key: string) => boolean
): Record<string, T> {
  return Object.fromEntries(Object.entries(obj).filter(([k, v]) => fn(v, k)))
}

/**
 * Remove undefined/null values from an object (one level deep)
 */
export function compact<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)
  ) as Partial<T>
}
