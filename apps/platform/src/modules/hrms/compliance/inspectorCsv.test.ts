import { describe, expect, it } from 'vitest'
import { inspectorCsv } from './inspectorCsv'
describe('inspection CSV', () => {
  it('preserves commas and quotes while neutralizing spreadsheet formulas', () => {
    const csv = inspectorCsv([
      {
        title: '=HYPERLINK("url","name")',
        date: '2026-09-23',
        category: 'Tax, monthly',
        status: 'PENDING',
      },
    ])
    expect(csv).toContain('"\'=HYPERLINK(""url"",""name"")"')
    expect(csv).toContain('"Tax, monthly"')
    expect(csv).toContain('"2026-09-23"')
  })
  it('exports column headings for an empty month', () => {
    expect(inspectorCsv([])).toBe('Obligation / filing,Due date,Category,Status\r\n')
  })
})
