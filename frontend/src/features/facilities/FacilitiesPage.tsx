import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import type { Facility, FacilityType } from '@/api/types';
import { Badge, Card, DataTable, FilterSelect, PageHeader, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useFacilities } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { FACILITY_TYPE_LABEL } from '@/lib/labels';

const FILTERS = ['type', 'district'] as const;

export default function FacilitiesPage() {
  const navigate = useNavigate();
  const lp = useListParams(FILTERS, { sortBy: 'name' });
  const q = useFacilities();

  const districts = useMemo(() => [...new Set((q.data ?? []).map((f) => f.district))].sort(), [q.data]);

  // The facility list is small and unpaginated, so it is filtered and sorted client-side.
  const rows = useMemo(() => {
    const s = lp.search.toLowerCase();
    const list = (q.data ?? []).filter(
      (f) =>
        (!lp.filters.type || f.type === lp.filters.type) &&
        (!lp.filters.district || f.district === lp.filters.district) &&
        (!s || [f.name, f.code, f.city, f.district, f.contactName].some((x) => x.toLowerCase().includes(s))),
    );
    const key = (lp.sortBy ?? 'name') as 'name' | 'city' | 'type' | 'code';
    const dir = lp.sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => a[key].localeCompare(b[key]) * dir);
  }, [q.data, lp.search, lp.filters.type, lp.filters.district, lp.sortBy, lp.sortDir]);

  const columns: Column<Facility>[] = [
    { key: 'code', header: 'Code', sortKey: 'code', hideOnMobile: true, cell: (f) => <span className="tabular text-xs text-ink-500">{f.code}</span> },
    {
      key: 'name',
      header: 'Facility',
      sortKey: 'name',
      cell: (f) => (
        <div>
          <p className="font-medium text-ink-900">{f.name}</p>
          <p className="text-xs text-ink-500 md:hidden">{FACILITY_TYPE_LABEL[f.type]}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sortKey: 'type', hideOnMobile: true, cell: (f) => <Badge tone={f.type === 'WAREHOUSE' ? 'info' : 'neutral'}>{FACILITY_TYPE_LABEL[f.type]}</Badge> },
    {
      key: 'location',
      header: 'Location',
      sortKey: 'city',
      cell: (f) => (
        <span className="flex items-center gap-1.5 text-ink-700">
          <MapPin className="size-3.5 shrink-0 text-ink-400" aria-hidden />
          {f.city}, {f.district}
        </span>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      hideOnMobile: true,
      cell: (f) => (
        <div className="text-xs">
          <p className="text-ink-700">{f.contactName}</p>
          <p className="tabular text-ink-500">{f.contactPhone}</p>
        </div>
      ),
    },
    { key: 'status', header: 'Status', hideOnMobile: true, cell: (f) => (f.isActive ? <Badge tone="success" dot>Active</Badge> : <Badge>Inactive</Badge>) },
  ];

  return (
    <>
      <PageHeader title="Facilities" description={q.data ? `${q.data.length} participating facilities in the network.` : 'Participating facilities in the network.'} />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search name, city, contact…" />
          <FilterSelect label="Type" value={lp.filters.type} onChange={(v) => lp.setFilter('type', v)} options={(Object.keys(FACILITY_TYPE_LABEL) as FacilityType[]).map((t) => ({ value: t, label: FACILITY_TYPE_LABEL[t] }))} />
          <FilterSelect label="District" value={lp.filters.district} onChange={(v) => lp.setFilter('district', v)} options={districts.map((d) => ({ value: d, label: d }))} />
        </Toolbar>
        <DataTable
          caption="Facilities"
          columns={columns}
          rows={q.data ? rows : undefined}
          rowKey={(f) => f.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(f) => navigate(`/facilities/${f.id}`)}
          empty={{ title: 'No facilities match' }}
        />
      </Card>
    </>
  );
}
