import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  ArrowRight,
  Boxes,
  Building2,
  CalendarClock,
  Pill,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react';
import { useFacilityScope } from '@/auth/FacilityScope';
import { useCurrentUser } from '@/auth/AuthContext';
import { ChartCard } from '@/components/charts/ChartCard';
import { InventoryDistributionChart, InventoryDistributionTable, inventoryLegend } from '@/components/charts/Charts';
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, StockBar, TransferStatusBadge } from '@/components/ui';
import { useAnalytics, useDashboardSummary, useExpiring, useFacilities, useMovements, useShortages, useTransfers } from '@/hooks/queries';
import { fmtCompact, fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { MOVEMENT_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const user = useCurrentUser();
  const { facilityId } = useFacilityScope();
  const qc = useQueryClient();
  const { data: facilities } = useFacilities();
  const scopeName = facilityId ? facilities?.find((f) => f.id === facilityId)?.name : 'All facilities';

  const summary = useDashboardSummary(facilityId);
  const s = summary.data;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${user.name.split(' ')[0]}`}
        description={
          <>
            Inventory position for <span className="font-medium text-ink-700">{scopeName ?? '…'}</span>
            {summary.dataUpdatedAt > 0 && <> · updated {fmtRelative(new Date(summary.dataUpdatedAt).toISOString())}</>}
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw className={cn('size-3.5', summary.isFetching && 'animate-spin')} />}
            onClick={() => qc.invalidateQueries()}
          >
            Refresh
          </Button>
        }
      />

      {s && (s.criticalShortages > 0 || s.expiredBatches > 0) && (
        <div role="alert" className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3">
          <TriangleAlert className="size-4 shrink-0 text-danger-600" aria-hidden />
          <p className="flex-1 text-sm text-danger-700">
            <span className="font-semibold">Action needed:</span>{' '}
            {s.criticalShortages > 0 && (
              <>
                {s.criticalShortages} medicine–facility pair{s.criticalShortages === 1 ? ' is' : 's are'} below critical level
              </>
            )}
            {s.criticalShortages > 0 && s.expiredBatches > 0 && ' · '}
            {s.expiredBatches > 0 && (
              <>
                {s.expiredBatches} expired batch{s.expiredBatches === 1 ? '' : 'es'} still on shelves
              </>
            )}
          </p>
          <div className="flex gap-3 text-sm font-medium">
            {s.criticalShortages > 0 && (
              <Link to="/shortages?severity=CRITICAL" className="text-danger-700 underline-offset-2 hover:underline">
                Review shortages
              </Link>
            )}
            {s.expiredBatches > 0 && (
              <Link to="/expiry?window=expired" className="text-danger-700 underline-offset-2 hover:underline">
                Review expired
              </Link>
            )}
          </div>
        </div>
      )}

      {summary.isError ? (
        <Card className="mb-5">
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
        </Card>
      ) : (
        <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Facilities" icon={<Building2 className="size-4" />} value={fmtNumber(s?.totalFacilities)} loading={summary.isLoading} to="/facilities" />
          <StatCard label="Medicines stocked" icon={<Pill className="size-4" />} value={fmtNumber(s?.totalMedicines)} loading={summary.isLoading} to="/medicines" />
          <StatCard
            label="Units in stock"
            icon={<Boxes className="size-4" />}
            value={s ? fmtCompact(s.totalInventoryUnits) : '—'}
            hint={s && `${fmtNumber(s.totalInventoryUnits)} usable units`}
            loading={summary.isLoading}
            to="/inventory"
          />
          <StatCard
            label="Critical shortages"
            icon={<TriangleAlert className="size-4" />}
            tone={s?.criticalShortages ? 'danger' : 'default'}
            value={fmtNumber(s?.criticalShortages)}
            hint={s && `${s.lowStock} more below reorder level`}
            loading={summary.isLoading}
            to="/shortages"
          />
          <StatCard
            label="Expiring ≤ 30 days"
            icon={<CalendarClock className="size-4" />}
            tone={s?.expiringBatches30d ? 'warning' : 'default'}
            value={fmtNumber(s?.expiringBatches30d)}
            hint={s && `${s.expiredBatches} already expired`}
            loading={summary.isLoading}
            to="/expiry?window=30"
          />
          <StatCard
            label="Pending transfers"
            icon={<ArrowLeftRight className="size-4" />}
            value={fmtNumber(s?.pendingTransfers)}
            hint="Awaiting approval"
            loading={summary.isLoading}
            to="/transfers?status=PENDING"
          />
        </div>
      )}

      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <ShortageAlerts facilityId={facilityId} />
        <ExpiryAlerts facilityId={facilityId} />
      </div>

      <div className="mb-5 grid gap-5 xl:grid-cols-3">
        <DistributionPanel facilityId={facilityId} className="xl:col-span-2" />
        <RecentTransfers facilityId={facilityId} />
      </div>

      <RecentMovements facilityId={facilityId} />
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

function ShortageAlerts({ facilityId }: { facilityId?: string }) {
  const q = useShortages({ facilityId, pageSize: 6, sortBy: 'coverage', sortDir: 'asc' });
  return (
    <Card>
      <CardHeader
        title="Shortage alerts"
        description="Lowest stock coverage against reorder level"
        actions={<PanelLink to="/shortages">All shortages</PanelLink>}
      />
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="No shortages" description="All medicines are at or above their reorder level." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.data.map((s) => (
            <li key={s.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-900">
                  {s.medicine.name} <span className="font-normal text-ink-500">{s.medicine.strength}</span>
                </p>
                <p className="truncate text-xs text-ink-500">{s.facility.name}</p>
              </div>
              <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
                <StockBar current={s.currentStock} critical={s.criticalThreshold} reorder={s.reorderThreshold} />
                <p className="tabular mt-1 text-[11px] text-ink-500">
                  {fmtNumber(s.currentStock)} / {fmtNumber(s.reorderThreshold)} {s.medicine.unit}s
                </p>
              </div>
              <div className="text-right">
                <p className={cn('tabular text-sm font-semibold', s.severity === 'CRITICAL' ? 'text-danger-600' : 'text-warning-700')}>
                  {s.daysRemaining === null ? '—' : `${s.daysRemaining} d`}
                </p>
                <p className="text-[11px] text-ink-500">{s.severity === 'CRITICAL' ? 'Critical' : 'Low'} · left</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ExpiryAlerts({ facilityId }: { facilityId?: string }) {
  const q = useExpiring({ facilityId, window: '30', pageSize: 6, sortBy: 'daysToExpiry', sortDir: 'asc' });
  return (
    <Card>
      <CardHeader title="Expiry alerts" description="Batches expiring within 30 days" actions={<PanelLink to="/expiry?window=30">Expiry monitor</PanelLink>} />
      {q.isLoading ? (
        <ListSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.data.length ? (
        <EmptyState title="Nothing expiring soon" description="No batches expire within the next 30 days." />
      ) : (
        <ul className="divide-y divide-line">
          {q.data.data.map((b) => (
            <li key={b.id} className="flex items-center gap-4 px-4 py-3">
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
                <p className="truncate text-sm font-medium text-ink-900">
                  {b.medicine.name} <span className="font-normal text-ink-500">{b.medicine.strength}</span>
                </p>
                <p className="truncate text-xs text-ink-500">
                  {b.facility.name} · Batch {b.batchNumber}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-medium text-ink-900">{fmtNumber(b.quantityAvailable)}</p>
                <p className="text-[11px] text-ink-500">{fmtDate(b.expiryDate)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DistributionPanel({ facilityId, className }: { facilityId?: string; className?: string }) {
  // Distribution compares facilities, so it always uses the network-wide view.
  const q = useAnalytics({ months: 6 });
  const data = q.data?.inventoryDistribution ?? [];
  return (
    <ChartCard
      className={className}
      title="Inventory distribution"
      description={facilityId ? 'Usable units across the whole network, for comparison with your facility' : 'Usable units held at each facility'}
      loading={q.isLoading}
      error={q.error}
      onRetry={() => q.refetch()}
      isEmpty={!data.length}
      legend={inventoryLegend}
      table={<InventoryDistributionTable data={data} />}
      height={300}
    >
      <InventoryDistributionChart data={data} />
    </ChartCard>
  );
}

function RecentTransfers({ facilityId }: { facilityId?: string }) {
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
                  <p className="truncate text-sm font-medium text-ink-900">{t.medicine.name}</p>
                  <TransferStatusBadge status={t.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-ink-500">
                  {t.sourceFacility.code} → {t.destinationFacility.code} · {fmtNumber(t.quantity)} {t.medicine.unit}s · {fmtRelative(t.updatedAt)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentMovements({ facilityId }: { facilityId?: string }) {
  const q = useMovements({ facilityId, pageSize: 8 });
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
                    <Badge tone={m.quantity > 0 ? 'success' : m.type === 'DAMAGE' || m.type === 'EXPIRED_WRITE_OFF' ? 'danger' : 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-medium text-ink-900">{m.medicine.name}</span> <span className="text-ink-500">{m.medicine.strength}</span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-ink-600 md:table-cell">{m.facility.name}</td>
                  <td className={cn('tabular px-4 py-2.5 text-right font-medium whitespace-nowrap', m.quantity > 0 ? 'text-brand-700' : 'text-ink-900')}>
                    {m.quantity > 0 ? '+' : ''}
                    {fmtNumber(m.quantity)}
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
