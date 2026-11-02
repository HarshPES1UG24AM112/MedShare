import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { SortDirection } from '@/api/types';

interface Defaults {
  sortBy?: string;
  sortDir?: SortDirection;
  pageSize?: number;
}

/**
 * List state (page, size, sort, search, filters) stored in the URL so that
 * filtered views survive reloads and can be shared as links.
 */
export function useListParams<F extends string>(filterKeys: readonly F[], defaults: Defaults = {}) {
  const [sp, setSp] = useSearchParams();

  const page = Number(sp.get('page') ?? 1) || 1;
  const pageSize = Number(sp.get('size') ?? defaults.pageSize ?? 20) || 20;
  const sortBy = sp.get('sort') ?? defaults.sortBy;
  const sortDir = (sp.get('dir') as SortDirection | null) ?? defaults.sortDir ?? 'asc';
  const search = sp.get('q') ?? '';

  const filters = useMemo(() => {
    const out = {} as Record<F, string | undefined>;
    for (const k of filterKeys) out[k] = sp.get(k) ?? undefined;
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, filterKeys.join(',')]);

  const update = useCallback(
    (patch: Record<string, string | number | undefined>, resetPage = true) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  return {
    page,
    pageSize,
    sortBy,
    sortDir,
    search,
    filters,
    setPage: (p: number) => update({ page: p }, false),
    setPageSize: (s: number) => update({ size: s }),
    setSort: (by: string, dir: SortDirection) => update({ sort: by, dir }),
    setSearch: (q: string) => update({ q }),
    setFilter: (key: F, value: string | undefined) => update({ [key]: value }),
    clearFilters: () => update(Object.fromEntries([...filterKeys, 'q'].map((k) => [k, undefined]))),
    hasActiveFilters: !!search || filterKeys.some((k) => !!filters[k]),
    /** Ready-to-pass params for list services. */
    query: { page, pageSize, sortBy, sortDir, search: search || undefined },
  };
}

export function useDebouncedValue<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
