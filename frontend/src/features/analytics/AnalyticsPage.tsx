import { useState } from 'react';
import { CheckCircle2, FlaskConical, Package, Send, TriangleAlert } from 'lucide-react';
import { usingMocks } from '@/api';
import { useFacilityScope } from '@/auth/FacilityScope';
import { ChartCard } from '@/components/charts/ChartCard';
import {
  CategoryStockChart,
  CategoryStockTable,
  ExpiryTrendChart,
  ExpiryTrendTable,
  InventoryDistributionChart,
  InventoryDistributionTable,
  MovementTrendChart,
  MovementTrendTable,
  ShortageRiskChart,
  ShortageRiskTable,
  TransferVolumeChart,
  TransferVolumeTable,
  inventoryLegend,
  movementLegend,
  shortageLegend,
  transferLegend,
} from '@/components/charts/Charts';
import { Card, CardHeader, PageHeader, Segmented, StatCard, TRANSFER_TONE, Badge } from '@/components/ui';
import { useAnalytics, useFacilities } from '@/hooks/queries';
import { fmtCompact, fmtNumber, fmtPercent } from '@/lib/format';
import { TRANSFER_STATUS_LABEL } from '@/lib/labels';

type Months = '3' | '6' | '12';

export default function AnalyticsPage() {
  const { facilityId } = useFacilityScope();
  const { data: facilities } = useFacilities();
  const [months, setMonths] = useState<Months>('6');
  const q = useAnalytics({ facilityId, months: Number(months) });
  const network = useAnalytics({ months: Number(months) }); // distribution always compares all facilities
  const d = q.data;
  const common = { loading: q.isLoading, error: q.error, onRetry: () => q.refetch() };

  const requested = d?.transferStats.reduce((s, x) => s + x.requested, 0) ?? 0;
  const units = d?.inventoryDistribution.reduce((s, x) => s + x.available, 0) ?? 0;
  const atRisk = d?.shortageRisk.reduce((s, x) => s + x.criticalCount, 0) ?? 0;
  const scopeName = facilityId ? facilities?.find((f) => f.id === facilityId)?.name : 'all facilities';

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
              { value: '3', label: '3 months' },
              { value: '6', label: '6 months' },
              { value: '12', label: '12 months' },
            ]}
          />
        }
      />
      {usingMocks && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-warning-100 bg-warning-50 px-4 py-3 text-xs text-warning-700">
          <FlaskConical className="mt-px size-4 shrink-0" />
          <p>
            <span className="font-semibold">Synthetic demonstration data.</span> These figures are generated in the browser for UI development and do not describe real facilities or stock.
          </p>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Usable units" icon={<Package className="size-4" />} value={d ? fmtCompact(units) : '—'} hint={d && `${fmtNumber(units)} across ${d.inventoryDistribution.length} facilities`} loading={q.isLoading} />
        <StatCard label="Transfer completion" icon={<CheckCircle2 className="size-4" />} value={d ? fmtPercent(d.transferCompletionRate) : '—'} hint="received ÷ closed transfers" loading={q.isLoading} />
        <StatCard label="Transfers requested" icon={<Send className="size-4" />} value={fmtNumber(requested)} hint={`last ${months} months`} loading={q.isLoading} />
        <StatCard label="Critical shortage points" icon={<TriangleAlert className="size-4" />} tone={atRisk ? 'danger' : 'default'} value={fmtNumber(atRisk)} hint="medicine–facility pairs" loading={q.isLoading} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <ChartCard
          title="Inventory distribution"
          description="Usable units by facility (network-wide)"
          loading={network.isLoading}
          error={network.error}
          onRetry={() => network.refetch()}
          isEmpty={!network.data?.inventoryDistribution.length}
          legend={inventoryLegend}
          table={<InventoryDistributionTable data={network.data?.inventoryDistribution ?? []} />}
          height={320}
        >
          <InventoryDistributionChart data={network.data?.inventoryDistribution ?? []} />
        </ChartCard>

        <ChartCard
          {...common}
          title="Highest shortage risk"
          description="Medicines short at the most facilities (top 10)"
          isEmpty={!d?.shortageRisk.length}
          emptyText="No medicines are below reorder level"
          legend={shortageLegend}
          table={<ShortageRiskTable data={d?.shortageRisk ?? []} />}
          height={320}
        >
          <ShortageRiskChart data={d?.shortageRisk ?? []} />
        </ChartCard>

        <ChartCard
          {...common}
          title="Expiry profile"
          description="Units expiring per month — faded bars are months already past"
          isEmpty={!d?.expiryTrend.some((x) => x.units > 0)}
          table={<ExpiryTrendTable data={d?.expiryTrend ?? []} />}
        >
          <ExpiryTrendChart data={d?.expiryTrend ?? []} />
        </ChartCard>

        <ChartCard
          {...common}
          title="Monthly inventory movements"
          description="Units in, out and lost per month (current month is month-to-date)"
          isEmpty={!d?.movementTrend.some((x) => x.inbound || x.outbound)}
          legend={movementLegend}
          table={<MovementTrendTable data={d?.movementTrend ?? []} />}
        >
          <MovementTrendChart data={d?.movementTrend ?? []} />
        </ChartCard>

        <ChartCard
          {...common}
          title="Transfer volume"
          description="Requests raised vs transfers closed per month (current month is month-to-date)"
          isEmpty={!d?.transferStats.some((x) => x.requested || x.received || x.rejected)}
          legend={transferLegend}
          table={<TransferVolumeTable data={d?.transferStats ?? []} />}
        >
          <TransferVolumeChart data={d?.transferStats ?? []} />
        </ChartCard>

        <div className="grid gap-5">
          <Card>
            <CardHeader title="Transfers by status" description="All transfers in scope" />
            <ul className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3">
              {(d?.transferStatusBreakdown ?? []).map((s) => (
                <li key={s.status} className="bg-surface p-4">
                  <Badge tone={TRANSFER_TONE[s.status]} dot>
                    {TRANSFER_STATUS_LABEL[s.status]}
                  </Badge>
                  <p className="tabular mt-2 text-xl font-semibold text-ink-950">{fmtNumber(s.count)}</p>
                </li>
              ))}
            </ul>
          </Card>
          <ChartCard
            {...common}
            title="Stock by therapeutic category"
            isEmpty={!d?.stockByCategory.length}
            table={<CategoryStockTable data={d?.stockByCategory ?? []} />}
            height={300}
          >
            <CategoryStockChart data={d?.stockByCategory ?? []} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}
