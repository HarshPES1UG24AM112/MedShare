import { useState } from 'react';
import { CheckCircle2, Clock, FlaskConical, Package, Shuffle, TriangleAlert } from 'lucide-react';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { Forbidden } from '@/auth/ProtectedRoute';
import { ChartCard, MiniTable } from '@/components/charts/ChartCard';
import {
  CategoryStockChart,
  CategoryStockTable,
  ExpiryTrendChart,
  ExpiryTrendTable,
  InventoryDistributionChart,
  InventoryDistributionTable,
  MovementTrendChart,
  MovementTrendTable,
  RecurringShortageChart,
  RecurringShortageTable,
  RegionAvailabilityChart,
  RegionAvailabilityTable,
  ShortageRiskChart,
  ShortageRiskTable,
  TopConsumedChart,
  TopConsumedTable,
  TransferVolumeChart,
  TransferVolumeTable,
  WastageChart,
  WastageTable,
  inventoryLegend,
  movementLegend,
  recurringLegend,
  shortageLegend,
  transferLegend,
} from '@/components/charts/Charts';
import { Badge, Card, CardHeader, ErrorState, PageHeader, Segmented, StatCard, TRANSFER_TONE } from '@/components/ui';
import { useAnalytics, useFacilityDirectory, useMedicines } from '@/hooks/queries';
import { fmtCompact, fmtCurrency, fmtNumber, fmtPercent } from '@/lib/format';
import { DEMAND_BASIS_LABEL, TRANSFER_STATUS_LABEL } from '@/lib/labels';

type Months = '3' | '6' | '12' | '24';

export default function AnalyticsPage() {
  const user = useCurrentUser();
  const { facilityId } = useFacilityScope();
  const { byId } = useFacilityDirectory();
  const [months, setMonths] = useState<Months>('6');
  const [regionMedicine, setRegionMedicine] = useState<number | undefined>();
  const q = useAnalytics({ facilityId, months: Number(months) });
  // Distribution and the regional rollup compare facilities, so they use the caller's whole scope.
  const scopeWide = useAnalytics({ months: Number(months), medicineId: regionMedicine });
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const d = q.data;
  const common = { loading: q.isLoading, error: q.error, onRetry: () => q.refetch() };

  if (!user.permissions.includes('report:read')) return <Forbidden />;

  const units = d?.inventoryDistribution.reduce((s, x) => s + x.available, 0) ?? 0;
  const atRisk = d?.shortageRisk.reduce((s, x) => s + x.criticalCount, 0) ?? 0;
  const scopeName = facilityId ? byId(facilityId)?.name : user.platformScope ? 'the whole network' : 'your facilities';
  const lead = d?.transferTiming.avgLeadTimeHours;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Inventory, expiry, shortage and transfer trends for ${scopeName ?? '…'}.`}
        actions={
          <Segmented<Months>
            value={months}
            onChange={setMonths}
            options={[
              { value: '3', label: '3 mo' },
              { value: '6', label: '6 mo' },
              { value: '12', label: '12 mo' },
              { value: '24', label: '24 mo' },
            ]}
          />
        }
      />
      {d?.meta.synthetic && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-xs text-warning-700">
          <FlaskConical className="mt-px size-4 shrink-0" />
          <p>
            <span className="font-semibold">Synthetic demonstration data.</span> {d.meta.note} {d.meta.consistency}
          </p>
        </div>
      )}
      {q.isError && (
        <Card className="mb-5">
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        </Card>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Available units" icon={<Package className="size-4" />} value={d ? fmtCompact(units) : '—'} hint={d && `${fmtNumber(units)} across ${d.inventoryDistribution.length} facilities`} loading={q.isLoading} />
        <StatCard
          label="Transfer completion"
          icon={<CheckCircle2 className="size-4" />}
          value={d?.transferCompletionRate != null ? fmtPercent(d.transferCompletionRate, 1) : '—'}
          hint={d && `${d.transferTiming.received} received of ${d.transferTiming.closed} closed`}
          loading={q.isLoading}
        />
        <StatCard
          label="Average lead time"
          icon={<Clock className="size-4" />}
          value={lead == null ? '—' : lead >= 48 ? `${(lead / 24).toFixed(1)} d` : `${fmtNumber(lead)} h`}
          hint="request → receipt"
          loading={q.isLoading}
        />
        <StatCard label="Critical shortage points" icon={<TriangleAlert className="size-4" />} tone={atRisk ? 'danger' : 'default'} value={fmtNumber(atRisk)} hint="top medicines, medicine–facility pairs" loading={q.isLoading} />
      </div>

      {d && (
        <Card className="mb-5">
          <CardHeader title="Redistribution potential" description="What the open recommendations would achieve if accepted and completed" />
          <dl className="grid grid-cols-2 gap-4 p-4 text-sm md:grid-cols-5">
            {[
              ['Open recommendations', fmtNumber(d.redistribution.openRecommendations)],
              ['Units to move', fmtNumber(d.redistribution.units)],
              ['Shortage units covered', fmtNumber(d.redistribution.shortageUnitsCovered)],
              ['Shortages addressed', fmtNumber(d.redistribution.shortagesAddressed)],
              ['Near-expiry value rescuable', fmtCurrency(d.redistribution.nearExpiryValueRescuable)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="flex items-center gap-1 text-xs text-ink-500">
                  <Shuffle className="size-3" aria-hidden /> {k}
                </dt>
                <dd className="tabular mt-0.5 text-lg font-semibold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <ChartCard
          title="Inventory distribution"
          description="Units by facility in your scope"
          loading={scopeWide.isLoading}
          error={scopeWide.error}
          onRetry={() => scopeWide.refetch()}
          isEmpty={!scopeWide.data?.inventoryDistribution.length}
          legend={inventoryLegend}
          table={<InventoryDistributionTable data={scopeWide.data?.inventoryDistribution ?? []} />}
          height={Math.max(180, (scopeWide.data?.inventoryDistribution.length ?? 0) * 24)}
        >
          <InventoryDistributionChart data={scopeWide.data?.inventoryDistribution ?? []} />
        </ChartCard>

        <ChartCard
          title="Availability by region"
          description="Recursive state › district › taluk rollup of usable units"
          loading={scopeWide.isLoading}
          error={scopeWide.error}
          onRetry={() => scopeWide.refetch()}
          isEmpty={!scopeWide.data?.availabilityByRegion.length}
          legend={[{ label: 'Usable units', color: '#2a78d6' }]}
          table={<RegionAvailabilityTable data={scopeWide.data?.availabilityByRegion ?? []} />}
          height={Math.max(180, (scopeWide.data?.availabilityByRegion.length ?? 0) * 26)}
          actions={
            <select
              aria-label="Medicine for regional availability"
              value={regionMedicine ?? ''}
              onChange={(e) => setRegionMedicine(e.target.value ? Number(e.target.value) : undefined)}
              className="h-7 max-w-40 rounded-md border border-line-strong bg-surface px-1.5 text-xs"
            >
              <option value="">All medicines</option>
              {medicines.data?.data.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          }
        >
          <RegionAvailabilityChart data={scopeWide.data?.availabilityByRegion ?? []} />
        </ChartCard>

        <ChartCard title="Expiry outlook" description="Units on hand by expiry month (12 months); past months already expired" {...common} isEmpty={!d?.expiryTrend.some((x) => x.units)} table={<ExpiryTrendTable data={d?.expiryTrend ?? []} />}>
          <ExpiryTrendChart data={d?.expiryTrend ?? []} />
        </ChartCard>

        <ChartCard title="Shortage risk" description="Medicines with the most facilities below reorder level" {...common} isEmpty={!d?.shortageRisk.length} emptyText="No shortages in scope" legend={shortageLegend} table={<ShortageRiskTable data={d?.shortageRisk ?? []} />}>
          <ShortageRiskChart data={d?.shortageRisk ?? []} />
        </ChartCard>

        <ChartCard
          title="Recurring shortages"
          description="Facilities ranked by shortage alerts raised in the period"
          {...common}
          isEmpty={!d?.recurringShortages.length}
          legend={recurringLegend}
          table={<RecurringShortageTable data={d?.recurringShortages ?? []} />}
          height={Math.max(180, (d?.recurringShortages.length ?? 0) * 26)}
        >
          <RecurringShortageChart data={d?.recurringShortages ?? []} />
        </ChartCard>

        <ChartCard title="Wastage" description="Value lost to damage, disposal and expiry in the period" {...common} isEmpty={!d?.wastage.length} emptyText="No losses recorded" table={<WastageTable data={d?.wastage ?? []} />} height={200}>
          <WastageChart data={d?.wastage ?? []} />
        </ChartCard>

        <ChartCard title="Transfer volume" description="Transfers requested and closed per month" {...common} isEmpty={!d?.transferStats.length} legend={transferLegend} table={<TransferVolumeTable data={d?.transferStats ?? []} />}>
          <TransferVolumeChart data={d?.transferStats ?? []} />
        </ChartCard>

        <ChartCard title="Stock movement" description="Units in, out and lost per month" {...common} isEmpty={!d?.movementTrend.length} legend={movementLegend} table={<MovementTrendTable data={d?.movementTrend ?? []} />}>
          <MovementTrendChart data={d?.movementTrend ?? []} />
        </ChartCard>

        <ChartCard
          title="Top consumed last month"
          description="Units dispensed in the last complete month, with the change from the month before"
          {...common}
          isEmpty={!d?.topConsumedLastMonth.length}
          table={<TopConsumedTable data={d?.topConsumedLastMonth ?? []} />}
          height={Math.max(180, (d?.topConsumedLastMonth.length ?? 0) * 26)}
        >
          <TopConsumedChart data={d?.topConsumedLastMonth ?? []} />
        </ChartCard>

        <ChartCard title="Stock by category" description="Usable units per therapeutic category" {...common} isEmpty={!d?.stockByCategory.length} table={<CategoryStockTable data={d?.stockByCategory ?? []} />} height={Math.max(180, (d?.stockByCategory.length ?? 0) * 24)}>
          <CategoryStockChart data={d?.stockByCategory ?? []} />
        </ChartCard>

        <Card>
          <CardHeader title="Transfer status" description="All transfers in scope by current status" />
          <div className="p-4">
            {d ? (
              <MiniTable
                head={['Status', 'Transfers']}
                rows={d.transferStatusBreakdown.map((x) => [TRANSFER_STATUS_LABEL[x.status], x.count])}
              />
            ) : (
              <div className="h-24 animate-pulse rounded bg-subtle" />
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {d?.transferStatusBreakdown.map((x) => (
                <Badge key={x.status} tone={TRANSFER_TONE[x.status]}>
                  {TRANSFER_STATUS_LABEL[x.status]} · {x.count}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Demand basis" description="How the daily demand behind shortage figures is derived, by stock policy" />
          <div className="p-4">
            {d ? (
              <MiniTable head={['Basis', 'Stock policies']} rows={d.demandBasis.map((x) => [DEMAND_BASIS_LABEL[x.demandBasis], fmtNumber(x.policies)])} />
            ) : (
              <div className="h-24 animate-pulse rounded bg-subtle" />
            )}
            <p className="mt-3 text-xs text-ink-500">Measured rates come from dispensing history; estimates are used when history is short or censored by a stock-out.</p>
          </div>
        </Card>
      </div>
    </>
  );
}
