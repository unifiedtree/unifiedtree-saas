/**
 * Group an array of objects by a key
 */
export function groupBy<T>(array: T[], key: keyof T): Record<string, T[]> {
  return array.reduce<Record<string, T[]>>((acc, item) => {
    const groupKey = String(item[key])
    if (!acc[groupKey]) acc[groupKey] = []
    acc[groupKey].push(item)
    return acc
  }, {})
}

/**
 * Sort an array of objects by a key
 */
export function sortBy<T>(array: T[], key: keyof T, order: 'asc' | 'desc' = 'asc'): T[] {
  return [...array].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av === bv) return 0
    const direction = order === 'asc' ? 1 : -1
    if (av === null || av === undefined) return direction
    if (bv === null || bv === undefined) return -direction
    return av < bv ? -direction : direction
  })
}

/**
 * Paginate an array
 */
export function paginate<T>(
  array: T[],
  page: number,
  pageSize: number
): { items: T[]; totalPages: number; total: number } {
  const total = array.length
  const totalPages = Math.ceil(total / pageSize)
  const start = (page - 1) * pageSize
  const items = array.slice(start, start + pageSize)
  return { items, totalPages, total }
}

/**
 * Return unique items from an array, optionally by a key
 */
export function unique<T>(array: T[], key?: keyof T): T[] {
  if (!key) {
    return [...new Set(array)]
  }
  const seen = new Set<unknown>()
  return array.filter((item) => {
    const k = item[key]
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Split an array into chunks of a given size
 */
export function chunk<T>(array: T[], size: number): T[][] {
  if (size <= 0) return [array]
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

/**
 * Flat-map an array
 */
export function flatMap<T, R>(array: T[], fn: (item: T) => R[]): R[] {
  return array.reduce<R[]>((acc, item) => [...acc, ...fn(item)], [])
}

/**
 * Sum an array of numbers
 */
export function sum(array: number[]): number {
  return array.reduce((acc, n) => acc + n, 0)
}

/**
 * Average of an array of numbers
 */
export function average(array: number[]): number {
  if (array.length === 0) return 0
  return sum(array) / array.length
}

/**
 * Find the item with the minimum value for a key
 */
export function min<T>(array: T[], key: keyof T): T | undefined {
  if (array.length === 0) return undefined
  return array.reduce((acc, item) => (item[key] < acc[key] ? item : acc))
}

/**
 * Find the item with the maximum value for a key
 */
export function max<T>(array: T[], key: keyof T): T | undefined {
  if (array.length === 0) return undefined
  return array.reduce((acc, item) => (item[key] > acc[key] ? item : acc))
}

/**
 * Get the first element of an array (undefined-safe)
 */
export function first<T>(array: T[]): T | undefined {
  return array[0]
}

/**
 * Get the last element of an array (undefined-safe)
 */
export function last<T>(array: T[]): T | undefined {
  return array[array.length - 1]
}

/**
 * Generate a range of numbers
 */
export function range(start: number, end: number, step = 1): number[] {
  const result: number[] = []
  if (step <= 0) return result
  for (let i = start; i < end; i += step) {
    result.push(i)
  }
  return result
}

/**
 * Zip two arrays together into an array of tuples
 */
export function zip<A, B>(a: A[], b: B[]): [A, B][] {
  const len = Math.min(a.length, b.length)
  return Array.from({ length: len }, (_, i) => [a[i], b[i]])
}

/**
 * Toggle an element in an array (add if absent, remove if present)
 */
export function toggle<T>(array: T[], item: T): T[] {
  const idx = array.indexOf(item)
  if (idx === -1) return [...array, item]
  return [...array.slice(0, idx), ...array.slice(idx + 1)]
}

/**
 * Move an item from one index to another
 */
export function move<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const result = [...array]
  const [item] = result.splice(fromIndex, 1)
  result.splice(toIndex, 0, item)
  return result
}
