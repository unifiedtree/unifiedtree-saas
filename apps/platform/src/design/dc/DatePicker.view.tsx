// The DatePicker's view: the shared calendar field with the design's 42px trigger
// (DatePicker.view.css). Everything else — popover, views, keyboard — is shared.
import { DateField } from '@/shared/components/calendar'
import './DatePicker.view.css'

export function DatePickerView({ v }: { v: any }) {
  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0, fontFamily: 'Inter,-apple-system,sans-serif', color: '#0f172a' }}>
      <DateField
        className="dc-date-picker"
        value={v.value || ''}
        min={v.min}
        max={v.max}
        today={v.today}
        clearable={!!v.clearable}
        placeholder={v.placeholder}
        aria-label={v.ariaLabel}
        onChange={v.onPick}
      />
    </div>
  )
}
