import { describe, expect, it } from 'vitest'
import { greetingName } from './greetingName'

describe('greetingName', () => {
  it('shows the full name: first and last name', () => {
    expect(greetingName('Admin', 'User')).toBe('Admin User')
    expect(greetingName('Al', 'Kumar')).toBe('Al Kumar')
    expect(greetingName('Priya', 'Sharma')).toBe('Priya Sharma')
  })

  it('trims spaces around each part', () => {
    expect(greetingName('  Reader ', 'User')).toBe('Reader User')
    expect(greetingName(' S. ', ' Kumar ')).toBe('S. Kumar')
  })

  it('keeps a short or initial first name as it is, with the last name', () => {
    expect(greetingName('S', 'Kumar')).toBe('S Kumar')
    expect(greetingName('S.', 'Kumar')).toBe('S. Kumar')
    expect(greetingName('A.B.', 'Rao')).toBe('A.B. Rao')
  })

  it('uses whatever name there is when one part is missing', () => {
    expect(greetingName('Reader', null)).toBe('Reader')
    expect(greetingName('S', undefined)).toBe('S')
    expect(greetingName('', 'Kumar')).toBe('Kumar')
    expect(greetingName('   ', 'Kumar')).toBe('Kumar')
  })

  it('returns undefined when there is no name, so the caller keeps its fallback', () => {
    expect(greetingName(undefined, undefined)).toBeUndefined()
    expect(greetingName('', '')).toBeUndefined()
    expect(greetingName('  ', null)).toBeUndefined()
  })
})
