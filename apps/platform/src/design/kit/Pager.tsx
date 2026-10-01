// The pager under a paged list (the Workforce directory keeps today's: "Showing 1–20 of 249
// people", numbered pages with gaps, previous / next, rows per page).
//
// Server paging: `page` is zero-based, exactly what the list endpoint takes, and `total` is
// PageResponse.totalElements (the whole list, not this page). It behaves like today's
// HrPagination: a new page size goes back to the first page; with a single page there are no
// page buttons (the count stays, and the size choice when offered); with no rows it renders
// nothing (the table shows its own empty line). On phones the numbers give way to "3 / 13".
//
// A <nav> with its own name; the current page has aria-current="page"; the count is a polite
// live region, so screen readers hear "Showing 21–40 of 249" after a page change.
import { useId } from 'react'
import { cx, renderIcon } from './displayUtil'
import './display.css'
import './data.css'

/** Number of pages for `total` rows at `size` a page (at least 1). */
export function pageCount(total: number, size: number): number {
  const t = Math.max(0, Math.floor(Number(total) || 0))
  const s = Math.floor(Number(size) || 0)
  if (s <= 0) return 1
  return Math.max(1, Math.ceil(t / s))
}

/** A zero-based page pulled back into range (a list that shrank under the reader). */
export function clampPage(page: number, total: number, size: number): number {
  const p = Math.floor(Number(page) || 0)
  return Math.min(Math.max(0, p), pageCount(total, size) - 1)
}

/** The rows a page shows, 1-based and inclusive ("21–40"); 0–0 when there are none. */
export function pageRange(page: number, size: number, total: number): { from: number; to: number } {
  const t = Math.max(0, Math.floor(Number(total) || 0))
  const s = Math.floor(Number(size) || 0)
  if (!t || s <= 0) return { from: 0, to: 0 }
  const p = clampPage(page, t, s)
  return { from: p * s + 1, to: Math.min((p + 1) * s, t) }
}

export type PageItem = number | 'gap'

/**
 * The page numbers to show, 1-based: the first, the last, and one either side of the current
 * page, with a gap for the rest. A gap that would hide a single page shows that page instead.
 *   pageList(5, 13) → [1, 'gap', 5, 6, 7, 'gap', 13]
 */
export function pageList(page: number, pages: number): PageItem[] {
  const n = Math.max(1, Math.floor(Number(pages) || 1))
  const cur = Math.min(Math.max(1, Math.floor(Number(page) || 0) + 1), n)
  const keep = new Set<number>([1, n, cur - 1, cur, cur + 1])
  const out: PageItem[] = []
  let prev = 0
  for (let i = 1; i <= n; i++) {
    if (!keep.has(i)) continue
    if (i - prev === 2) out.push(i - 1)
    else if (i - prev > 2) out.push('gap')
    out.push(i)
    prev = i
  }
  return out
}

const fmt = (n: number) => n.toLocaleString('en-IN')

export interface PagerProps {
  /** Zero-based page, as sent to the backend. */
  page: number
  /** Rows per page (the `size` the list asked for). */
  pageSize: number
  /** All rows (PageResponse.totalElements). */
  total: number
  onPageChange: (page: number) => void
  /** Offer a rows-per-page choice. Changing it also goes back to the first page. */
  onPageSizeChange?: (size: number) => void
  /** The sizes offered (default 10, 25, 50, 100; the current size is always included). */
  pageSizes?: readonly number[]
  /** What the rows are, after the count: "people", "records". */
  noun?: string
  /** The count before a filter, for "· filtered from 312". */
  filteredFrom?: number
  /** Numbered page buttons (default true). Without them the pager shows "3 / 13". */
  numbers?: boolean
  /** Accessible name of the page buttons (default "Pages"). */
  label?: string
  className?: string
}

const SIZES = [10, 25, 50, 100]

export function Pager({
  page, pageSize, total, onPageChange, onPageSizeChange, pageSizes = SIZES, noun, filteredFrom, numbers = true, label = 'Pages', className,
}: PagerProps) {
  const sizeId = useId()
  const t = Math.max(0, Math.floor(Number(total) || 0))
  if (!t) return null
  const pages = pageCount(t, pageSize)
  const cur = clampPage(page, t, pageSize)
  const { from, to } = pageRange(cur, pageSize, t)
  const sizes = pageSizes.includes(pageSize) ? pageSizes : [...pageSizes, pageSize].sort((a, b) => a - b)
  const filtered = filteredFrom != null && Number.isFinite(filteredFrom) && filteredFrom !== t

  return (
    <div className={cx('uk-pager', !numbers && 'uk-pager--nonum', className)}>
      <div className="uk-pager__info">
        <p className="uk-pager__range" aria-live="polite">
          Showing <b>{fmt(from)}–{fmt(to)}</b> of <b>{fmt(t)}</b>{noun ? ` ${noun}` : ''}
          {filtered && <span className="uk-pager__filtered"> · filtered from {fmt(filteredFrom!)}</span>}
        </p>
        {onPageSizeChange && (
          <span className="uk-pager__size">
            <label htmlFor={sizeId}>Rows</label>
            <span className="uk-pager__selwrap">
              <select id={sizeId} className="uk-pager__select" value={pageSize} aria-label="Rows per page" data-testid="rows-per-page"
                onChange={(e) => {
                  onPageSizeChange(Number(e.target.value))
                  // Page 7 of a 10-row list doesn't exist at 100 rows a page: start again at the top.
                  onPageChange(0)
                }}>
                {sizes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="uk-pager__chev" aria-hidden="true">{renderIcon('chevronDown', 14)}</span>
            </span>
          </span>
        )}
      </div>
      {pages > 1 && (
        <nav className="uk-pager__nav" aria-label={label}>
          <button type="button" className="uk-pager__btn" aria-label="Previous page" disabled={cur <= 0} onClick={() => onPageChange(cur - 1)}>
            {renderIcon('chevronLeft', 16)}
          </button>
          {numbers && pageList(cur, pages).map((it, i) => it === 'gap'
            ? <span key={`gap-${i}`} className="uk-pager__gap" aria-hidden="true">…</span>
            : (
              <button key={it} type="button" className={cx('uk-pager__btn', 'uk-pager__num', it === cur + 1 && 'is-on')}
                aria-label={`Page ${it}`} aria-current={it === cur + 1 ? 'page' : undefined}
                onClick={() => { if (it !== cur + 1) onPageChange(it - 1) }}>
                {fmt(it)}
              </button>
            ))}
          <span className="uk-pager__of">
            <span aria-hidden="true">{fmt(cur + 1)} / {fmt(pages)}</span>
            <span className="uk-sr">Page {cur + 1} of {pages}</span>
          </span>
          <button type="button" className="uk-pager__btn" aria-label="Next page" disabled={cur >= pages - 1} onClick={() => onPageChange(cur + 1)}>
            {renderIcon('chevronRight', 16)}
          </button>
        </nav>
      )}
    </div>
  )
}
