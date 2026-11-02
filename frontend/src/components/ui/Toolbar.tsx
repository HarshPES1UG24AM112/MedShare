import { useEffect, useState, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useListParams';
import { cn } from '@/lib/utils';
import { Button } from './Button';

/** Search box that commits after the user pauses typing. */
export function SearchInput({ value, onChange, placeholder = 'Search…', className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const [draft, setDraft] = useState(value);
  const debounced = useDebouncedValue(draft, 300);
  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-400" aria-hidden />
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-9 w-full rounded-md border border-line-strong bg-surface pr-8 pl-8 text-sm placeholder:text-ink-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {draft && (
        <button type="button" onClick={() => setDraft('')} className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-ink-400 hover:text-ink-900" aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = 'All',
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  options: { value: string; label: string }[];
  allLabel?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      className={cn(
        'h-9 rounded-md border bg-surface pr-7 pl-2.5 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none',
        value ? 'border-ink-700 text-ink-900' : 'border-line-strong text-ink-600',
      )}
    >
      <option value="">
        {label}: {allLabel}
      </option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toolbar({ children, onClear, showClear }: { children: ReactNode; onClear?: () => void; showClear?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
      {children}
      {showClear && onClear && (
        <Button variant="ghost" size="sm" onClick={onClear} icon={<X className="size-3.5" />}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

/** Segmented tab control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number; tone?: 'danger' | 'warning' }[];
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('scrollbar-thin flex max-w-full gap-1 overflow-x-auto rounded-lg bg-subtle p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors',
              active ? 'bg-surface text-ink-900 shadow-card' : 'text-ink-600 hover:text-ink-900',
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  'tabular rounded px-1.5 py-px text-[11px]',
                  o.tone === 'danger' && o.count > 0 ? 'bg-danger-100 text-danger-700' : o.tone === 'warning' && o.count > 0 ? 'bg-warning-100 text-warning-700' : 'bg-line text-ink-600',
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
