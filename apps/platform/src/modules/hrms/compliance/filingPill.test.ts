import { describe, expect, it } from 'vitest'
import { filingPill } from './filingPill'

// Audit 4 Oct: a PF filing due 15 Aug read "Due" on Statutory filings while the
// Payroll dashboard called it overdue.
describe('filingPill', () => {
  it('calls an open filing past its due date overdue', () => {
    expect(filingPill('DUE', '2026-08-15', '2026-10-04')).toEqual({ tone: 'red', label: 'Overdue' })
  })
  it('keeps an open filing due today or later as due', () => {
    expect(filingPill('DUE', '2026-10-04', '2026-10-04')).toEqual({ tone: 'warn', label: 'Due' })
    expect(filingPill('DUE', '2026-10-15', '2026-10-04')).toEqual({ tone: 'warn', label: 'Due' })
  })
  it('leaves filed returns alone, late or not', () => {
    expect(filingPill('FILED', '2026-08-15', '2026-10-04')).toEqual({ tone: 'ok', label: 'Filed' })
    expect(filingPill('LATE', '2026-08-15', '2026-10-04')).toEqual({ tone: 'red', label: 'Filed late' })
  })
})
