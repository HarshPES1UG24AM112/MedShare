import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, ArrowRight, Boxes, Building2, CalendarClock, ClipboardList, Pill, RefreshCw, Shuffle, Truck, TriangleAlert } from 'lucide-react';
import { useFacilityScope } from '@/auth/FacilityScope';
import { useCurrentUser } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { ChartCard } from '@/components/charts/ChartCard';
import { InventoryDistributionChart, InventoryDistributionTable, inventoryLegend } from '@/components/charts/Charts';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, StockBar, TransferStatusBadge } from '@/components/ui';
import { useAnalytics, useDashboardSummary, useExpiring, useFacilityDirectory, useMovements, useShortages, useTransfers } from '@/hooks/queries';
import { fmtCompact, fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { MOVEMENT_LABEL, MOVEMENT_TONE } from '@/lib/labels';
import { cn } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const firstName = (fullName: string) => fullName.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];

export function DashboardPage() {
  const user = useCurrentUser();
  const { facilityId } = useFacilityScope();
  const qc = useQueryClient();
  const { byId } = useFacilityDirectory();
  const scopeName = facilityId ? byId(facilityId)?.name : user.platformScope ? 'the whole network' : 'all facilities in your scope';
  const operational = can(user, 'inventory:read');

  const summary = useDashboardSummary(facilityId);
  const s = summary.data;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName(user.fullName)}`}
        description={
          <>
            Inventory position for <span className="font-medium text-ink-700">{scopeName ?? '…'}</span>
            {summary.dataUpdatedAt > 0 && <> · updated {fmtRelative(new Date(summary.dataUpdatedAt).toISOString())}</>}
          </>
        }
        actions={
          <Button variant="secondary" size="sm" icon={<RefreshCw className={cn('size-3.5', summary.isFetching && 'animate-spin')} />} onClick={() => qc.invalidateQueries()}>
            Refresh
          </Button>
        }
      />

      {s && (s.criticalShortages > 0 || s.expiredBatchesOnHand > 0) && (
        <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <TriangleAlert className="size-4 shrink-0 text-danger-600" aria-hidden />
          <p className="flex-1 text-sm text-danger-700">
            <span className="font-semibold">Action needed:</span>{' '}
            {s.criticalShortages > 0 && (
              <>
                {s.criticalShortages} medicine–facility pair{s.criticalShortages === 1 ? ' is' : 's are'} below critical level
              </>
            )}
            {s.criticalShortages > 0 && s.expiredBatchesOnHand > 0 && ' · '}
            {s.expiredBatchesOnHand > 0 && (
              <>
                {s.expiredBatchesOnHand} expired batch{s.expiredBatchesOnHand === 1 ? '' : 'es'} still on shelves
              </>
            )}
          </p>
          {operational && (
            <div className="flex gap-3 text-sm font-medium">
              {s.criticalShortages > 0 && (
                <Link to="/shortages?severity=CRITICAL" className="text-danger-700 underline-offset-2 hover:underline">
                  Review shortages
                </Link>
              )}
              {s.expiredBatchesOnHand > 0 && (
                <Link to="/expiry?window=expired" className="text-danger-700 underline-offset-2 hover:underline">
                  Review expired
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {summary.isError ? (
        <Card className="mb-5">
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Facilities" icon={<Building2 className="size-4" />} value={fmtNumber(s?.totalFacilities)} loading={summary.isLoading} to="/facilities" />
            <StatCard
              label="Medicines in stock"
              icon={<Pill className="size-4" />}
              value={fmtNumber(s?.medicinesInStock)}
              hint={s && `of ${fmtNumber(s.registeredMedicines)} registered`}
              loading={summary.isLoading}
              to="/medicines"
            />
            <StatCard
              label="Usable units"
              icon={<Boxes className="size-4" />}
              value={s ? fmtCompact(s.totalInventoryUnits) : '—'}
              hint={s && `${fmtNumber(s.totalInventoryUnits)} units`}
              loading={summary.isLoading}
              to={operational ? '/inventory' : undefined}
            />
            <StatCard
              label="Critical shortages"
              icon={<TriangleAlert className="size-4" />}
              tone={s?.criticalShortages ? 'danger' : 'default'}
              value={fmtNumber(s?.criticalShortages)}
              hint={s && `${s.lowStock} more below reorder level`}
              loading={summary.isLoading}
              to={operational ? '/shortages' : undefined}
            />
            <StatCard
              label="Expiring ≤ 30 days"
              icon={<CalendarClock className="size-4" />}
              tone={s?.expiringBatches30d ? 'warning' : 'default'}
              value={fmtNumber(s?.expiringBatches30d)}
              hint={s && `${s.expiredBatchesOnHand} expired batches on hand`}
              loading={summary.isLoading}
              to={operational ? '/expiry?window=30' : undefined}
            />
            <StatCard
              label="Pending transfers"
              icon={<ArrowLeftRight className="size-4" />}
              value={fmtNumber(s?.pendingTransfers)}
              hint="Awaiting approval"
              loading={summary.isLoading}
              to={operational ? '/transfers?status=PENDING' : undefined}
            />
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Awaiting dispatch" icon={<Truck className="size-4" />} value={fmtNumber(s?.awaitingDispatch)} loading={summary.isLoading} to={operational ? '/transfers?status=APPROVED' : undefined} />
            <StatCard label="In transit" icon={<Truck className="size-4" />} value={fmtNumber(s?.inTransit)} loading={summary.isLoading} to={operational ? '/transfers?status=DISPATCHED' : undefined} />
            <StatCard
              label="Open recommendations"
              icon={<Shuffle className="size-4" />}
              value={fmtNumber(s?.openRecommendations)}
              loading={summary.isLoading}
              to={operational ? '/redistribution' : undefined}
            />
            <StatCard
              label="Open stock requests"
              icon={<ClipboardList className="size-4" />}
              value={fmtNumber(s?.openStockRequests)}
              loading={summary.isLoading}
              to={operational ? '/stock-requests' : undefined}
            />
          </div>
        </>
      )}

      {operational && (
        <div className="mb-5 grid gap-5 lg:grid-cols-2">
          <ShortageAlerts facilityId={facilityId} />
          <ExpiryAlerts facilityId={facilityId} />
        </div>
      )}

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <DistributionPanel facilityId={facilityId} className={operational ? 'xl:col-span-2' : 'xl:col-span-3'} />
        {operational && <RecentTransfers facilityId={facilityId} />}
      </div>

      {operational && <RecentMovements facilityId={facilityId} />}
    </>
  );
}

/* ---------------------------------------------------------------------------- */

function PanelLink({ to, children }: { to: string; children: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-xs font-medium text-ink-600 hover:text-ink-900">
      {children} <ArrowRight className="size-3" />
    </Link>
  );
}

function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-16" />
        </li>
      ))}
    </ul>
  );
}

function ShortageAlerts({ facilityId }: { facilityId?: number }) {
  const q = useShortages({ facilityId, pageSize: 6, sortBy: 'coverage', sortDir: 'asc' });
  return (
    <Card>
      <CardHeader title="Shortage alerts" description="Lowest stock coverage against reorder level" actions={<PanelLink to="/shortages">All shortages</PanelLink>} />
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No shortages" description="All medicines are at or above their reorder level." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.data.map((s) => (
            <li
              key={`${s.facilityId}-${s.medicineId}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">
                  {s.medicineName} <span className="font-normal text-ink-500">{s.strengthLabel}</span>
                </p>
                <p className="truncate text-xs text-ink-500">{s.facilityName}</p>
              </div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                <StockBar current={s.currentStock} critical={s.minStockLevel} reorder={s.reorderThreshold} />
                <p className="tabular mt-1 text-[11px] text-ink-500">
                  {fmtNumber(s.currentStock)} / {fmtNumber(s.reorderThreshold)}
                </p>
              </div>
              <div className="text-right">
                <p className={cn('tabular text-sm font-semibold', s.severity === 'CRITICAL' ? 'text-danger-600' : 'text-warning-700')}>
                  {s.daysRemaining === null ? '—' : `${fmtNumber(s.daysRemaining)} d`}
                </p>
                <p className="text-[11px] text-ink-500">{s.severity === 'CRITICAL' ? 'Critical' : 'Low'} · cover</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExpiryAlerts({ facilityId }: { facilityId?: number }) {
  const q = useExpiring({ facilityId, window: '30', pageSize: 6, sortBy: 'daysToExpiry', sortDir: 'asc' });
  return (
    <Card>
      <CardHeader title="Expiry alerts" description="Batches on hand expiring within 30 days" actions={<PanelLink to="/expiry?window=30">Expiry monitor</PanelLink>} />
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="Nothing expiring soon" description="No batches on hand expire within the next 30 days." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.data.map((b) => (
            <li key={b.inventoryId} className="flex items-center gap-4 px-4 py-3">
              <div
                className={cn(
                  'tabular flex size-11 shrink-0 flex-col items-center justify-center rounded-md text-center leading-none',
                  b.daysToExpiry <= 7 ? 'bg-danger-50 text-danger-700' : 'bg-warning-50 text-warning-700',
                )}
                aria-label={`${b.daysToExpiry} days to expiry`}
              >
                <span className="text-base font-semibold">{b.daysToExpiry}</span>
                <span className="text-[10px]">{b.daysToExpiry === 1 ? 'day' : 'days'}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink-900">{b.medicineName}</p>
                <p className="truncate text-xs text-ink-500">
                  {b.facilityName} · Batch {b.batchNumber}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-medium text-ink-900">{fmtNumber(b.qtyAvailable + b.qtyReserved)}</p>
                <p className="text-[11px] text-ink-500">{fmtDate(b.expiryDate)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DistributionPanel({ facilityId, className }: { facilityId?: number; className?: string }) {
  // Distribution compares facilities, so it uses the caller's whole scope rather than the selected facility.
  const q = useAnalytics({ months: 6 });
  const data = q.data?.inventoryDistribution ?? [];
  return (
    <ChartCard
      className={className}
      title="Inventory distribution"
      description={facilityId ? 'Units at every facility in your scope, for comparison' : 'Units held at each facility in your scope'}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={!data.length}
      legend={inventoryLegend}
      table={<InventoryDistributionTable data={data} />}
      height={Math.max(160, data.length * 24)}
    >
      <InventoryDistributionChart data={data} />
    </ChartCard>
  );
}

function RecentTransfers({ facilityId }: { facilityId?: number }) {
  const q = useTransfers({ facilityId, pageSize: 6, sortBy: 'updatedAt', sortDir: 'desc' });
  return (
    <Card>
      <CardHeader title="Recent transfers" actions={<PanelLink to="/transfers">All transfers</PanelLink>} />
      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No transfers yet" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.data.map((t) => (
            <li key={t.id}>
              <Link to={`/transfers?open=${t.id}`} className="block px-4 py-3 hover:bg-subtle/60">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-ink-900">{t.medicines}</p>
                  <TransferStatusBadge status={t.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {t.code} · {t.sourceFacility.code} → {t.destinationFacility.code} · {fmtNumber(t.totalUnits)} units · {fmtRelative(t.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentMovements({ facilityId }: { facilityId?: number }) {
  const q = useMovements({ facilityId, pageSize: 8, sortBy: 'createdAt', sortDir: 'desc' });
  return (
    <Card>
      <CardHeader title="Recent inventory movements" actions={<PanelLink to="/inventory/movements">Movement ledger</PanelLink>} />
      {q.isLoading ? (
        <ListSkeleton rows={6} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No movements recorded" />
      ) : (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {q.data.data.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <Badge tone={MOVEMENT_TONE[m.movementType]}>{MOVEMENT_LABEL[m.movementType]}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink-900">{m.medicineName}</span> <span className="text-ink-500">{m.strengthLabel}</span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-ink-600 md:table-cell">{m.facilityName}</td>
                  <td className={cn('tabular px-4 py-2.5 text-right font-medium whitespace-nowrap', m.deltaAvailable > 0 ? 'text-brand-700' : 'text-ink-900')}>
                    {m.deltaAvailable > 0 ? '+' : ''}
                    {fmtNumber(m.deltaAvailable || m.quantity)}
                  </td>
                  <td className="hidden px-4 py-2.5 text-right text-xs whitespace-nowrap text-ink-500 sm:table-cell">{fmtRelative(m.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
