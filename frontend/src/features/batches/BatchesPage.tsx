import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api';
import type { Batch, BatchStatus, ExpiryBucket } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { can } from '@/auth/permissions';
import {
  BatchStatusBadge,
  Button,
  Card,
  DataTable,
  ErrorState,
  ExpiryBadge,
  FilterSelect,
  FormField,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  Skeleton,
  Textarea,
  Toolbar,
  useToast,
  type Column,
} from '@/components/ui';
import { useBatch, useBatches, useManufacturers, useSetBatchStatus } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtCurrency, fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { BATCH_STATUS_LABEL, EXPIRY_BUCKET_LABEL, options } from '@/lib/labels';

const FILTERS = ['status', 'bucket', 'manufacturerId', 'medicineId', 'onHand', 'open'] as const;

export default function BatchesPage() {
  const lp = useListParams(FILTERS, { sortBy: 'expiryDate' });
  const [, setSp] = useSearchParams();
  const manufacturers = useManufacturers();
  const q = useBatches({
    ...lp.query,
    status: lp.filters.status as BatchStatus | undefined,
    expiryBucket: lp.filters.bucket as ExpiryBucket | undefined,
    manufacturerId: toId(lp.filters.manufacturerId),
    medicineId: toId(lp.filters.medicineId),
    onHandOnly: lp.filters.onHand === 'false' ? 'false' : 'true',
  });
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

  const columns: Column<Batch>[] = [
    {
      key: 'batch',
      header: 'Batch',
      sortKey: 'batchNumber',
      cell: (b) => (
        <div>
          <p className="tabular font-medium text-ink-900">{b.batchNumber}</p>
          <p className="text-xs text-ink-500">
            {b.medicineName} {b.strengthLabel}
          </p>
        </div>
      ),
    },
    { key: 'medicine', header: 'Medicine', sortKey: 'medicine', hideOnMobile: true, cell: (b) => <span className="text-xs text-ink-600">{b.medicineCode}</span> },
    { key: 'mfr', header: 'Manufacturer', hideOnMobile: true, cell: (b) => <span className="text-xs text-ink-700">{b.manufacturer}</span> },
    {
      key: 'expiry',
      header: 'Expiry',
      sortKey: 'expiryDate',
      cell: (b) => (
        <span className="flex flex-col items-start gap-1">
          <span className="tabular text-xs text-ink-700">{fmtDate(b.expiryDate)}</span>
          <ExpiryBadge days={b.daysToExpiry} />
        </span>
      ),
    },
    { key: 'status', header: 'Status', sortKey: 'status', cell: (b) => <BatchStatusBadge status={b.status} /> },
    { key: 'onHand', header: 'Network on hand', sortKey: 'onHand', align: 'right', cell: (b) => <span className="tabular font-medium">{fmtNumber(b.networkOnHand)}</span> },
    { key: 'holding', header: 'Facilities', align: 'right', hideOnMobile: true, cell: (b) => <span className="tabular text-ink-600">{b.facilitiesHolding}</span> },
  ];

  return (
    <>
      <PageHeader title="Batches" description="Manufacturer lots across the network. A lot is recorded once; each facility holding it has its own inventory row." />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search batch or medicine…" />
          <FilterSelect label="Status" value={lp.filters.status} onChange={(v) => lp.setFilter('status', v)} options={options(BATCH_STATUS_LABEL)} />
          <FilterSelect label="Expiry" value={lp.filters.bucket} onChange={(v) => lp.setFilter('bucket', v)} options={options(EXPIRY_BUCKET_LABEL)} />
          <FilterSelect
            label="Manufacturer"
            value={lp.filters.manufacturerId}
            onChange={(v) => lp.setFilter('manufacturerId', v)}
            options={(manufacturers.data ?? []).map((m) => ({ value: String(m.id), label: m.name }))}
          />
          <label className="flex h-9 items-center gap-2 rounded-md border border-line-strong px-2.5 text-sm text-ink-700">
            <input type="checkbox" className="size-4 accent-brand-600" checked={lp.filters.onHand === 'false'} onChange={(e) => lp.setFilter('onHand', e.target.checked ? 'false' : undefined)} />
            Include depleted lots
          </label>
        </Toolbar>
        <DataTable
          caption="Batches"
          columns={columns}
          rows={q.data?.data}
          rowKey={(b) => String(b.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          sortBy={lp.sortBy}
          sortDir={lp.sortDir}
          onSortChange={lp.setSort}
          onRowClick={(b) => setOpen(b.id)}
          empty={{ title: 'No batches match these filters' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <BatchDetailModal id={openId} onClose={() => setOpen(undefined)} />
    </>
  );
}

function BatchDetailModal({ id, onClose }: { id: number | undefined; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const q = useBatch(id);
  const setStatus = useSetBatchStatus();
  const b = q.data;
  const [status, setStatusValue] = useState<BatchStatus>('ACTIVE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canManage = can(user, 'batch:manage');

  useEffect(() => {
    if (b) setStatusValue(b.status);
    setReason('');
    setError(null);
  }, [b]);

  const save = async () => {
    if (!b) return;
    if (status !== 'ACTIVE' && reason.trim().length < 3) return setError('Give a reason for quarantining or recalling the lot');
    try {
      await setStatus.mutateAsync({ id: b.id, status, reason: reason.trim() || undefined });
      toast.success('Batch status updated', `${b.batchNumber} is now ${BATCH_STATUS_LABEL[status].toLowerCase()}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not change the status.');
    }
  };

  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={b ? `Batch ${b.batchNumber}` : 'Batch'} description={b && `${b.medicineName} ${b.strengthLabel} · ${b.manufacturer}`}>
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !b ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-5">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ['Manufactured', fmtDate(b.manufactureDate)],
              ['Expires', `${fmtDate(b.expiryDate)} (${b.daysToExpiry} d)`],
              ['Unit cost', fmtCurrency(b.unitCost)],
              ['Network on hand', fmtNumber(b.networkOnHand)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-ink-500">{k}</dt>
                <dd className="tabular font-medium text-ink-900">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <BatchStatusBadge status={b.status} />
            {b.statusReason && <span className="text-xs text-ink-600">{b.statusReason}</span>}
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Holdings {user.platformScope ? '' : '(facilities in your scope)'}</p>
            {!b.holdings.length ? (
              <p className="text-xs text-ink-500">No facility in your scope holds this lot.</p>
            ) : (
              <div className="scrollbar-thin overflow-x-auto rounded-lg border border-line">
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr className="border-b border-line bg-subtle/70 text-left text-xs text-ink-500">
                      <th className="px-3 py-2 font-medium">Facility</th>
                      <th className="px-3 py-2 text-right font-medium">Available</th>
                      <th className="px-3 py-2 text-right font-medium">Reserved</th>
                      <th className="px-3 py-2 text-right font-medium">Damaged</th>
                      <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.holdings.map((h) => (
                      <tr key={h.inventoryId} className="border-b border-line last:border-0">
                        <td className="px-3 py-2 text-ink-900">
                          {h.facilityCode} <span className="text-xs text-ink-500">{h.facilityName}</span>
                        </td>
                        <td className="px-3 py-2 text-right">{fmtNumber(h.qtyAvailable)}</td>
                        <td className="px-3 py-2 text-right text-ink-600">{fmtNumber(h.qtyReserved)}</td>
                        <td className="px-3 py-2 text-right text-ink-600">{fmtNumber(h.qtyDamaged)}</td>
                        <td className="hidden px-3 py-2 text-right text-xs text-ink-500 sm:table-cell">{fmtDateTime(h.updatedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {canManage && (
            <div className="space-y-3 border-t border-line pt-4">
              <p className="text-xs text-ink-600">
                Quarantined or recalled lots cannot be dispensed or dispatched. Approved transfers holding this lot will be refused at dispatch.
              </p>
              {error && (
                <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
                  {error}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
                <FormField label="Status" htmlFor="batch-status">
                  <Select id="batch-status" value={status} onChange={(e) => setStatusValue(e.target.value as BatchStatus)}>
                    {options(BATCH_STATUS_LABEL).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Reason" htmlFor="batch-reason" required={status !== 'ACTIVE'}>
                  <Textarea id="batch-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                </FormField>
              </div>
              <div className="flex justify-end">
                <Button loading={setStatus.isPending} disabled={status === b.status} onClick={save} variant={status === 'RECALLED' ? 'danger' : 'primary'}>
                  Change status
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
