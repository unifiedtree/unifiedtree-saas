// Typed public faces of the shared calendar (usage: see index.ts).
import { forwardRef } from 'react'
import { CalendarField, type CalendarEvent, type CalendarFieldCommonProps, type DateRange } from './CalendarField'
import type { DatePreset, MonthPreset, RangePreset } from './dateMath'

export interface DateFieldProps extends CalendarFieldCommonProps {
  /** 'yyyy-MM-dd', or '' for empty. Omit (and use defaultValue) for an uncontrolled field. */
  value?: string | null
  defaultValue?: string
  /** `e.target.value` is the new 'yyyy-MM-dd' ('' when cleared); the value is also the second argument. */
  onChange?: (evt: CalendarEvent<string>, value: string) => void
  onBlur?: (evt: CalendarEvent<string>) => void
  onFocus?: (evt: CalendarEvent<string>) => void
  /** 'long' = "Sat, 26 Sep 2026" (default), 'short' = "26 Sep 2026". */
  format?: 'long' | 'short'
  /** Quick picks under the calendar. Default: Today / Yesterday / Tomorrow (as min/max allow). false hides them. */
  presets?: DatePreset[] | false
}

export interface MonthFieldProps extends CalendarFieldCommonProps {
  /** 'yyyy-MM', or '' for empty. */
  value?: string | null
  defaultValue?: string
  onChange?: (evt: CalendarEvent<string>, value: string) => void
  onBlur?: (evt: CalendarEvent<string>) => void
  onFocus?: (evt: CalendarEvent<string>) => void
  /** 'long' = "September 2026" (default), 'short' = "Sep 2026". */
  format?: 'long' | 'short'
  /** Default: This month / Last month (as min/max allow). false hides them. */
  presets?: MonthPreset[] | false
}

export interface DateRangeFieldProps extends CalendarFieldCommonProps {
  /** { from, to } as 'yyyy-MM-dd'; either may be ''. */
  value?: DateRange | null
  defaultValue?: DateRange
  /** Fires once both ends are picked (or a preset / Clear is used). `e.target.value` is the { from, to } object. */
  onChange?: (evt: CalendarEvent<DateRange>, value: DateRange) => void
  onBlur?: (evt: CalendarEvent<DateRange>) => void
  onFocus?: (evt: CalendarEvent<DateRange>) => void
  /** Default: Today, Last 7 days, Last 30 days, This month, Last month, This year, Last year — clamped to min/max. */
  presets?: RangePreset[] | false
  /** Months shown side by side on wide screens (default 2; phones always get 1). */
  months?: 1 | 2
}

export const DateField = forwardRef<HTMLInputElement, DateFieldProps>(function DateField(props, ref) {
  return <CalendarField {...props} mode="day" ref={ref} />
})

export const MonthField = forwardRef<HTMLInputElement, MonthFieldProps>(function MonthField(props, ref) {
  return <CalendarField {...props} mode="month" ref={ref} />
})

export const DateRangeField = forwardRef<HTMLInputElement, DateRangeFieldProps>(function DateRangeField(props, ref) {
  return <CalendarField {...props} mode="range" ref={ref} />
})
