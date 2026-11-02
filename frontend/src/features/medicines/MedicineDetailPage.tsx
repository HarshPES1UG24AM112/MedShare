import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftRight, Snowflake } from 'lucide-react';
import type { Batch, MedicineFacilityStock } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { facilitiesWith } from '@/auth/permissions';
import { Badge, BatchStatusBadge, Button, Card, CardHeader, DataTable, ErrorState, ExpiryBadge, PageHeader, Pagination, Skeleton, StockStatusBadge, type Column } from '@/components/ui';
import { useBatches, useMedicine } from '@/hooks/queries';
import { fmtDate, fmtNumber } from '@/lib/format';
import { DOSAGE_FORM_LABEL } from '@/lib/labels';
import { RequestTransferModal } from '../transfers/RequestTransferModal';

export default function MedicineDetailPage() {
  const id = Number(useParams().id);
  const user = useCurrentUser();
  const q = useMedicine(id);
  const [page, setPage] = useState(1);
  const batches = useBatches({ medicineId: id, page, pageSize: 10, sortBy: 'expiryDate', sortDir: 'asc', onHandOnly: 'true' });
  const [requesting, setRequesting] = useState(false);
  const canRequest = facilitiesWith(user, 'transfer:request').length > 0;

  if (!Number.isInteger(id) || id < 1) return <ErrorState error={new Error('Invalid medicine id')} className="py-24" />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-24" />;
  const m = q.data;

  const stockCols: Column<MedicineFacilityStock>[] = [
    {
      key: 'facility',
      header: 'Facility',
      cell: (r) => (
        <Link to={`/facilities/${r.facilityId}`} className="font-medium text-ink-900 hover:underline">
          <span className="text-xs text-ink-500">{r.facilityCode}</span> {r.facilityName}
        </Link>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <StockStatusBadge status={r.stockStatus} /> },
    { key: 'usable', header: 'Usable', align: 'right', cell: (r) => <span className="tabular font-medium">{fmtNumber(r.usable)}</span> },
    {
      key: 'reorder',
      header: 'Reorder / min',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => (
        <span className="tabular text-xs text-ink-600">
          {fmtNumber(r.reorderThreshold)} / {fmtNumber(r.minStockLevel)}
        </span>
      ),
    },
    { key: 'days', header: 'Days of cover', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular text-ink-700">{r.daysOfInventory == null ? '—' : fmtNumber(r.daysOfInventory)}</span> },
    { key: 'reserved', header: 'Reserved', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular text-ink-600">{fmtNumber(r.reserved)}</span> },
    { key: 'expiry', header: 'Nearest expiry', align: 'right', cell: (r) => <span className="tabular text-xs text-ink-600">{fmtDate(r.nearestUsableExpiry)}</span> },
  ];

  const batchCols: Column<Batch>[] = [
    {
      key: 'batch',
      header: 'Batch',
      cell: (b) => (
        <Link to={`/batches?open=${b.id}`} className="tabular font-medium text-ink-900 hover:underline">
          {b.batchNumber}
        </Link>
      ),
    },
    { key: 'mfr', header: 'Manufacturer', hideOnMobile: true, cell: (b) => <span className="text-ink-700">{b.manufacturer}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (b) => (
        <span className="flex flex-wrap items-center gap-2">
          <span className="tabular text-xs">{fmtDate(b.expiryDate)}</span>
          <ExpiryBadge days={b.daysToExpiry} />
        </span>
      ),
    },
    { key: 'status', header: 'Status', hideOnMobile: true, cell: (b) => <BatchStatusBadge status={b.status} /> },
    { key: 'onHand', header: 'Network on hand', align: 'right', cell: (b) => <span className="tabular font-medium">{fmtNumber(b.networkOnHand)}</span> },
    { key: 'holding', header: 'Facilities', align: 'right', hideOnMobile: true, cell: (b) => <span className="tabular text-ink-600">{b.facilitiesHolding}</span> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Medicine catalogue', to: '/medicines' }, { label: m?.name ?? '…' }]}
        title={
          m ? (
            <span className="flex flex-wrap items-center gap-2">
              {m.name} <span className="font-normal text-ink-500">{m.strengthLabel}</span>
              {m.isEssential && <Badge tone="success">Essential medicine</Badge>}
              {m.requiresColdChain && (
                <Badge tone="info">
                  <Snowflake className="size-3" /> Cold chain
                </Badge>
              )}
              {!m.isActive && <Badge tone="danger">Inactive</Badge>}
            </span>
          ) : (
            <Skeleton className="h-7 w-64" />
          )
        }
        description={m && `${m.code} · ${DOSAGE_FORM_LABEL[m.dosageForm]} · ${m.categoryPath}`}
        actions={
          canRequest &&
          m && (
            <Button icon={<ArrowLeftRight className="size-4" />} onClick={() => setRequesting(true)}>
              Request stock
            </Button>
          )
        }
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-1">
          <Card>
            <CardHeader title="Details" />
            <dl className="divide-y divide-line text-sm">
              {[
                ['Issue unit', m && `${m.unit}${m.unitVolumeMl ? ` (${m.unitVolumeMl} mL)` : ''}`],
                ['Network usable', m && `${fmtNumber(m.networkUsable)} ${m.unit}s`],
                ['Facilities holding', m && fmtNumber(m.facilitiesHolding)],
                ['Facilities short', m && fmtNumber(m.facilitiesShort)],
                ['Nearest expiry', m && fmtDate(m.nearestExpiry)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="text-right font-medium text-ink-900">{v ?? <Skeleton className="h-4 w-24" />}</dd>
                </div>
              ))}
            </dl>
            {m?.description && <p className="border-t border-line px-4 py-3 text-xs text-ink-600">{m.description}</p>}
          </Card>
          <Card>
            <CardHeader title="Ingredients" description="The strength label is composed from these" />
            {m ? (
              <ul className="divide-y divide-line text-sm">
                {m.ingredients.map((i) => (
                  <li key={i.substanceId} className="flex justify-between gap-4 px-4 py-2.5">
                    <span className="text-ink-900">{i.substance}</span>
                    <span className="tabular text-ink-600">
                      {fmtNumber(i.strengthValue)} {i.strengthUom}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Skeleton className="m-4 h-10" />
            )}
          </Card>
          <Card>
            <CardHeader title="Manufacturers" description="With batches of this medicine on record" />
            {m && !m.manufacturers.length ? (
              <p className="px-4 py-3 text-xs text-ink-500">No batches recorded yet.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {m?.manufacturers.map((x) => (
                  <li key={x.id} className="px-4 py-2.5 text-ink-900">
                    {x.name}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader
            title="Stock by facility"
            description={user.platformScope ? 'Usable stock at every facility holding this medicine' : 'Usable stock at facilities in your scope'}
          />
          <DataTable
            columns={stockCols}
            rows={m?.stockByFacility}
            rowKey={(r) => String(r.facilityId)}
            loading={q.isLoading}
            skeletonRows={5}
            empty={{ title: 'Not stocked in your scope', description: 'No facility you can see holds this medicine. Use “Request stock” to find sources.' }}
          />
        </Card>
      </div>

      <Card>
        <CardHeader title="Batches on hand" description="Lots of this medicine held anywhere in the network, earliest expiry first" />
        <DataTable
          columns={batchCols}
          rows={batches.data?.data}
          rowKey={(b) => String(b.id)}
          loading={batches.isLoading}
          error={batches.error}
          onRetry={() => batches.refetch()}
          skeletonRows={5}
          empty={{ title: 'No batches on hand' }}
        />
        <Pagination meta={batches.data?.meta} onPageChange={setPage} />
      </Card>
      <RequestTransferModal open={requesting} onClose={() => setRequesting(false)} prefill={{ mode: 'pull', medicineId: id }} />
    </>
  );
}
