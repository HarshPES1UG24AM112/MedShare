import type { InventoryMovement, MovementType } from '@/api/types';
import { useFacilityScope } from '@/auth/FacilityScope';
import { Badge, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useFacilities, useMovements } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtDateTime, fmtNumber } from '@/lib/format';
import { MOVEMENT_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

const FILTERS = ['facility', 'type'] as const;

export default function MovementsPage() {
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'createdAt', sortDir: 'desc' });
  const facilities = useFacilities();
  const q = useMovements({ ...lp.query, facilityId: lp.filters.facility ?? scope.facilityId, type: lp.filters.type as MovementType | undefined });

  const columns: Column<InventoryMovement>[] = [
    { key: 'when', header: 'Date', sortKey: 'createdAt', cell: (m) => <span className="tabular text-xs whitespace-nowrap text-ink-600">{fmtDateTime(m.createdAt)}</span> },
    {
      key: 'type',
      header: 'Movement',
      cell: (m) => <Badge tone={m.quantity > 0 ? 'success' : m.type === 'DAMAGE' || m.type === 'EXPIRED_WRITE_OFF' ? 'danger' : 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge>,
    },
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (m) => (
        <div>
          <p className="font-medium text-ink-900">
            {m.medicine.name} <span className="font-normal text-ink-500">{m.medicine.strength}</span>
          </p>
          <p className="tabular text-xs text-ink-500">Batch {m.batch.batchNumber}</p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', hideOnMobile: true, cell: (m) => <span className="text-ink-700">{m.facility.name}</span> },
    {
      key: 'qty',
      header: 'Quantity',
      sortKey: 'quantity',
      align: 'right',
      cell: (m) => (
        <span className={cn('tabular font-medium', m.quantity > 0 ? 'text-brand-700' : 'text-ink-900')}>
          {m.quantity > 0 ? '+' : ''}
          {fmtNumber(m.quantity)}
        </span>
      ),
    },
    { key: 'by', header: 'Recorded by', hideOnMobile: true, cell: (m) => <span className="text-xs text-ink-600">{m.performedBy.name}</span> },
    { key: 'ref', header: 'Reference', hideOnMobile: true, cell: (m) => <span className="text-xs text-ink-500">{[m.reference, m.note].filter(Boolean).join(' · ') || '—'}</span> },
  ];

  return (
    <>
      <PageHeader title="Stock movements" description="Ledger of every receipt, issue, transfer and loss. Quantities are signed: + adds to available stock." />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine, batch, reference…" />
          <FilterSelect
            label="Facility"
            allLabel={scope.facilityId ? 'Current scope' : 'All'}
            value={lp.filters.facility}
            onChange={(v) => lp.setFilter('facility', v)}
            options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
          />
          <FilterSelect label="Type" value={lp.filters.type} onChange={(v) => lp.setFilter('type', v)} options={Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label }))} />
        </Toolbar>
        <DataTable
          caption="Inventory movements"
          columns={columns}
          rows={q.data?.data}
          rowKey={(m) => m.id}
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
