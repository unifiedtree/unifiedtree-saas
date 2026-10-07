// The optional ?from=&to= of the paged lists (calendar everywhere, 7 Oct 2026). The server keeps each list to
// its own date (a leave's days, a claim's submitted day, a settlement's last working day, ...; see
// _results/calendar-pages.md "Server date params"); without them the list is exactly as before.
import type { DayRange } from '@/design/kit/rangeFilterModel'

/** The longest range the server lists answer (ListDateRange.MAX_DAYS): the calendar says so instead of a 400. */
export const LIST_MAX_DAYS = 366

/** `&from=yyyy-MM-dd&to=yyyy-MM-dd` for a range, '' for none (all dates). */
export function rangeQs(range?: DayRange | null): string {
  return range ? `&from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : ''
}

/** Adds the range to URLSearchParams (nothing for none). */
export function setRangeParams(params: URLSearchParams, range?: DayRange | null): URLSearchParams {
  if (range) {
    params.set('from', range.from)
    params.set('to', range.to)
  }
  return params
}

/** The range's place in a react-query key (after the page, so prefix invalidation still reaches it). */
export function rangeKey(range?: DayRange | null): string {
  return range ? `${range.from}..${range.to}` : 'all'
}
