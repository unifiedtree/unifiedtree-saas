import { describe, expect, it } from 'vitest'
import { countValidRows, parseErrors } from './useBulkImport'

// ── Contract test: backend error string format ────────────────────────────────
// Backend emits errors as "Row N: message" (EmployeeBulkImportService.addError).
// If the backend changes this format, parseErrors will return rowNumber=0 for
// all errors and the error table will show "?" instead of row numbers.
// This test catches that silent breakage.
// To fix: update the regex in parseErrors AND ask backend to keep "Row N:" prefix.

describe('parseErrors', () => {
  it('parses the current backend error string format "Row N: message"', () => {
    const raw = [
      'Row 2: first_name is required',
      'Row 2: email is invalid or missing',
      'Row 4: employment_type invalid: FREELANCE',
    ]
    const parsed = parseErrors(raw)

    expect(parsed[0]).toMatchObject({ rowNumber: 2, message: 'first_name is required' })
    expect(parsed[1]).toMatchObject({ rowNumber: 2, message: 'email is invalid or missing' })
    expect(parsed[2]).toMatchObject({ rowNumber: 4, message: 'employment_type invalid: FREELANCE' })
  })

  it('returns rowNumber=0 for strings that do not match "Row N: message"', () => {
    const parsed = parseErrors(['Something went wrong without a row prefix'])
    expect(parsed[0].rowNumber).toBe(0)
  })

  it('each entry has a unique id', () => {
    const raw = ['Row 2: first_name is required', 'Row 2: email is missing']
    const parsed = parseErrors(raw)
    const ids = parsed.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('countValidRows', () => {
  it('counts unique error rows, not total error messages', () => {
    // Row 2 has two errors → counts as ONE invalid row
    const result = countValidRows({
      totalRows: 5,
      successCount: 0,
      errorCount: 3,
      errors: [
        'Row 2: first_name is required',
        'Row 2: email is invalid or missing',
        'Row 4: employment_type invalid: FREELANCE',
      ],
      committed: false,
    })
    // 2 rows have errors (rows 2 and 4), so validRows = 5 - 2 = 3
    expect(result).toBe(3)
  })

  it('returns totalRows when there are no errors', () => {
    const result = countValidRows({
      totalRows: 10,
      successCount: 0,
      errorCount: 0,
      errors: [],
      committed: false,
    })
    expect(result).toBe(10)
  })

  it('returns 0 when all rows have errors', () => {
    const result = countValidRows({
      totalRows: 2,
      successCount: 0,
      errorCount: 2,
      errors: ['Row 2: email is required', 'Row 3: email is required'],
      committed: false,
    })
    expect(result).toBe(0)
  })
})
