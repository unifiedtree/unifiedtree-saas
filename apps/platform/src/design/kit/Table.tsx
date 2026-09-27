// Data table (prototype UtSection "table" body and the Workforce directory):
// a grey header strip, 13.5px rows with hairline dividers and a soft hover, a
// person cell (avatar, name, sub-line), status pills and row actions.
//
// A real <table> (th scope="col" / scope="row"), so screen readers and tests
// see table, row, cell and columnheader. Put it in a Section with body="flush";
// the Section shows empty and error states, `loading` here shows the skeleton.
//
//   Rows are clickable with onRowClick / rowHref: Tab reaches them, Enter opens.
//   Selection: `selectable` adds checkboxes and a select-all box (controlled).
//   Sorting: columns with `sortable` get a header button; you own the order (controlled `sort`).
//   Phones: the table scrolls sideways inside its card, or mobile="cards" turns each row into a card.
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { SkeletonTable } from './Skeleton'
import { Avatar, type AvatarTone } from './Avatar'
import { cx } from './displayUtil'
import './display.css'

export type RowKey = string | number

export interface TableColumn<Row> {
  key: string
  /** Header content. */
  header: ReactNode
  /** Plain-text name of the column, for the phone card layout and the sort button when `header` isn't text. */
  label?: string
  /** Column width: px, or any CSS width ("28%"). Unset columns share what's left. */
  width?: number | string
  align?: 'left' | 'center' | 'right'
  /** Figures: right-aligned, tabular numbers. */
  numeric?: boolean
  render: (row: Row, index: number) => ReactNode
  /** Shows a sort button in the header. The page sorts the rows (see `sort` / `onSort`). */
  sortable?: boolean
  /** The row's name (usually the first column): a row header (<th scope="row">, role rowheader), ink 500, and the title of a phone card. */
  primary?: boolean
  /** Leave this column out of the phone card layout. */
  hideOnCards?: boolean
  className?: string
}

export interface TableSort {
  key: string
  dir: 'asc' | 'desc'
}

export interface TableProps<Row> {
  columns: readonly TableColumn<Row>[]
  rows: readonly Row[]
  rowKey: (row: Row, index: number) => RowKey
  /** Accessible name of the table ("Employees"). */
  label: string
  /** Opens a row (click, or Enter when the row has focus). */
  onRowClick?: (row: Row, e: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) => void
  /** A row's own URL: ctrl/⌘/middle click opens it in a new tab; a plain click calls onRowClick, or loads the URL (pass onRowClick with the router for in-app moves). */
  rowHref?: (row: Row) => string | undefined
  /** What the row is called, for its checkbox ("Select Priya Sharma"). */
  rowLabel?: (row: Row) => string
  /** Checkboxes on each row plus select-all in the header. */
  selectable?: boolean
  selected?: ReadonlySet<RowKey> | readonly RowKey[]
  onSelectedChange?: (keys: RowKey[]) => void
  /** The current sort; `onSort` gets the next one when a sortable header is clicked. */
  sort?: TableSort | null
  onSort?: (sort: TableSort) => void
  /** Keep the header in view while the body scrolls (needs maxHeight, the table's own scroll area). */
  stickyHeader?: boolean
  maxHeight?: number | string
  /** compact 8px · default 10px (UtSection) · comfy 12px (directory) row padding. `dense` = compact. */
  density?: 'compact' | 'default' | 'comfy'
  dense?: boolean
  /** Below this width the table scrolls sideways inside its card (default 640). */
  minWidth?: number
  /** Phones (≤ 640px): keep scrolling sideways (default) or show each row as a card. */
  mobile?: 'scroll' | 'cards'
  loading?: boolean
  loadingRows?: number
  /** A message row when there are no rows (e.g. "No one matches this search"). */
  empty?: ReactNode
  rowClassName?: (row: Row, index: number) => string | undefined
  className?: string
  style?: CSSProperties
}

const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [data-row-ignore]'

function colStyle(c: { width?: number | string }): CSSProperties | undefined {
  if (c.width == null) return undefined
  return { width: typeof c.width === 'number' ? `${c.width}px` : c.width }
}

function headerText<Row>(c: TableColumn<Row>): string | undefined {
  if (c.label) return c.label
  return typeof c.header === 'string' ? c.header : undefined
}

function SelectBox({ checked, indeterminate, label, onChange }: { checked: boolean; indeterminate?: boolean; label: string; onChange: (next: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate
  }, [indeterminate])
  return (
    <span className={cx('uk-check', checked && 'is-on', indeterminate && 'is-mixed')}>
      <input ref={ref} type="checkbox" className="uk-check__input" checked={checked} aria-label={label}
        onChange={(e) => onChange(e.target.checked)} onClick={(e) => e.stopPropagation()} />
      <span className="uk-check__box" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          {indeterminate && !checked ? <path d="M6 12h12" /> : <path d="M20 6 9 17l-5-5" />}
        </svg>
      </span>
    </span>
  )
}

export function Table<Row>({
  columns, rows, rowKey, label, onRowClick, rowHref, rowLabel, selectable, selected, onSelectedChange, sort, onSort,
  stickyHeader, maxHeight, density, dense, minWidth = 640, mobile = 'scroll', loading, loadingRows, empty, rowClassName, className, style,
}: TableProps<Row>) {
  if (loading) {
    return (
      <div className={cx('uk-table-wrap', className)} style={style}>
        <SkeletonTable rows={loadingRows ?? 5} cols={Math.max(2, columns.length)} label={`Loading ${label}`} />
      </div>
    )
  }

  const dens = dense ? 'compact' : density ?? 'default'
  const cards = mobile === 'cards'
  const clickable = !!(onRowClick || rowHref)
  const sel = new Set<RowKey>(selected ? Array.from(selected as Iterable<RowKey>) : [])
  const keys = rows.map((r, i) => rowKey(r, i))
  const nSel = keys.filter((k) => sel.has(k)).length
  const all = rows.length > 0 && nSel === rows.length
  const some = nSel > 0 && !all
  const roles = cards // display:block drops table semantics in some browsers; keep them explicit then
  const span = columns.length + (selectable ? 1 : 0)

  const toggle = (k: RowKey, on: boolean) => {
    if (!onSelectedChange) return
    const next = new Set(sel)
    if (on) next.add(k)
    else next.delete(k)
    onSelectedChange(keys.filter((x) => next.has(x)).concat(Array.from(next).filter((x) => !keys.includes(x))))
  }
  const toggleAll = (on: boolean) => {
    if (!onSelectedChange) return
    const others = Array.from(sel).filter((x) => !keys.includes(x))
    onSelectedChange(on ? others.concat(keys) : others)
  }

  const activate = (row: Row, e: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) => {
    const href = rowHref?.(row)
    const mouse = 'button' in e
    if (href && mouse && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) {
      window.open(href, '_blank', 'noopener')
      return
    }
    if (onRowClick) onRowClick(row, e)
    else if (href) window.location.assign(href)
  }

  const onRowMouse = (row: Row) => (e: MouseEvent<HTMLTableRowElement>) => {
    if ((e.target as Element).closest?.(INTERACTIVE)) return
    if (e.button !== 0 && e.button !== 1) return
    activate(row, e)
  }
  const onRowKey = (row: Row) => (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget) return
    e.preventDefault()
    activate(row, e)
  }

  const sortHeader = (c: TableColumn<Row>) => {
    const on = sort?.key === c.key
    const dir = on ? sort!.dir : undefined
    const next: TableSort = { key: c.key, dir: on && dir === 'asc' ? 'desc' : 'asc' }
    return (
      <button type="button" className={cx('uk-sort', on && 'is-on')} onClick={() => onSort?.(next)}>
        <span>{c.header}</span>
        <svg className="uk-sort__icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {dir === 'asc' ? <path d="m6 15 6-6 6 6" /> : dir === 'desc' ? <path d="m6 9 6 6 6-6" /> : <path d="m7 10 5-5 5 5M7 14l5 5 5-5" />}
        </svg>
      </button>
    )
  }

  const tableStyle: CSSProperties = { minWidth }
  return (
    <div className={cx('uk-table-wrap', stickyHeader && 'uk-table-wrap--sticky', cards && 'uk-table-wrap--cards', className)}
      style={{ ...style, ...(maxHeight != null ? { maxHeight } : null) }}>
      <table className={cx('uk-table', `uk-table--${dens}`, clickable && 'uk-table--links', cards && 'uk-table--cards')} aria-label={label}
        style={tableStyle} role={roles ? 'table' : undefined}>
        <colgroup>
          {selectable && <col className="uk-col-check" />}
          {columns.map((c) => <col key={c.key} style={colStyle(c)} />)}
        </colgroup>
        <thead role={roles ? 'rowgroup' : undefined}>
          <tr role={roles ? 'row' : undefined}>
            {selectable && (
              <th scope="col" className="uk-th uk-th--check" role={roles ? 'columnheader' : undefined}>
                <SelectBox checked={all} indeterminate={some} label="Select all rows" onChange={toggleAll} />
              </th>
            )}
            {columns.map((c) => {
              const on = sort?.key === c.key
              return (
                <th key={c.key} scope="col" role={roles ? 'columnheader' : undefined}
                  className={cx('uk-th', (c.numeric || c.align === 'right') && 'is-right', c.align === 'center' && 'is-center', c.className)}
                  aria-sort={c.sortable && on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                  {c.sortable && onSort ? sortHeader(c) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody role={roles ? 'rowgroup' : undefined}>
          {rows.length === 0 && empty != null && (
            <tr role={roles ? 'row' : undefined}>
              <td colSpan={span} className="uk-td uk-td--empty" role={roles ? 'cell' : undefined}>{empty}</td>
            </tr>
          )}
          {rows.map((row, i) => {
            const k = keys[i]
            const isSel = sel.has(k)
            const name = rowLabel?.(row)
            return (
              <tr key={k} role={roles ? 'row' : undefined}
                className={cx('uk-tr', clickable && 'is-link', isSel && 'is-selected', rowClassName?.(row, i))}
                tabIndex={clickable ? 0 : undefined}
                data-href={rowHref?.(row)}
                onClick={clickable ? onRowMouse(row) : undefined}
                onAuxClick={clickable && rowHref ? onRowMouse(row) : undefined}
                onKeyDown={clickable ? onRowKey(row) : undefined}>
                {selectable && (
                  <td className="uk-td uk-td--check" role={roles ? 'cell' : undefined} data-row-ignore="">
                    <SelectBox checked={isSel} label={name ? `Select ${name}` : `Select row ${i + 1}`} onChange={(on) => toggle(k, on)} />
                  </td>
                )}
                {columns.map((c) => {
                  const cellCls = cx('uk-td', c.primary && 'uk-td--primary', (c.numeric || c.align === 'right') && 'is-right', c.align === 'center' && 'is-center', c.numeric && 'is-num', c.hideOnCards && 'is-card-hidden', c.className)
                  const label_ = headerText(c)
                  const content = c.render(row, i)
                  return c.primary ? (
                    <th key={c.key} scope="row" className={cellCls} data-label={label_} role={roles ? 'rowheader' : undefined}>{content}</th>
                  ) : (
                    <td key={c.key} className={cellCls} data-label={label_} role={roles ? 'cell' : undefined}>{content}</td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export interface CellPersonProps {
  name: ReactNode
  /** Second line: department, email, employee code… */
  sub?: ReactNode
  /** Initials to show (default: from the name when it's text). */
  initials?: string
  /** Photo URL. */
  src?: string | null
  /** 32 (sections, default) or 36 (directory). */
  size?: 32 | 36
  tone?: AvatarTone
  /** No avatar, just the two lines. */
  plain?: boolean
}

/** Avatar + name + sub-line: the first cell of people tables. */
export function CellPerson({ name, sub, initials, src, size = 32, tone = 'soft', plain }: CellPersonProps) {
  const text = typeof name === 'string' ? name : undefined
  return (
    <span className={cx('uk-cell-person', size === 36 && 'uk-cell-person--lg')}>
      {!plain && <Avatar name={text} initials={initials} src={src} size={size} tone={tone} weight={size === 32 ? 600 : 500} />}
      <span className="uk-cell-person__text">
        <span className="uk-cell-person__name">{name}</span>
        {sub != null && sub !== '' && <span className="uk-cell-person__sub">{sub}</span>}
      </span>
    </span>
  )
}

/** Two lines in a cell: a stronger first line and a quiet second one (designation · department). */
export function CellStack({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) {
  return (
    <span className="uk-cell-stack">
      <span className="uk-cell-stack__a">{primary}</span>
      {secondary != null && secondary !== '' && <span className="uk-cell-stack__b">{secondary}</span>}
    </span>
  )
}

/** Right-aligned row buttons (use Button size={30}, variant soft for the main action). */
export function CellActions({ children }: { children: ReactNode }) {
  return <span className="uk-cell-actions" data-row-ignore="">{children}</span>
}
