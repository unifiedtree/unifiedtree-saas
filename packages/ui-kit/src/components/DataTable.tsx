import React, { useCallback } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '../cn';
import { TableSkeleton } from './Skeleton';
import { EmptyState } from './EmptyState';

export interface Column<T> {
  key: string;
  header: string;
  /** Render cell content. Receives the row and the column key. */
  cell: (row: T) => React.ReactNode;
  sortable?: boolean;
  /** Hide column below this Tailwind breakpoint class, e.g. 'sm', 'md', 'lg' */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  headerClassName?: string;
}

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  getRowKey: (row: T) => string;
  isLoading?: boolean;
  error?: Error | null;
  sortState?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyVariant?: 'first-run' | 'filtered';
  className?: string;
  stickyHeader?: boolean;
}

const HIDE_BELOW_CLASS: Record<string, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

export function DataTable<T>({
  columns,
  data,
  getRowKey,
  isLoading = false,
  error = null,
  sortState,
  onSortChange,
  onRowClick,
  emptyTitle,
  emptyDescription,
  emptyVariant = 'first-run',
  className,
  stickyHeader = false,
}: DataTableProps<T>) {
  const handleSort = useCallback(
    (col: Column<T>) => {
      if (!col.sortable || !onSortChange) return;
      const dir: SortDirection =
        sortState?.key === col.key && sortState.direction === 'asc' ? 'desc' : 'asc';
      onSortChange({ key: col.key, direction: dir });
    },
    [sortState, onSortChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, row: T) => {
      if (!onRowClick) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onRowClick(row);
      }
    },
    [onRowClick],
  );

  if (isLoading) {
    return <TableSkeleton rows={6} cols={columns.length} className={className} />;
  }

  if (error) {
    return (
      <EmptyState
        variant="error"
        description={error.message}
        className={className}
      />
    );
  }

  if (data.length === 0) {
    return (
      <EmptyState
        variant={emptyVariant}
        title={emptyTitle}
        description={emptyDescription}
        className={className}
      />
    );
  }

  return (
    <div className={cn('w-full overflow-auto', className)}>
      <table className="w-full caption-bottom text-sm">
        <thead
          className={cn(
            'bg-[var(--bg-surface)] [&_tr]:border-b [&_tr]:border-[var(--border-default)]',
            stickyHeader && 'sticky top-0 z-10',
          )}
        >
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={cn(
                  'h-10 px-4 text-left align-middle text-xs font-semibold uppercase tracking-wider text-[var(--text-tertiary)]',
                  col.sortable && 'cursor-pointer select-none hover:text-[var(--text-primary)]',
                  col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
                  col.headerClassName,
                )}
                onClick={col.sortable ? () => handleSort(col) : undefined}
                aria-sort={
                  sortState?.key === col.key
                    ? sortState.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : col.sortable
                    ? 'none'
                    : undefined
                }
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && (
                    <span className="ml-1 text-[var(--text-disabled)]">
                      {sortState?.key === col.key ? (
                        sortState.direction === 'asc' ? (
                          <ChevronUp size={12} className="text-[var(--accent-fg)]" />
                        ) : (
                          <ChevronDown size={12} className="text-[var(--accent-fg)]" />
                        )
                      ) : (
                        <ChevronsUpDown size={12} />
                      )}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr:last-child]:border-0">
          {data.map(row => (
            <tr
              key={getRowKey(row)}
              className={cn(
                'border-b border-[var(--border-subtle)] transition-colors',
                onRowClick &&
                  'cursor-pointer hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-focus)]',
              )}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? e => handleKeyDown(e, row) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              role={onRowClick ? 'button' : undefined}
            >
              {columns.map(col => (
                <td
                  key={col.key}
                  className={cn(
                    'px-4 py-3 align-middle text-[var(--text-primary)]',
                    col.hideBelow && HIDE_BELOW_CLASS[col.hideBelow],
                    col.className,
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
