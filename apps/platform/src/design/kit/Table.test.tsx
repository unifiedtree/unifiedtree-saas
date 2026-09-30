import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { Table, CellPerson, CellStack, CellActions, StatusPill, type TableColumn, type TableProps, type TableSort } from './display'

type Emp = { id: number; name: string; code: string; dept: string; status: string; salary: number }
const rows: Emp[] = [
  { id: 1, name: 'Priya Sharma', code: 'UT-014', dept: 'Engineering', status: 'Active', salary: 58000 },
  { id: 2, name: 'Arjun Mehta', code: 'UT-022', dept: 'Finance', status: 'On leave', salary: 64000 },
  { id: 3, name: 'Kavya Iyer', code: 'UT-031', dept: 'People', status: 'Active', salary: 51000 },
]
const cols: TableColumn<Emp>[] = [
  { key: 'name', header: 'Employee', primary: true, width: '30%', sortable: true, render: (r) => <CellPerson name={r.name} sub={r.dept} /> },
  { key: 'code', header: 'Code', width: 96, render: (r) => r.code },
  { key: 'status', header: 'Status', render: (r) => <StatusPill tone={r.status === 'Active' ? 'brand' : 'leave'}>{r.status}</StatusPill>, hideOnCards: false },
  { key: 'salary', header: 'Salary', numeric: true, sortable: true, render: (r) => r.salary.toLocaleString('en-IN') },
]
const base: TableProps<Emp> = { columns: cols, rows, rowKey: (r) => r.id, label: 'Employees' }

const html = (el: ReactElement) => renderToStaticMarkup(el)
const count = (s: string, needle: string) => s.split(needle).length - 1

// Table has no hooks, so calling it returns the element tree; the handlers on it can be called directly.
type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>
function find(node: ReactNode, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => find(n, pred, out))
  else if (isValidElement(node)) {
    const e = node as El
    if (pred(e)) out.push(e)
    find(e.props.children, pred, out)
  }
  return out
}
const tree = (p: Partial<TableProps<Emp>>) => Table<Emp>({ ...base, ...p }) as ReactNode
const cls = (e: El) => String(e.props.className ?? '')
const bodyRows = (t: ReactNode) => find(t, (e) => e.type === 'tr' && cls(e).includes('uk-tr'))
const mouse = (over: Record<string, unknown> = {}) => ({ button: 0, ctrlKey: false, metaKey: false, shiftKey: false, target: { closest: () => null }, ...over })

type Globals = { window?: unknown }
const g = globalThis as unknown as Globals
afterEach(() => { delete g.window })

describe('Table: markup', () => {
  it('a real table: caption name, column headers with scope, a row header per row, cells', () => {
    const s = html(<Table {...base} />)
    expect(s).toContain('<div class="uk-table-wrap"><table class="uk-table uk-table--default" aria-label="Employees" style="min-width:640px">')
    expect(count(s, '<th scope="col" class="uk-th')).toBe(4)
    expect(count(s, '<th scope="row" class="uk-td uk-td--primary"')).toBe(3)
    expect(count(s, '<td class="uk-td')).toBe(9)
    expect(s).not.toContain('role=')
    expect(s).toContain('<col style="width:30%"/><col style="width:96px"/><col/><col/>')
  })

  it('figures are right-aligned with tabular numbers; header follows', () => {
    const s = html(<Table {...base} />)
    expect(s).toContain('<th scope="col" class="uk-th is-right">Salary</th>')
    expect(s).toContain('class="uk-td is-right is-num" data-label="Salary">58,000</td>')
  })

  it('person cell: avatar initials, name and sub-line', () => {
    const s = html(<Table {...base} />)
    expect(s).toContain('uk-cell-person')
    expect(s).toContain('>PS<')
    expect(s).toContain('<span class="uk-cell-person__name">Priya Sharma</span><span class="uk-cell-person__sub">Engineering</span>')
  })

  it('rows are not focusable unless they open something', () => {
    const s = html(<Table {...base} />)
    expect(s).not.toContain('tabindex')
    expect(s).not.toContain('is-link')
    const c = html(<Table {...base} onRowClick={() => {}} />)
    expect(count(c, '<tr class="uk-tr is-link" tabindex="0"')).toBe(3)
    expect(c).toContain('uk-table--links')
  })

  it('rowHref is written on the row for middle / ctrl click', () => {
    const s = html(<Table {...base} rowHref={(r) => `/employees/${r.id}`} />)
    expect(s).toContain('data-href="/employees/2"')
    expect(s).toContain('tabindex="0"')
  })

  it('density, sticky header, own scroll height and minimum width', () => {
    expect(html(<Table {...base} dense />)).toContain('uk-table--compact')
    expect(html(<Table {...base} density="comfy" />)).toContain('uk-table--comfy')
    const s = html(<Table {...base} stickyHeader maxHeight={420} minWidth={860} />)
    expect(s).toContain('<div class="uk-table-wrap uk-table-wrap--sticky" style="max-height:420px">')
    expect(s).toContain('style="min-width:860px"')
  })

  it('empty: one message row across every column', () => {
    const s = html(<Table {...base} rows={[]} selectable selected={[]} onSelectedChange={() => {}} empty="No one matches this search" />)
    expect(s).toContain('<td colSpan="5" class="uk-td uk-td--empty">No one matches this search</td>')
    const none = html(<Table {...base} rows={[]} />)
    expect(none).not.toContain('uk-td--empty')
    expect(none).toContain('<thead>')
  })

  it('loading: the table skeleton, labelled', () => {
    const s = html(<Table {...base} loading />)
    expect(s).toContain('uk-skel-table')
    expect(s).toContain('Loading Employees')
    expect(s).not.toContain('<table')
  })

  it('phone cards: explicit roles (display:block drops them) and a label per cell', () => {
    const s = html(<Table {...base} mobile="cards" columns={[...cols.slice(0, 3), { ...cols[3], hideOnCards: true }]} />)
    expect(s).toContain('uk-table-wrap--cards')
    expect(s).toContain('role="table"')
    expect(count(s, 'role="rowgroup"')).toBe(2)
    expect(count(s, 'role="row"')).toBe(4)
    expect(count(s, 'role="columnheader"')).toBe(4)
    expect(count(s, 'role="rowheader"')).toBe(3)
    expect(count(s, 'role="cell"')).toBe(9)
    expect(s).toContain('data-label="Code"')
    expect(count(s, 'is-card-hidden')).toBe(3)
  })

  it('cells: stack and actions (actions never open the row)', () => {
    expect(html(<CellStack primary="Engineer" secondary="Engineering · Full-time" />)).toBe(
      '<span class="uk-cell-stack"><span class="uk-cell-stack__a">Engineer</span><span class="uk-cell-stack__b">Engineering · Full-time</span></span>',
    )
    expect(html(<CellStack primary="Engineer" />)).not.toContain('uk-cell-stack__b')
    expect(html(<CellActions><button>Approve</button></CellActions>)).toBe('<span class="uk-cell-actions" data-row-ignore=""><button>Approve</button></span>')
    expect(html(<CellPerson name="Arjun Mehta" size={36} plain />)).not.toContain('uk-av')
    expect(html(<CellPerson name="Arjun Mehta" size={36} />)).toContain('uk-cell-person--lg')
  })
})

describe('Table: sorting (controlled)', () => {
  it('only sortable columns get a button; the sorted one says its direction', () => {
    const s = html(<Table {...base} sort={{ key: 'salary', dir: 'desc' }} onSort={() => {}} />)
    expect(count(s, '<button type="button" class="uk-sort')).toBe(2)
    expect(s).toContain('<th scope="col" class="uk-th is-right" aria-sort="descending"><button type="button" class="uk-sort is-on">')
    expect(s).toContain('<th scope="col" class="uk-th">Code</th>')
    expect(count(s, 'aria-sort')).toBe(1)
  })

  it('no onSort, no buttons', () => {
    expect(html(<Table {...base} />)).not.toContain('uk-sort')
  })

  it('a click asks for ascending first, then flips', () => {
    const got: TableSort[] = []
    const onSort = (x: TableSort) => got.push(x)
    const click = (sort: TableSort | null, key: string) => {
      const btn = find(tree({ sort, onSort }), (e) => e.type === 'button' && cls(e).includes('uk-sort'))
      const i = cols.filter((c) => c.sortable).findIndex((c) => c.key === key)
      ;(btn[i].props.onClick as () => void)()
    }
    click(null, 'name')
    click({ key: 'name', dir: 'asc' }, 'name')
    click({ key: 'name', dir: 'desc' }, 'name')
    click({ key: 'name', dir: 'desc' }, 'salary')
    expect(got).toEqual([
      { key: 'name', dir: 'asc' },
      { key: 'name', dir: 'desc' },
      { key: 'name', dir: 'asc' },
      { key: 'salary', dir: 'asc' },
    ])
  })
})

describe('Table: selection (controlled)', () => {
  const boxes = (t: ReactNode) => find(t, (e) => typeof e.type === 'function' && 'onChange' in e.props && 'label' in e.props)

  it('checkboxes are labelled; select-all shows mixed when some are picked', () => {
    const s = html(<Table {...base} selectable selected={[2]} onSelectedChange={() => {}} rowLabel={(r) => r.name} />)
    expect(s).toContain('<col class="uk-col-check"/>')
    expect(s).toContain('aria-label="Select all rows"')
    expect(s).toContain('aria-label="Select Priya Sharma"')
    expect(count(s, 'type="checkbox"')).toBe(4)
    expect(count(s, 'checked=""')).toBe(1)
    expect(s).toContain('uk-check is-mixed')
    expect(s).toContain('<tr class="uk-tr is-selected">')
    expect(html(<Table {...base} selectable selected={[]} onSelectedChange={() => {}} />)).toContain('aria-label="Select row 1"')
  })

  it('all picked: select-all is checked, not mixed', () => {
    const s = html(<Table {...base} selectable selected={new Set([1, 2, 3])} onSelectedChange={() => {}} />)
    expect(count(s, 'checked=""')).toBe(4)
    expect(s).not.toContain('is-mixed')
  })

  it('ticking rows and select-all reports the keys (keys from other pages are kept)', () => {
    const got: unknown[] = []
    const on = (k: unknown) => got.push(k)
    let b = boxes(tree({ selectable: true, selected: [2, 99], onSelectedChange: on }))
    ;(b[1].props.onChange as (v: boolean) => void)(true) // Priya
    ;(b[2].props.onChange as (v: boolean) => void)(false) // Arjun off
    ;(b[0].props.onChange as (v: boolean) => void)(true) // all on
    b = boxes(tree({ selectable: true, selected: [1, 2, 3, 99], onSelectedChange: on }))
    ;(b[0].props.onChange as (v: boolean) => void)(false) // all off
    expect(got).toEqual([[1, 2, 99], [99], [99, 1, 2, 3], [99]])
  })

  it('the checkbox cell never opens the row', () => {
    const s = html(<Table {...base} selectable selected={[]} onSelectedChange={() => {}} onRowClick={() => {}} />)
    expect(s).toContain('<td class="uk-td uk-td--check" data-row-ignore="">')
  })
})

describe('Table: opening rows', () => {
  it('click or Enter opens the row; clicks on buttons inside and other keys do not', () => {
    const opened: string[] = []
    const t = tree({ onRowClick: (r) => opened.push(r.name) })
    const [r1, r2] = bodyRows(t)
    const onClick = r1.props.onClick as (e: unknown) => void
    const onKey = r2.props.onKeyDown as (e: unknown) => void
    onClick(mouse())
    onClick(mouse({ target: { closest: () => ({}) } })) // inside a button / link / [data-row-ignore]
    const self = {}
    onKey({ key: 'Enter', target: self, currentTarget: self, preventDefault() {} })
    onKey({ key: ' ', target: self, currentTarget: self, preventDefault() {} })
    onKey({ key: 'Enter', target: {}, currentTarget: self, preventDefault() {} }) // Enter on a control inside the row
    expect(opened).toEqual(['Priya Sharma', 'Arjun Mehta'])
  })

  it('with rowHref: ctrl/⌘/middle click opens a new tab, a plain click calls onRowClick', () => {
    const open = vi.fn()
    g.window = { open, location: { assign: vi.fn() } }
    const opened: number[] = []
    const t = tree({ rowHref: (r) => `/employees/${r.id}`, onRowClick: (r) => opened.push(r.id) })
    const [r1] = bodyRows(t)
    ;(r1.props.onClick as (e: unknown) => void)(mouse({ ctrlKey: true }))
    ;(r1.props.onAuxClick as (e: unknown) => void)(mouse({ button: 1 }))
    ;(r1.props.onAuxClick as (e: unknown) => void)(mouse({ button: 2 })) // right click: nothing
    ;(r1.props.onClick as (e: unknown) => void)(mouse())
    expect(open).toHaveBeenCalledTimes(2)
    expect(open).toHaveBeenCalledWith('/employees/1', '_blank', 'noopener')
    expect(opened).toEqual([1])
  })

  it('rowHref alone navigates on a plain click or Enter', () => {
    const assign = vi.fn()
    g.window = { open: vi.fn(), location: { assign } }
    const [, r2] = bodyRows(tree({ rowHref: (r) => `/employees/${r.id}` }))
    ;(r2.props.onClick as (e: unknown) => void)(mouse())
    const self = {}
    ;(r2.props.onKeyDown as (e: unknown) => void)({ key: 'Enter', target: self, currentTarget: self, preventDefault() {} })
    expect(assign).toHaveBeenCalledTimes(2)
    expect(assign).toHaveBeenCalledWith('/employees/2')
  })
})
