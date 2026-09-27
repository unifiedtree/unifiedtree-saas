// A plain data table in the redesign's look (prototype UtSection "table" /
// kit Table): a grey header strip with quiet 12px labels, 13.5px rows with
// hairline dividers and a soft hover. Columns keep their natural widths and
// text wraps as before (this is not the kit Table's fixed layout). Same props
// and behaviour: click-to-sort headers, clickable rows, sub-rows, a footer.
import React, { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { SkeletonTable } from '@/design/kit/Skeleton'

export interface Column<T> {
  key: keyof T | string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  width?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyField: keyof T
  loading?: boolean
  emptyMessage?: string
  onRowClick?: (row: T) => void
  footer?: React.ReactNode
  expandedRowIds?: (string | number)[]
  renderSubRow?: (row: T) => React.ReactNode
}

export function DataTable<T>({
  columns,
  data,
  keyField,
  loading,
  emptyMessage = 'No records found',
  onRowClick,
  footer,
  expandedRowIds = [],
  renderSubRow,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = [...data].sort((a, b) => {
    if (!sortKey) return 0
    const av = (a as Record<string, unknown>)[sortKey]
    const bv = (b as Record<string, unknown>)[sortKey]
    if (av === bv) return 0
    const cmp = String(av) < String(bv) ? -1 : 1
    return sortDir === 'asc' ? cmp : -cmp
  })

  if (loading) {
    return (
      <div className="ut-card overflow-hidden" style={{ borderRadius: 16, borderColor: 'var(--u-ln,#E3E9E6)', background: 'var(--u-sf,#fff)', boxShadow: 'none' }}>
        <SkeletonTable rows={5} cols={Math.max(2, columns.length)} />
      </div>
    )
  }

  const cell = 'px-4 first:pl-5 last:pr-5'
  return (
    <div className="overflow-x-auto w-full rounded-[10px]">
      <table className="w-full text-[13.5px] text-[var(--u-ink,#0E1B16)]">
        <thead>
          <tr className="bg-[var(--u-sf2,#F7F9F8)]">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={clsx(
                  cell,
                  'border-y border-[var(--u-ln2,#EDF1EF)] py-2.5 text-left text-[12px] font-medium text-[var(--u-ink3,#6A7A73)]',
                  col.sortable && 'cursor-pointer select-none hover:text-[var(--u-ink,#0E1B16)]',
                  col.width
                )}
                onClick={() => col.sortable && handleSort(String(col.key))}
              >
                <div className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === String(col.key) && (
                    sortDir === 'asc'
                      ? <ChevronUp size={12} aria-hidden="true" className="text-[var(--u-brt,#0F6E56)]" />
                      : <ChevronDown size={12} aria-hidden="true" className="text-[var(--u-brt,#0F6E56)]" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-6 py-12 text-center text-[13.5px] text-[var(--u-ink3,#6A7A73)]">{emptyMessage}</td></tr>
          ) : (
            sorted.map((row) => (
              <React.Fragment key={String(row[keyField])}>
                <tr
                  className={clsx(
                    'border-b border-[var(--u-ln2,#EDF1EF)] last:border-0 transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-[var(--u-hv,#F0F4F2)]' : 'hover:bg-[var(--u-sf2,#F7F9F8)]'
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={String(col.key)} className={clsx(cell, 'py-3 text-[var(--u-ink2,#4A5A54)]')}>
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[String(col.key)] ?? '—')}
                    </td>
                  ))}
                </tr>
                {renderSubRow && expandedRowIds.includes(String(row[keyField])) && (
                  <tr>
                    <td colSpan={columns.length} className="p-0 border-b border-[var(--u-ln2,#EDF1EF)]">
                      {renderSubRow(row)}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))
          )}
        </tbody>
        {footer}
      </table>
    </div>
  )
}
