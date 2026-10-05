// The signed-in person's weekly offs and holidays, for the "Select date" picker on the attendance
// request forms (Fix a day, Request overtime), as Work from home builds it: their own weekly offs,
// else the company's, else Sat + Sun; the company's holidays in the years the form can reach.
// The days are only marked (greyed, dotted): a weekly off or a holiday can still be picked.
import { useMemo } from 'react'
import type { WorkCalendar } from '@/design/kit/DateRangePicker'
import { useHolidays, useWeekendDays } from '../api/useSettings'
import { useMeEmployee } from '../ess/home/homeApi'
import { weeklyOffSet } from '../ess/home/homeModel'

/**
 * `min` / `max` (yyyy-MM-dd) are the form's limits; holidays are read for every year between them (at most three).
 * `enabled` false (a closed form) reads nothing.
 */
export function useMyWorkCalendar(min: string, max: string, enabled = true): WorkCalendar {
  const me = useMeEmployee({ enabled })
  const companyId = enabled ? me.data?.companyId ?? '' : ''
  const weekend = useWeekendDays(companyId || undefined)
  const first = Number(min.slice(0, 4))
  const last = Number(max.slice(0, 4))
  // A fixed number of hooks; a year outside the range is not fetched (no company id → disabled).
  const a = useHolidays(companyId, first)
  const b = useHolidays(last > first ? companyId : '', first + 1)
  const c = useHolidays(last > first + 1 ? companyId : '', first + 2)
  return useMemo(() => ({
    off: weeklyOffSet(me.data?.weeklyOffDays, weekend.data?.weekendDays),
    holidays: new Map([...(a.data ?? []), ...(b.data ?? []), ...(c.data ?? [])]
      .filter((h) => h.active !== false)
      .map((h) => [h.holidayDate.slice(0, 10), h.holidayName] as const)),
  }), [me.data?.weeklyOffDays, weekend.data?.weekendDays, a.data, b.data, c.data])
}
