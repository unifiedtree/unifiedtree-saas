import React from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Footer pager for a server-paginated `TableCard`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every HRMS list endpoint returns `PageResponse<T>` (content / page / size /
 * totalElements / totalPages / last) and every hook already accepts a page
 * number — but eight tables hard-coded `page = 0` and rendered no control, so
 * everything past the first 20 (or 50) rows was unreachable in the product. To
 * a client with real headcount that reads as "our data is missing".
 *
 * Employees.tsx and letters/GeneratedLetters.tsx were the only two screens that
 * had a working pager, and they had each hand-rolled the same markup with
 * cosmetic drift (gap-1 vs gap-2, opacity-30 vs opacity-40). This is that markup
 * factored out once, based on the Employees.tsx variant — it is the more
 * legible of the two (bold figures against secondary label text, so the numbers
 * read at a glance) and its larger hit-area gap is easier to click.
 *
 * Both originals also rendered the bar whenever `total > 0`, which left a dead
 * "1 / 1" with two permanently-disabled arrows on every small tenant. This one
 * disappears instead — see `hrPaginationFooter`.
 */
export interface HrPaginationProps {
  /** Zero-based page index, exactly as sent to the backend. */
  page: number
  /**
   * Rows per page — the same `size` the hook puts on the query string. Pass the
   * hook's exported constant rather than a literal so the label can never drift
   * from what was actually requested.
   */
  pageSize: number
  /** `PageResponse.totalElements` — the tenant-wide count, not the page's. */
  totalElements: number
  /** `PageResponse.totalPages`. */
  totalPages: number
  onPageChange: (page: number) => void
  /**
   * Opt into a rows-per-page control. Supply a handler and the pager renders
   * the selector; omit it and the pager is exactly what it was before.
   *
   * Opt-in rather than always-on because `pageSize` is currently a hook
   * constant on most screens — a screen must be able to *accept* a new size
   * before it is offered one, otherwise the control would silently do nothing.
   */
  onPageSizeChange?: (size: number) => void
  /** Sizes offered. Defaults to 10 / 25 / 50 / 100. */
  pageSizeOptions?: number[]
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100]

export function HrPagination({
  page, pageSize, totalElements, totalPages, onPageChange,
  onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZES,
}: HrPaginationProps) {
  // Nothing to page through: render nothing at all rather than a row of
  // permanently-disabled controls — UNLESS a rows-per-page control is offered,
  // in which case the bar must stay so the user can enlarge the page and can
  // get back from a size that collapsed the list to one page.
  if (totalPages <= 1 && !onPageSizeChange) return null

  const first = totalElements === 0 ? 0 : page * pageSize + 1
  const last = Math.min((page + 1) * pageSize, totalElements)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-xs text-text-secondary">
          Showing <span className="font-semibold text-text-primary">{first}–{last}</span> of{' '}
          <span className="font-semibold text-text-primary">{totalElements}</span>
        </p>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-xs text-text-secondary">
            Rows
            <select
              value={pageSize}
              aria-label="Rows per page"
              data-testid="rows-per-page"
              onChange={(e) => {
                // Jump back to the first page: page 7 of a 10-row list does not
                // exist once the size becomes 100, and asking the server for it
                // returns an empty page that reads as "the data vanished".
                onPageSizeChange(Number(e.target.value))
                onPageChange(0)
              }}
              className="ut-select ut-select-sm w-auto min-w-[72px]"
            >
              {pageSizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      {/* Nav cluster only when there is somewhere to go. With a rows-per-page
          control the bar can now survive a single-page result, and a permanent
          "1 / 1" between two dead arrows is exactly the dead control this
          component was factored out to remove. */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0}
            aria-label="Previous page"
            className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="px-1 text-xs font-semibold text-text-primary">{page + 1} / {totalPages}</span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1}
            aria-label="Next page"
            className="rounded-lg border border-border-default p-1.5 text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The pager as a value for `TableCard`'s `footer` prop.
 *
 * TableCard renders `{footer && <div className="border-t …">{footer}</div>}`, so
 * ANY non-null element — including a component that renders null — still draws
 * an empty bordered strip under the table. The single-page test therefore has
 * to happen before the element is created, not inside it.
 */
export function hrPaginationFooter(props: HrPaginationProps): React.ReactNode {
  // A rows-per-page control keeps the bar worth drawing even on a single page:
  // the user may have just chosen "100" and needs a way back to "10".
  const worthDrawing = props.totalPages > 1 || Boolean(props.onPageSizeChange)
  return worthDrawing ? <HrPagination {...props} /> : undefined
}

/**
 * Pulls the caller back into range when the result set shrinks underneath it.
 *
 * Needed on any list whose rows can leave it while the user is looking — a
 * deleted document, a claim that has just been reimbursed out of the approvals
 * queue. Delete the only row on the last page and `totalPages` drops by one,
 * but the page index does not: the next fetch asks for a page the server no
 * longer has, gets an empty `content` back, and the table reads as "everything
 * is gone" with a nonsensical "4 / 3" beneath it.
 *
 * Only steps BACKWARD, and only once data has actually arrived (`totalPages`
 * defaults to 1 while loading, which would otherwise slam every page to 0 on
 * the first render of page 2).
 */
export function useClampedPage(
  page: number,
  totalPages: number | undefined,
  onPageChange: (page: number) => void,
) {
  React.useEffect(() => {
    if (totalPages == null || totalPages < 1) return
    if (page > totalPages - 1) onPageChange(totalPages - 1)
  }, [page, totalPages, onPageChange])
}
