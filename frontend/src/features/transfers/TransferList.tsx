import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, Plus } from 'lucide-react';
import type { TransferStatus, TransferSummary } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { facilitiesWith } from '@/auth/permissions';
import { Badge, Button, Card, DataTable, FilterSelect, PageHeader, Pagination, SearchInput, Segmented, Toolbar, TransferStatusBadge, type Column } from '@/components/ui';
import { useFacilityDirectory, useTransfers } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { RequestTransferModal } from './RequestTransferModal';
import { TransferDetailModal } from './TransferDetailModal';

const FILTERS = ['status', 'facility', 'direction', 'open', 'actionable'] as const;

const TAB_LABEL: Record<TransferStatus, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Awaiting dispatch',
  DISPATCHED: 'In transit',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const ACTIVE_STATUSES: TransferStatus[] = ['PENDING', 'APPROVED', 'DISPATCHED'];
export const CLOSED_STATUSES: TransferStatus[] = ['RECEIVED', 'REJECTED', 'CANCELLED'];

function useStatusCount(status: TransferStatus, facilityId?: number, direction?: 'incoming' | 'outgoing') {
  return useTransfers({ status, facilityId, direction, pageSize: 1 }).data?.meta.total;
}

/** Shared list for "Transfers" (active workflow) and "Transfer history" (closed transfers). */
export function TransferList({ kind, title, description }: { kind: 'active' | 'history'; title: string; description: ReactNode }) {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const [, setSp] = useSearchParams();
  const lp = useListParams(FILTERS, { sortBy: kind === 'active' ? 'createdAt' : 'updatedAt', sortDir: 'desc' });
  const { facilities } = useFacilityDirectory();
  const statuses = kind === 'active' ? ACTIVE_STATUSES : CLOSED_STATUSES;
  const facilityId = toId(lp.filters.facility) ?? scope.facilityId;
  const actionable = kind === 'active' && lp.filters.actionable === 'true';
  const requested = lp.filters.status as TransferStatus | undefined;
  // "Needs my action" spans every active status; otherwise a tab picks one status.
  const status = actionable ? undefined : requested && statuses.includes(requested) ? requested : statuses[0];
  const direction = facilityId ? (lp.filters.direction as 'incoming' | 'outgoing' | undefined) : undefined;
  const [requesting, setRequesting] = useState(false);

  const q = useTransfers({ ...lp.query, status, facilityId, direction, actionable: actionable ? 'true' : undefined });
  const counts: Partial<Record<TransferStatus, number | undefined>> = {
    [statuses[0]]: useStatusCount(statuses[0], facilityId, direction),
    [statuses[1]]: useStatusCount(statuses[1], facilityId, direction),
    [statuses[2]]: useStatusCount(statuses[2], facilityId, direction),
  };
  const actionableCount = useTransfers({ actionable: 'true', facilityId, pageSize: 1 }).data?.meta.total;

  const openId = toId(lp.filters.open);
  const setOpen = (id: number | undefined) =>
    setSp(
      (prev) => {
        const n = new URLSearchParams(prev);
        if (id) n.set('open', String(id));
        else n.delete('open');
        return n;
      },
      { replace: true },
    );

  const columns: Column<TransferSummary>[] = [
    {
      key: 'code',
      header: 'Transfer',
      sortKey: 'code',
      cell: (t) => (
        <div>
          <p className="tabular font-medium whitespace-nowrap text-ink-900">{t.code}</p>
          <p className="text-xs text-ink-500">{fmtDate(t.createdAt)}</p>
        </div>
      ),
    },
    {
      key: 'medicines',
      header: 'Medicines',
      cell: (t) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-ink-900">{t.medicines}</p>
          <p className="text-xs text-ink-500">
            {t.itemCount} line{t.itemCount === 1 ? '' : 's'} · by {t.requestedBy.name}
          </p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      hideOnMobile: true,
      cell: (t) => (
        <span className="flex items-center gap-1.5 text-xs text-ink-700">
          <span title={t.sourceFacility.name}>{t.sourceFacility.code}</span>
          <ArrowRight className="size-3 shrink-0 text-ink-400" />
          <span title={t.destinationFacility.name}>{t.destinationFacility.code}</span>
          {t.crossOrganization && <Badge tone="info">Cross-org</Badge>}
        </span>
      ),
    },
    { key: 'units', header: 'Units', sortKey: 'totalUnits', align: 'right', cell: (t) => <span className="tabular font-medium">{fmtNumber(t.totalUnits)}</span> },
    {
      key: 'status',
      header: 'Status',
      sortKey: 'status',
      cell: (t) => (
        <div className="flex flex-col items-start gap-1">
          <TransferStatusBadge status={t.status} />
          {t.recommendationId && <Badge>From recommendation</Badge>}
        </div>
      ),
    },
    {
      key: 'updated',
      header: kind === 'active' ? 'Last update' : 'Closed',
      sortKey: 'updatedAt',
      align: 'right',
      hideOnMobile: true,
      cell: (t) => <span className="text-xs text-ink-500">{kind === 'active' ? fmtRelative(t.updatedAt) : fmtDate(t.updatedAt)}</span>,
    },
  ];

  const inScopeFacilities = facilities.filter((f) => scope.scopeIds.includes(f.id));

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        actions={
          kind === 'active' &&
          facilitiesWith(user, 'transfer:request').length > 0 && (
            <Button icon={<Plus className="size-4" />} onClick={() => setRequesting(true)}>
              New transfer request
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Segmented<string>
            className="w-fit"
            value={actionable ? 'mine' : (status ?? '')}
            onChange={(v) => (v === 'mine' ? lp.update({ actionable: 'true', status: undefined }) : lp.update({ status: v, actionable: undefined }))}
            options={[
              ...(kind === 'active' ? [{ value: 'mine', label: 'Needs my action', count: actionableCount, tone: 'warning' as const }] : []),
              ...statuses.map((s) => ({ value: s, label: TAB_LABEL[s], count: counts[s], tone: s === 'PENDING' ? ('warning' as const) : undefined })),
            ]}
          />
        </div>
        <Toolbar onClear={lp.clearFilters} showClear={!!lp.search || !!lp.filters.facility || !!lp.filters.direction}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search code, medicine, facility…" />
          {scope.scopeIds.length > 1 && (
            <FilterSelect
              label="Facility"
              allLabel={scope.facilityId ? 'Current scope' : 'All in scope'}
              value={lp.filters.facility}
              onChange={(v) => lp.setFilter('facility', v)}
              options={inScopeFacilities.map((f) => ({ value: String(f.id), label: `${f.code} · ${f.name}` }))}
            />
          )}
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
          caption={title}
          columns={columns}
          rows={q.data?.data}
          rowKey={(t) => String(t.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(t) => setOpen(t.id)}
          empty={{
            title: actionable ? 'Nothing is waiting on you' : `No ${TAB_LABEL[status!].toLowerCase()} transfers`,
            description: actionable ? 'Transfers you can approve, dispatch or receive appear here.' : undefined,
          }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <TransferDetailModal id={openId} onClose={() => setOpen(undefined)} />
      {kind === 'active' && <RequestTransferModal open={requesting} onClose={() => setRequesting(false)} />}
    </>
  );
}
