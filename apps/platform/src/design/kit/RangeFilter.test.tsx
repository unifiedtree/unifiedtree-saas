// The start / end box beside a list's filters (RangeFilter.tsx). Rendered as markup (no DOM test environment): the
// box itself; the calendar in its popover is DateRangeBody (DateRangePicker.test.tsx).
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RangeFilter } from './RangeFilter'

const noop = () => {}
const html = (el: JSX.Element) => renderToStaticMarkup(el)

describe('RangeFilter', () => {
  it('no range: "All dates", a dialog button named for screen readers', () => {
    const s = html(<RangeFilter value={null} onChange={noop} today="2026-10-07" />)
    expect(s).toContain('All dates')
    expect(s).toContain('aria-haspopup="dialog"')
    expect(s).toContain('aria-label="Dates: All dates. Choose dates"')
    expect(s).toContain('data-filter="dates"')
    expect(s).not.toContain('is-on')
  })
  it('a range: both ends as DD/MM/YYYY, tinted as an active filter', () => {
    const s = html(<RangeFilter value={{ from: '2026-10-01', to: '2026-10-07' }} onChange={noop} label="Report dates" filterKey="report-dates" today="2026-10-07" />)
    expect(s).toContain('01/10/2026 – 07/10/2026')
    expect(s).toContain('urf-box urf-sm is-on')
    expect(s).toContain('aria-label="Report dates: 1 Oct – 7 Oct 2026. Change the dates"')
    expect(s).toContain('data-filter="report-dates"')
  })
  it('the closed box has no calendar in the page', () => {
    expect(html(<RangeFilter value={null} onChange={noop} />)).not.toContain('udr-grid')
  })
})
