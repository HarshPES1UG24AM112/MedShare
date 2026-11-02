import type { Movement, MovementType } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { Forbidden } from '@/auth/ProtectedRoute';
import { Card, DataTable, FilterSelect, Input, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useFacilityDirectory, useMovements } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { MOVEMENT_LABEL, options } from '@/lib/labels';
import { movementColumns } from './BatchModals';

const FILTERS = ['facility', 'type', 'from', 'to', 'inventoryId'] as const;

export default function MovementsPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'createdAt', sortDir: 'desc' });
  const { facilities } = useFacilityDirectory();
  const q = useMovements({
    ...lp.query,
    facilityId: toId(lp.filters.facility) ?? scope.facilityId,
    type: lp.filters.type as MovementType | undefined,
    inventoryId: toId(lp.filters.inventoryId),
    from: lp.filters.from,
    to: lp.filters.to,
  });

  if (!user.permissions.includes('inventory:read')) return <Forbidden />;

  const columns: Column<Movement>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (m) => (
        <div>
          <p className="font-medium text-ink-900">
            {m.medicineName} <span className="font-normal text-ink-500">{m.strengthLabel}</span>
          </p>
          <p className="tabular text-xs text-ink-500">
            {m.facilityCode} · batch {m.batchNumber}
          </p>
        </div>
      ),
    },
    ...movementColumns.map((c) => (c.key === 'when' ? { ...c, sortKey: 'createdAt' } : c.key === 'type' ? { ...c, sortKey: 'type' } : c)),
  ];

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="The inventory ledger: every receipt, issue, reservation, transfer and loss. Balances change only through these movements."
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine, batch, reference…" />
          {scope.scopeIds.length > 1 && (
            <FilterSelect
              label="Facility"
              allLabel={scope.facilityId ? 'Current scope' : 'All in scope'}
              value={lp.filters.facility}
              onChange={(v) => lp.setFilter('facility', v)}
              options={facilities.filter((f) => scope.scopeIds.includes(f.id)).map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }))}
            />
          )}
          <FilterSelect label="Type" value={lp.filters.type} onChange={(v) => lp.setFilter('type', v)} options={options(MOVEMENT_LABEL)} />
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            From
            <Input type="date" className="w-36" value={lp.filters.from ?? ''} onChange={(e) => lp.setFilter('from', e.target.value || undefined)} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-600">
            To
            <Input type="date" className="w-36" value={lp.filters.to ?? ''} onChange={(e) => lp.setFilter('to', e.target.value || undefined)} />
          </label>
        </Toolbar>
        <DataTable
          caption="Inventory movements"
          columns={columns}
          rows={q.data?.data}
          rowKey={(m) => String(m.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          empty={{ title: 'No movements match these filters' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
    </>
  );
}
