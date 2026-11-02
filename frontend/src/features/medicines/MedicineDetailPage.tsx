import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftRight } from 'lucide-react';
import type { Batch, MedicineStockByFacility } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import { Badge, Button, Card, CardHeader, DataTable, ErrorState, ExpiryBadge, PageHeader, Pagination, Skeleton, type Column } from '@/components/ui';
import { useBatches, useMedicine } from '@/hooks/queries';
import { daysUntil, fmtDate, fmtNumber } from '@/lib/format';
import { DOSAGE_FORM_LABEL } from '@/lib/labels';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

export default function MedicineDetailPage() {
  const { id = '' } = useParams();
  const user = useCurrentUser();
  const q = useMedicine(id);
  const [page, setPage] = useState(1);
  const batches = useBatches({ medicineId: id, page, pageSize: 10, sortBy: 'expiryDate' });
  const [transfer, setTransfer] = useState<TransferPrefill | null>(null);

  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} className="py-24" />;
  const m = q.data;

  const stockCols: Column<MedicineStockByFacility>[] = [
    {
      key: 'facility',
      header: 'Facility',
      cell: (r) => (
        <Link to={`/facilities/${r.facility.id}`} className="font-medium text-ink-900 hover:underline">
          {r.facility.name}
        </Link>
      ),
    },
    { key: 'batches', header: 'Batches', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.batchCount}</span> },
    { key: 'available', header: 'Available', align: 'right', cell: (r) => <span className="tabular font-medium">{fmtNumber(r.available)}</span> },
    { key: 'reserved', header: 'Reserved', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular text-ink-600">{fmtNumber(r.reserved)}</span> },
    { key: 'expiry', header: 'Nearest expiry', align: 'right', cell: (r) => <span className="tabular text-xs text-ink-600">{fmtDate(r.nearestExpiry)}</span> },
  ];

  const batchCols: Column<Batch>[] = [
    { key: 'batch', header: 'Batch', cell: (b) => <span className="tabular font-medium text-ink-900">{b.batchNumber}</span> },
    { key: 'facility', header: 'Facility', cell: (b) => <span className="text-ink-700">{b.facility.name}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      cell: (b) => (
        <span className="flex items-center gap-2">
          <span className="tabular text-xs">{fmtDate(b.expiryDate)}</span>
          <ExpiryBadge days={daysUntil(b.expiryDate)} />
        </span>
      ),
    },
    { key: 'available', header: 'Available', align: 'right', cell: (b) => <span className="tabular font-medium">{fmtNumber(b.quantityAvailable)}</span> },
    {
      key: 'act',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cell: (b) =>
        can(user, 'transfer:request') &&
        daysUntil(b.expiryDate) >= 0 &&
        b.quantityAvailable > 0 && (
          <Button
            variant="ghost"
            size="sm"
            icon={<ArrowLeftRight className="size-3.5" />}
            onClick={() => setTransfer({ medicine: b.medicine, batch: { id: b.id, batchNumber: b.batchNumber, quantityAvailable: b.quantityAvailable, expiryDate: b.expiryDate, facility: b.facility } })}
          >
            Transfer
          </Button>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Medicine catalogue', to: '/medicines' }, { label: m?.name ?? '…' }]}
        title={
          m ? (
            <span className="flex flex-wrap items-center gap-2">
              {m.name} <span className="font-normal text-ink-500">{m.strength}</span>
              {m.isEssential && <Badge tone="success">Essential medicine</Badge>}
            </span>
          ) : (
            <Skeleton className="h-7 w-64" />
          )
        }
        description={m && `${m.genericName} · ${DOSAGE_FORM_LABEL[m.dosageForm]} · ${m.code}`}
      />

      <div className="mb-5 grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader title="Details" />
          <dl className="divide-y divide-line text-sm">
            {[
              ['Category', m?.category],
              ['Manufacturer', m?.manufacturer],
              ['Issue unit', m?.unit],
              ['Reorder threshold', m && `${fmtNumber(m.reorderThreshold)} ${m.unit}s`],
              ['Critical threshold', m && `${fmtNumber(m.criticalThreshold)} ${m.unit}s`],
              ['Network stock', m && `${fmtNumber(m.totalAvailable)} ${m.unit}s`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 px-4 py-2.5">
                <dt className="text-ink-500">{k}</dt>
                <dd className="text-right font-medium text-ink-900">{v ?? <Skeleton className="h-4 w-24" />}</dd>
              </div>
            ))}
          </dl>
          {m?.description && <p className="border-t border-line px-4 py-3 text-xs text-ink-600">{m.description}</p>}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Stock by facility" description="Usable (non-expired) stock only" />
          <DataTable
            columns={stockCols}
            rows={m?.stockByFacility}
            rowKey={(r) => r.facility.id}
            loading={q.isLoading}
            skeletonRows={5}
            empty={{ title: 'Not stocked anywhere', description: 'No facility currently holds usable stock of this medicine.' }}
          />
        </Card>
      </div>

      <Card>
        <CardHeader title="Batches" description="All batches of this medicine across the network, earliest expiry first" />
        <DataTable
          columns={batchCols}
          rows={batches.data?.data}
          rowKey={(b) => b.id}
          loading={batches.isLoading}
          error={batches.error}
          onRetry={() => batches.refetch()}
          skeletonRows={5}
          empty={{ title: 'No batches recorded' }}
        />
        <Pagination meta={batches.data?.meta} onPageChange={setPage} />
      </Card>
      <RequestTransferModal open={!!transfer} onClose={() => setTransfer(null)} prefill={transfer ?? undefined} />
    </>
  );
}
