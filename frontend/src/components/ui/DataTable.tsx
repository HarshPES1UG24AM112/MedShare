import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import type { SortDirection } from '@/api/types';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, Skeleton } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** When set, the header becomes a sort toggle for this server-side sort key. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hide below the md breakpoint to keep tables readable on phones. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  sortBy?: string;
  sortDir?: SortDirection;
  onSortChange?: (sortBy: string, dir: SortDirection) => void;
  onRowClick?: (row: T) => void;
  empty?: { title: string; description?: ReactNode; action?: ReactNode };
  rowClassName?: (row: T) => string | undefined;
  skeletonRows?: number;
  caption?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  onRetry,
  sortBy,
  sortDir,
  onSortChange,
  onRowClick,
  empty,
  rowClassName,
  skeletonRows = 8,
  caption,
}: DataTableProps<T>) {
  const alignCls = (a?: string) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');

  if (error && !loading) return <ErrorState error={error} onRetry={onRetry} />;

  return (
    // `relative` keeps absolutely-positioned descendants (sr-only labels) clipped by the scroller.
    <div className="scrollbar-thin relative overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-line bg-subtle/70">
            {columns.map((c) => {
              const active = c.sortKey && sortBy === c.sortKey;
              const ariaSort = active ? (sortDir === 'desc' ? 'descending' : 'ascending') : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn('px-4 py-2.5 text-xs font-medium whitespace-nowrap text-ink-500', alignCls(c.align), c.hideOnMobile && 'hidden md:table-cell', c.className)}
                >
                  {c.sortKey && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(c.sortKey!, active && sortDir === 'asc' ? 'desc' : 'asc')}
                      className={cn('inline-flex items-center gap-1 hover:text-ink-900', active && 'text-ink-900', c.align === 'right' && 'flex-row-reverse')}
                    >
                      {c.header}
                      {active ? (
                        sortDir === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: skeletonRows }).map((_, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3', c.hideOnMobile && 'hidden md:table-cell')}>
                      <Skeleton className="h-4 w-full max-w-36" />
                    </td>
                  ))}
                </tr>
              ))
            : rows?.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    'border-b border-line last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-subtle/60',
                    rowClassName?.(row),
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3 align-middle', alignCls(c.align), c.hideOnMobile && 'hidden md:table-cell', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows && rows.length === 0 && (
        <EmptyState title={empty?.title ?? 'No records found'} description={empty?.description} action={empty?.action} />
      )}
    </div>
  );
}
