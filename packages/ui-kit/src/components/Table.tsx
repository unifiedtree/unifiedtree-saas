import React from 'react'
import { cn } from '../lib/cn'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  striped?: boolean
  hoverable?: boolean
  compact?: boolean
  stickyHeader?: boolean
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ striped, hoverable, compact, stickyHeader, className, children, ...props }, ref) => (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-700/50">
      <table
        ref={ref}
        className={cn(
          'w-full border-collapse text-sm',
          striped && '[&_tbody_tr:nth-child(even)]:bg-slate-800/30',
          hoverable && '[&_tbody_tr]:hover:bg-slate-800/50 [&_tbody_tr]:transition-colors [&_tbody_tr]:cursor-pointer',
          compact && '[&_th]:py-2 [&_td]:py-2',
          stickyHeader && '[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10',
          className
        )}
        {...props}
      >
        {children}
      </table>
    </div>
  )
)
Table.displayName = 'Table'

export const Thead = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, children, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('bg-slate-800/60 border-b border-slate-700/50', className)}
      {...props}
    >
      {children}
    </thead>
  )
)
Thead.displayName = 'Thead'

export const Tbody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, children, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn('divide-y divide-slate-700/30', className)}
      {...props}
    >
      {children}
    </tbody>
  )
)
Tbody.displayName = 'Tbody'

export const Tfoot = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, children, ...props }, ref) => (
    <tfoot
      ref={ref}
      className={cn('bg-slate-800/40 border-t border-slate-700/50', className)}
      {...props}
    >
      {children}
    </tfoot>
  )
)
Tfoot.displayName = 'Tfoot'

export const Tr = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, children, ...props }, ref) => (
    <tr ref={ref} className={cn('', className)} {...props}>
      {children}
    </tr>
  )
)
Tr.displayName = 'Tr'

export type SortDirection = 'asc' | 'desc' | null

export interface ThProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean
  sortDirection?: SortDirection
  align?: 'left' | 'center' | 'right'
}

export const Th = React.forwardRef<HTMLTableCellElement, ThProps>(
  ({ sortable, sortDirection, align = 'left', className, children, onClick, ...props }, ref) => {
    const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' }[align]
    return (
      <th
        ref={ref}
        onClick={onClick}
        className={cn(
          'px-4 py-3 font-semibold text-xs text-slate-400 uppercase tracking-wider whitespace-nowrap',
          alignClass,
          sortable && 'cursor-pointer select-none hover:text-slate-200 transition-colors',
          className
        )}
        {...props}
      >
        <div className={cn('flex items-center gap-1.5', align === 'right' && 'justify-end', align === 'center' && 'justify-center')}>
          {children}
          {sortable && (
            <span className="text-slate-500">
              {sortDirection === 'asc' ? (
                <ChevronUp size={14} className="text-indigo-400" />
              ) : sortDirection === 'desc' ? (
                <ChevronDown size={14} className="text-indigo-400" />
              ) : (
                <ChevronsUpDown size={14} />
              )}
            </span>
          )}
        </div>
      </th>
    )
  }
)
Th.displayName = 'Th'

export interface TdProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  truncate?: boolean
  align?: 'left' | 'center' | 'right'
  maxWidth?: number
}

export const Td = React.forwardRef<HTMLTableCellElement, TdProps>(
  ({ truncate, align = 'left', maxWidth, className, children, style, ...props }, ref) => {
    const alignClass = { left: 'text-left', center: 'text-center', right: 'text-right' }[align]
    return (
      <td
        ref={ref}
        className={cn(
          'px-4 py-3.5 text-sm text-slate-300',
          alignClass,
          truncate && 'truncate',
          className
        )}
        style={{ maxWidth: maxWidth ? `${maxWidth}px` : undefined, ...style }}
        {...props}
      >
        {children}
      </td>
    )
  }
)
Td.displayName = 'Td'
