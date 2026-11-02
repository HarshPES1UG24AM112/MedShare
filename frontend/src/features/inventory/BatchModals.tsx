import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '@/api';
import type { Batch, InventoryMovement } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { Badge, Button, DataTable, FormField, Input, Modal, Pagination, Select, Textarea, useToast, type Column } from '@/components/ui';
import { useAdjustStock, useFacilities, useMedicines, useMovements, useReceiveBatch } from '@/hooks/queries';
import { daysUntil, fmtDate, fmtDateTime, fmtNumber, todayISODate } from '@/lib/format';
import { MOVEMENT_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

/* --------------------------------- Receive -------------------------------- */

const receiveSchema = z
  .object({
    facilityId: z.string().min(1, 'Select a facility'),
    medicineId: z.string().min(1, 'Select a medicine'),
    batchNumber: z
      .string()
      .trim()
      .min(3, 'At least 3 characters')
      .max(30)
      .regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes only'),
    manufactureDate: z.string().min(1, 'Required'),
    expiryDate: z.string().min(1, 'Required'),
    quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Whole units only').positive('Must be at least 1').max(1_000_000),
    unitCost: z.coerce.number({ invalid_type_error: 'Enter a cost' }).nonnegative('Cannot be negative'),
  })
  .refine((v) => v.manufactureDate <= todayISODate(), { path: ['manufactureDate'], message: 'Cannot be in the future' })
  .refine((v) => v.expiryDate > todayISODate(), { path: ['expiryDate'], message: 'Batch is already expired' })
  .refine((v) => v.expiryDate > v.manufactureDate, { path: ['expiryDate'], message: 'Must be after manufacture date' });

type ReceiveValues = z.infer<typeof receiveSchema>;

export function ReceiveBatchModal({ open, onClose, facilityId }: { open: boolean; onClose: () => void; facilityId?: string }) {
  const user = useCurrentUser();
  const toast = useToast();
  const receive = useReceiveBatch();
  const facilities = useFacilities();
  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const defaultFacility = facilityId ?? user.facilityId ?? '';
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<ReceiveValues>({ resolver: zodResolver(receiveSchema), defaultValues: { facilityId: defaultFacility, unitCost: 0 } });

  useEffect(() => {
    if (open) reset({ facilityId: defaultFacility, unitCost: 0 });
  }, [open, defaultFacility, reset]);

  const onSubmit = handleSubmit(async (v) => {
    try {
      const b = await receive.mutateAsync(v);
      toast.success('Stock received', `${fmtNumber(b.quantityAvailable)} × ${b.medicine.name} added as batch ${b.batchNumber}.`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details) for (const [f, m] of Object.entries(e.details)) setError(f as keyof ReceiveValues, { message: m[0] });
      toast.error('Could not receive stock', e instanceof ApiError ? e.message : undefined);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Receive stock"
      description="Record a goods receipt as a new batch."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="receive-batch" loading={receive.isPending}>
            Record receipt
          </Button>
        </>
      }
    >
      <form id="receive-batch" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Facility" htmlFor="facilityId" error={errors.facilityId?.message} required className="sm:col-span-2">
          {user.role === 'ADMIN' ? (
            <Select id="facilityId" invalid={!!errors.facilityId} {...register('facilityId')}>
              <option value="">Select facility…</option>
              {facilities.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Input id="facilityId" readOnly value={facilities.data?.find((f) => f.id === defaultFacility)?.name ?? ''} className="bg-subtle" />
              <input type="hidden" {...register('facilityId')} />
            </>
          )}
        </FormField>
        <FormField label="Medicine" htmlFor="medicineId" error={errors.medicineId?.message} required className="sm:col-span-2">
          <Select id="medicineId" invalid={!!errors.medicineId} {...register('medicineId')}>
            <option value="">Select medicine…</option>
            {medicines.data?.data.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.strength}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Batch number" htmlFor="batchNumber" error={errors.batchNumber?.message} required>
          <Input id="batchNumber" invalid={!!errors.batchNumber} {...register('batchNumber')} />
        </FormField>
        <FormField label="Quantity received" htmlFor="quantity" error={errors.quantity?.message} required>
          <Input id="quantity" type="number" min={1} inputMode="numeric" invalid={!!errors.quantity} {...register('quantity')} />
        </FormField>
        <FormField label="Manufacture date" htmlFor="manufactureDate" error={errors.manufactureDate?.message} required>
          <Input id="manufactureDate" type="date" max={todayISODate()} invalid={!!errors.manufactureDate} {...register('manufactureDate')} />
        </FormField>
        <FormField label="Expiry date" htmlFor="expiryDate" error={errors.expiryDate?.message} required>
          <Input id="expiryDate" type="date" min={todayISODate()} invalid={!!errors.expiryDate} {...register('expiryDate')} />
        </FormField>
        <FormField label="Unit cost (₹)" htmlFor="unitCost" error={errors.unitCost?.message}>
          <Input id="unitCost" type="number" min={0} step="0.01" inputMode="decimal" invalid={!!errors.unitCost} {...register('unitCost')} />
        </FormField>
      </form>
    </Modal>
  );
}

/* --------------------------------- Adjust --------------------------------- */

const adjustSchema = z.object({
  type: z.enum(['DISPENSE', 'DAMAGE', 'CORRECTION', 'WRITE_OFF']),
  direction: z.enum(['INCREASE', 'DECREASE']),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Whole units only').positive('Must be at least 1'),
  reason: z.string().trim().min(3, 'Give a short reason').max(200),
});
type AdjustValues = z.infer<typeof adjustSchema>;

export function AdjustStockModal({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const toast = useToast();
  const adjust = useAdjustStock();
  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm<AdjustValues>({ resolver: zodResolver(adjustSchema), defaultValues: { type: 'DISPENSE', direction: 'DECREASE', reason: '' } });

  const expired = !!batch && daysUntil(batch.expiryDate) < 0;
  useEffect(() => {
    if (batch)
      reset(
        daysUntil(batch.expiryDate) < 0
          ? { type: 'WRITE_OFF', direction: 'DECREASE', reason: 'Expired — removed from usable stock', quantity: batch.quantityAvailable }
          : { type: 'DISPENSE', direction: 'DECREASE', reason: '' },
      );
  }, [batch, reset]);

  const type = watch('type');
  const direction = watch('direction');

  const onSubmit = handleSubmit(async (v) => {
    if (!batch) return;
    const decreasing = v.type !== 'CORRECTION' || v.direction === 'DECREASE';
    if (decreasing && v.quantity > batch.quantityAvailable) {
      setError('quantity', { message: `Only ${fmtNumber(batch.quantityAvailable)} available` });
      return;
    }
    try {
      await adjust.mutateAsync({ batchId: batch.id, input: { type: v.type, quantity: v.quantity, direction: v.type === 'CORRECTION' ? v.direction : undefined, reason: v.reason } });
      toast.success('Stock updated', `Batch ${batch.batchNumber}: ${decreasing ? '−' : '+'}${fmtNumber(v.quantity)} (${MOVEMENT_LABEL[v.type === 'WRITE_OFF' ? 'EXPIRED_WRITE_OFF' : v.type].toLowerCase()}).`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.details) for (const [f, m] of Object.entries(e.details)) setError(f as keyof AdjustValues, { message: m[0] });
      toast.error('Adjustment failed', e instanceof ApiError ? e.message : undefined);
    }
  });

  return (
    <Modal
      open={!!batch}
      onClose={onClose}
      title="Adjust stock"
      description={batch && `${batch.medicine.name} ${batch.medicine.strength} · Batch ${batch.batchNumber} · ${fmtNumber(batch.quantityAvailable)} available`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-stock" variant={type === 'DAMAGE' ? 'danger' : 'primary'} loading={adjust.isPending}>
            Record {{ DISPENSE: 'issue', DAMAGE: 'damage', CORRECTION: 'correction', WRITE_OFF: 'write-off' }[type]}
          </Button>
        </>
      }
    >
      <form id="adjust-stock" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Adjustment type" htmlFor="type" required>
          <Select id="type" {...register('type')}>
            {expired ? (
              <option value="WRITE_OFF">Expiry write-off</option>
            ) : (
              <>
                <option value="DISPENSE">Dispense / issue to ward</option>
                <option value="DAMAGE">Damaged / unusable</option>
              </>
            )}
            <option value="CORRECTION">Stock-count correction</option>
          </Select>
        </FormField>
        {type === 'CORRECTION' ? (
          <FormField label="Direction" htmlFor="direction" required>
            <Select id="direction" {...register('direction')}>
              <option value="DECREASE">Decrease (count was lower)</option>
              <option value="INCREASE">Increase (count was higher)</option>
            </Select>
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}
        <FormField
          label="Quantity"
          htmlFor="adj-quantity"
          error={errors.quantity?.message}
          hint={type !== 'CORRECTION' || direction === 'DECREASE' ? `Max ${fmtNumber(batch?.quantityAvailable ?? 0)}` : undefined}
          required
        >
          <Input id="adj-quantity" type="number" min={1} inputMode="numeric" invalid={!!errors.quantity} {...register('quantity')} />
        </FormField>
        <FormField label="Reason" htmlFor="reason" error={errors.reason?.message} required className="sm:col-span-2">
          <Textarea id="reason" rows={2} invalid={!!errors.reason} placeholder={type === 'DAMAGE' ? 'e.g. vials cracked during cold-chain excursion' : 'e.g. OPD issue, ward 3'} {...register('reason')} />
        </FormField>
      </form>
    </Modal>
  );
}

/* --------------------------------- History -------------------------------- */

export function BatchHistoryModal({ batch, onClose }: { batch: Batch | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [batch?.id]);
  const q = useMovements({ batchId: batch?.id, page, pageSize: 10 }, !!batch);
  const columns: Column<InventoryMovement>[] = [
    { key: 'when', header: 'Date', cell: (m) => <span className="text-xs whitespace-nowrap text-ink-600">{fmtDateTime(m.createdAt)}</span> },
    { key: 'type', header: 'Movement', cell: (m) => <Badge tone={m.quantity > 0 ? 'success' : m.type === 'DAMAGE' ? 'danger' : 'neutral'}>{MOVEMENT_LABEL[m.type]}</Badge> },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      cell: (m) => (
        <span className={cn('tabular font-medium', m.quantity > 0 ? 'text-brand-700' : 'text-ink-900')}>
          {m.quantity > 0 ? '+' : ''}
          {fmtNumber(m.quantity)}
        </span>
      ),
    },
    { key: 'by', header: 'By', hideOnMobile: true, cell: (m) => <span className="text-xs text-ink-600">{m.performedBy.name}</span> },
    { key: 'ref', header: 'Reference / note', hideOnMobile: true, cell: (m) => <span className="text-xs text-ink-500">{[m.reference, m.note].filter(Boolean).join(' · ') || '—'}</span> },
  ];
  return (
    <Modal
      open={!!batch}
      onClose={onClose}
      size="lg"
      title={`Stock history · Batch ${batch?.batchNumber ?? ''}`}
      description={batch && `${batch.medicine.name} ${batch.medicine.strength} at ${batch.facility.name} · received ${fmtDate(batch.receivedAt)} · expires ${fmtDate(batch.expiryDate)}`}
    >
      <div className="-mx-5 -my-4">
        <DataTable columns={columns} rows={q.data?.data} rowKey={(m) => m.id} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} skeletonRows={5} empty={{ title: 'No movements recorded for this batch' }} />
        <Pagination meta={q.data?.meta} onPageChange={setPage} />
      </div>
    </Modal>
  );
}
