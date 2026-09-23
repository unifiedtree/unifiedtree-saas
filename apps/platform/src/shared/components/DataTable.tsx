import React, { useState } from 'react'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

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
      <div className="ut-card animate-pulse space-y-3 p-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 bg-white/50 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="overflow-x-auto w-full rounded-[10px]">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={clsx(
                  'px-6 py-4 text-left text-xs font-bold text-gray-500 uppercase tracking-wider',
                  col.sortable && 'cursor-pointer hover:text-gray-900 select-none',
                  col.width
                )}
                onClick={() => col.sortable && handleSort(String(col.key))}
              >
                <div className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === String(col.key) && (
                    sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr><td colSpan={columns.length} className="px-6 py-16 text-center text-gray-500 text-sm font-medium">{emptyMessage}</td></tr>
          ) : (
            sorted.map((row) => (
              <React.Fragment key={String(row[keyField])}>
                <tr
                  className={clsx(
                    'border-b border-gray-100 last:border-0 transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-gray-50/80' : 'hover:bg-gray-50/50'
                  )}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => (
                    <td key={String(col.key)} className="px-6 py-4 text-gray-700 font-medium">
                      {col.render
                        ? col.render(row)
                        : String((row as Record<string, unknown>)[String(col.key)] ?? '—')}
                    </td>
                  ))}
                </tr>
                {renderSubRow && expandedRowIds.includes(String(row[keyField])) && (
                  <tr>
                    <td colSpan={columns.length} className="p-0 border-b border-gray-100">
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
