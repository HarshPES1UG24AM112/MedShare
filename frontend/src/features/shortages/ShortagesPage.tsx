import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Search } from 'lucide-react';
import { ApiError } from '@/api';
import type { Shortage, ShortageSeverity } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { canAt } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import {
  Badge,
  Button,
  Card,
  DataTable,
  DemandBasisBadge,
  FilterSelect,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  SeverityBadge,
  StockBar,
  Toolbar,
  useToast,
  type Column,
} from '@/components/ui';
import { useAcknowledgeAlert, useFacilityDirectory, useShortages } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtNumber, fmtPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

const FILTERS = ['facility', 'severity'] as const;

export default function ShortagesPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'daysRemaining' });
  const { facilities } = useFacilityDirectory();
  const facilityId = toId(lp.filters.facility) ?? scope.facilityId;
  const severity = lp.filters.severity as ShortageSeverity | undefined;

  const q = useShortages({ ...lp.query, facilityId, severity });
  // Lightweight count queries for the tab badges.
  const critical = useShortages({ facilityId, severity: 'CRITICAL', pageSize: 1, search: lp.query.search });
  const low = useShortages({ facilityId, severity: 'LOW', pageSize: 1, search: lp.query.search });
  const ack = useAcknowledgeAlert();
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);

  if (!user.permissions.includes('inventory:read')) return <Forbidden />;

  const columns: Column<Shortage>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      sortKey: 'medicine',
      cell: (s) => (
        <div>
          <Link to={`/medicines/${s.medicineId}`} className="font-medium text-ink-900 hover:underline">
            {s.medicineName} <span className="font-normal text-ink-500">{s.strengthLabel}</span>
          </Link>
          <p className="text-xs text-ink-500 md:hidden">{s.facilityCode}</p>
        </div>
      ),
    },
    {
      key: 'facility',
      header: 'Facility',
      sortKey: 'facility',
      hideOnMobile: true,
      cell: (s) => (
        <span className="block text-ink-700" title={s.facilityName}>
          {s.facilityCode}
          <span className="block max-w-40 truncate text-xs text-ink-500">{s.facilityName}</span>
        </span>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      cell: (s) => (
        <div className="flex flex-col items-start gap-1">
          <SeverityBadge severity={s.severity} />
          {s.alertStatus === 'ACKNOWLEDGED' && <Badge>Acknowledged</Badge>}
        </div>
      ),
    },
    {
      key: 'level',
      header: 'Stock vs thresholds',
      sortKey: 'coverage',
      hideOnMobile: true,
      cell: (s) => (
        <div className="w-44">
          <StockBar current={s.currentStock} critical={s.minStockLevel} reorder={s.reorderThreshold} />
          <p className="tabular mt-1 text-[11px] text-ink-500">
            <span className="font-medium text-ink-800">{fmtNumber(s.currentStock)}</span> · min {fmtNumber(s.minStockLevel)} · reorder {fmtNumber(s.reorderThreshold)} · {fmtPercent(s.coverage)}
          </p>
        </div>
      ),
    },
    {
      key: 'demand',
      header: 'Daily demand',
      hideOnMobile: true,
      cell: (s) => (
        <div className="space-y-1">
          <span className="tabular text-xs text-ink-900">{s.avgDailyConsumption == null ? '—' : `${fmtNumber(s.avgDailyConsumption)} / day`}</span>
          <DemandBasisBadge basis={s.demandBasis} possiblyCensored={s.possiblyCensored} />
        </div>
      ),
    },
    {
      key: 'days',
      header: 'Days of cover',
      sortKey: 'daysRemaining',
      align: 'right',
      cell: (s) => (
        <span className={cn('tabular font-semibold', s.daysRemaining !== null && s.daysRemaining <= 7 ? 'text-danger-600' : 'text-ink-900')}>
          {s.daysRemaining === null ? <span title="No demand estimate">—</span> : fmtNumber(s.daysRemaining)}
        </span>
      ),
    },
    { key: 'deficit', header: 'Deficit', sortKey: 'deficit', align: 'right', hideOnMobile: true, cell: (s) => <span className="tabular text-ink-700">{fmtNumber(s.deficit)}</span> },
    {
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (s) => (
        <div className="flex justify-end gap-1">
          {s.alertId && s.alertStatus === 'OPEN' && canAt(user, 'inventory:write', s.facilityId) && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Check className="size-3.5" />}
              title="Acknowledge alert"
              aria-label={`Acknowledge shortage of ${s.medicineName} at ${s.facilityCode}`}
              loading={ack.isPending && ack.variables?.alertId === s.alertId}
              onClick={() =>
                ack.mutate(
                  { kind: 'shortages', alertId: s.alertId! },
                  {
                    onSuccess: () => toast.success('Alert acknowledged', `${s.medicineName} at ${s.facilityCode}`),
                    onError: (e) => toast.error('Could not acknowledge', e instanceof ApiError ? e.message : undefined),
                  },
                )
              }
            />
          )}
          {canAt(user, 'transfer:request', s.facilityId) && (
            <Button
              variant="secondary"
              size="sm"
              icon={<Search className="size-3.5" />}
              onClick={() => setTransfer({ mode: 'pull', destinationFacilityId: s.facilityId, medicineId: s.medicineId, quantity: Math.max(1, s.deficit) })}
            >
              Source stock
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Shortage monitoring"
        description="Medicine–facility pairs below the reorder level. Days of cover = usable stock ÷ daily demand; the demand basis says where that rate comes from."
        actions={
          <Link to="/redistribution?reasonCode=SHORTAGE_COVER" className="text-sm font-medium text-brand-700 hover:underline">
            Redistribution suggestions →
          </Link>
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <Segmented<'' | ShortageSeverity>
            value={severity ?? ''}
            onChange={(v) => lp.setFilter('severity', v || undefined)}
            options={[
              { value: '', label: 'All', count: critical.data && low.data ? critical.data.meta.total + low.data.meta.total : undefined },
              { value: 'CRITICAL', label: 'Critical', count: critical.data?.meta.total, tone: 'danger' },
              { value: 'LOW', label: 'Low stock', count: low.data?.meta.total, tone: 'warning' },
            ]}
          />
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine or facility…" />
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
        <DataTable
          caption="Shortages"
          columns={columns}
          rows={q.data?.data}
          rowKey={(s) => `${s.facilityId}-${s.medicineId}`}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          rowClassName={(s) => (s.severity === 'CRITICAL' ? 'bg-danger-50/30' : undefined)}
          empty={{ title: 'No shortages', description: 'All medicines in this view are at or above their reorder level.' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
    </>
  );
}
