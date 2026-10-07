import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DateRangeBody, DateRangeButton } from './DateRangePicker'
import { offDaysFromIso, type WorkCalendar } from './dateRangeModel'

// Mon 9 Nov 2026 is Diwali; Saturday and Sunday are off; "today" is Thu 5 Nov.
const CAL: WorkCalendar = { off: offDaysFromIso([6, 7]), holidays: new Map([['2026-11-09', 'Diwali']]) }
const TODAY = '2026-11-05'
const noop = () => {}
const html = (el: JSX.Element) => renderToStaticMarkup(el)
const dayButton = (s: string, iso: string) => {
  const m = new RegExp(`<button[^>]*data-day="${iso}"[^>]*>`).exec(s)
  return m ? m[0] : ''
}

describe('DateRangeBody', () => {
  it('empty: the header, the presets, the month and the hint', () => {
    const s = html(<DateRangeBody from="" min={TODAY} calendar={CAL} today={TODAY} onDone={noop} />)
    for (const t of ['Start date', 'End date', 'November 2026', 'Today', 'Tomorrow', 'Rest of this week', 'Next week (Mon–Fri)', 'Next Monday', 'Pick the first day, then the last']) {
      expect(s).toContain(t)
    }
    // Done waits for a day.
    expect(s).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Done/)
    // No half-day switch unless the form has half days.
    expect(s).not.toContain('role="switch"')
  })

  it('marks past days, today, weekly offs and holidays', () => {
    const s = html(<DateRangeBody from="" min={TODAY} calendar={CAL} today={TODAY} onDone={noop} />)
    expect(dayButton(s, '2026-11-04')).toContain('disabled=""')
    expect(dayButton(s, '2026-11-05')).toContain('is-today')
    expect(dayButton(s, '2026-11-05')).toContain('aria-label="Thu, 05/11/2026, today"')
    expect(dayButton(s, '2026-11-07')).toContain('is-off')
    expect(dayButton(s, '2026-11-07')).toContain('weekly off')
    expect(dayButton(s, '2026-11-09')).toContain('title="Diwali"')
    expect(dayButton(s, '2026-11-09')).toContain('holiday, Diwali')
    expect(s).toContain('class="udr-dot"')
  })

  it('a range: start · span · end, the band, and the working days in the footer', () => {
    // Fri 6 – Tue 10 Nov: Sat, Sun off and Mon Diwali, so 2 working days of 5.
    const s = html(<DateRangeBody from="2026-11-06" to="2026-11-10" min={TODAY} calendar={CAL} today={TODAY} onDone={noop} noun="leave" />)
    expect(s).toContain('06/11/2026')
    expect(s).toContain('10/11/2026')
    expect(s).toContain('5 days')
    expect(s).toContain('Your leave is for 2 working days')
    expect(s.match(/class="udr-cell in-band/g)?.length).toBe(5)
    expect(dayButton(s, '2026-11-06')).toContain('aria-pressed="true"')
  })

  it('the server’s count wins over the local one', () => {
    const s = html(<DateRangeBody from="2026-11-06" to="2026-11-10" calendar={CAL} today={TODAY} serverDays={3} onDone={noop} />)
    expect(s).toContain('Your request is for 3 working days')
  })

  it('half day: the switch, one day, 0.5 working day', () => {
    const s = html(<DateRangeBody from="2026-11-10" to="2026-11-12" calendar={CAL} today={TODAY} halfDay onDone={noop} />)
    expect(s).toContain('role="switch"')
    expect(s).toContain('Half day')
    expect(s).toContain('Your request is for 0.5 working day')
  })

  it('all weekly offs and holidays says so', () => {
    const s = html(<DateRangeBody from="2026-11-07" to="2026-11-09" calendar={CAL} today={TODAY} onDone={noop} />)
    expect(s).toContain('These days are all weekly offs or holidays')
  })

  it('single date: one-day presets only, and the footer names the day', () => {
    const s = html(<DateRangeBody mode="single" from="2026-11-09" calendar={CAL} today={TODAY} min="2026-09-06" max="2026-12-05" onDone={noop} />)
    expect(s).toContain('Selected date: Mon, 09/11/2026')
    expect(s).not.toContain('Rest of this week')
    expect(s).not.toContain('End date')
  })

  it('presets outside the form’s limits are disabled', () => {
    const s = html(<DateRangeBody from="" calendar={CAL} today={TODAY} min={TODAY} max="2026-11-06" onDone={noop} />)
    expect(s).toMatch(/<button[^>]*disabled=""[^>]*>Next Monday<\/button>/)
    expect(s).toMatch(/<button[^>]*aria-pressed="false"[^>]*>Today<\/button>/)
  })
})

describe('DateRangeBody for a calendar that only shows dates', () => {
  it('no legend, Cancel beside the renamed Done', () => {
    const s = html(<DateRangeBody from="2026-11-02" to="2026-11-05" calendar={CAL} today={TODAY} legend={false} doneLabel="Apply" onCancel={noop} onDone={noop} />)
    expect(s).not.toContain('udr-legend')
    expect(s).toMatch(/>Cancel<\/span>|>Cancel</)
    expect(s).toContain('Apply')
    expect(s).not.toContain('>Done<')
  })
  it('keeps the legend and Done by default', () => {
    const s = html(<DateRangeBody from="" calendar={CAL} today={TODAY} onDone={noop} />)
    expect(s).toContain('udr-legend')
    expect(s).not.toContain('Cancel')
  })
  it('maxSpan leaves the days in reach of a settled range alone', () => {
    // Both ends picked: the next tap starts a new range, so nothing is limited.
    const s = html(<DateRangeBody from="2026-11-02" to="2026-11-03" calendar={CAL} today={TODAY} maxSpan={3} onDone={noop} />)
    expect(dayButton(s, '2026-11-30')).not.toContain('disabled=""')
  })
})

describe('DateRangeButton', () => {
  it('shows both ends as DD/MM/YYYY with their labels', () => {
    const s = html(<DateRangeButton from="2026-11-06" to="2026-11-10" startLabel="From *" endLabel="To *" onOpen={noop} />)
    expect(s).toContain('From *')
    expect(s).toContain('06/11/2026')
    expect(s).toContain('10/11/2026')
    expect(s).toContain('aria-label="From: Fri, 06/11/2026"')
    expect(s).toContain('aria-haspopup="dialog"')
  })
  it('empty shows the placeholder; a half day greys the end', () => {
    const s = html(<DateRangeButton from="" startLabel="From *" endLabel="To *" endDisabled onOpen={noop} />)
    expect(s).toContain('DD/MM/YYYY')
    expect(s).toContain('aria-label="To: not picked"')
    expect(s.match(/disabled=""/g)?.length).toBe(1)
  })
})

// 7 Oct 2026: a real calendar everywhere: the month title jumps to a month or a year, Clear, and the longest range
// said in plain words instead of days quietly disabled.
describe('DateRangeBody: jumping months and years, Clear, the longest range', () => {
  const OCT = '2026-10-07'
  it('the month title is a button that opens the month grid', () => {
    const s = html(<DateRangeBody from="" calendar={CAL} today={OCT} legend={false} onDone={noop} />)
    expect(s).toMatch(/<button[^>]*class="udr-month-t udr-title"[^>]*aria-label="October 2026, choose a month"/)
  })
  it('the month grid: the year’s 12 months, this one marked, months past the limit disabled; the year title opens the years', () => {
    const s = html(<DateRangeBody from="" calendar={CAL} today={OCT} max={OCT} legend={false} initialView="months" onDone={noop} />)
    for (const m of ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) expect(s).toContain(`>${m}</button>`)
    expect(s).toMatch(/data-month="2026-10"[^>]*class="udr-mcell is-today"/)
    expect(s).toMatch(/<button[^>]*data-month="2026-11"[^>]*disabled=""/)
    expect(s).not.toMatch(/<button[^>]*data-month="2026-09"[^>]*disabled=""/)
    expect(s).toContain('aria-label="2026, choose a year"')
    expect(s).toMatch(/aria-label="Next year" disabled=""/)
    // The days aren't drawn while the months are.
    expect(s).not.toContain('data-day=')
  })
  it('the year grid: 12 years, the year after the limit disabled', () => {
    const s = html(<DateRangeBody from="" calendar={CAL} today={OCT} max={OCT} legend={false} initialView="years" onDone={noop} />)
    expect(s).toContain('2016 – 2027')
    expect(s).toMatch(/<button[^>]*data-year="2027"[^>]*disabled=""/)
    expect(s).toMatch(/data-year="2026"[^>]*tabindex="0"/)
  })
  it('a picked range marks its months on the month grid', () => {
    const s = html(<DateRangeBody from="2026-08-20" to="2026-10-02" calendar={CAL} today={OCT} legend={false} initialView="months" onDone={noop} />)
    expect(s.match(/class="udr-mcell is-on/g)?.length).toBe(3)
  })
  it('Clear only when asked for; disabled with nothing picked unless the page clears its own filter', () => {
    expect(html(<DateRangeBody from="" calendar={CAL} today={OCT} onDone={noop} />)).not.toContain('udr-clear')
    expect(html(<DateRangeBody from="" calendar={CAL} today={OCT} clearable onDone={noop} />)).toMatch(/class="udr-clear" disabled=""/)
    expect(html(<DateRangeBody from="" calendar={CAL} today={OCT} onClear={noop} onDone={noop} />)).toMatch(/class="udr-clear">Clear/)
  })
  it('a range longer than the page allows: every day stays clickable, a plain message, and Apply waits', () => {
    const s = html(<DateRangeBody from="2026-08-01" to={OCT} max={OCT} calendar={CAL} today={OCT} legend={false} maxSpan={31} doneLabel="Apply" onDone={noop} />)
    expect(s).toContain('Pick 31 days or fewer. This range is 68 days.')
    expect(s).toContain('role="alert"')
    expect(s).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*?Apply/)
    expect(dayButton(s, '2026-10-01')).not.toContain('disabled=""')
  })
  it('within the longest range: no message, Apply ready', () => {
    const s = html(<DateRangeBody from="2026-09-10" to={OCT} max={OCT} calendar={CAL} today={OCT} legend={false} maxSpan={31} doneLabel="Apply" onDone={noop} />)
    expect(s).not.toContain('Pick 31 days or fewer')
    expect(s).not.toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]{0,40}Apply/)
  })
})
