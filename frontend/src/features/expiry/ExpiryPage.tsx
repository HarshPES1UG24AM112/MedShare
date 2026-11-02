import { useState } from 'react';
import { ArrowUpFromLine, CalendarClock, CalendarX2, Check, Package, Trash2 } from 'lucide-react';
import { ApiError } from '@/api';
import type { ExpiringRow, ExpiryWindow } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { canAt } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import { Badge, BatchStatusBadge, Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, StatCard, Toolbar, useToast, type Column } from '@/components/ui';
import { useAcknowledgeAlert, useExpiring, useExpirySummary, useFacilityDirectory } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtCompact, fmtCurrency, fmtDate, fmtDaysToExpiry, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { StockActionModal } from '../inventory/BatchModals';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

const FILTERS = ['facility', 'window'] as const;
const WINDOWS: ExpiryWindow[] = ['expired', '7', '30', '60'];

export default function ExpiryPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'daysToExpiry' });
  const { facilities } = useFacilityDirectory();
  const facilityId = toId(lp.filters.facility) ?? scope.facilityId;
  const window = (WINDOWS.includes(lp.filters.window as ExpiryWindow) ? lp.filters.window : '30') as ExpiryWindow;

  const summary = useExpirySummary(facilityId);
  const q = useExpiring({ ...lp.query, facilityId, window });
  const ack = useAcknowledgeAlert();
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);
  const [writeOff, setWriteOff] = useState<ExpiringRow | null>(null);
  const s = summary.data;

  if (!user.permissions.includes('inventory:read')) return <Forbidden />;

  const columns: Column<ExpiringRow>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (b) => (
        <div>
          <p className="font-medium text-ink-900">{b.medicineName}</p>
          <p className="tabular text-xs text-ink-500">
            Batch {b.batchNumber}
            <span className="md:hidden"> · {b.facilityCode}</span>
          </p>
        </div>
      ),
    },
    { key: 'facility', header: 'Facility', sortKey: 'facility', hideOnMobile: true, cell: (b) => <span className="text-ink-700" title={b.facilityName}>{b.facilityCode}</span> },
    {
      key: 'date',
      header: 'Expiry date',
      hideOnMobile: true,
      cell: (b) => (
        <span className="flex flex-col items-start gap-1">
          <span className="tabular text-ink-700">{fmtDate(b.expiryDate)}</span>
          {b.batchStatus !== 'ACTIVE' && <BatchStatusBadge status={b.batchStatus} />}
        </span>
      ),
    },
    {
      key: 'days',
      header: 'Time left',
      sortKey: 'daysToExpiry',
      align: 'right',
      cell: (b) => (
        <span className={cn('tabular font-semibold whitespace-nowrap', b.daysToExpiry <= 7 ? 'text-danger-600' : b.daysToExpiry <= 30 ? 'text-warning-700' : 'text-ink-900')}>
          {fmtDaysToExpiry(b.daysToExpiry)}
        </span>
      ),
    },
    {
      key: 'qty',
      header: 'On hand',
      sortKey: 'quantity',
      align: 'right',
      cell: (b) => (
        <span className="tabular">
          {fmtNumber(b.qtyAvailable)}
          {b.qtyReserved > 0 && <span className="block text-[11px] text-info-700">+{fmtNumber(b.qtyReserved)} reserved</span>}
        </span>
      ),
    },
    { key: 'value', header: 'Value at risk', sortKey: 'value', align: 'right', hideOnMobile: true, cell: (b) => <span className="tabular text-ink-600">{fmtCurrency(b.valueAtRisk)}</span> },
    {
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (b) => (
        <div className="flex justify-end gap-1">
          {b.alertId && canAt(user, 'inventory:write', b.facilityId) && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Check className="size-3.5" />}
              title="Acknowledge alert"
              aria-label={`Acknowledge expiry alert for batch ${b.batchNumber}`}
              loading={ack.isPending && ack.variables?.alertId === b.alertId}
              onClick={() =>
                ack.mutate(
                  { kind: 'expiry', alertId: b.alertId! },
                  {
                    onSuccess: () => toast.success('Alert acknowledged', `Batch ${b.batchNumber} at ${b.facilityCode}`),
                    onError: (e) => toast.error('Could not acknowledge', e instanceof ApiError ? e.message : undefined),
                  },
                )
              }
            />
          )}
          {b.daysToExpiry < 0
            ? b.qtyAvailable > 0 &&
              canAt(user, 'inventory:write', b.facilityId) && (
                <Button variant="secondary" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setWriteOff(b)}>
                  Write off
                </Button>
              )
            : b.isUsable &&
              b.qtyAvailable > 0 &&
              canAt(user, 'transfer:request', b.facilityId) && (
                <Button variant="secondary" size="sm" icon={<ArrowUpFromLine className="size-3.5" />} onClick={() => setTransfer({ mode: 'push', sourceFacilityId: b.facilityId, pushInventory: b })}>
                  Redistribute
                </Button>
              )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader title="Expiry monitoring" description="Batches on hand that are expired or close to expiry. Redistribute usable stock before it expires; write off what already has." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expired on hand" icon={<CalendarX2 className="size-4" />} tone={s?.expired ? 'danger' : 'default'} value={fmtNumber(s?.expired)} hint={s && `${fmtCurrency(s.expiredValue)} written down`} loading={summary.isLoading} />
        <StatCard label="Expiring ≤ 7 days" icon={<CalendarClock className="size-4" />} tone={s?.within7 ? 'danger' : 'default'} value={fmtNumber(s?.within7)} hint="batches" loading={summary.isLoading} />
        <StatCard label="Expiring ≤ 30 days" icon={<CalendarClock className="size-4" />} tone={s?.within30 ? 'warning' : 'default'} value={fmtNumber(s?.within30)} hint={s && `${fmtNumber(s.within60)} within 60 days`} loading={summary.isLoading} />
        <StatCard label="Value at risk (≤ 60 d)" icon={<Package className="size-4" />} value={s ? fmtCurrency(s.valueAtRisk) : '—'} hint={s && `${fmtCompact(s.unitsAtRisk)} units`} loading={summary.isLoading} />
      </div>

      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={!!lp.search || !!lp.filters.facility}>
          <Segmented<ExpiryWindow>
            value={window}
            onChange={(v) => lp.setFilter('window', v)}
            options={[
              { value: 'expired', label: 'Expired', count: s?.expired, tone: 'danger' },
              { value: '7', label: '≤ 7 days', count: s?.within7, tone: 'danger' },
              { value: '30', label: '≤ 30 days', count: s?.within30, tone: 'warning' },
              { value: '60', label: '≤ 60 days', count: s?.within60 },
            ]}
          />
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine or batch…" />
          {scope.scopeIds.length > 1 && (
            <FilterSelect
              label="Facility"
              allLabel={scope.facilityId ? 'Current scope' : 'All in scope'}
              value={lp.filters.facility}
              onChange={(v) => lp.setFilter('facility', v)}
              options={facilities.filter((f) => scope.scopeIds.includes(f.id)).map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }))}
            />
          )}
        </Toolbar>
        {window === 'expired' && (
          <p className="border-b border-line bg-danger-50/40 px-4 py-2 text-xs text-danger-700">
            Expired stock can't be dispensed or transferred. Write it off to remove it from usable inventory; the write-off is recorded in the ledger.
          </p>
        )}
        <DataTable
          caption="Expiring batches"
          columns={columns}
          rows={q.data?.data}
          rowKey={(b) => String(b.inventoryId)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          empty={{ title: window === 'expired' ? 'No expired stock on hand' : 'Nothing expiring in this window' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      {q.data && q.data.data.some((r) => r.alertId) && (
        <p className="mt-3 text-xs text-ink-500">
          <Badge>Check</Badge> acknowledges an open expiry alert, telling colleagues it has been seen.
        </p>
      )}
      <StockActionModal row={writeOff} action={writeOff ? 'write-off' : null} onClose={() => setWriteOff(null)} />
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
    </>
  );
}
