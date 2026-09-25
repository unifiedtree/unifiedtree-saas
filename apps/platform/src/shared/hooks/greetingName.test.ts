import { describe, expect, it } from 'vitest'
import { greetingName } from './greetingName'

describe('greetingName', () => {
  it('shows the first name when it has two letters or more', () => {
    expect(greetingName('Admin', 'User')).toBe('Admin')
    expect(greetingName('Al', 'Kumar')).toBe('Al')
    expect(greetingName('  Reader ', 'User')).toBe('Reader')
  })

  it('shows the full name when the first name has fewer than two letters', () => {
    expect(greetingName('S', 'Kumar')).toBe('S Kumar')
    expect(greetingName('S.', 'Kumar')).toBe('S. Kumar')
    expect(greetingName(' S. ', ' Kumar ')).toBe('S. Kumar')
  })

  it('counts letters only, not dots or spaces', () => {
    expect(greetingName('S. .', 'Kumar')).toBe('S. . Kumar')
    expect(greetingName('A.B.', 'Rao')).toBe('A.B.')
  })

  it('uses whatever name there is when the full name is short too', () => {
    expect(greetingName('S', null)).toBe('S')
    expect(greetingName('', 'Kumar')).toBe('Kumar')
  })

  it('returns undefined when there is no name, so the caller keeps its fallback', () => {
    expect(greetingName(undefined, undefined)).toBeUndefined()
    expect(greetingName('', '')).toBeUndefined()
    expect(greetingName('  ', null)).toBeUndefined()
  })
})
