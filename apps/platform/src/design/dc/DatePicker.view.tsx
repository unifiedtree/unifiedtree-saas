// hand-owned (F2d). The DatePicker's view: the shared calendar field with the
// design's 42px trigger (DatePicker.view.css, tokens only). Everything else —
// popover, views, keyboard — is the shared calendar's.
import { DateField } from '@/shared/components/calendar'
import './DatePicker.view.css'

export function DatePickerView({ v }: { v: any }) {
  return (
    <div style={{ position: 'relative', width: '100%', minWidth: 0, fontFamily: "var(--u-font,'Plus Jakarta Sans',system-ui,sans-serif)" }}>
      <DateField
        className="dcdp"
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
