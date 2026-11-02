import { useState } from 'react';
import { ArrowLeftRight, CalendarClock, CalendarX2, Package, Trash2 } from 'lucide-react';
import type { ExpiringBatch, ExpiryWindow } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can, canWriteAt } from '@/auth/permissions';
import { Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, StatCard, Toolbar, type Column } from '@/components/ui';
import { useExpiring, useExpirySummary, useFacilities } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtCompact, fmtCurrency, fmtDate, fmtDaysToExpiry, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AdjustStockModal } from '../inventory/BatchModals';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

const FILTERS = ['facility', 'window'] as const;
const WINDOWS: ExpiryWindow[] = ['expired', '7', '30', '60'];

export default function ExpiryPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'daysToExpiry' });
  const facilities = useFacilities();
  const facilityId = lp.filters.facility ?? scope.facilityId;
  const window = (WINDOWS.includes(lp.filters.window as ExpiryWindow) ? lp.filters.window : '30') as ExpiryWindow;

  const summary = useExpirySummary(facilityId);
  const q = useExpiring({ ...lp.query, facilityId, window });
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);
  const [writeOff, setWriteOff] = useState<ExpiringBatch | null>(null);
  const s = summary.data;

  const columns: Column<ExpiringBatch>[] = [
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
    { key: 'date', header: 'Expiry date', cell: (b) => <span className="tabular text-ink-700">{fmtDate(b.expiryDate)}</span> },
    {
      key: 'days',
      header: 'Time left',
      sortKey: 'daysToExpiry',
      align: 'right',
      cell: (b) => (
        <span className={cn('tabular font-semibold whitespace-nowrap', b.daysToExpiry < 0 || b.daysToExpiry <= 7 ? 'text-danger-600' : b.daysToExpiry <= 30 ? 'text-warning-700' : 'text-ink-900')}>
          {fmtDaysToExpiry(b.daysToExpiry)}
        </span>
      ),
    },
    { key: 'qty', header: 'Available', sortKey: 'quantityAvailable', align: 'right', cell: (b) => <span className="tabular">{fmtNumber(b.quantityAvailable)}</span> },
    { key: 'value', header: 'Value at risk', sortKey: 'value', align: 'right', hideOnMobile: true, cell: (b) => <span className="tabular text-ink-600">{fmtCurrency(b.quantityAvailable * b.unitCost)}</span> },
    {
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (b) =>
        b.daysToExpiry < 0
          ? canWriteAt(user, b.facility.id) &&
            b.quantityAvailable > 0 && (
              <Button variant="secondary" size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setWriteOff(b)}>
                Write off
              </Button>
            )
          : can(user, 'transfer:request') &&
            b.quantityAvailable > 0 && (
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeftRight className="size-3.5" />}
                onClick={() => setTransfer({ medicine: b.medicine, batch: { id: b.id, batchNumber: b.batchNumber, quantityAvailable: b.quantityAvailable, expiryDate: b.expiryDate, facility: b.facility } })}
              >
                Redistribute
              </Button>
            ),
    },
  ];

  return (
    <>
      <PageHeader title="Expiry monitoring" description="Batches by time remaining to expiry. Redistribute stock that won't be used locally before it expires." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Expired on hand" icon={<CalendarX2 className="size-4" />} tone={s?.expired ? 'danger' : 'default'} value={fmtNumber(s?.expired)} hint="batches" loading={summary.isLoading} />
        <StatCard label="Expiring ≤ 7 days" icon={<CalendarClock className="size-4" />} tone={s?.within7 ? 'danger' : 'default'} value={fmtNumber(s?.within7)} hint="batches" loading={summary.isLoading} />
        <StatCard label="Expiring ≤ 30 days" icon={<CalendarClock className="size-4" />} tone={s?.within30 ? 'warning' : 'default'} value={fmtNumber(s?.within30)} hint="batches" loading={summary.isLoading} />
        <StatCard label="Units at risk (≤ 60 d)" icon={<Package className="size-4" />} value={s ? fmtCompact(s.unitsAtRisk) : '—'} hint={s && `${s.within60} batches`} loading={summary.isLoading} />
      </div>

      <Card>
        <Toolbar onClear={() => lp.clearFilters()} showClear={!!lp.search || !!lp.filters.facility}>
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
          <FilterSelect
            label="Facility"
            allLabel={scope.facilityId ? 'Current scope' : 'All'}
            value={lp.filters.facility}
            onChange={(v) => lp.setFilter('facility', v)}
            options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
          />
        </Toolbar>
        <DataTable
          caption="Expiring batches"
          columns={columns}
          rows={q.data?.data}
          rowKey={(b) => b.id}
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
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
      <AdjustStockModal batch={writeOff} onClose={() => setWriteOff(null)} />
    </>
  );
}
