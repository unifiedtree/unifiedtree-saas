import { describe, expect, it } from 'vitest'
import { letterViews, resolveLetterView } from './lettersView'

const HR = { templates: true, readAll: true, readSelf: true, distribute: true }
const EMPLOYEE = { templates: false, readAll: false, readSelf: true, distribute: false }
const FINANCE = { templates: true, readAll: true, readSelf: true, distribute: false }
const NONE = { templates: false, readAll: false, readSelf: false, distribute: false }

describe('Letters hub views', () => {
  it('gives HR every view in order, with their own letters last', () => {
    expect(letterViews(HR)).toEqual(['templates', 'generated', 'distributions', 'my'])
  })
  it('gives an employee only My letters', () => {
    expect(letterViews(EMPLOYEE)).toEqual(['my'])
  })
  it('shows distributions to letter readers who cannot send them', () => {
    expect(letterViews(FINANCE)).toContain('distributions')
  })
  it('opens the view named in the old routes', () => {
    expect(resolveLetterView('templates', HR).active).toBe('templates')
    expect(resolveLetterView('generated', HR).active).toBe('generated')
    expect(resolveLetterView('distributions', HR).active).toBe('distributions')
    expect(resolveLetterView('my', HR).active).toBe('my')
  })
  it('opens the first allowed view for /hrms/letters and unknown segments', () => {
    expect(resolveLetterView(undefined, HR).active).toBe('templates')
    expect(resolveLetterView('nope', HR).active).toBe('templates')
  })
  it('sends an employee on an old Generated letters link to My letters', () => {
    expect(resolveLetterView('generated', EMPLOYEE).active).toBe('my')
    expect(resolveLetterView('templates', EMPLOYEE).active).toBe('my')
  })
  it('has no view without any letters permission', () => {
    expect(resolveLetterView('templates', NONE)).toEqual({ views: [], active: null })
  })
})
