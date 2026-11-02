import { Link, useParams } from 'react-router-dom';
import { Boxes, CalendarClock, MapPin, Package, Phone, TriangleAlert, User } from 'lucide-react';
import type { Shortage } from '@/api/types';
import { Badge, Card, CardHeader, DataTable, ErrorState, PageHeader, SeverityBadge, Skeleton, StatCard, StockBar, type Column } from '@/components/ui';
import { useFacility, useFacilitySummary, useShortages } from '@/hooks/queries';
import { fmtCompact, fmtNumber } from '@/lib/format';
import { FACILITY_TYPE_LABEL } from '@/lib/labels';

export default function FacilityDetailPage() {
  const { id = '' } = useParams();
  const fq = useFacility(id);
  const sq = useFacilitySummary(id);
  const shortages = useShortages({ facilityId: id, pageSize: 50, sortBy: 'coverage' });

  if (fq.isError) return <ErrorState error={fq.error} onRetry={() => fq.refetch()} className="py-24" />;
  const f = fq.data;
  const s = sq.data;

  const cols: Column<Shortage>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      cell: (r) => (
        <Link to={`/medicines/${r.medicine.id}`} className="font-medium text-ink-900 hover:underline">
          {r.medicine.name} <span className="font-normal text-ink-500">{r.medicine.strength}</span>
        </Link>
      ),
    },
    { key: 'sev', header: 'Severity', cell: (r) => <SeverityBadge severity={r.severity} /> },
    {
      key: 'level',
      header: 'Stock vs reorder',
      hideOnMobile: true,
      cell: (r) => (
        <div className="w-40">
          <StockBar current={r.currentStock} critical={r.criticalThreshold} reorder={r.reorderThreshold} />
          <p className="tabular mt-1 text-[11px] text-ink-500">
            {fmtNumber(r.currentStock)} / {fmtNumber(r.reorderThreshold)}
          </p>
        </div>
      ),
    },
    { key: 'days', header: 'Days left', align: 'right', cell: (r) => <span className="tabular font-medium">{r.daysRemaining ?? '—'}</span> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Facilities', to: '/facilities' }, { label: f?.name ?? '…' }]}
        title={f ? f.name : <Skeleton className="h-7 w-72" />}
        description={f && `${FACILITY_TYPE_LABEL[f.type]} · ${f.code}`}
        actions={
          f && (
            <>
              <Link to={`/inventory?facility=${f.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-subtle">
                <Boxes className="size-4" /> View inventory
              </Link>
              <Link to={`/transfers?facility=${f.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-subtle">
                Transfers
              </Link>
            </>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Usable units" icon={<Package className="size-4" />} value={s ? fmtCompact(s.totalUnits) : '—'} hint={s && `${s.medicineCount} medicines · ${s.batchCount} batches`} loading={sq.isLoading} />
        <StatCard
          label="Critical shortages"
          icon={<TriangleAlert className="size-4" />}
          tone={s?.criticalShortages ? 'danger' : 'default'}
          value={fmtNumber(s?.criticalShortages)}
          hint={s && `${s.lowStock} low stock`}
          loading={sq.isLoading}
          to={`/shortages?facility=${id}`}
        />
        <StatCard
          label="Expiring ≤ 30 days"
          icon={<CalendarClock className="size-4" />}
          tone={s?.expiringIn30Days ? 'warning' : 'default'}
          value={fmtNumber(s?.expiringIn30Days)}
          hint="batches"
          loading={sq.isLoading}
          to={`/expiry?window=30&facility=${id}`}
        />
        <StatCard
          label="Expired on hand"
          icon={<CalendarClock className="size-4" />}
          tone={s?.expired ? 'danger' : 'default'}
          value={fmtNumber(s?.expired)}
          hint="batches awaiting write-off"
          loading={sq.isLoading}
          to={`/expiry?window=expired&facility=${id}`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Location & contact" />
          {f ? (
            <ul className="space-y-3 p-4 text-sm">
              <li className="flex gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-ink-400" />
                <span>
                  <span className="block text-ink-900">{f.address}</span>
                  <span className="text-ink-500">
                    {f.city}, {f.district}
                  </span>
                  <span className="tabular block text-xs text-ink-400">
                    {f.latitude.toFixed(4)}°N, {f.longitude.toFixed(4)}°E
                  </span>
                </span>
              </li>
              <li className="flex gap-3">
                <User className="mt-0.5 size-4 shrink-0 text-ink-400" />
                <span className="text-ink-900">{f.contactName}</span>
              </li>
              <li className="flex gap-3">
                <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" />
                <a href={`tel:${f.contactPhone.replace(/\s/g, '')}`} className="tabular text-ink-900 hover:underline">
                  {f.contactPhone}
                </a>
              </li>
              <li>{f.isActive ? <Badge tone="success" dot>Active participant</Badge> : <Badge>Inactive</Badge>}</li>
            </ul>
          ) : (
            <div className="space-y-2 p-4">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Facility shortages" description="Medicines below reorder level at this facility" />
          <DataTable
            columns={cols}
            rows={shortages.data?.data}
            rowKey={(r) => r.id}
            loading={shortages.isLoading}
            error={shortages.error}
            onRetry={() => shortages.refetch()}
            skeletonRows={5}
            empty={{ title: 'No shortages', description: 'Every stocked medicine is at or above its reorder level.' }}
          />
        </Card>
      </div>
    </>
  );
}
