import { useNavigate } from 'react-router-dom';
import { MapPin, Snowflake } from 'lucide-react';
import type { Facility, FacilityType } from '@/api/types';
import { Badge, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useFacilities, useOrganizations, useRegions } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { FACILITY_TYPE_LABEL, options } from '@/lib/labels';

const FILTERS = ['type', 'organizationId', 'regionId'] as const;

export default function FacilitiesPage() {
  const navigate = useNavigate();
  const lp = useListParams(FILTERS, { sortBy: 'name', pageSize: 20 });
  const organizations = useOrganizations();
  const regions = useRegions();
  const q = useFacilities({
    ...lp.query,
    type: lp.filters.type as FacilityType | undefined,
    organizationId: toId(lp.filters.organizationId),
    regionId: toId(lp.filters.regionId),
  });

  const columns: Column<Facility>[] = [
    { key: 'code', header: 'Code', sortKey: 'code', hideOnMobile: true, cell: (f) => <span className="tabular text-xs text-ink-500">{f.code}</span> },
    {
      key: 'name',
      header: 'Facility',
      sortKey: 'name',
      cell: (f) => (
        <div>
          <p className="font-medium text-ink-900">
            {f.name}
            {f.hasColdChain && <Snowflake className="ml-1 inline size-3.5 text-info-500" aria-label="Cold chain capable" />}
          </p>
          <p className="text-xs text-ink-500">{f.organizationName}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', sortKey: 'type', hideOnMobile: true, cell: (f) => <Badge tone={f.facilityType === 'WAREHOUSE' ? 'info' : 'neutral'}>{FACILITY_TYPE_LABEL[f.facilityType]}</Badge> },
    {
      key: 'region',
      header: 'Region',
      sortKey: 'region',
      cell: (f) => (
        <span className="flex items-center gap-1.5 text-xs text-ink-700" title={f.regionPath}>
          <MapPin className="size-3.5 shrink-0 text-ink-400" aria-hidden />
          {f.regionName}
        </span>
      ),
    },
    { key: 'phone', header: 'Contact', hideOnMobile: true, cell: (f) => <span className="tabular text-xs text-ink-500">{f.contactPhone ?? '—'}</span> },
    {
      key: 'scope',
      header: 'Access',
      hideOnMobile: true,
      cell: (f) => (
        <span className="flex flex-wrap gap-1">
          {f.inScope ? <Badge tone="success">In your scope</Badge> : <Badge>Directory only</Badge>}
          {!f.isActive && <Badge tone="danger">Inactive</Badge>}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Facilities"
        description={q.data ? `${q.data.meta.total} facilities in the network directory. Operational detail is shown for facilities in your scope.` : 'The network facility directory.'}
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search name or code…" />
          <FilterSelect label="Type" value={lp.filters.type} onChange={(v) => lp.setFilter('type', v)} options={options(FACILITY_TYPE_LABEL)} />
          <FilterSelect
            label="Organisation"
            value={lp.filters.organizationId}
            onChange={(v) => lp.setFilter('organizationId', v)}
            options={(organizations.data ?? []).map((o) => ({ value: String(o.id), label: o.name }))}
          />
          <FilterSelect
            label="Region"
            value={lp.filters.regionId}
            onChange={(v) => lp.setFilter('regionId', v)}
            options={(regions.data ?? []).map((r) => ({ value: String(r.id), label: `${'  '.repeat(r.depth - 1)}${r.name}` }))}
          />
        </Toolbar>
        <DataTable
          caption="Facilities"
          columns={columns}
          rows={q.data?.data}
          rowKey={(f) => String(f.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(f) => navigate(`/facilities/${f.id}`)}
          empty={{ title: 'No facilities match' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
    </>
  );
}
