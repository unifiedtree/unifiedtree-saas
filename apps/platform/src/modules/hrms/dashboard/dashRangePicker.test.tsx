// The dashboard's plain start / end picker (owner decision, 6 Oct 2026): a calendar, six quick picks and
// Apply / Cancel; no stats panel, no attendance legend, no days after today. The date chip says the period.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { offDaysFromIso, type WorkCalendar } from '@/design/kit/dateRangeModel'
import { DashRangeBody, DateChipButton, RangeBanner } from './OverviewBlocks'
import { dashboardPresets } from './dashboardRange'

const TODAY = '2026-10-06'
const CAL: WorkCalendar = { off: offDaysFromIso([7]), holidays: new Map([['2026-10-02', 'Gandhi Jayanti']]) }
const noop = () => {}
const html = (el: JSX.Element) => renderToStaticMarkup(el)
const dayButton = (s: string, iso: string) => new RegExp(`<button[^>]*data-day="${iso}"[^>]*>`).exec(s)?.[0] ?? ''

describe('the dashboard date picker', () => {
  it('is a plain calendar: start and end, six quick picks, Apply and Cancel', () => {
    const s = html(<DashRangeBody sel={TODAY} from={null} today={TODAY} calendar={CAL} presets={dashboardPresets(TODAY)} onApply={noop} onCancel={noop} />)
    for (const t of ['Start date', 'End date', 'October 2026', 'Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Apply', 'Cancel']) {
      expect(s).toContain(t)
    }
    // Nothing of the old panel: no day's stats, no attendance legend, no "Last working day".
    for (const t of ['Selected day', 'Last working day', 'attendance', 'Attendance ≥90', 'Late', 'Absent', 'On leave']) {
      expect(s).not.toContain(t)
    }
    expect(s).not.toContain('udr-legend')
  })

  it('one day is selected as both ends; days after today are disabled', () => {
    const s = html(<DashRangeBody sel="2026-10-02" from={null} today={TODAY} calendar={CAL} presets={dashboardPresets(TODAY)} onApply={noop} onCancel={noop} />)
    expect(s).toContain('1 day · 2 Oct')
    expect(dayButton(s, '2026-10-07')).toContain('disabled=""')
    expect(dayButton(s, TODAY)).not.toContain('disabled=""')
    expect(dayButton(s, '2026-10-02')).toContain('aria-pressed="true"')
  })

  it('a range shows its days and its period, with its quick pick pressed', () => {
    const s = html(<DashRangeBody sel={TODAY} from="2026-10-01" today={TODAY} calendar={CAL} presets={dashboardPresets(TODAY)} onApply={noop} onCancel={noop} />)
    expect(s).toContain('01/10/2026')
    expect(s).toContain('06/10/2026')
    expect(s).toContain('6 days · 1–6 Oct')
    expect(s).toMatch(/aria-pressed="true"[^>]*>This month<\/button>/)
    expect(s.match(/class="udr-cell in-band/g)?.length).toBe(6)
  })
})

describe('the date chip', () => {
  it('today, a past day and a range', () => {
    const today = html(<DateChipButton sel={TODAY} from={null} today={TODAY} daily={{}} holidays={[]} onApply={noop} />)
    expect(today).toContain('Today')
    expect(today).toContain('Tuesday, 6 October 2026')
    expect(today).toContain('change the dashboard date')
    const past = html(<DateChipButton sel="2026-10-02" from={null} today={TODAY} daily={{}} holidays={[]} onApply={noop} />)
    expect(past).toContain('Viewing')
    const range = html(<DateChipButton sel={TODAY} from="2026-10-01" today={TODAY} daily={{}} holidays={[]} onApply={noop} />)
    expect(range).toContain('Period')
    expect(range).toContain('1 Oct – 6 Oct 2026')
    expect(range).toContain('aria-label="Viewing 1–6 Oct · change the dashboard dates"')
  })
})

describe('the period banner', () => {
  it('says what the cards add up and what the rest of the page shows', () => {
    const s = html(<RangeBanner from="2026-10-01" to={TODAY} today={TODAY} onBack={noop} />)
    expect(s).toContain('1–6 Oct')
    expect(s).toContain('6 days')
    expect(s).toContain('headcount on today')
    expect(s).toContain('Back to today')
    const past = html(<RangeBanner from="2026-09-01" to="2026-09-30" today={TODAY} onBack={noop} />)
    expect(past).toContain('Wed, 30 Sep 2026')
  })
})
