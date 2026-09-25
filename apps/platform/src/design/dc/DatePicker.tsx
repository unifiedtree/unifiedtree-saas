// The design-system date picker. Since wave 3 its calendar is the app's shared
// one (src/shared/components/calendar): day, month and year views, a year list,
// presets, keyboard, a bottom sheet on phones.
// Props are unchanged — value, min, max, clearable, placeholder, label, today —
// and onChange is still called as onChange({ target: { value } }, value).
import { DCLogic, dc } from './dc-runtime'
import { DatePickerView } from './DatePicker.view'

export class DatePicker extends DCLogic {
  renderVals() {
    const p = this.props
    return {
      placeholder: p.placeholder || 'Pick a date',
      ariaLabel: p.label || 'Date',
      onPick: (_e: unknown, v: string) => { const f = p.onChange; if (f) f({ target: { value: v } }, v) },
    }
  }
  render() { return dc(this, DatePickerView, 'DatePicker') }
}
