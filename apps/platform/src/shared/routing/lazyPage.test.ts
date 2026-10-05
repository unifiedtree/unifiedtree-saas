import { describe, expect, it } from 'vitest'
import { isStaleChunkError } from './lazyPage'

describe('a page whose code is gone after a deploy', () => {
  it('is recognised in each browser’s words', () => {
    expect(isStaleChunkError(new TypeError('Failed to fetch dynamically imported module: https://demo-hrms.unifiedtree.com/assets/Modules-BZP24mPO.js'))).toBe(true) // Chrome, Edge
    expect(isStaleChunkError(new TypeError('error loading dynamically imported module: https://x/assets/EmployeeDetail-1.js'))).toBe(true) // Firefox
    expect(isStaleChunkError(new TypeError('Importing a module script failed.'))).toBe(true) // Safari
    expect(isStaleChunkError(new Error('Unable to preload CSS for /assets/EmployeeDetail-1.css'))).toBe(true) // Vite's preload
  })

  it('is not any other error', () => {
    expect(isStaleChunkError(new TypeError("Cannot read properties of null (reading 'charAt')"))).toBe(false)
    expect(isStaleChunkError(null)).toBe(false)
    expect(isStaleChunkError(undefined)).toBe(false)
  })
})
