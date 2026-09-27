// The selection bar over a table (prototype PgDirectory): once rows are ticked, a brand-green
// bar pops in with "3 selected", the bulk actions ("Assign shift", "Send letter", "Export") and
// a × that clears the selection. It works with the kit Table's controlled selection:
//
//   const [selected, setSelected] = useState<RowKey[]>([])
//   <BulkBar selected={selected} onClear={() => setSelected([])} actions={[…]} />
//   <Table selectable selected={selected} onSelectedChange={setSelected} … />
//
// Nothing shows while nothing is selected. A toolbar with its own name; the count is a polite
// live region, so screen readers hear it change. Only put actions here that the person may
// take (the page checks permissions).
import type { ReactNode } from 'react'
import type { RowKey } from './Table'
import { cx, renderIcon, type KitIcon } from './displayUtil'
import './display.css'
import './data.css'

export interface BulkAction {
  key: string
  label: ReactNode
  onClick: () => void
  icon?: KitIcon
  disabled?: boolean
  /** Shows a spinner and ignores clicks (aria-busy) while the action runs. */
  busy?: boolean
  /** Tooltip, e.g. why it's disabled. */
  title?: string
}

export interface BulkBarProps {
  /** The Table's selected keys (a Set or an array)… */
  selected?: ReadonlySet<RowKey> | readonly RowKey[]
  /** …or just how many rows are picked. */
  count?: number
  actions?: readonly BulkAction[]
  /** Any other controls, after the actions. */
  children?: ReactNode
  onClear: () => void
  /** The words for the count (default "3 selected"). */
  countLabel?: (count: number) => ReactNode
  /** Accessible name of the bar (default "Bulk actions"). */
  label?: string
  /** The design's place inside a table card: 20px in from the sides, 12px above the table (default true). */
  inset?: boolean
  className?: string
}

function sizeOf(selected: BulkBarProps['selected']): number {
  if (!selected) return 0
  return 'size' in selected ? selected.size : (selected as readonly RowKey[]).length
}

export function BulkBar({ selected, count, actions = [], children, onClear, countLabel, label = 'Bulk actions', inset = true, className }: BulkBarProps) {
  const n = Math.max(0, Math.floor(count ?? sizeOf(selected)))
  if (!n) return null
  return (
    <div role="toolbar" aria-label={label} className={cx('uk-bulk', inset && 'uk-bulk--inset', 'ufx-pop', className)}>
      <span className="uk-bulk__count" role="status" aria-live="polite">{countLabel ? countLabel(n) : `${n.toLocaleString('en-IN')} selected`}</span>
      {actions.map((a) => {
        const off = a.disabled || a.busy
        return (
          <button key={a.key} type="button" className={cx('uk-bulk__btn', a.busy && 'is-busy')} title={a.title}
            disabled={a.disabled} aria-busy={a.busy || undefined}
            onClick={() => { if (!off) a.onClick() }}>
            {a.busy ? <span className="uk-bulk__spin" aria-hidden="true" /> : a.icon != null && a.icon !== '' && <span className="uk-bulk__icon" aria-hidden="true">{renderIcon(a.icon, 14)}</span>}
            {a.label}
          </button>
        )
      })}
      {children}
      <button type="button" className="uk-bulk__x" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
        {renderIcon('x', 15)}
      </button>
    </div>
  )
}
