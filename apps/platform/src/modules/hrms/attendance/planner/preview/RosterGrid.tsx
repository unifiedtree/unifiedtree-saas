// The live preview's grid (design §1.6 "Right column"), also used read-only by the import page.
// Sticky day header (date + weekday letter; holidays tinted, named on hover) and sticky first column (name, code,
// designation); a cell per day with the code: WO grey, PH / L / COFF badges over the cell, a dot on edited cells, a red
// (error) or amber (warning) outline on cells with issues, hatched days before joining or after leaving; the S13
// totals at the right; a row menu.
// Editing: click a cell for the picker; arrows move, typing a code sets it (W = WO, Delete = clear), drag or
// shift-click a range then pick to fill it, Ctrl+Z undoes. The grid paints the edit at once through `onEdit`.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Menu, type MenuEntry } from '@/design/kit/overlays'
import type { CellToken } from '../../../api/rosterTypes'
import { tokenForTyped, type CellEdit, type GridCell, type GridDay, type GridRow, type GridView, type ShiftLite } from '../plannerModel'
import { CellPicker } from './CellPicker'

export interface GridFlash { employeeId: string | null; dates: string[]; key: number }

export interface RosterGridProps {
  view: GridView
  /** Shifts offered in the picker and typed codes (the ticked ones). */
  shifts: readonly ShiftLite[]
  label?: string
  readOnly?: boolean
  compact?: boolean
  /** Extra table sections under the rows (the coverage rows). */
  footer?: ReactNode
  onEdit?: (edits: CellEdit[]) => void
  onUndo?: () => void
  /** Items of a row's menu ("Start on pattern day…", "Clear row", "Remove from roster"). */
  rowMenu?: (row: GridRow) => MenuEntry[]
  /** Scroll to these cells and flash them (from the Schedule check). */
  flash?: GridFlash | null
  /** Shown when there are no rows. */
  empty?: ReactNode
  maxHeight?: number | string
}

interface Pos { r: number; c: number }
const TOTALS = [
  { key: 'working', label: 'Work', title: 'Working days' },
  { key: 'weeklyOff', label: 'WO', title: 'Weekly offs' },
  { key: 'holiday', label: 'PH', title: 'Holidays' },
  { key: 'leave', label: 'L', title: 'Leave and comp-off' },
] as const
export const TOTAL_COLUMNS = TOTALS.length

const OVERLAY_LABEL = { PH: 'PH', L: 'L', COFF: 'CO' } as const

const WD3 = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const dayLabel = (d: GridDay) => `${WD3[d.weekday - 1]} ${d.dayNo} ${MON3[Number(d.date.slice(5, 7)) - 1]}`

function cellTitle(row: GridRow, day: GridDay, cell: GridCell, shifts: ReadonlyMap<string, ShiftLite>) {
  const s = cell.token && cell.token !== 'WO' ? shifts.get(cell.token) : undefined
  const parts = [`${row.name} · ${dayLabel(day)}`]
  parts.push(cell.token == null ? 'Nothing planned' : cell.token === 'WO' ? 'Weekly off' : s ? `${s.code} · ${s.name} ${s.start}–${s.end}` : cell.code ?? 'Shift')
  if (cell.overlay) parts.push(`${cell.overlay.label}${cell.overlay.halfDay ? ' (half day)' : ''}`)
  if (day.holidayName && cell.overlay?.type !== 'PH') parts.push(`Holiday: ${day.holidayName}`)
  if (cell.outside) parts.push('Not employed on this day')
  if (cell.edited) parts.push('Edited by hand')
  if (cell.locked) parts.push('Already published; days before today can’t change')
  return parts.join(' · ')
}

const Row = memo(function Row({ row, r, days, shiftMap, sel, active, flash, readOnly, rowMenu }: {
  row: GridRow; r: number; days: GridDay[]; shiftMap: ReadonlyMap<string, ShiftLite>
  sel: { r1: number; r2: number; c1: number; c2: number } | null; active: Pos | null; flash: Set<number> | null
  readOnly: boolean; rowMenu?: (row: GridRow) => MenuEntry[]
}) {
  const inRow = !!sel && r >= sel.r1 && r <= sel.r2
  const menu = !readOnly && rowMenu ? rowMenu(row) : null
  return (
    <tr className="spl-grid__row" data-employee={row.employeeId}>
      <th scope="row" className="spl-grid__name">
        <span className="spl-grid__who">
          <span className="spl-grid__person">{row.name}</span>
          <span className="spl-grid__meta">{[row.code, row.designationName].filter(Boolean).join(' · ') || 'No designation'}</span>
        </span>
        {menu && menu.length > 0 && (
          <Menu label={`${row.name}: row actions`} items={menu} width={240} placement="bottom-start"
            trigger={({ props }) => <button type="button" className="spl-grid__rowmenu" aria-label={`Actions for ${row.name}`} {...props}><MoreHorizontal size={16} aria-hidden="true" /></button>} />
        )}
      </th>
      {row.cells.map((cell, c) => {
        const d = days[c]
        const selected = inRow && c >= sel!.c1 && c <= sel!.c2
        const isActive = !!active && active.r === r && active.c === c
        return (
          <td key={c} role="gridcell" data-r={r} data-c={c} tabIndex={isActive ? 0 : -1}
            aria-selected={selected || undefined} aria-readonly={readOnly || cell.locked || undefined}
            className="spl-cell" data-tone={cell.tone} data-level={cell.level ?? undefined}
            data-outside={cell.outside ? '' : undefined} data-locked={cell.locked ? '' : undefined}
            data-holiday={d?.holidayName ? '' : undefined} data-weekend={d?.weekend ? '' : undefined}
            data-selected={selected ? '' : undefined} data-flash={flash?.has(c) ? '' : undefined}
            title={d ? cellTitle(row, d, cell, shiftMap) : undefined}>
            <span className="spl-cell__code">{cell.code ?? ''}</span>
            {cell.overlay && <span className="spl-cell__badge" data-type={cell.overlay.type}>{OVERLAY_LABEL[cell.overlay.type]}{cell.overlay.halfDay ? '½' : ''}</span>}
            {cell.edited && <span className="spl-cell__dot" aria-hidden="true" />}
          </td>
        )
      })}
      {TOTALS.map((t, i) => <td key={t.key} className={i ? 'spl-grid__total' : 'spl-grid__total spl-grid__total--first'}>{row.totals ? row.totals[t.key] : '–'}</td>)}
    </tr>
  )
})

export function RosterGrid({ view, shifts, label = 'Roster', readOnly = false, compact = false, footer, onEdit, onUndo, rowMenu, flash, empty, maxHeight = '70vh' }: RosterGridProps) {
  const { days, rows } = view
  const shiftMap = useMemo(() => new Map(shifts.map((s) => [s.id, s])), [shifts])
  const [anchor, setAnchor] = useState<Pos | null>(null)
  const [focus, setFocus] = useState<Pos | null>(null)
  const [picker, setPicker] = useState(false)
  const [pickerSoon, setPickerSoon] = useState(false)
  const [flashOn, setFlashOn] = useState<{ r: number; cols: Set<number> } | null>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const pickerAnchor = useRef<HTMLElement | null>(null)
  const dragging = useRef(false)
  const typed = useRef({ text: '', at: 0 })
  const editable = !readOnly && !!onEdit

  const sel = useMemo(() => (anchor && focus ? {
    r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c),
  } : null), [anchor, focus])

  // Keep the active cell inside the grid when rows or days change.
  useEffect(() => {
    if (!focus) return
    if (focus.r >= rows.length || focus.c >= days.length) { setFocus(null); setAnchor(null); setPicker(false) }
  }, [rows.length, days.length, focus])

  const cellEl = useCallback((p: Pos) => tableRef.current?.querySelector<HTMLElement>(`td[data-r="${p.r}"][data-c="${p.c}"]`) ?? null, [])
  const moveTo = useCallback((p: Pos, extend: boolean) => {
    const r = Math.max(0, Math.min(rows.length - 1, p.r)), c = Math.max(0, Math.min(days.length - 1, p.c))
    const next = { r, c }
    setFocus(next)
    if (!extend) setAnchor(next)
    requestAnimationFrame(() => { const el = cellEl(next); el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) })
  }, [rows.length, days.length, cellEl])

  const selectionEdits = useCallback((token: CellToken): CellEdit[] => {
    if (!sel) return []
    const out: CellEdit[] = []
    for (let r = sel.r1; r <= sel.r2; r++) {
      const row = rows[r]
      if (!row) continue
      for (let c = sel.c1; c <= sel.c2; c++) {
        const cell = row.cells[c]
        if (!cell || cell.locked || (token != null && cell.outside)) continue
        out.push({ employeeId: row.employeeId, index: c, token })
      }
    }
    return out
  }, [sel, rows])
  const fill = useCallback((token: CellToken) => { const e = selectionEdits(token); if (e.length) onEdit?.(e) }, [selectionEdits, onEdit])
  const selCount = sel ? (sel.r2 - sel.r1 + 1) * (sel.c2 - sel.c1 + 1) : 0
  const openPicker = useCallback(() => {
    if (!editable || !focus) return
    if (!selectionEdits('WO').length && !selectionEdits(null).length) return
    pickerAnchor.current = cellEl(focus)
    setPicker(true)
  }, [editable, focus, selectionEdits, cellEl])

  // ── Mouse: press to select, drag (or shift-click) for a range, release opens the picker ──
  const posOf = (e: MouseEvent) => {
    const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-r]')
    return td ? { r: Number(td.dataset.r), c: Number(td.dataset.c) } : null
  }
  const onMouseDown = (e: MouseEvent<HTMLTableElement>) => {
    if (e.button !== 0) return
    const p = posOf(e)
    if (!p) return
    e.preventDefault()
    setPicker(false)
    if (e.shiftKey && anchor) setFocus(p)
    else { setAnchor(p); setFocus(p) }
    cellEl(p)?.focus({ preventScroll: true })
    dragging.current = true
  }
  const onMouseOver = (e: MouseEvent<HTMLTableElement>) => {
    if (!dragging.current) return
    const p = posOf(e)
    if (p && (p.r !== focus?.r || p.c !== focus?.c)) setFocus(p)
  }
  useEffect(() => {
    const up = () => {
      if (!dragging.current) return
      dragging.current = false
      if (editable) requestAnimationFrame(() => setPickerSoon(true))
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [editable])
  // Opening waits for the selection state of the release to settle.
  useEffect(() => { if (pickerSoon) { setPickerSoon(false); openPicker() } }, [pickerSoon, openPicker])

  // ── Keyboard ──
  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (!(e.target as HTMLElement).closest('td[data-r]')) return
    const f = focus
    if (!f) return
    const k = e.key
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) { e.preventDefault(); if (editable) onUndo?.(); return }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const moves: Record<string, Pos> = { ArrowUp: { r: f.r - 1, c: f.c }, ArrowDown: { r: f.r + 1, c: f.c }, ArrowLeft: { r: f.r, c: f.c - 1 }, ArrowRight: { r: f.r, c: f.c + 1 }, Home: { r: f.r, c: 0 }, End: { r: f.r, c: days.length - 1 } }
    if (moves[k]) { e.preventDefault(); moveTo(moves[k], e.shiftKey); return }
    if (k === 'Escape') { setAnchor(f); return }
    if (!editable) return
    if (k === 'Enter' || k === ' ' || k === 'F2') { e.preventDefault(); openPicker(); return }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); fill(null); return }
    if (/^[a-z0-9]$/i.test(k)) {
      const now = Date.now()
      const t = typed.current
      let text = now - t.at < 700 ? t.text + k : k
      let token = tokenForTyped(text, shifts)
      if (token === undefined && text.length > 1) { text = k; token = tokenForTyped(text, shifts) }
      typed.current = { text, at: now }
      if (token !== undefined) { e.preventDefault(); fill(token) }
    }
  }

  // ── Flash from the Schedule check ──
  useEffect(() => {
    if (!flash) return
    const r = rows.findIndex((x) => x.employeeId === flash.employeeId)
    const cols = new Set(flash.dates.map((d) => days.findIndex((x) => x.date === d)).filter((i) => i >= 0))
    const target = r >= 0 ? cellEl({ r, c: cols.size ? Math.min(...cols) : 0 }) : null
    const rowEl = r >= 0 ? null : (cols.size ? tableRef.current?.querySelector<HTMLElement>(`th[data-c="${Math.min(...cols)}"]`) : null)
    ;(target ?? rowEl)?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    if (r < 0) return
    setFlashOn({ r, cols })
    const t = window.setTimeout(() => setFlashOn(null), 1800)
    return () => window.clearTimeout(t)
  }, [flash]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = focus ?? (rows.length && days.length ? { r: 0, c: 0 } : null)
  const current = sel && sel.r1 === sel.r2 && sel.c1 === sel.c2 ? rows[sel.r1]?.cells[sel.c1]?.token ?? null : undefined

  return (
    <div className="spl-grid" data-compact={compact ? '' : undefined} data-readonly={readOnly ? '' : undefined} style={{ maxHeight }}>
      <table ref={tableRef} className="spl-grid__table" role="grid" aria-label={label} aria-rowcount={rows.length + 1} aria-colcount={days.length + 1 + TOTAL_COLUMNS}
        onMouseDown={onMouseDown} onMouseOver={onMouseOver} onKeyDown={onKeyDown}>
        <thead>
          <tr>
            <th scope="col" className="spl-grid__name spl-grid__corner">{rows.length} {rows.length === 1 ? 'person' : 'people'}</th>
            {days.map((d, c) => (
              <th key={d.date} scope="col" data-c={c} className="spl-grid__day" data-holiday={d.holidayName ? '' : undefined} data-weekend={d.weekend ? '' : undefined}
                data-today={d.today ? '' : undefined} title={d.holidayName ? `${d.date} · ${d.holidayName}` : d.date}>
                <span className="spl-grid__dayno">{d.dayNo}</span>
                <span className="spl-grid__wd">{d.letter}</span>
              </th>
            ))}
            {TOTALS.map((t, i) => <th key={t.key} scope="col" className={`spl-grid__total spl-grid__total--head${i ? '' : ' spl-grid__total--first'}`} title={t.title}>{t.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <Row key={row.employeeId} row={row} r={r} days={days} shiftMap={shiftMap}
              sel={sel && r >= sel.r1 && r <= sel.r2 ? sel : null}
              active={active && active.r === r ? active : null}
              flash={flashOn && flashOn.r === r ? flashOn.cols : null}
              readOnly={readOnly} rowMenu={rowMenu} />
          ))}
          {!rows.length && (
            <tr><td className="spl-grid__empty" colSpan={days.length + 1 + TOTAL_COLUMNS}>{empty ?? 'No one on this roster yet.'}</td></tr>
          )}
        </tbody>
        {footer}
      </table>
      {editable && (
        <CellPicker open={picker} anchorRef={pickerAnchor} onClose={() => { setPicker(false); if (focus) cellEl(focus)?.focus({ preventScroll: true }) }}
          shifts={shifts} current={current} count={selCount} onPick={fill} />
      )}
    </div>
  )
}
