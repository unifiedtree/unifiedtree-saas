// The design's form controls: a label with an optional required marker, the control, a quiet
// hint and an inline error tied to the control (aria-describedby + aria-invalid), with the
// brand focus ring (brand border + 3px soft halo). Two sizes from the design:
//   lg (default) — the side panel's fields (PgCompanies): 44px, radius 12, 14px text, 13px label;
//   md           — a section card's form (UtSection): 40px, radius 11, 13.5px text, 12.5px label.
// Set the size per control or once on <FieldGrid size>.
// Also: the on/off switch row, the range slider with its live value and end captions, the
// check card ("Mark as headquarters"), and date fields — which are always the shared calendar
// (src/shared/components/calendar), never a native date input.
import {
  createContext, forwardRef, useContext, useId, type CSSProperties, type InputHTMLAttributes, type MouseEvent,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react'
import { Check, ChevronDown, CircleAlert } from 'lucide-react'
import {
  DateField, DateRangeField, MonthField,
  type DateFieldProps, type DateRangeFieldProps, type MonthFieldProps,
} from '@/shared/components/calendar'
import { kitIcon, type KitIcon } from './overlayCore'
import './overlays.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ') || undefined
const hasText = (n: ReactNode) => n != null && n !== false && n !== ''

export type FieldSize = 'md' | 'lg'
const SizeContext = createContext<FieldSize>('lg')
function useSize(own?: FieldSize): FieldSize {
  const inherited = useContext(SizeContext)
  return own ?? inherited
}

export interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  /** Inline error under the control; also marks the control invalid. */
  error?: ReactNode
  /** Shows the required marker after the label. */
  required?: boolean
  /** Span every column of a FieldGrid. */
  full?: boolean
  /** lg = side panel fields (44px, default); md = section card forms (40px). */
  size?: FieldSize
}

interface ShellProps extends FieldProps {
  htmlFor?: string
  hintId?: string
  errorId?: string
  className?: string
  style?: CSSProperties
  children: ReactNode
}

function useFieldIds(id?: string) {
  const uid = useId()
  const base = id || `${uid}-field`
  return { id: base, hint: `${base}-hint`, error: `${base}-error` }
}

const describedBy = (own: string | undefined, hint: ReactNode, error: ReactNode, ids: { hint: string; error: string }) =>
  cx(own, hasText(hint) && ids.hint, hasText(error) && ids.error)

/** Label, control, hint and error laid out the design's way (gap 6px). */
export function FormField({ label, hint, error, required, full, size, htmlFor, hintId, errorId, className, style, children }: ShellProps) {
  const s = useSize(size)
  return (
    <div className={cx('uko-field', className)} data-size={s} data-full={full ? '' : undefined} style={style}>
      {label != null && (
        <label className="uko-label" htmlFor={htmlFor}>
          {label}
          {required && <span className="uko-req" aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {hasText(hint) && <div id={hintId} className="uko-hint">{hint}</div>}
      {hasText(error) && (
        <div id={errorId} className="uko-error">
          <CircleAlert size={14} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}

/** Columns of fields (one column on phones); `full` fields span the row. Sets the size for its fields. */
export function FieldGrid({ columns = 2, size, className, children }: { columns?: 1 | 2 | 3; size?: FieldSize; className?: string; children: ReactNode }) {
  const grid = <div className={cx('uko-grid', className)} style={{ ['--uko-cols' as string]: columns } as CSSProperties}>{children}</div>
  return size ? <SizeContext.Provider value={size}>{grid}</SizeContext.Provider> : grid
}

// ── Input ──
export interface InputProps extends FieldProps, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Icon inside the field, on the left: a design icon name or a node. */
  leading?: KitIcon
  /** Class on the field wrapper (className goes on the input). */
  fieldClassName?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(props, ref) {
  // Dates always use the shared calendar, even when someone asks for type="date" / "month".
  // (Its change event also carries e.target.value, so an onChange written for the native input still works.)
  if (props.type === 'date' || props.type === 'month') {
    const { type, value, defaultValue, onChange, onBlur, onFocus, leading: _l, min, max, ...rest } = props
    const common = {
      ...(rest as object),
      min: min == null ? undefined : String(min),
      max: max == null ? undefined : String(max),
      value: value == null ? (value as null | undefined) : String(value),
      defaultValue: defaultValue == null ? undefined : String(defaultValue),
      onChange: onChange as unknown as DateFieldProps['onChange'],
      onBlur: onBlur as unknown as DateFieldProps['onBlur'],
      onFocus: onFocus as unknown as DateFieldProps['onFocus'],
    }
    return type === 'date' ? <DateInput ref={ref} {...(common as DateInputProps)} /> : <MonthInput ref={ref} {...(common as MonthInputProps)} />
  }
  return <TextInput ref={ref} {...props} />
})

const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput(
  { label, hint, error, required, full, size, leading, id, className, fieldClassName, ...rest },
  ref,
) {
  const ids = useFieldIds(id)
  return (
    <FormField label={label} hint={hint} error={error} required={required} full={full} size={size} htmlFor={ids.id} hintId={ids.hint} errorId={ids.error} className={fieldClassName}>
      <span className="uko-control" data-leading={leading ? '' : undefined}>
        {leading && <span className="uko-lead" aria-hidden="true">{kitIcon(leading, 16)}</span>}
        <input
          ref={ref}
          id={ids.id}
          required={required}
          {...rest}
          className={cx('uko-input', className)}
          aria-invalid={hasText(error) ? true : rest['aria-invalid']}
          aria-describedby={describedBy(rest['aria-describedby'], hint, error, ids)}
        />
      </span>
    </FormField>
  )
})

// ── Select ──
export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends FieldProps, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options?: SelectOption[]
  /** A first, empty choice (e.g. "Choose a state"). */
  placeholder?: string
  fieldClassName?: string
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, required, full, size, options, placeholder, id, className, fieldClassName, children, ...rest },
  ref,
) {
  const ids = useFieldIds(id)
  return (
    <FormField label={label} hint={hint} error={error} required={required} full={full} size={size} htmlFor={ids.id} hintId={ids.hint} errorId={ids.error} className={fieldClassName}>
      <span className="uko-control uko-select-wrap">
        <select
          ref={ref}
          id={ids.id}
          required={required}
          {...rest}
          className={cx('uko-input', 'uko-select', className)}
          aria-invalid={hasText(error) ? true : rest['aria-invalid']}
          aria-describedby={describedBy(rest['aria-describedby'], hint, error, ids)}
        >
          {placeholder != null && <option value="">{placeholder}</option>}
          {options?.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          {children}
        </select>
        <ChevronDown className="uko-select-chev" size={16} aria-hidden="true" />
      </span>
    </FormField>
  )
})

// ── Textarea ──
export interface TextareaProps extends FieldProps, TextareaHTMLAttributes<HTMLTextAreaElement> {
  fieldClassName?: string
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, required, full, size, id, className, fieldClassName, rows = 4, ...rest },
  ref,
) {
  const ids = useFieldIds(id)
  return (
    <FormField label={label} hint={hint} error={error} required={required} full={full} size={size} htmlFor={ids.id} hintId={ids.hint} errorId={ids.error} className={fieldClassName}>
      <textarea
        ref={ref}
        id={ids.id}
        rows={rows}
        required={required}
        {...rest}
        className={cx('uko-input', 'uko-textarea', className)}
        aria-invalid={hasText(error) ? true : rest['aria-invalid']}
        aria-describedby={describedBy(rest['aria-describedby'], hint, error, ids)}
      />
    </FormField>
  )
})

// ── Date fields (the shared calendar) ──
type CalendarShell = FieldProps & { fieldClassName?: string }
type Clash = 'size' | 'error' | 'invalid'
export type DateInputProps = CalendarShell & Omit<DateFieldProps, Clash>
export type MonthInputProps = CalendarShell & Omit<MonthFieldProps, Clash>
export type DateRangeInputProps = CalendarShell & Omit<DateRangeFieldProps, Clash>

function useCalendarField(p: CalendarShell & { id?: string; className?: string; 'aria-describedby'?: string }) {
  const ids = useFieldIds(p.id)
  return {
    ids,
    shell: { label: p.label, hint: p.hint, error: p.error, required: p.required, full: p.full, size: p.size, htmlFor: ids.id, hintId: ids.hint, errorId: ids.error, className: p.fieldClassName },
    field: {
      id: ids.id,
      required: p.required,
      invalid: hasText(p.error) || undefined,
      className: cx('uko-datebox', p.className),
      'aria-describedby': describedBy(p['aria-describedby'], p.hint, p.error, ids),
    },
  }
}

/** A date ('yyyy-MM-dd') through the shared calendar, as a kit field. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(props, ref) {
  const { label: _a, hint: _b, error: _c, full: _d, size: _e, fieldClassName: _f, ...rest } = props
  const { shell, field } = useCalendarField(props)
  return <FormField {...shell}><DateField ref={ref} {...rest} {...field} /></FormField>
})

/** A month ('yyyy-MM') through the shared calendar, as a kit field. */
export const MonthInput = forwardRef<HTMLInputElement, MonthInputProps>(function MonthInput(props, ref) {
  const { label: _a, hint: _b, error: _c, full: _d, size: _e, fieldClassName: _f, ...rest } = props
  const { shell, field } = useCalendarField(props)
  return <FormField {...shell}><MonthField ref={ref} {...rest} {...field} /></FormField>
})

/** A date range ({ from, to }) through the shared calendar, as a kit field. */
export const DateRangeInput = forwardRef<HTMLInputElement, DateRangeInputProps>(function DateRangeInput(props, ref) {
  const { label: _a, hint: _b, error: _c, full: _d, size: _e, fieldClassName: _f, ...rest } = props
  const { shell, field } = useCalendarField(props)
  return <FormField {...shell}><DateRangeField ref={ref} {...rest} {...field} /></FormField>
})

// ── Toggle (switch row) ──
export interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  /** Line under the label, e.g. "Mobile and web punches outside it are flagged". */
  description?: ReactNode
  disabled?: boolean
  id?: string
  full?: boolean
  /** lg = the side panel's 42×24 switch (default); md = a section card's 38×22 row. */
  size?: FieldSize
  className?: string
}

export function Toggle({ checked, onChange, label, description, disabled, id, full, size, className }: ToggleProps) {
  const ids = useFieldIds(id)
  const s = useSize(size)
  const labelId = `${ids.id}-label`, descId = `${ids.id}-desc`
  // The whole row is clickable, like the design's; the switch button is the real control.
  const rowClick = (e: MouseEvent<HTMLDivElement>) => {
    if (disabled || (e.target as HTMLElement).closest('button')) return
    onChange(!checked)
  }
  return (
    <div className={cx('uko-toggle', className)} data-size={s} data-full={full ? '' : undefined} data-disabled={disabled ? '' : undefined} onClick={rowClick}>
      <span className="uko-toggle-text">
        <span id={labelId} className="uko-toggle-label">{label}</span>
        {description != null && <span id={descId} className="uko-toggle-desc">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        id={ids.id}
        className="uko-switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description != null ? descId : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      />
    </div>
  )
}

// ── Slider ──
export interface SliderProps extends FieldProps {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** The value as people read it, e.g. v => `${v} m`. */
  format?: (value: number) => string
  /** Captions under the ends, e.g. "50 m · one building" / "500 m · a campus". */
  minLabel?: ReactNode
  maxLabel?: ReactNode
  disabled?: boolean
  id?: string
  name?: string
}

export function Slider({ label, hint, error, required, full, size, value, onChange, min, max, step = 1, format = String, minLabel, maxLabel, disabled, id, name }: SliderProps) {
  const ids = useFieldIds(id)
  const text = format(value)
  return (
    <FormField hint={hint} error={error} full={full} size={size} hintId={ids.hint} errorId={ids.error} className="uko-slider">
      <label className="uko-label uko-slider-head" htmlFor={ids.id}>
        {label}
        {required && <span className="uko-req" aria-hidden="true"> *</span>}
        {label != null && <span aria-hidden="true"> · </span>}
        <output htmlFor={ids.id} className="uko-slider-value">{text}</output>
      </label>
      <input
        id={ids.id}
        name={name}
        type="range"
        className="uko-range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={text}
        aria-invalid={hasText(error) ? true : undefined}
        aria-describedby={describedBy(undefined, hint, error, ids)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {(minLabel != null || maxLabel != null) && (
        <div className="uko-slider-scale" aria-hidden="true"><span>{minLabel}</span><span>{maxLabel}</span></div>
      )}
    </FormField>
  )
}

// ── Checkbox (plain, or the design's check card) ──
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked' | 'size'> {
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  description?: ReactNode
  /** The bordered card look ("Mark as headquarters"). */
  card?: boolean
  full?: boolean
}

export function Checkbox({ checked, onChange, label, description, card, full, id, className, disabled, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id)
  const titleId = `${ids.id}-title`, descId = `${ids.id}-desc`
  return (
    <label className={cx('uko-check', className)} data-card={card ? '' : undefined} data-full={full ? '' : undefined} data-disabled={disabled ? '' : undefined}>
      <input
        {...rest}
        id={ids.id}
        type="checkbox"
        className="uko-check-input"
        checked={checked}
        disabled={disabled}
        aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="uko-check-box" aria-hidden="true"><Check size={12} strokeWidth={3.2} /></span>
      <span className="uko-check-text">
        <span id={titleId} className="uko-check-title">{label}</span>
        {description != null && <span id={descId} className="uko-check-desc">{description}</span>}
      </span>
    </label>
  )
}
