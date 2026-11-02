import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { PageMeta } from '@/api/types';
import { fmtNumber } from '@/lib/format';
import { Button } from './Button';

interface PaginationProps {
  meta: PageMeta | undefined;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}

export function Pagination({ meta, onPageChange, onPageSizeChange }: PaginationProps) {
  if (!meta || meta.total === 0) return null;
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-ink-600">
      <p className="tabular">
        Showing <span className="font-medium text-ink-900">{fmtNumber(from)}</span>–<span className="font-medium text-ink-900">{fmtNumber(to)}</span> of{' '}
        <span className="font-medium text-ink-900">{fmtNumber(meta.total)}</span>
      </p>
      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="hidden sm:inline">Rows</span>
            <select
              value={meta.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
              aria-label="Rows per page"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => onPageChange(meta.page - 1)} aria-label="Previous page" icon={<ChevronLeft className="size-3.5" />} />
        <span className="tabular min-w-16 text-center">
          Page {meta.page} / {meta.totalPages}
        </span>
        <Button variant="secondary" size="sm" disabled={meta.page >= meta.totalPages} onClick={() => onPageChange(meta.page + 1)} aria-label="Next page" icon={<ChevronRight className="size-3.5" />} />
      </div>
    </div>
  );
}
