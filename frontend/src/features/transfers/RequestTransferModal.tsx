import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDownToLine, ArrowUpFromLine, Info, Plus, Trash2 } from 'lucide-react';
import { ApiError, newIdempotencyKey } from '@/api';
import type { FacilityRef, InventoryRow, SourceOption } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { facilitiesWith } from '@/auth/permissions';
import { Badge, Button, FormField, Input, Modal, Segmented, Select, Textarea, useToast } from '@/components/ui';
import { useCreateTransfer, useFacilityDirectory, useInventory, useMedicines, useSources, useStockRequests } from '@/hooks/queries';
import { fmtDate, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

export type TransferMode = 'pull' | 'push';

export interface TransferPrefill {
  mode?: TransferMode;
  /** Pull: the facility receiving the stock. */
  destinationFacilityId?: number;
  /** Push: the facility sending the stock. */
  sourceFacilityId?: number;
  /** Pull: the medicine to source for the first line. */
  medicineId?: number;
  quantity?: number;
  stockRequestItemId?: number;
  /** Push: an inventory row to start with (e.g. a near-expiry batch). */
  pushInventory?: InventoryRow;
  notes?: string;
}

interface Line {
  key: string;
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  medicineId: number;
  medicineName: string;
  available: number;
  quantity: string;
  stockRequestItemId?: number;
}

const lineFromSource = (o: SourceOption, medicineId: number, medicineName: string, quantity?: number, stockRequestItemId?: number): Line => ({
  key: `${o.batchId}`,
  batchId: o.batchId,
  batchNumber: o.batchNumber,
  expiryDate: o.expiryDate,
  medicineId,
  medicineName,
  available: o.qtyAvailable,
  quantity: quantity ? String(Math.min(quantity, o.qtyAvailable)) : '',
  stockRequestItemId,
});

const lineFromInventory = (r: InventoryRow, quantity?: number): Line => ({
  key: `${r.batchId}`,
  batchId: r.batchId,
  batchNumber: r.batchNumber,
  expiryDate: r.expiryDate,
  medicineId: r.medicineId,
  medicineName: r.medicineName,
  available: r.qtyAvailable,
  quantity: quantity ? String(Math.min(quantity, r.qtyAvailable)) : '',
});

/* ------------------------------ pull: add a line ------------------------------ */

function PullPicker({
  destinationId,
  source,
  initialMedicineId,
  initialQuantity,
  initialStockRequestItemId,
  taken,
  onAdd,
}: {
  destinationId: number;
  source: FacilityRef | null;
  initialMedicineId?: number;
  initialQuantity?: number;
  initialStockRequestItemId?: number;
  taken: Set<number>;
  onAdd: (line: Line, source: FacilityRef) => void;
}) {
  const [medicineId, setMedicineId] = useState<number | undefined>(initialMedicineId);
  const [pick, setPick] = useState('');
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const sources = useSources(medicineId, destinationId);
  const medicine = medicines.data?.data.find((m) => m.id === medicineId);

  // Every line must come from one source facility, and each batch may appear once.
  const options = (sources.data ?? []).filter((o) => (!source || o.facility.id === source.id) && !taken.has(o.batchId));

  const add = () => {
    const o = options.find((x) => String(x.inventoryId) === pick);
    if (!o || !medicine) return;
    onAdd(lineFromSource(o, medicine.id, medicine.displayName, initialMedicineId === medicine.id ? initialQuantity : undefined, initialMedicineId === medicine.id ? initialStockRequestItemId : undefined), o.facility);
    setPick('');
  };

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-line-strong p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Medicine" htmlFor="pull-medicine">
          <Select
            id="pull-medicine"
            value={medicineId ?? ''}
            onChange={(e) => {
              setMedicineId(e.target.value ? Number(e.target.value) : undefined);
              setPick('');
            }}
          >
            <option value="">{medicines.isLoading ? 'Loading…' : 'Select medicine…'}</option>
            {medicines.data?.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Source batch"
          htmlFor="pull-source"
          hint={
            sources.isError
              ? (sources.error as Error).message
              : medicineId && !sources.isLoading && !options.length
                ? source
                  ? `${source.code} holds no other eligible batch of this medicine.`
                  : 'No other facility holds an eligible batch.'
                : 'Earliest expiry first (FEFO); only batches with enough shelf life are offered.'
          }
        >
          <Select id="pull-source" value={pick} disabled={!medicineId || sources.isLoading || !options.length} onChange={(e) => setPick(e.target.value)}>
            <option value="">{sources.isLoading ? 'Loading sources…' : 'Select batch…'}</option>
            {options.map((o) => (
              <option key={o.inventoryId} value={o.inventoryId}>
                {o.facility.code} · {o.batchNumber} · {fmtNumber(o.qtyAvailable)} avail · exp {fmtDate(o.expiryDate)}
                {o.distanceKm != null ? ` · ${o.distanceKm} km` : ''}
                {o.crossOrganization ? ' · other org' : ''}
                {o.sourceStockStatus !== 'OK' ? ` · source ${o.sourceStockStatus.toLowerCase()}` : ''}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} disabled={!pick} onClick={add}>
          Add line
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------ push: add a line ------------------------------ */

function PushPicker({ sourceId, taken, onAdd }: { sourceId: number; taken: Set<number>; onAdd: (line: Line) => void }) {
  const [pick, setPick] = useState('');
  const inv = useInventory({ facilityId: sourceId, onHandOnly: 'true', pageSize: 100, sortBy: 'expiryDate', sortDir: 'asc' });
  const rows = (inv.data?.data ?? []).filter((r) => r.isUsable && r.qtyAvailable > 0 && !taken.has(r.batchId));
  const add = () => {
    const r = rows.find((x) => String(x.inventoryId) === pick);
    if (!r) return;
    onAdd(lineFromInventory(r));
    setPick('');
  };
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-line-strong p-3">
      <FormField
        label="Batch to send"
        htmlFor="push-batch"
        className="min-w-0 flex-1"
        hint={(inv.data?.meta.total ?? 0) > 100 ? 'Showing the 100 earliest-expiring batches.' : 'Usable batches at the source, earliest expiry first.'}
      >
        <Select id="push-batch" value={pick} disabled={inv.isLoading || !rows.length} onChange={(e) => setPick(e.target.value)}>
          <option value="">{inv.isLoading ? 'Loading stock…' : rows.length ? 'Select batch…' : 'No usable stock'}</option>
          {rows.map((r) => (
            <option key={r.inventoryId} value={r.inventoryId}>
              {r.medicineName} · {r.batchNumber} · {fmtNumber(r.qtyAvailable)} avail · exp {fmtDate(r.expiryDate)}
            </option>
          ))}
        </Select>
      </FormField>
      <Button variant="secondary" size="md" icon={<Plus className="size-3.5" />} disabled={!pick} onClick={add}>
        Add line
      </Button>
    </div>
  );
}

/* ----------------------------------- modal ----------------------------------- */

export function RequestTransferModal({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: TransferPrefill }) {
  const user = useCurrentUser();
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateTransfer();
  const { facilities, byId } = useFacilityDirectory();
  const requestable = facilitiesWith(user, 'transfer:request');

  const [mode, setMode] = useState<TransferMode>('pull');
  const [destinationId, setDestinationId] = useState<number | undefined>();
  const [sourceId, setSourceId] = useState<number | undefined>();
  const [pullSource, setPullSource] = useState<FacilityRef | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  // One key per submission attempt of this form: a retry after a network error cannot create a duplicate.
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => {
    if (!open) return;
    const m = prefill?.mode ?? (prefill?.pushInventory ? 'push' : 'pull');
    setMode(m);
    setDestinationId(m === 'pull' ? (prefill?.destinationFacilityId ?? (requestable.length === 1 ? requestable[0] : undefined)) : prefill?.destinationFacilityId);
    setSourceId(m === 'push' ? (prefill?.sourceFacilityId ?? prefill?.pushInventory?.facilityId ?? (requestable.length === 1 ? requestable[0] : undefined)) : undefined);
    setPullSource(null);
    setLines(prefill?.pushInventory ? [lineFromInventory(prefill.pushInventory, prefill.quantity)] : []);
    setNotes(prefill?.notes ?? '');
    setErrors({});
    setFormError(null);
    idemKey.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  const effectiveSource = mode === 'push' ? (sourceId ? byId(sourceId) : undefined) : pullSource;
  const effectiveDest = destinationId ? byId(destinationId) : undefined;
  const taken = useMemo(() => new Set(lines.map((l) => l.batchId)), [lines]);

  // Open stock requests at the destination, for linking lines (pull only).
  const openRequests = useStockRequests({ facilityId: destinationId, status: 'OPEN', pageSize: 100 });
  const requestItems = mode === 'pull' && destinationId ? (openRequests.data?.data ?? []).flatMap((r) => r.items.map((i) => ({ ...i, requestCode: r.code }))) : [];

  const switchMode = (m: TransferMode) => {
    setMode(m);
    setLines([]);
    setPullSource(null);
    setErrors({});
    if (m === 'pull') {
      setSourceId(undefined);
      setDestinationId(requestable.length === 1 ? requestable[0] : undefined);
    } else {
      setDestinationId(undefined);
      setSourceId(requestable.length === 1 ? requestable[0] : undefined);
    }
  };

  const updateLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) =>
    setLines((ls) => {
      const next = ls.filter((l) => l.key !== key);
      if (!next.length) setPullSource(null);
      return next;
    });

  const close = () => {
    create.reset();
    onClose();
  };

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (!effectiveSource) errs.source = mode === 'push' ? 'Choose the sending facility' : 'Add at least one line to choose a source';
    if (!destinationId) errs.destination = 'Choose the receiving facility';
    if (effectiveSource && destinationId === effectiveSource.id) errs.destination = 'Destination must differ from the source';
    if (!lines.length) errs.lines = 'Add at least one batch';
    for (const l of lines) {
      const n = Number(l.quantity);
      if (!Number.isInteger(n) || n < 1) errs[`q${l.key}`] = 'Whole units, at least 1';
      else if (n > l.available) errs[`q${l.key}`] = `Only ${fmtNumber(l.available)} available`;
    }
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;
    try {
      const t = await create.mutateAsync({
        input: {
          sourceFacilityId: effectiveSource!.id,
          destinationFacilityId: destinationId!,
          items: lines.map((l) => ({ batchId: l.batchId, quantity: Number(l.quantity), stockRequestItemId: l.stockRequestItemId })),
          notes: notes.trim() || undefined,
        },
        opts: { idempotencyKey: idemKey.current },
      });
      toast.success(`Transfer ${t.code} requested`, `${fmtNumber(t.totalUnits)} units from ${t.sourceFacility.code}. Stock is reserved when it is approved.`);
      close();
      navigate(`/transfers?open=${t.id}`);
    } catch (e) {
      // A definitive refusal means the next attempt is a new request.
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) idemKey.current = newIdempotencyKey();
      setFormError(e instanceof ApiError ? e.message : 'The transfer request failed.');
    }
  };

  const destOptions = mode === 'pull' ? facilities.filter((f) => requestable.includes(f.id)) : facilities.filter((f) => f.id !== sourceId && f.isActive);
  const sourceOptions = facilities.filter((f) => requestable.includes(f.id));
  const totalUnits = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);

  return (
    <Modal
      open={open}
      onClose={close}
      size="lg"
      title="Request transfer"
      description="The source facility approves before dispatch (plus its organisation for cross-organisation transfers). Stock is reserved at approval, not now."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button onClick={submit} loading={create.isPending} disabled={!requestable.length}>
            Submit request
          </Button>
        </>
      }
    >
      {!requestable.length ? (
        <p className="text-sm text-ink-600">Your roles don't include requesting transfers at any facility.</p>
      ) : (
        <div className="space-y-4">
          <Segmented<TransferMode>
            value={mode}
            onChange={switchMode}
            options={[
              { value: 'pull', label: <><ArrowDownToLine className="size-3.5" /> Into my facility</> },
              { value: 'push', label: <><ArrowUpFromLine className="size-3.5" /> Out of my facility</> },
            ]}
          />

          {formError && (
            <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
              {formError}
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {mode === 'pull' ? (
              <>
                <FormField label="Receiving facility" htmlFor="dest" error={errors.destination} required>
                  <Select
                    id="dest"
                    invalid={!!errors.destination}
                    value={destinationId ?? ''}
                    onChange={(e) => {
                      setDestinationId(e.target.value ? Number(e.target.value) : undefined);
                      setLines([]);
                      setPullSource(null);
                    }}
                  >
                    <option value="">Select…</option>
                    {destOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Source facility" htmlFor="src" error={errors.source} hint="Set by the first line; every line ships from one facility.">
                  <Input id="src" readOnly className="bg-subtle" value={pullSource ? `${pullSource.code} · ${pullSource.name}` : '—'} />
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Sending facility" htmlFor="src" error={errors.source} required>
                  <Select
                    id="src"
                    invalid={!!errors.source}
                    value={sourceId ?? ''}
                    onChange={(e) => {
                      setSourceId(e.target.value ? Number(e.target.value) : undefined);
                      setLines([]);
                    }}
                  >
                    <option value="">Select…</option>
                    {sourceOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Receiving facility" htmlFor="dest" error={errors.destination} required>
                  <Select id="dest" invalid={!!errors.destination} value={destinationId ?? ''} onChange={(e) => setDestinationId(e.target.value ? Number(e.target.value) : undefined)}>
                    <option value="">Select…</option>
                    {destOptions.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.code} · {f.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </>
            )}
          </div>

          {effectiveSource && effectiveDest && byId(effectiveSource.id)?.organizationId !== effectiveDest.organizationId && (
            <p className="flex items-start gap-1.5 text-xs text-info-700">
              <Info className="mt-px size-3.5 shrink-0" /> Cross-organisation transfer: the source organisation must also approve, under an agreement in force.
            </p>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-ink-700">
              Lines <span className="font-normal text-ink-500">({lines.length} · {fmtNumber(totalUnits)} units)</span>
            </p>
            {errors.lines && <p className="mb-2 text-xs text-danger-600">{errors.lines}</p>}
            {lines.length > 0 && (
              <ul className="mb-3 divide-y divide-line rounded-lg border border-line">
                {lines.map((l) => {
                  const err = errors[`q${l.key}`];
                  const linkable = requestItems.filter((i) => i.medicineId === l.medicineId);
                  return (
                    <li key={l.key} className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink-900">{l.medicineName}</p>
                        <p className="tabular text-xs text-ink-500">
                          Batch {l.batchNumber} · exp {fmtDate(l.expiryDate)} · {fmtNumber(l.available)} available
                        </p>
                        {mode === 'pull' && linkable.length > 0 && (
                          <label className="mt-1.5 flex items-center gap-2 text-xs text-ink-600">
                            <span className="shrink-0">Fulfils</span>
                            <select
                              aria-label={`Stock request for ${l.medicineName}`}
                              value={l.stockRequestItemId ?? ''}
                              onChange={(e) => updateLine(l.key, { stockRequestItemId: e.target.value ? Number(e.target.value) : undefined })}
                              className="h-7 min-w-0 flex-1 rounded border border-line-strong bg-surface px-1.5 text-xs"
                            >
                              <option value="">No stock request</option>
                              {linkable.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.requestCode}: {fmtNumber(i.quantityRequested - i.quantityReceived - i.quantityInProgress)} still needed
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                      <div>
                        <Input
                          aria-label={`Quantity of ${l.batchNumber}`}
                          type="number"
                          min={1}
                          max={l.available}
                          inputMode="numeric"
                          placeholder="Qty"
                          invalid={!!err}
                          value={l.quantity}
                          onChange={(e) => updateLine(l.key, { quantity: e.target.value })}
                        />
                        {err && <p className="mt-1 text-xs text-danger-600">{err}</p>}
                      </div>
                      <Button variant="ghost" aria-label={`Remove ${l.batchNumber}`} icon={<Trash2 className="size-4" />} onClick={() => removeLine(l.key)} />
                    </li>
                  );
                })}
              </ul>
            )}
            {mode === 'pull' ? (
              destinationId ? (
                <PullPicker
                  key={destinationId}
                  destinationId={destinationId}
                  source={pullSource}
                  initialMedicineId={prefill?.medicineId}
                  initialQuantity={prefill?.quantity}
                  initialStockRequestItemId={prefill?.stockRequestItemId}
                  taken={taken}
                  onAdd={(line, src) => {
                    setPullSource((s) => s ?? src);
                    setLines((ls) => [...ls, line]);
                  }}
                />
              ) : (
                <p className={cn('rounded-lg border border-dashed border-line-strong p-3 text-xs text-ink-500')}>Choose the receiving facility first.</p>
              )
            ) : sourceId ? (
              <PushPicker key={sourceId} sourceId={sourceId} taken={taken} onAdd={(line) => setLines((ls) => [...ls, line])} />
            ) : (
              <p className="rounded-lg border border-dashed border-line-strong p-3 text-xs text-ink-500">Choose the sending facility first.</p>
            )}
          </div>

          <FormField label="Notes for approver" htmlFor="notes">
            <Textarea id="notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Clinical need, urgency, delivery instructions…" />
          </FormField>
          {effectiveSource && (
            <p className="text-xs text-ink-500">
              <Badge>{effectiveSource.code}</Badge> → <Badge>{effectiveDest?.code ?? '?'}</Badge>
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
