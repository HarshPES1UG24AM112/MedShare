import { useState } from 'react';
import { ArrowUpFromLine, History, MoreHorizontal, PackagePlus } from 'lucide-react';
import type { BatchStatus, ExpiryBucket, InventoryRow, StockAction } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { canAt, facilitiesWith } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import { BatchStatusBadge, Button, Card, DataTable, ExpiryBadge, FilterSelect, PageHeader, Pagination, SearchInput, Toolbar, type Column } from '@/components/ui';
import { useFacilityDirectory, useInventory } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtCurrency, fmtDate, fmtNumber } from '@/lib/format';
import { BATCH_STATUS_LABEL, EXPIRY_BUCKET_LABEL, options } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';
import { ACTION_META, availableActions, ReceiveStockModal, StockActionModal, StockHistoryModal } from './BatchModals';

const FILTERS = ['facility', 'bucket', 'batchStatus', 'medicineId', 'all'] as const;

function RowActions({ row, onAction, onHistory, onPush, canWrite, canPush }: {
  row: InventoryRow;
  onAction: (a: StockAction) => void;
  onHistory: () => void;
  onPush: () => void;
  canWrite: boolean;
  canPush: boolean;
}) {
  const actions = canWrite ? availableActions(row) : [];
  return (
    <div className="flex items-center justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={onHistory} aria-label={`Stock history for batch ${row.batchNumber}`} title="Stock history" icon={<History className="size-3.5" />} />
      {canPush && row.isUsable && row.qtyAvailable > 0 && (
        <Button variant="ghost" size="sm" onClick={onPush} aria-label={`Send batch ${row.batchNumber} to another facility`} title="Send to another facility" icon={<ArrowUpFromLine className="size-3.5" />} />
      )}
      {actions.length > 0 && (
        <label className="relative inline-flex">
          <span className="sr-only">Stock action for batch {row.batchNumber}</span>
          <MoreHorizontal className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-ink-600" aria-hidden />
          <select
            value=""
            onChange={(e) => e.target.value && onAction(e.target.value as StockAction)}
            className="h-8 w-8 cursor-pointer appearance-none rounded-md bg-transparent text-transparent hover:bg-subtle focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
          >
            <option value="">Actions…</option>
            {actions.map((a) => (
              <option key={a} value={a} className="text-ink-900">
                {ACTION_META[a].title}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

export default function InventoryPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'expiryDate' });
  const { facilities } = useFacilityDirectory();
  // The URL filter wins; otherwise fall back to the global facility scope.
  const facilityId = toId(lp.filters.facility) ?? scope.facilityId;
  const onHandOnly = lp.filters.all === 'true' ? 'false' : 'true';

  const q = useInventory({
    ...lp.query,
    facilityId,
    medicineId: toId(lp.filters.medicineId),
    expiryBucket: lp.filters.bucket as ExpiryBucket | undefined,
    batchStatus: lp.filters.batchStatus as BatchStatus | undefined,
    onHandOnly,
  });
  const [receiving, setReceiving] = useState(false);
  const [action, setAction] = useState<{ row: InventoryRow; action: StockAction } | null>(null);
  const [history, setHistory] = useState<InventoryRow | null>(null);
  const [push, setPush] = useState<TransferPrefill | null>(null);

  if (!user.permissions.includes('inventory:read')) return <Forbidden />;

  const columns: Column<InventoryRow>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (r) => (
        <div>
          <p className="font-medium text-ink-900">{r.medicineName}</p>
          <p className="tabular text-xs text-ink-500">
            Batch {r.batchNumber}
            {r.batchStatus !== 'ACTIVE' && (
              <span className="ml-1.5">
                <BatchStatusBadge status={r.batchStatus} />
              </span>
            )}
          </p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', sortKey: 'facility', hideOnMobile: true, cell: (r) => <span className="text-ink-700" title={r.facilityName}>{r.facilityCode}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      sortKey: 'expiryDate',
      cell: (r) => (
        <div className="flex flex-col items-start gap-1">
          <span className="tabular text-xs text-ink-700">{fmtDate(r.expiryDate)}</span>
          <ExpiryBadge days={r.daysToExpiry} />
        </div>
      ),
    },
    { key: 'available', header: 'Available', sortKey: 'available', align: 'right', cell: (r) => <span className="tabular font-medium text-ink-900">{fmtNumber(r.qtyAvailable)}</span> },
    {
      key: 'reserved',
      header: 'Reserved',
      sortKey: 'reserved',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className={cn('tabular', r.qtyReserved ? 'text-info-700' : 'text-ink-400')}>{fmtNumber(r.qtyReserved)}</span>,
    },
    {
      key: 'damaged',
      header: 'Damaged',
      sortKey: 'damaged',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => <span className={cn('tabular', r.qtyDamaged ? 'text-danger-600' : 'text-ink-400')}>{fmtNumber(r.qtyDamaged)}</span>,
    },
    { key: 'value', header: 'Available value', sortKey: 'value', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular text-ink-600">{fmtCurrency(r.availableValue)}</span> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (r) => (
        <RowActions
          row={r}
          canWrite={canAt(user, 'inventory:write', r.facilityId)}
          canPush={canAt(user, 'transfer:request', r.facilityId)}
          onAction={(a) => setAction({ row: r, action: a })}
          onHistory={() => setHistory(r)}
          onPush={() => setPush({ mode: 'push', sourceFacilityId: r.facilityId, pushInventory: r })}
        />
      ),
    },
  ];

  const inScope = facilities.filter((f) => scope.scopeIds.includes(f.id));

  return (
    <>
      <PageHeader
        title="Stock"
        description="Batch-level inventory at the facilities in your scope: available, reserved for approved transfers, and damaged."
        actions={
          facilitiesWith(user, 'inventory:write').length > 0 && (
            <Button icon={<PackagePlus className="size-4" />} onClick={() => setReceiving(true)}>
              Receive stock
            </Button>
          )
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine or batch…" />
          {scope.scopeIds.length > 1 && (
            <FilterSelect
              label="Facility"
              allLabel={scope.facilityId ? 'Current scope' : 'All in scope'}
              value={lp.filters.facility}
              onChange={(v) => lp.setFilter('facility', v)}
              options={inScope.map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }))}
            />
          )}
          <FilterSelect label="Expiry" value={lp.filters.bucket} onChange={(v) => lp.setFilter('bucket', v)} options={options(EXPIRY_BUCKET_LABEL)} />
          <FilterSelect label="Batch status" value={lp.filters.batchStatus} onChange={(v) => lp.setFilter('batchStatus', v)} options={options(BATCH_STATUS_LABEL)} />
          <label className="flex h-9 items-center gap-2 rounded-md border border-line-strong px-2.5 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-brand-600" checked={lp.filters.all === 'true'} onChange={(e) => lp.setFilter('all', e.target.checked ? 'true' : undefined)} />
            Include empty rows
          </label>
        </Toolbar>
        <DataTable
          caption="Inventory"
          columns={columns}
          rows={q.data?.data}
          rowKey={(r) => String(r.inventoryId)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          rowClassName={(r) => (r.expiryBucket === 'EXPIRED' ? 'bg-danger-50/40' : undefined)}
          empty={{ title: 'No stock found', description: lp.hasActiveFilters ? 'Try clearing the filters.' : 'Receive stock to create the first batch.' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>

      <ReceiveStockModal open={receiving} onClose={() => setReceiving(false)} facilityId={facilityId} />
      <StockActionModal row={action?.row ?? null} action={action?.action ?? null} onClose={() => setAction(null)} />
      <StockHistoryModal row={history} onClose={() => setHistory(null)} />
      <RequestTransferModal open={!!push} onClose={() => setPush(null)} prefill={push ?? undefined} />
    </>
  );
}
