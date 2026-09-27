// The date chip in a page header (prototype PgDashboard and EmpHome greeting rows): a calendar
// tile, a small brand word ("TODAY", or "VIEWING" for another day) and the full date
// ("Friday, 25 September 2026").
//
// With onChange it is a button that opens the SHARED calendar (src/shared/components/calendar):
// the calendar's own field is stretched over the chip, invisible, so the chip keeps the design's
// look while the calendar owns the click, the keyboard (Arrow Down opens, arrows move, Enter
// picks, Escape closes), min / max, the Today and Yesterday presets and the phone bottom sheet.
// The design's five-day menu is not used. Without onChange it is plain text (Home).
import { useId, type ReactNode } from 'react'
import { DateField } from '@/shared/components/calendar'
import type { DatePreset } from '@/shared/components/calendar'
import * as D from '@/shared/components/calendar/dateMath'
import { cx, renderIcon } from './displayUtil'
import './display.css'
import './data.css'

export interface DateChipProps {
  /** The day shown, yyyy-MM-dd. Default: today. */
  value?: string | null
  /** Today, yyyy-MM-dd. Default: the IST business day, like the shared calendar. */
  today?: string
  /** Picking a day. Without it the chip is plain text. */
  onChange?: (date: string) => void
  /** Earliest / latest day that can be picked (yyyy-MM-dd). The dashboard passes today as max. */
  min?: string
  max?: string
  /** Quick picks under the calendar (default: Today / Yesterday / Tomorrow as min / max allow); false hides them. */
  presets?: DatePreset[] | false
  /** The small word above the date. Default "Today" on today, else "Viewing". */
  tag?: ReactNode
  /** dashboard = 46px (PgDashboard, default); home = 50px (EmpHome). */
  size?: 'dashboard' | 'home'
  /** What the picker is for, for screen readers (default "Choose the day to show"). */
  label?: string
  disabled?: boolean
  id?: string
  className?: string
}

export function DateChip({
  value, today, onChange, min, max, presets, tag, size = 'dashboard', label = 'Choose the day to show', disabled, id, className,
}: DateChipProps) {
  const uid = useId()
  const todayIso = D.normDay(today) || D.istToday()
  const day = D.normDay(value) || todayIso
  const isToday = day === todayIso
  const word = tag ?? (isToday ? 'Today' : 'Viewing')
  const long = D.fmtDayFull(day)
  const tile = <span className="uk-dchip__tile" aria-hidden="true">{renderIcon('calendar', size === 'home' ? 17 : 15)}</span>

  if (!onChange) {
    return (
      <div id={id} className={cx('uk-dchip', `uk-dchip--${size}`, className)}>
        {tile}
        <span className="uk-dchip__text">
          <span className="uk-dchip__tag">{word}</span>
          <time className="uk-dchip__date" dateTime={day}>{long}</time>
        </span>
      </div>
    )
  }

  return (
    <span className={cx('uk-dchip', `uk-dchip--${size}`, 'is-button', disabled && 'is-disabled', className)}>
      {tile}
      <span className="uk-dchip__text" aria-hidden="true">
        <span className="uk-dchip__tag">{word}</span>
        <span className="uk-dchip__date">{long}</span>
      </span>
      <svg className="uk-dchip__chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 9 6 6 6-6" />
      </svg>
      <DateField
        id={id ?? `${uid}-chip`}
        className="uk-dchip__field"
        value={day}
        today={todayIso}
        min={min}
        max={max}
        presets={presets}
        icon={false}
        disabled={disabled}
        aria-label={`${label}. Showing ${isToday ? 'today, ' : ''}${long}`}
        onChange={(_e, v) => { if (v && v !== day) onChange(v) }}
      />
    </span>
  )
}
