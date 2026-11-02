import { useEffect, useState } from 'react';
import { ClipboardPlus, Plus, Search, Trash2, X } from 'lucide-react';
import { ApiError } from '@/api';
import type { RequestPriority, StockRequest, StockRequestStatus } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { canAt, facilitiesWith } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FilterSelect,
  FormField,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Textarea,
  Toolbar,
  useToast,
  type Tone,
} from '@/components/ui';
import { useCancelStockRequest, useCreateStockRequest, useFacilityDirectory, useMedicines, useStockRequests } from '@/hooks/queries';
import { toId, useListParams } from '@/hooks/useListParams';
import { fmtDate, fmtNumber, fmtRelative, todayISODate } from '@/lib/format';
import { PRIORITY_LABEL, STOCK_REQUEST_STATUS_LABEL, options } from '@/lib/labels';
import { RequestTransferModal, type TransferPrefill } from '../transfers/RequestTransferModal';

const FILTERS = ['status', 'priority', 'facility'] as const;
const PRIORITY_TONE: Record<RequestPriority, Tone> = { ROUTINE: 'neutral', URGENT: 'warning', EMERGENCY: 'danger' };
const STATUS_TONE: Record<StockRequestStatus, Tone> = { OPEN: 'info', CLOSED: 'success', CANCELLED: 'neutral' };

export default function StockRequestsPage() {
  const user = useCurrentUser();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'createdAt', sortDir: 'desc', pageSize: 10 });
  const { facilities } = useFacilityDirectory();
  const status = (lp.filters.status as StockRequestStatus | undefined) ?? 'OPEN';
  const q = useStockRequests({
    ...lp.query,
    status,
    priority: lp.filters.priority as RequestPriority | undefined,
    facilityId: toId(lp.filters.facility) ?? scope.facilityId,
  });
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<StockRequest | null>(null);
  const [sourcing, setSourcing] = useState<TransferPrefill | null>(null);

  if (!user.permissions.includes('inventory:read')) return <Forbidden />;
  const canCreate = facilitiesWith(user, 'request:create').length > 0;

  return (
    <>
      <PageHeader
        title="Stock requests"
        description="A facility's statement of need. Transfers linked to a request line count towards it; the request closes when every line is fully received."
        actions={
          canCreate && (
            <Button icon={<ClipboardPlus className="size-4" />} onClick={() => setCreating(true)}>
              New stock request
            </Button>
          )
        }
      />
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={!!lp.filters.priority || !!lp.filters.facility}>
          <Segmented<StockRequestStatus>
            value={status}
            onChange={(v) => lp.setFilter('status', v === 'OPEN' ? undefined : v)}
            options={options(STOCK_REQUEST_STATUS_LABEL).map((o) => ({ value: o.value, label: o.label }))}
          />
          <FilterSelect label="Priority" value={lp.filters.priority} onChange={(v) => lp.setFilter('priority', v)} options={options(PRIORITY_LABEL)} />
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
        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : !q.data?.data.length ? (
          <EmptyState title={`No ${STOCK_REQUEST_STATUS_LABEL[status].toLowerCase()} stock requests`} />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.data.map((r) => {
              const canSource = r.status === 'OPEN' && canAt(user, 'transfer:request', r.facility.id);
              return (
                <li key={r.id} className="px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
                        <span className="tabular">{r.code}</span>
                        <Badge tone={STATUS_TONE[r.status]}>{STOCK_REQUEST_STATUS_LABEL[r.status]}</Badge>
                        <Badge tone={PRIORITY_TONE[r.priority]}>{PRIORITY_LABEL[r.priority]}</Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        {r.facility.code} · {r.facility.name} · by {r.requestedBy.name} {fmtRelative(r.createdAt)}
                        {r.neededBy && ` · needed by ${fmtDate(r.neededBy)}`}
                      </p>
                      {r.notes && <p className="mt-1 text-xs text-ink-600">{r.notes}</p>}
                    </div>
                    {r.status === 'OPEN' && canAt(user, 'request:create', r.facility.id) && (
                      <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => setCancelling(r)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <div className="scrollbar-thin mt-3 overflow-x-auto rounded-lg border border-line">
                    <table className="tabular w-full text-sm">
                      <thead>
                        <tr className="border-b border-line bg-subtle/70 text-left text-xs text-ink-500">
                          <th className="px-3 py-2 font-medium">Medicine</th>
                          <th className="px-3 py-2 text-right font-medium">Requested</th>
                          <th className="px-3 py-2 text-right font-medium">Received</th>
                          <th className="px-3 py-2 text-right font-medium">In progress</th>
                          <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                          {canSource && <th className="px-3 py-2"><span className="sr-only">Actions</span></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {r.items.map((i) => {
                          const outstanding = Math.max(0, i.quantityRequested - i.quantityReceived - i.quantityInProgress);
                          return (
                            <tr key={i.id} className="border-b border-line last:border-0">
                              <td className="px-3 py-2 text-ink-900">
                                {i.medicineName} <span className="text-ink-500">{i.strengthLabel}</span>
                              </td>
                              <td className="px-3 py-2 text-right">{fmtNumber(i.quantityRequested)}</td>
                              <td className="px-3 py-2 text-right text-brand-700">{fmtNumber(i.quantityReceived)}</td>
                              <td className="px-3 py-2 text-right text-info-700">{fmtNumber(i.quantityInProgress)}</td>
                              <td className="px-3 py-2 text-right font-medium">{fmtNumber(outstanding)}</td>
                              {canSource && (
                                <td className="px-3 py-2 text-right">
                                  {outstanding > 0 && (
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      icon={<Search className="size-3.5" />}
                                      onClick={() => setSourcing({ mode: 'pull', destinationFacilityId: r.facility.id, medicineId: i.medicineId, quantity: outstanding, stockRequestItemId: i.id })}
                                    >
                                      Source
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <CreateStockRequestModal open={creating} onClose={() => setCreating(false)} defaultFacility={scope.facilityId} />
      <CancelModal request={cancelling} onClose={() => setCancelling(null)} />
      <RequestTransferModal open={!!sourcing} onClose={() => setSourcing(null)} prefill={sourcing ?? undefined} />
    </>
  );
}

function CreateStockRequestModal({ open, onClose, defaultFacility }: { open: boolean; onClose: () => void; defaultFacility?: number }) {
  const user = useCurrentUser();
  const toast = useToast();
  const create = useCreateStockRequest();
  const { facilities } = useFacilityDirectory();
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const allowed = facilitiesWith(user, 'request:create');
  const [facilityId, setFacilityId] = useState('');
  const [priority, setPriority] = useState<RequestPriority>('ROUTINE');
  const [neededBy, setNeededBy] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<{ medicineId: string; quantity: string }[]>([{ medicineId: '', quantity: '' }]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFacilityId(defaultFacility && allowed.includes(defaultFacility) ? String(defaultFacility) : allowed.length === 1 ? String(allowed[0]) : '');
    setPriority('ROUTINE');
    setNeededBy('');
    setNotes('');
    setItems([{ medicineId: '', quantity: '' }]);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async () => {
    if (!facilityId) return setError('Choose the requesting facility');
    const parsed = items.map((i) => ({ medicineId: Number(i.medicineId), quantity: Number(i.quantity) }));
    if (parsed.some((i) => !i.medicineId || !Number.isInteger(i.quantity) || i.quantity < 1)) return setError('Every line needs a medicine and a whole quantity of at least 1');
    if (new Set(parsed.map((i) => i.medicineId)).size !== parsed.length) return setError('Each medicine may appear once');
    if (neededBy && neededBy < todayISODate()) return setError('The needed-by date cannot be in the past');
    try {
      const r = await create.mutateAsync({ facilityId: Number(facilityId), priority, neededBy: neededBy || undefined, notes: notes.trim() || undefined, items: parsed });
      toast.success(`Stock request ${r.code} created`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the request.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New stock request"
      description="Record what your facility needs. Source it with transfers linked to its lines."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            Create request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
            {error}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <FormField label="Facility" htmlFor="sr-fac" required className="sm:col-span-3">
            <Select id="sr-fac" value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">Select…</option>
              {facilities
                .filter((f) => allowed.includes(f.id))
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <FormField label="Priority" htmlFor="sr-pri">
            <Select id="sr-pri" value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority)}>
              {options(PRIORITY_LABEL).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Needed by" htmlFor="sr-date">
            <Input id="sr-date" type="date" min={todayISODate()} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </FormField>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-700">Lines</legend>
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] gap-2">
              <Select aria-label={`Medicine ${i + 1}`} value={it.medicineId} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, medicineId: e.target.value } : x)))}>
                <option value="">Medicine…</option>
                {medicines.data?.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                  </option>
                ))}
              </Select>
              <Input aria-label={`Quantity ${i + 1}`} type="number" min={1} inputMode="numeric" placeholder="Qty" value={it.quantity} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <Button variant="ghost" aria-label={`Remove line ${i + 1}`} disabled={items.length === 1} icon={<Trash2 className="size-4" />} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} />
            </div>
          ))}
          <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} disabled={items.length >= 50} onClick={() => setItems((xs) => [...xs, { medicineId: '', quantity: '' }])}>
            Add line
          </Button>
        </fieldset>
        <FormField label="Notes" htmlFor="sr-notes">
          <Textarea id="sr-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}

function CancelModal({ request, onClose }: { request: StockRequest | null; onClose: () => void }) {
  const toast = useToast();
  const cancel = useCancelStockRequest();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setError(null);
  }, [request?.id]);
  if (!request) return null;
  const submit = async () => {
    if (reason.trim().length < 3) return setError('Give a reason (3+ characters)');
    try {
      await cancel.mutateAsync({ id: request.id, reason: reason.trim() });
      toast.success(`Stock request ${request.code} cancelled`);
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not cancel the request.');
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Cancel ${request.code}`}
      description="Transfers already linked to it are not affected."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant="danger" loading={cancel.isPending} onClick={submit}>
            Cancel request
          </Button>
        </>
      }
    >
      <FormField label="Reason" htmlFor="sr-cancel" error={error ?? undefined} required>
        <Textarea id="sr-cancel" rows={2} maxLength={300} value={reason} invalid={!!error} onChange={(e) => setReason(e.target.value)} />
      </FormField>
    </Modal>
  );
}
