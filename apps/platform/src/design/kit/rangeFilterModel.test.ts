// The start / end calendar's rules (rangeFilterModel.ts): quick picks, the URL, the longest range, the month / year
// grids and their keys, and keeping a list's records to the range.
import { describe, expect, it } from 'vitest'
import {
  clampPreset, dayKeyStep, historyPresets, inDayRange, isDay, istDayOf, keepInRange, monthCells, monthKeyStep, monthRange, monthsOf,
  overlapsRange, rangeProblem, rangeText, rangeWords, readRange, wholeList, writeRange, yearCells, yearKeyStep, yearPageStart,
} from './rangeFilterModel'
import { settled, tapDay, type DraftRange } from './dateRangeModel'

// Wed 7 Oct 2026.
const TODAY = '2026-10-07'

describe('clicking days: any start, then any end', () => {
  const click = (days: string[]) => days.reduce<DraftRange>((d, day) => tapDay(d, day, false), { from: null, to: null })
  it('the first click is the start, the next on or after it is the end', () => {
    expect(settled(click(['2026-09-03', '2026-10-20']))).toEqual({ from: '2026-09-03', to: '2026-10-20' })
  })
  it('one click is one day; the same day twice is one day', () => {
    expect(settled(click(['2026-10-05']))).toEqual({ from: '2026-10-05', to: '2026-10-05' })
    expect(settled(click(['2026-10-05', '2026-10-05']))).toEqual({ from: '2026-10-05', to: '2026-10-05' })
  })
  it('a click before the start starts again; a click after a full range starts a new one', () => {
    expect(click(['2026-10-10', '2026-10-02'])).toEqual({ from: '2026-10-02', to: null })
    expect(click(['2026-10-01', '2026-10-05', '2026-12-25'])).toEqual({ from: '2026-12-25', to: null })
  })
  it('a start years back and an end in another month', () => {
    expect(settled(click(['2019-02-11', '2026-10-07']))).toEqual({ from: '2019-02-11', to: '2026-10-07' })
  })
})

describe('quick picks of a list', () => {
  const p = Object.fromEntries(historyPresets(TODAY).map((x) => [x.key, x]))
  it('today, yesterday, this / last week (Mon–Sun), this / last month, last 3 months, this year', () => {
    expect(historyPresets(TODAY).map((x) => x.label)).toEqual(['Today', 'Yesterday', 'This week', 'Last week', 'This month', 'Last month', 'Last 3 months', 'This year'])
    expect(p.today).toMatchObject({ from: TODAY, to: TODAY })
    expect(p.yesterday).toMatchObject({ from: '2026-10-06', to: '2026-10-06' })
    expect(p.thisWeek).toMatchObject({ from: '2026-10-05', to: '2026-10-11' })
    expect(p.lastWeek).toMatchObject({ from: '2026-09-28', to: '2026-10-04' })
    expect(p.thisMonth).toMatchObject({ from: '2026-10-01', to: '2026-10-31' })
    expect(p.lastMonth).toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
    expect(p.last3Months).toMatchObject({ from: '2026-08-01', to: '2026-10-31' })
    expect(p.thisYear).toMatchObject({ from: '2026-01-01', to: '2026-12-31' })
  })
  it('a January "last month" is December of the year before', () => {
    const jan = Object.fromEntries(historyPresets('2027-01-15').map((x) => [x.key, x]))
    expect(jan.lastMonth).toMatchObject({ from: '2026-12-01', to: '2026-12-31' })
  })
  it('a page that stops at today cuts "this month" at today, and a Sunday "this week" is the whole week', () => {
    const q = Object.fromEntries(historyPresets(TODAY, { max: TODAY }).map((x) => [x.key, x]))
    expect(q.thisMonth).toMatchObject({ from: '2026-10-01', to: TODAY })
    expect(historyPresets('2026-10-11').find((x) => x.key === 'thisWeek')).toMatchObject({ from: '2026-10-05', to: '2026-10-11' })
  })
  it('a pick wholly outside the limits is disabled', () => {
    expect(clampPreset({ key: 'x', label: 'X', from: '2026-01-01', to: '2026-01-31' }, '2026-02-01')).toMatchObject({ disabled: true })
    expect(clampPreset({ key: 'x', label: 'X', from: '2026-01-01', to: '2026-03-31' }, '2026-02-01').disabled).toBeUndefined()
  })
  it('a month as a range', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(monthRange('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
  })
})

describe('the longest range: said in plain words', () => {
  it('fine up to the limit, a sentence past it', () => {
    expect(rangeProblem({ from: '2026-09-07', to: TODAY }, 31)).toBeNull()
    expect(rangeProblem({ from: '2026-09-06', to: TODAY }, 31)).toBe('Pick 31 days or fewer. This range is 32 days.')
    expect(rangeProblem({ from: '2020-01-01', to: TODAY })).toBeNull()
    expect(rangeProblem(null, 31)).toBeNull()
  })
})

describe('the range in the URL (?from=&to=)', () => {
  const q = (s: string) => new URLSearchParams(s)
  it('reads both ends', () => {
    expect(readRange(q('from=2026-09-01&to=2026-09-30'))).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('nothing, half a range, a fake day or a backwards range is no range', () => {
    expect(readRange(q(''))).toBeNull()
    expect(readRange(q('from=2026-09-01'))).toBeNull()
    expect(readRange(q('from=2026-02-30&to=2026-03-02'))).toBeNull()
    expect(readRange(q('from=2026-10-02&to=2026-10-01'))).toBeNull()
    expect(readRange(q('from=yesterday&to=today'))).toBeNull()
  })
  it('ends past the limits are cut to them; nothing left, or too long, is no range', () => {
    expect(readRange(q('from=2026-10-01&to=2026-10-31'), { max: TODAY })).toEqual({ from: '2026-10-01', to: TODAY })
    expect(readRange(q('from=2026-11-01&to=2026-11-30'), { max: TODAY })).toBeNull()
    expect(readRange(q('from=2026-01-01&to=2026-10-07'), { maxSpan: 62 })).toBeNull()
  })
  it('its own keys, so two lists on a page never mix', () => {
    const keys = { from: 'mineFrom', to: 'mineTo' }
    expect(readRange(q('from=2026-09-01&to=2026-09-30'), { keys })).toBeNull()
    expect(readRange(q('mineFrom=2026-09-01&mineTo=2026-09-02'), { keys })).toEqual({ from: '2026-09-01', to: '2026-09-02' })
  })
  it('writing keeps the other parameters, drops the ones asked, and null removes the range', () => {
    const w = writeRange('?tab=review&page=3', { from: '2026-09-01', to: '2026-09-30' }, { drop: ['page'] })
    expect(w.toString()).toBe('tab=review&from=2026-09-01&to=2026-09-30')
    expect(writeRange(w, null).toString()).toBe('tab=review')
  })
})

describe('labels', () => {
  it('DD/MM/YYYY on the box; words in notes', () => {
    expect(rangeText({ from: '2026-10-01', to: TODAY })).toBe('01/10/2026 – 07/10/2026')
    expect(rangeText({ from: TODAY, to: TODAY })).toBe('07/10/2026')
    expect(rangeText(null)).toBe('')
    expect(rangeWords({ from: '2026-10-01', to: TODAY })).toBe('1 Oct – 7 Oct 2026')
    expect(rangeWords({ from: '2025-12-30', to: '2026-01-02' })).toBe('30 Dec 2025 – 2 Jan 2026')
    expect(rangeWords({ from: TODAY, to: TODAY })).toBe('7 Oct 2026')
  })
})

describe('jumping months and years', () => {
  it('a year has 12 months; months wholly outside the limits are disabled', () => {
    const cells = monthCells(2026, '2026-03-15', TODAY)
    expect(cells.map((c) => c.label)).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'])
    expect(cells.filter((c) => !c.disabled).map((c) => c.ym)).toEqual(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'])
    expect(cells[9].name).toBe('October 2026')
  })
  it('12 years to a page, and years past the limits are disabled', () => {
    expect(yearPageStart(2026)).toBe(2016)
    expect(yearPageStart(2028)).toBe(2028)
    expect(yearPageStart(2015)).toBe(2004)
    const ys = yearCells(2026, null, TODAY)
    expect(ys.map((y) => y.year)).toEqual([2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027])
    expect(ys.filter((y) => y.disabled).map((y) => y.year)).toEqual([2027])
  })
})

describe('the keyboard', () => {
  it('days: arrows a day / a week, Page Up / Down a month (same day, or the month’s last), Home / End the week', () => {
    expect(dayKeyStep('ArrowRight', TODAY)).toBe('2026-10-08')
    expect(dayKeyStep('ArrowLeft', '2026-10-01')).toBe('2026-09-30')
    expect(dayKeyStep('ArrowDown', TODAY)).toBe('2026-10-14')
    expect(dayKeyStep('ArrowUp', TODAY)).toBe('2026-09-30')
    expect(dayKeyStep('PageDown', TODAY)).toBe('2026-11-07')
    expect(dayKeyStep('PageUp', '2026-03-31')).toBe('2026-02-28')
    expect(dayKeyStep('Home', TODAY)).toBe('2026-10-05')
    expect(dayKeyStep('End', TODAY)).toBe('2026-10-11')
    expect(dayKeyStep('a', TODAY)).toBeNull()
  })
  it('months: three to a row; Page Up / Down a year', () => {
    expect(monthKeyStep('ArrowRight', '2026-12')).toBe('2027-01')
    expect(monthKeyStep('ArrowDown', '2026-10')).toBe('2027-01')
    expect(monthKeyStep('ArrowUp', '2026-02')).toBe('2025-11')
    expect(monthKeyStep('PageUp', '2026-10')).toBe('2025-10')
    expect(monthKeyStep('Tab', '2026-10')).toBeNull()
  })
  it('years: three to a row; Page Up / Down twelve years', () => {
    expect(yearKeyStep('ArrowLeft', 2026)).toBe(2025)
    expect(yearKeyStep('ArrowDown', 2026)).toBe(2029)
    expect(yearKeyStep('PageDown', 2026)).toBe(2038)
    expect(yearKeyStep('x', 2026)).toBeNull()
  })
})

describe('records in a range (a list the page holds whole)', () => {
  const range = { from: '2026-10-01', to: '2026-10-07' }
  it('a plain day, an instant (India’s day), a local date-time', () => {
    expect(istDayOf('2026-10-05')).toBe('2026-10-05')
    // 20:00 UTC on the 6th is 01:30 on the 7th in India.
    expect(istDayOf('2026-10-06T20:00:00Z')).toBe('2026-10-07')
    expect(istDayOf('2026-10-06T20:00:00+05:30')).toBe('2026-10-06')
    expect(istDayOf('2026-10-06T23:30')).toBe('2026-10-06')
    expect(istDayOf(null)).toBeNull()
    expect(isDay('2026-10-06')).toBe(true)
  })
  it('in the range, both ends included; no range keeps everything; no date is out', () => {
    expect(inDayRange('2026-10-01', range)).toBe(true)
    expect(inDayRange('2026-10-07', range)).toBe(true)
    expect(inDayRange('2026-10-08', range)).toBe(false)
    expect(inDayRange('2026-09-30T19:00:00Z', range)).toBe(true)
    expect(inDayRange(null, range)).toBe(false)
    expect(inDayRange(null, null)).toBe(true)
  })
  it('a request over several days counts when any of it overlaps', () => {
    expect(overlapsRange('2026-09-28', '2026-10-02', range)).toBe(true)
    expect(overlapsRange('2026-10-07', '2026-10-09', range)).toBe(true)
    expect(overlapsRange('2026-09-20', '2026-09-30', range)).toBe(false)
    expect(overlapsRange('2026-10-03', null, range)).toBe(true)
  })
  it('keeps the rows and says whether a page of results is the whole list', () => {
    const rows = [{ d: '2026-10-02' }, { d: '2026-09-02' }, { d: '2026-10-07' }]
    expect(keepInRange(rows, range, (r) => r.d)).toEqual([{ d: '2026-10-02' }, { d: '2026-10-07' }])
    expect(keepInRange(rows, null, (r) => r.d)).toHaveLength(3)
    expect(wholeList(20, 20)).toBe(true)
    expect(wholeList(20, 45)).toBe(false)
    expect(wholeList(3, undefined)).toBe(true)
  })
  it('the months a range touches (a month-by-month endpoint), at most 12', () => {
    expect(monthsOf({ from: '2026-08-20', to: '2026-10-07' })).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(monthsOf({ from: '2024-01-01', to: '2026-10-07' })).toHaveLength(12)
  })
})
