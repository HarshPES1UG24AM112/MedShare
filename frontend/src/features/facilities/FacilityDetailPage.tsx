import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Boxes, CalendarClock, Lock, MapPin, Package, Pencil, Phone, Snowflake, TriangleAlert } from 'lucide-react';
import { ApiError } from '@/api';
import type { Shortage, StockPolicy } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { canAt } from '@/auth/permissions';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DataTable,
  DemandBasisBadge,
  EmptyState,
  ErrorState,
  FormField,
  Input,
  Modal,
  PageHeader,
  Pagination,
  SearchInput,
  Segmented,
  SeverityBadge,
  Skeleton,
  StatCard,
  StockBar,
  StockStatusBadge,
  useToast,
  type Column,
} from '@/components/ui';
import { useFacility, useFacilitySettings, useFacilitySummary, useShortages, useUpdateStockPolicy } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useListParams';
import { fmtCompact, fmtCurrency, fmtNumber } from '@/lib/format';
import { FACILITY_TYPE_LABEL } from '@/lib/labels';

type Tab = 'shortages' | 'policy';

export default function FacilityDetailPage() {
  const id = Number(useParams().id);
  const user = useCurrentUser();
  const fq = useFacility(id);
  const f = fq.data;
  const inScope = !!f?.inScope;
  const sq = useFacilitySummary(id, inScope);
  const [tab, setTab] = useState<Tab>('shortages');

  if (fq.isError) return <ErrorState error={fq.error} onRetry={() => fq.refetch()} className="py-24" />;
  const s = sq.data;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Facilities', to: '/facilities' }, { label: f?.name ?? '…' }]}
        title={f ? f.name : <Skeleton className="h-7 w-72" />}
        description={f && `${f.code} · ${FACILITY_TYPE_LABEL[f.facilityType]} · ${f.organizationName}`}
        actions={
          inScope &&
          f && (
            <>
              <Link to={`/inventory?facility=${f.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-subtle">
                <Boxes className="size-4" /> Stock
              </Link>
              <Link to={`/transfers?facility=${f.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-subtle">
                Transfers
              </Link>
            </>
          )
        }
      />

      <Card className="mb-5">
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: MapPin, k: 'Region', v: f?.regionPath },
            { icon: MapPin, k: 'Address', v: f?.addressLine ?? '—' },
            { icon: Phone, k: 'Phone', v: f?.contactPhone ?? '—' },
            { icon: Snowflake, k: 'Cold chain / dispatch radius', v: f && `${f.hasColdChain ? 'Cold chain' : 'No cold chain'} · ${f.maxDispatchRadiusKm} km` },
          ].map(({ icon: I, k, v }) => (
            <div key={k} className="min-w-0">
              <dt className="flex items-center gap-1.5 text-xs text-ink-500">
                <I className="size-3.5" aria-hidden /> {k}
              </dt>
              <dd className="mt-0.5 truncate font-medium text-ink-900">{v ?? <Skeleton className="h-4 w-32" />}</dd>
            </div>
          ))}
        </dl>
        {f?.isSynthetic && <p className="border-t border-line px-4 py-2 text-[11px] text-ink-500">Synthetic facility created for demonstration.</p>}
      </Card>

      {f && !inScope ? (
        <Card>
          <EmptyState
            icon={<Lock className="size-5" />}
            title="Operational detail is restricted"
            description="This facility is outside your scope. You can see it in the directory and request stock from it, but not its inventory, shortages or stock policy."
          />
        </Card>
      ) : (
        <>
          {sq.isError ? (
            <Card className="mb-5">
              <ErrorState error={sq.error} onRetry={() => sq.refetch()} />
            </Card>
          ) : (
            <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <StatCard label="Usable units" icon={<Boxes className="size-4" />} value={s ? fmtCompact(s.usableUnits) : '—'} hint={s && `${fmtNumber(s.reservedUnits)} reserved`} loading={!s} />
              <StatCard label="Usable value" icon={<Package className="size-4" />} value={s ? fmtCurrency(s.usableValue) : '—'} hint={s && `${fmtNumber(s.damagedUnits)} damaged units`} loading={!s} />
              <StatCard label="Medicines in stock" icon={<Package className="size-4" />} value={fmtNumber(s?.medicinesInStock)} hint={s && `${s.batchesOnHand} batches on hand`} loading={!s} />
              <StatCard label="Critical shortages" icon={<TriangleAlert className="size-4" />} tone={s?.criticalShortages ? 'danger' : 'default'} value={fmtNumber(s?.criticalShortages)} hint={s && `${s.lowStock} low`} loading={!s} />
              <StatCard label="Expiring ≤ 30 d" icon={<CalendarClock className="size-4" />} tone={s?.expiring30dBatches ? 'warning' : 'default'} value={fmtNumber(s?.expiring30dBatches)} hint="batches" loading={!s} to={`/expiry?window=30`} />
              <StatCard label="Expired on hand" icon={<CalendarClock className="size-4" />} tone={s?.expiredBatches ? 'danger' : 'default'} value={fmtNumber(s?.expiredBatches)} hint="batches" loading={!s} to={`/expiry?window=expired`} />
            </div>
          )}

          <Segmented<Tab>
            className="mb-3 w-fit"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'shortages', label: 'Shortages' },
              { value: 'policy', label: 'Stock policy' },
            ]}
          />
          {tab === 'shortages' ? <ShortagesTab facilityId={id} /> : <PolicyTab facilityId={id} editable={canAt(user, 'settings:manage', id)} />}
        </>
      )}
    </>
  );
}

function ShortagesTab({ facilityId }: { facilityId: number }) {
  const [page, setPage] = useState(1);
  const q = useShortages({ facilityId, page, pageSize: 20, sortBy: 'coverage', sortDir: 'asc' });
  const cols: Column<Shortage>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      cell: (r) => (
        <Link to={`/medicines/${r.medicineId}`} className="font-medium text-ink-900 hover:underline">
          {r.medicineName} <span className="font-normal text-ink-500">{r.strengthLabel}</span>
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
          <StockBar current={r.currentStock} critical={r.minStockLevel} reorder={r.reorderThreshold} />
          <p className="tabular mt-1 text-[11px] text-ink-500">
            {fmtNumber(r.currentStock)} / {fmtNumber(r.reorderThreshold)}
          </p>
        </div>
      ),
    },
    { key: 'basis', header: 'Demand basis', hideOnMobile: true, cell: (r) => <DemandBasisBadge basis={r.demandBasis} possiblyCensored={r.possiblyCensored} /> },
    { key: 'days', header: 'Days of cover', align: 'right', cell: (r) => <span className="tabular font-medium">{r.daysRemaining == null ? '—' : fmtNumber(r.daysRemaining)}</span> },
  ];
  return (
    <Card>
      <CardHeader title="Medicines below reorder level" description="Lowest coverage first" />
      <DataTable
        columns={cols}
        rows={q.data?.data}
        rowKey={(r) => String(r.medicineId)}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        skeletonRows={4}
        empty={{ title: 'No shortages', description: 'Every medicine with a stock policy is at or above its reorder level.' }}
      />
      <Pagination meta={q.data?.meta} onPageChange={setPage} />
    </Card>
  );
}

function PolicyTab({ facilityId, editable }: { facilityId: number; editable: boolean }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  useEffect(() => setPage(1), [debounced]);
  const q = useFacilitySettings(facilityId, { page, pageSize: 20, search: debounced || undefined, sortBy: 'status', sortDir: 'asc' });
  const [editing, setEditing] = useState<StockPolicy | null>(null);

  const cols: Column<StockPolicy>[] = [
    {
      key: 'medicine',
      header: 'Medicine',
      cell: (r) => (
        <span className="font-medium text-ink-900">
          {r.medicineName} <span className="font-normal text-ink-500">{r.strengthLabel}</span>
        </span>
      ),
    },
    { key: 'status', header: 'Status', cell: (r) => <StockStatusBadge status={r.stockStatus} /> },
    {
      key: 'levels',
      header: 'Min / safety / reorder',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => (
        <span className="tabular text-xs text-ink-700">
          {fmtNumber(r.minStockLevel)} / {fmtNumber(r.safetyStock)} / {fmtNumber(r.reorderThreshold)}
        </span>
      ),
    },
    { key: 'usable', header: 'Usable', align: 'right', cell: (r) => <span className="tabular">{fmtNumber(r.usable)}</span> },
    {
      key: 'rate',
      header: 'Daily demand',
      hideOnMobile: true,
      cell: (r) => (
        <div className="space-y-1">
          <span className="tabular text-xs text-ink-900">{r.dailyRate == null ? '—' : `${fmtNumber(r.dailyRate)} / day`}</span>
          <DemandBasisBadge basis={r.demandBasis} possiblyCensored={r.possiblyCensored} />
        </div>
      ),
    },
    { key: 'days', header: 'Days of cover', align: 'right', hideOnMobile: true, cell: (r) => <span className="tabular">{r.daysOfInventory == null ? '—' : fmtNumber(r.daysOfInventory)}</span> },
    {
      key: 'edit',
      header: <span className="sr-only">Edit</span>,
      align: 'right',
      cell: (r) => editable && <Button variant="ghost" size="sm" icon={<Pencil className="size-3.5" />} aria-label={`Edit policy for ${r.medicineName}`} onClick={() => setEditing(r)} />,
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Stock policy"
        description={editable ? 'Per-medicine thresholds and demand estimates for this facility. Changes are audited.' : 'Per-medicine thresholds and demand estimates. Read-only for your role.'}
        actions={<SearchInput value={search} onChange={setSearch} placeholder="Search medicine…" className="sm:w-56" />}
      />
      <DataTable
        columns={cols}
        rows={q.data?.data}
        rowKey={(r) => String(r.medicineId)}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        skeletonRows={6}
        empty={{ title: 'No stock policies' }}
      />
      <Pagination meta={q.data?.meta} onPageChange={setPage} />
      <PolicyModal facilityId={facilityId} policy={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function PolicyModal({ facilityId, policy, onClose }: { facilityId: number; policy: StockPolicy | null; onClose: () => void }) {
  const toast = useToast();
  const update = useUpdateStockPolicy();
  const [v, setV] = useState({ minStockLevel: '', safetyStock: '', reorderThreshold: '', estimatedDailyConsumption: '', estimateIsSimulated: false });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!policy) return;
    setV({
      minStockLevel: String(policy.minStockLevel),
      safetyStock: String(policy.safetyStock),
      reorderThreshold: String(policy.reorderThreshold),
      estimatedDailyConsumption: String(policy.estimatedDailyConsumption),
      estimateIsSimulated: policy.estimateIsSimulated,
    });
    setError(null);
  }, [policy]);

  if (!policy) return null;

  const save = async () => {
    const [min, safety, reorder, rate] = [v.minStockLevel, v.safetyStock, v.reorderThreshold, v.estimatedDailyConsumption].map(Number);
    if (![min, safety, reorder].every((n) => Number.isInteger(n) && n >= 0) || reorder < 1) return setError('Levels are whole numbers; the reorder level must be at least 1.');
    if (min > reorder || safety > reorder) return setError('Minimum and safety stock cannot exceed the reorder level.');
    if (!(rate >= 0)) return setError('Daily consumption must be zero or more.');
    try {
      await update.mutateAsync({
        facilityId,
        medicineId: policy.medicineId,
        input: { minStockLevel: min, safetyStock: safety, reorderThreshold: reorder, estimatedDailyConsumption: rate, estimateIsSimulated: v.estimateIsSimulated },
      });
      toast.success('Stock policy saved', `${policy.medicineName} ${policy.strengthLabel}`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the policy.');
    }
  };

  const field = (key: 'minStockLevel' | 'safetyStock' | 'reorderThreshold' | 'estimatedDailyConsumption', label: string, hint: string) => (
    <FormField label={label} htmlFor={key} hint={hint} required>
      <Input id={key} type="number" min={0} step={key === 'estimatedDailyConsumption' ? '0.01' : '1'} value={v[key]} onChange={(e) => setV((s) => ({ ...s, [key]: e.target.value }))} />
    </FormField>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={`Stock policy · ${policy.medicineName} ${policy.strengthLabel}`}
      description="Below the minimum is CRITICAL; below the reorder level is LOW."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={update.isPending} onClick={save}>
            Save policy
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="mb-4 rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
          {error}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('minStockLevel', 'Minimum stock (critical)', 'Units')}
        {field('safetyStock', 'Safety stock', 'Units')}
        {field('reorderThreshold', 'Reorder level', 'Units')}
        {field('estimatedDailyConsumption', 'Estimated daily consumption', 'Used when measured demand is unavailable')}
        <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
          <input type="checkbox" className="size-4 accent-brand-600" checked={v.estimateIsSimulated} onChange={(e) => setV((s) => ({ ...s, estimateIsSimulated: e.target.checked }))} />
          The estimate is simulated (not configured from local knowledge)
        </label>
      </div>
      <p className="mt-4 text-xs text-ink-500">
        Current measured demand: {policy.measuredDailyConsumption == null ? 'not enough history' : `${fmtNumber(policy.measuredDailyConsumption)} / day`}. <Badge>{policy.demandBasis}</Badge>
      </p>
    </Modal>
  );
}
