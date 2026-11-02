import { useState } from 'react';
import { ArrowLeftRight, History, PackagePlus, SlidersHorizontal } from 'lucide-react';
import type { Batch, BatchStatus } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can, canWriteAt } from '@/auth/permissions';
import { Button, Card, DataTable, ExpiryBadge, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, Toolbar, type Column } from '@/components/ui';
import { useBatches, useFacilities } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { daysUntil, fmtCurrency, fmtDate, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';
import { AdjustStockModal, BatchHistoryModal, ReceiveBatchModal } from './BatchModals';

const FILTERS = ['facility', 'status'] as const;

export default function InventoryPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'expiryDate' });
  const facilities = useFacilities();
  // The URL filter wins; otherwise fall back to the global facility scope.
  const facilityId = lp.filters.facility ?? scope.facilityId;
  const status = (lp.filters.status as BatchStatus | undefined) ?? undefined;

  const q = useBatches({ ...lp.query, facilityId, status });
  const [receiving, setReceiving] = useState(false);
  const [adjusting, setAdjusting] = useState<Batch | null>(null);
  const [history, setHistory] = useState<Batch | null>(null);
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);

  const columns: Column<Batch>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (b) => (
        <div>
          <p className="font-medium text-ink-900">
            {b.medicine.name} <span className="font-normal text-ink-500">{b.medicine.strength}</span>
          </p>
          <p className="tabular text-xs text-ink-500">Batch {b.batchNumber}</p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', sortKey: 'facility', hideOnMobile: true, cell: (b) => <span className="text-ink-700">{b.facility.name}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      sortKey: 'expiryDate',
      cell: (b) => (
        <div className="flex flex-col items-start gap-1">
          <span className="tabular text-xs text-ink-700">{fmtDate(b.expiryDate)}</span>
          <ExpiryBadge days={daysUntil(b.expiryDate)} />
        </div>
      ),
    },
    { key: 'available', header: 'Available', sortKey: 'quantityAvailable', align: 'right', cell: (b) => <span className="tabular font-medium text-ink-900">{fmtNumber(b.quantityAvailable)}</span> },
    {
      key: 'reserved',
      header: 'Reserved',
      sortKey: 'quantityReserved',
      align: 'right',
      hideOnMobile: true,
      cell: (b) => <span className={cn('tabular', b.quantityReserved ? 'text-info-700' : 'text-ink-400')}>{fmtNumber(b.quantityReserved)}</span>,
    },
    {
      key: 'damaged',
      header: 'Damaged',
      sortKey: 'quantityDamaged',
      align: 'right',
      hideOnMobile: true,
      cell: (b) => <span className={cn('tabular', b.quantityDamaged ? 'text-danger-600' : 'text-ink-400')}>{fmtNumber(b.quantityDamaged)}</span>,
    },
    { key: 'value', header: 'Stock value', align: 'right', hideOnMobile: true, cell: (b) => <span className="tabular text-ink-600">{fmtCurrency(b.quantityAvailable * b.unitCost)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (b) => {
        const expired = daysUntil(b.expiryDate) < 0;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setHistory(b)} aria-label={`Stock history for batch ${b.batchNumber}`} title="Stock history" icon={<History className="size-3.5" />} />
            {canWriteAt(user, b.facility.id) && (
              <Button variant="ghost" size="sm" onClick={() => setAdjusting(b)} aria-label={`Adjust stock for batch ${b.batchNumber}`} title="Adjust stock" icon={<SlidersHorizontal className="size-3.5" />} />
            )}
            {can(user, 'transfer:request') && !expired && b.quantityAvailable > 0 && (
              <Button
                variant="ghost"
                size="sm"
                title="Request transfer"
                aria-label={`Request transfer from batch ${b.batchNumber}`}
                icon={<ArrowLeftRight className="size-3.5" />}
                onClick={() => setTransfer({ medicine: b.medicine, batch: { id: b.id, batchNumber: b.batchNumber, quantityAvailable: b.quantityAvailable, expiryDate: b.expiryDate, facility: b.facility } })}
              />
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Stock & batches"
        description="Batch-level inventory with available, reserved (committed to transfers) and damaged quantities."
        actions={
          can(user, 'inventory:write') && (
            <Button icon={<PackagePlus className="size-4" />} onClick={() => setReceiving(true)}>
              Receive stock
            </Button>
          )
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine or batch…" />
          <FilterSelect
            label="Facility"
            allLabel={scope.facilityId ? 'Current scope' : 'All'}
            value={lp.filters.facility}
            onChange={(v) => lp.setFilter('facility', v)}
            options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
          />
          <Segmented<'' | BatchStatus>
            className="ml-auto"
            value={status ?? ''}
            onChange={(v) => lp.setFilter('status', v || undefined)}
            options={[
              { value: '', label: 'All batches' },
              { value: 'OK', label: 'In date' },
              { value: 'EXPIRING', label: 'Expiring ≤ 60 d' },
              { value: 'EXPIRED', label: 'Expired' },
            ]}
          />
        </Toolbar>
        <DataTable
          caption="Inventory batches"
          columns={columns}
          rows={q.data?.data}
          rowKey={(b) => b.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          rowClassName={(b) => (daysUntil(b.expiryDate) < 0 ? 'bg-danger-50/40' : undefined)}
          empty={{ title: 'No batches found', description: lp.hasActiveFilters ? 'Try clearing the filters.' : 'Receive stock to create the first batch.' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>

      <ReceiveBatchModal open={receiving} onClose={() => setReceiving(false)} facilityId={facilityId} />
      <AdjustStockModal batch={adjusting} onClose={() => setAdjusting(null)} />
      <BatchHistoryModal batch={history} onClose={() => setHistory(null)} />
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
    </>
  );
}
