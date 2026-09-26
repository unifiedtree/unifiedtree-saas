/**
 * Shared calendar — ONE date picker for the whole app.
 * ════════════════════════════════════════════════════════════════════════════
 *   import { DateField, MonthField, DateRangeField } from '@/shared/components/calendar'
 *
 * Day grid (Monday first) · month grid · year grid (every year, in decades) ·
 * "September ▾" / "2026 ▾" header chips that jump straight to a month or year ·
 * prev/next arrows · quick presets · Clear · min/max · full keyboard · a bottom
 * sheet on phones (≤ 480px) · portalled popover that flips above the field and
 * stays in the viewport (works inside HrDrawer, Radix modals, scrolling tables).
 * "Today" is the IST business day (istToday), like the rest of the app.
 *
 * ── DROP-IN for <input type="date"> ──────────────────────────────────────────
 *   before: <input type="date" className="ut-input" value={d} min={a} max={b}
 *                  onChange={(e) => setD(e.target.value)} required />
 *   after:  <DateField          className="ut-input" value={d} min={a} max={b}
 *                  onChange={(e) => setD(e.target.value)} required />
 *
 *   • value: 'yyyy-MM-dd' or '' (null / undefined-with-defaultValue also fine).
 *   • onChange(evt, value): evt = { type, target: { value, name, id }, currentTarget }, so
 *     `e.target.value` keeps working. It is NOT a React.ChangeEvent — a handler typed
 *     `(e: React.ChangeEvent<HTMLInputElement>) => …` must drop that annotation.
 *     Fires only when the value really changes; '' when cleared.
 *   • className / style style the visible box, exactly where the input's went
 *     ("ut-input", "ut-input ut-input-sm", "ut-input mt-2", "w-44", widths…). No
 *     className → the same 40px look as .ut-input.
 *   • id goes on the focusable trigger, so <label htmlFor={id}> works; so do
 *     aria-label / aria-labelledby / aria-describedby / aria-invalid / title / data-*.
 *   • name + value + required live on a hidden input inside the field: native forms,
 *     FormData and "please fill out this field" validation behave like the native input.
 *   • disabled, readOnly, autoFocus, placeholder, min, max as usual.
 *   • invalid / error (boolean) → red box (ui-kit <Field error> passes these for you).
 *
 * Extra props: clearable (× in the field + Clear), format="short" ("26 Sep 2026";
 * default "Sat, 26 Sep 2026"), presets={[{ label, value }] | false}, size="sm",
 * icon={false}, align="end", fromYear / toYear (year list when no min/max; default
 * 1940 … today+10), today (override).
 *
 * ── react-hook-form ──────────────────────────────────────────────────────────
 *   Preferred — Controller:
 *     <Controller control={control} name="dateOfBirth" render={({ field, fieldState }) => (
 *       <DateField {...field} value={field.value ?? ''} max={todayIso()} invalid={!!fieldState.error} />
 *     )} />
 *   (field.onChange accepts our evt; field.ref gets a focusable element, so
 *    shouldFocusError / setFocus land on the field.)
 *   register() also works: <DateField {...register('passportExpiry')} /> — the ref is
 *   the hidden input, so defaultValues, reset() and setValue() show up in the field.
 *
 * ── MonthField ("September 2026" selectors) ──────────────────────────────────
 *   const [month, setMonth] = useState(istToday().slice(0, 7))       // 'yyyy-MM'
 *   <MonthField value={month} max={istToday()} onChange={(e) => setMonth(e.target.value)}
 *               aria-label="Month" style={{ width: 200 }} />
 *   min / max accept 'yyyy-MM' or 'yyyy-MM-dd'. Presets: This month / Last month.
 *
 * ── DateRangeField ───────────────────────────────────────────────────────────
 *   const [range, setRange] = useState<DateRange>({ from: '', to: '' })
 *   <DateRangeField value={range} max={istToday()} clearable
 *                   onChange={(e, r) => setRange(r)} aria-label="Period" />
 *   Two clicks pick a range (hover previews it). Quick ranges: Today, Last 7 days,
 *   Last 30 days, This month, Last month, This year, Last year (clamped to min/max),
 *   or your own: presets={[{ label: 'Q1', from: '2026-04-01', to: '2026-06-30' }]}.
 *   months={1} for one month. The hidden input's value is "from/to" (for required/forms).
 *
 * ── Keyboard (focus stays on the field) ──────────────────────────────────────
 *   ArrowDown/ArrowUp opens · arrows move a day/week · PageUp/PageDown a month ·
 *   Shift+PageUp/PageDown a year · Home/End start/end of week · T today ·
 *   Enter/Space picks · Escape closes (only the calendar, not the drawer/modal
 *   around it) · Tab closes and moves on · Delete/Backspace clears (clearable).
 *   Month and year views: arrows move, PageUp/PageDown a year / a decade.
 *
 * The design-system DatePicker (@/design/dc/DatePicker) renders this same calendar.
 */
export { DateField, MonthField, DateRangeField } from './fields'
export type { DateFieldProps, MonthFieldProps, DateRangeFieldProps } from './fields'
export type { CalendarEvent, CalendarFieldCommonProps, DateRange } from './CalendarField'
export type { DatePreset, MonthPreset, RangePreset } from './dateMath'
export { fmtDay, fmtMonth, fmtRange, istToday } from './dateMath'
// Building blocks, for calendars with their own day cells (the dashboard's DashCalendar).
export { CalChip, CalArrow, DayGrid, MonthGrid, YearGrid, monthStep, yearStep } from './parts'
