import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import type { Transfer, TransferStatus } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can, transferActionsFor } from '@/auth/permissions';
import { Badge, Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, Toolbar, TransferStatusBadge, type Column } from '@/components/ui';
import { useFacilities, useTransfers } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { RequestTransferModal } from './RequestTransferModal';
import { TransferDetailModal } from './TransferDetailModal';

const FILTERS = ['status', 'facility', 'direction', 'open'] as const;
const STATUSES: TransferStatus[] = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED', 'REJECTED', 'CANCELLED'];
const TAB_LABEL: Record<TransferStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DISPATCHED: 'In transit',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

function useStatusCount(status: TransferStatus, facilityId?: string, direction?: 'incoming' | 'outgoing') {
  return useTransfers({ status, facilityId, direction, pageSize: 1 }).data?.meta.total;
}

export default function TransfersPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const [, setSp] = useSearchParams();
  const lp = useListParams(FILTERS, { sortBy: 'createdAt', sortDir: 'desc' });
  const facilities = useFacilities();
  const facilityId = lp.filters.facility ?? scope.facilityId;
  const status = lp.filters.status as TransferStatus | undefined;
  const direction = facilityId ? (lp.filters.direction as 'incoming' | 'outgoing' | undefined) : undefined;
  const [requesting, setRequesting] = useState(false);

  const q = useTransfers({ ...lp.query, status, facilityId, direction });
  const counts = {
    PENDING: useStatusCount('PENDING', facilityId, direction),
    APPROVED: useStatusCount('APPROVED', facilityId, direction),
    DISPATCHED: useStatusCount('DISPATCHED', facilityId, direction),
  };

  const openId = lp.filters.open;
  const setOpen = (id: string | undefined) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('open', id);
        else n.delete('open');
        return n;
      },
      { replace: true },
    );

  const columns: Column<Transfer>[] = [
    {
      key: 'code',
      header: 'Transfer',
      sortKey: 'createdAt',
      cell: (t) => (
        <div>
          <p className="tabular font-medium whitespace-nowrap text-ink-900">{t.code}</p>
          <p className="text-xs text-ink-500">{fmtDate(t.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (t) => (
        <div>
          <p className="text-ink-900">
            {t.medicine.name} <span className="text-ink-500">{t.medicine.strength}</span>
          </p>
          <p className="tabular text-xs text-ink-500">Batch {t.batch.batchNumber}</p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      cell: (t) => (
        <span className="flex items-center gap-1.5 text-xs text-ink-700">
          <span className="max-w-40 truncate" title={t.sourceFacility.name}>
            {t.sourceFacility.name}
          </span>
          <ArrowRight className="size-3 shrink-0 text-ink-400" />
          <span className="max-w-40 truncate" title={t.destinationFacility.name}>
            {t.destinationFacility.name}
          </span>
        </span>
      ),
    },
    { key: 'qty', header: 'Qty', sortKey: 'quantity', align: 'right', cell: (t) => <span className="tabular font-medium">{fmtNumber(t.quantity)}</span> },
    {
      key: 'status',
      header: 'Status',
      cell: (t) => (
        <div className="flex flex-col items-start gap-1">
          <TransferStatusBadge status={t.status} />
          {transferActionsFor(user, t).some((a) => a !== 'cancel') && <Badge tone="info">Your action</Badge>}
        </div>
      ),
    },
    { key: 'updated', header: 'Last update', sortKey: 'updatedAt', align: 'right', hideOnMobile: true, cell: (t) => <span className="text-xs text-ink-500">{fmtRelative(t.updatedAt)}</span> },
  ];

  return (
    <>
      <PageHeader
        title="Transfers"
        description="Inter-facility transfer requests from approval through dispatch to receipt."
        actions={
          can(user, 'transfer:request') && (
            <Button icon={<Plus className="size-4" />} onClick={() => setRequesting(true)}>
              New transfer request
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b border-line px-4 pt-3">
          <Segmented<'' | TransferStatus>
            className="mb-3 w-fit"
            value={status ?? ''}
            onChange={(v) => lp.setFilter('status', v || undefined)}
            options={[
              { value: '', label: 'All' },
              ...STATUSES.map((s) => ({
                value: s,
                label: TAB_LABEL[s],
                count: s in counts ? counts[s as keyof typeof counts] : undefined,
                tone: s === 'PENDING' ? ('warning' as const) : undefined,
              })),
            ]}
          />
        </div>
        <Toolbar onClear={lp.clearFilters} showClear={!!lp.search || !!lp.filters.facility || !!lp.filters.direction}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search code, medicine, facility…" />
          <FilterSelect
            label="Facility"
            allLabel={scope.facilityId ? 'Current scope' : 'All'}
            value={lp.filters.facility}
            onChange={(v) => lp.setFilter('facility', v)}
            options={(facilities.data ?? []).map((f) => ({ value: f.id, label: f.name }))}
          />
          {facilityId && (
            <FilterSelect
              label="Direction"
              allLabel="Both"
              value={lp.filters.direction}
              onChange={(v) => lp.setFilter('direction', v)}
              options={[
                { value: 'incoming', label: 'Incoming' },
                { value: 'outgoing', label: 'Outgoing' },
              ]}
            />
          )}
        </Toolbar>
        <DataTable
          caption="Transfers"
          columns={columns}
          rows={q.data?.data}
          rowKey={(t) => t.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(t) => setOpen(t.id)}
          empty={{ title: status ? `No ${TAB_LABEL[status].toLowerCase()} transfers` : 'No transfers found' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <TransferDetailModal id={openId} onClose={() => setOpen(undefined)} />
      <RequestTransferModal open={requesting} onClose={() => setRequesting(false)} />
    </>
  );
}
