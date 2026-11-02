import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError, newIdempotencyKey } from '@/api';
import type { InventoryRow, Movement, StockAction } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { facilitiesWith } from '@/auth/permissions';
import { Badge, Button, DataTable, FormField, Input, Modal, Pagination, Select, Textarea, useToast, type Column } from '@/components/ui';
import { useFacilityDirectory, useManufacturers, useMedicines, useMovements, useReceiveStock, useStockAction } from '@/hooks/queries';
import { fmtDate, fmtDateTime, fmtNumber, todayISODate } from '@/lib/format';
import { MOVEMENT_LABEL, MOVEMENT_TONE } from '@/lib/labels';
import { cn } from '@/lib/utils';

/* --------------------------------- Receive -------------------------------- */

const receiveSchema = z
  .object({
    facilityId: z.coerce.number({ invalid_type_error: 'Select a facility' }).int().positive('Select a facility'),
    medicineId: z.coerce.number({ invalid_type_error: 'Select a medicine' }).int().positive('Select a medicine'),
    manufacturerId: z.coerce.number({ invalid_type_error: 'Select a manufacturer' }).int().positive('Select a manufacturer'),
    batchNumber: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9-]{2,29}$/, 'Letters, digits and dashes (3–30)'),
    manufactureDate: z.string().min(1, 'Required'),
    expiryDate: z.string().min(1, 'Required'),
    quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Whole units only').positive('Must be at least 1').max(10_000_000),
    unitCost: z.coerce.number({ invalid_type_error: 'Enter a cost' }).min(0, 'Cannot be negative').max(1_000_000),
    reference: z.string().trim().max(60).optional(),
  })
  .refine((v) => v.manufactureDate <= todayISODate(), { path: ['manufactureDate'], message: 'Cannot be in the future' })
  .refine((v) => v.expiryDate > v.manufactureDate, { path: ['expiryDate'], message: 'Must be after the manufacture date' });

type ReceiveIn = z.input<typeof receiveSchema>;
type ReceiveOut = z.output<typeof receiveSchema>;

export function ReceiveStockModal({ open, onClose, facilityId }: { open: boolean; onClose: () => void; facilityId?: number }) {
  const user = useCurrentUser();
  const toast = useToast();
  const receive = useReceiveStock();
  const { facilities } = useFacilityDirectory();
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const manufacturers = useManufacturers();
  const writable = facilitiesWith(user, 'inventory:write');
  const defaultFacility = facilityId && writable.includes(facilityId) ? facilityId : writable.length === 1 ? writable[0] : undefined;
  const [formError, setFormError] = useState<string | null>(null);
  const idemKey = useRef(newIdempotencyKey());
  const empty = { facilityId: defaultFacility ?? '', unitCost: 0, batchNumber: '', manufactureDate: '', expiryDate: '', reference: '' } as unknown as ReceiveIn;
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ReceiveIn, unknown, ReceiveOut>({ resolver: zodResolver(receiveSchema), defaultValues: empty });

  useEffect(() => {
    if (!open) return;
    reset(empty);
    setFormError(null);
    idemKey.current = newIdempotencyKey();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFacility]);

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const row = await receive.mutateAsync({ input: { ...v, reference: v.reference || undefined }, opts: { idempotencyKey: idemKey.current } });
      toast.success('Stock received', `${fmtNumber(v.quantity)} × ${row.medicineName}, batch ${row.batchNumber}, at ${row.facilityCode}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status !== 0 && e.status < 500) idemKey.current = newIdempotencyKey();
      if (e instanceof ApiError && e.details) for (const [f, m] of Object.entries(e.details)) setError(f as keyof ReceiveIn, { message: m[0] });
      setFormError(e instanceof ApiError ? e.message : 'Could not record the receipt.');
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive stock"
      description="Record a goods receipt. The batch is created on its first receipt; later receipts of the same lot add to it."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="receive-stock" loading={receive.isPending}>
            Record receipt
          </Button>
        </>
      }
    >
      {formError && (
        <p role="alert" className="mb-4 rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
          {formError}
        </p>
      )}
      <form id="receive-stock" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Facility" htmlFor="facilityId" error={errors.facilityId?.message} required>
          <Select id="facilityId" invalid={!!errors.facilityId} {...register('facilityId')}>
            <option value="">Select…</option>
            {facilities
              .filter((f) => writable.includes(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.name}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="Medicine" htmlFor="medicineId" error={errors.medicineId?.message} required>
          <Select id="medicineId" invalid={!!errors.medicineId} {...register('medicineId')}>
            <option value="">{medicines.isLoading ? 'Loading…' : 'Select…'}</option>
            {medicines.data?.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Manufacturer" htmlFor="manufacturerId" error={errors.manufacturerId?.message} required>
          <Select id="manufacturerId" invalid={!!errors.manufacturerId} {...register('manufacturerId')}>
            <option value="">Select…</option>
            {manufacturers.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Batch / lot number" htmlFor="batchNumber" error={errors.batchNumber?.message} required>
          <Input id="batchNumber" className="uppercase" invalid={!!errors.batchNumber} placeholder="PAR2611-0001" {...register('batchNumber')} />
        </FormField>
        <FormField label="Manufacture date" htmlFor="manufactureDate" error={errors.manufactureDate?.message} required>
          <Input id="manufactureDate" type="date" max={todayISODate()} invalid={!!errors.manufactureDate} {...register('manufactureDate')} />
        </FormField>
        <FormField label="Expiry date" htmlFor="expiryDate" error={errors.expiryDate?.message} required>
          <Input id="expiryDate" type="date" invalid={!!errors.expiryDate} {...register('expiryDate')} />
        </FormField>
        <FormField label="Quantity (issue units)" htmlFor="quantity" error={errors.quantity?.message} required>
          <Input id="quantity" type="number" min={1} inputMode="numeric" invalid={!!errors.quantity} {...register('quantity')} />
        </FormField>
        <FormField label="Unit cost (INR)" htmlFor="unitCost" error={errors.unitCost?.message} required>
          <Input id="unitCost" type="number" min={0} step="0.01" inputMode="decimal" invalid={!!errors.unitCost} {...register('unitCost')} />
        </FormField>
        <FormField label="Reference" htmlFor="reference" error={errors.reference?.message} hint="Invoice or delivery note number" className="sm:col-span-2">
          <Input id="reference" {...register('reference')} />
        </FormField>
      </form>
    </Modal>
  );
}

/* ------------------------------- Stock actions ------------------------------ */

export const ACTION_META: Record<StockAction, { title: string; description: string; verb: string; needsReason: boolean; button: string }> = {
  dispense: { title: 'Dispense', description: 'Issue usable stock to patients or wards.', verb: 'dispensed', needsReason: false, button: 'Record dispensing' },
  damage: { title: 'Record damage', description: 'Move usable units to the damaged bucket.', verb: 'marked damaged', needsReason: true, button: 'Record damage' },
  dispose: { title: 'Dispose damaged stock', description: 'Destroy units already recorded as damaged.', verb: 'disposed', needsReason: true, button: 'Record disposal' },
  'write-off': { title: 'Write off expired stock', description: 'Remove expired units from usable inventory. Only expired batches can be written off.', verb: 'written off', needsReason: false, button: 'Write off' },
  adjust: { title: 'Stock-count adjustment', description: 'Correct the usable quantity after a physical count. Use a negative number to decrease.', verb: 'adjusted', needsReason: true, button: 'Apply adjustment' },
};

/** Which actions make sense for a row right now (the database still validates each one). */
export function availableActions(r: InventoryRow): StockAction[] {
  const out: StockAction[] = [];
  const expired = r.expiryBucket === 'EXPIRED';
  if (!expired && r.qtyAvailable > 0 && r.batchStatus === 'ACTIVE') out.push('dispense');
  if (r.qtyAvailable > 0) out.push('damage');
  if (r.qtyDamaged > 0) out.push('dispose');
  if (expired && r.qtyAvailable > 0) out.push('write-off');
  out.push('adjust');
  return out;
}

export function StockActionModal({ row, action, onClose }: { row: InventoryRow | null; action: StockAction | null; onClose: () => void }) {
  const toast = useToast();
  const act = useStockAction();
  const [quantity, setQuantity] = useState('');
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<{ quantity?: string; text?: string; form?: string }>({});
  const idemKey = useRef(newIdempotencyKey());
  const open = !!row && !!action;

  useEffect(() => {
    if (!open) return;
    setQuantity(action === 'write-off' && row ? String(row.qtyAvailable) : '');
    setText('');
    setErrors({});
    idemKey.current = newIdempotencyKey();
  }, [open, action, row]);

  if (!row || !action) return null;
  const meta = ACTION_META[action];
  const max = action === 'dispose' ? row.qtyDamaged : row.qtyAvailable;

  const submit = async () => {
    const n = Number(quantity);
    const errs: typeof errors = {};
    if (action === 'adjust') {
      if (!Number.isInteger(n) || n === 0) errs.quantity = 'Enter a non-zero whole number';
      else if (n < 0 && -n > row.qtyAvailable) errs.quantity = `Cannot remove more than the ${fmtNumber(row.qtyAvailable)} available`;
    } else if (!Number.isInteger(n) || n < 1) errs.quantity = 'Whole units, at least 1';
    else if (n > max) errs.quantity = `Only ${fmtNumber(max)} ${action === 'dispose' ? 'damaged' : 'available'}`;
    if (meta.needsReason && text.trim().length < 3) errs.text = 'Give a short reason (3+ characters)';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const input =
      action === 'dispense'
        ? { action, quantity: n, reference: text.trim() || undefined }
        : action === 'write-off'
          ? { action, quantity: n, reason: text.trim() || undefined }
          : action === 'adjust'
            ? { action, delta: n, reason: text.trim() }
            : { action, quantity: n, reason: text.trim() };
    try {
      await act.mutateAsync({ inventoryId: row.inventoryId, input, opts: { idempotencyKey: idemKey.current } });
      toast.success(`Stock ${meta.verb}`, `${row.medicineName}, batch ${row.batchNumber} at ${row.facilityCode}.`);
      onClose();
    } catch (e) {
      idemKey.current = newIdempotencyKey();
      setErrors({ form: e instanceof ApiError ? e.message : 'The stock change failed.' });
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={meta.title}
      description={meta.description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action === 'damage' || action === 'dispose' || action === 'write-off' ? 'danger' : 'primary'} loading={act.isPending} onClick={submit}>
            {meta.button}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line bg-subtle/60 p-3 text-sm">
          <p className="font-medium text-ink-900">{row.medicineName}</p>
          <p className="tabular mt-0.5 text-xs text-ink-600">
            {row.facilityCode} · batch {row.batchNumber} · exp {fmtDate(row.expiryDate)}
          </p>
          <p className="tabular mt-1.5 text-xs text-ink-600">
            Available <span className="font-medium text-ink-900">{fmtNumber(row.qtyAvailable)}</span> · Reserved {fmtNumber(row.qtyReserved)} · Damaged {fmtNumber(row.qtyDamaged)}
          </p>
        </div>
        {errors.form && (
          <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
            {errors.form}
          </p>
        )}
        <FormField
          label={action === 'adjust' ? 'Change in usable units (±)' : 'Quantity'}
          htmlFor="stock-qty"
          error={errors.quantity}
          hint={action === 'adjust' ? 'e.g. -12 after a count found 12 fewer units' : `Up to ${fmtNumber(max)}`}
          required
        >
          <Input id="stock-qty" type="number" inputMode="numeric" min={action === 'adjust' ? undefined : 1} max={action === 'adjust' ? undefined : max} invalid={!!errors.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </FormField>
        <FormField
          label={action === 'dispense' ? 'Reference (optional)' : meta.needsReason ? 'Reason' : 'Reason (optional)'}
          htmlFor="stock-text"
          error={errors.text}
          required={meta.needsReason}
        >
          {action === 'dispense' ? (
            <Input id="stock-text" maxLength={60} value={text} onChange={(e) => setText(e.target.value)} placeholder="Ward, prescription or OPD reference" />
          ) : (
            <Textarea id="stock-text" rows={2} maxLength={300} invalid={!!errors.text} value={text} onChange={(e) => setText(e.target.value)} />
          )}
        </FormField>
      </div>
    </Modal>
  );
}

/* ---------------------------------- History --------------------------------- */

const signed = (n: number) => (n > 0 ? `+${fmtNumber(n)}` : n < 0 ? `−${fmtNumber(-n)}` : '0');

export const movementColumns: Column<Movement>[] = [
  { key: 'when', header: 'When', cell: (m) => <span className="text-xs whitespace-nowrap text-ink-600">{fmtDateTime(m.createdAt)}</span> },
  { key: 'type', header: 'Type', cell: (m) => <Badge tone={MOVEMENT_TONE[m.movementType]}>{MOVEMENT_LABEL[m.movementType]}</Badge> },
  {
    key: 'deltas',
    header: 'Available / reserved / damaged',
    align: 'right',
    cell: (m) => (
      <span className="tabular text-xs whitespace-nowrap">
        {[m.deltaAvailable, m.deltaReserved, m.deltaDamaged].map((d, i) => (
          <span key={i} className={cn(i > 0 && 'ml-2', d > 0 ? 'text-brand-700' : d < 0 ? 'text-danger-600' : 'text-ink-400')}>
            {signed(d)}
          </span>
        ))}
      </span>
    ),
  },
  {
    key: 'detail',
    header: 'Detail',
    hideOnMobile: true,
    cell: (m) => (
      <span className="text-xs text-ink-600">
        {[m.transferCode, m.reason, m.reference].filter(Boolean).join(' · ') || '—'}
        {m.performedByName && <span className="block text-ink-400">by {m.performedByName}</span>}
      </span>
    ),
  },
];

export function StockHistoryModal({ row, onClose }: { row: InventoryRow | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [row?.inventoryId]);
  const q = useMovements({ inventoryId: row?.inventoryId, page, pageSize: 10, sortBy: 'createdAt', sortDir: 'desc' }, !!row);
  return (
    <Modal
      open={!!row}
      onClose={onClose}
      size="lg"
      title="Stock history"
      description={row && `${row.medicineName} · batch ${row.batchNumber} · ${row.facilityCode}. Every change is a ledger movement with signed bucket deltas.`}
    >
      <div className="-mx-5 -my-4">
        <DataTable
          caption="Stock movements for this batch"
          columns={movementColumns}
          rows={q.data?.data}
          rowKey={(m) => String(m.id)}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => q.refetch()}
          skeletonRows={5}
          empty={{ title: 'No movements recorded' }}
        />
        <Pagination meta={q.data?.meta} onPageChange={setPage} />
      </div>
    </Modal>
  );
}
