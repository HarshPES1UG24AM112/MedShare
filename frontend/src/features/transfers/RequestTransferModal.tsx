import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowRight, Info } from 'lucide-react';
import { ApiError } from '@/api';
import type { FacilityRef, MedicineRef } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { Button, FormField, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { useBatches, useCreateTransfer, useFacilities, useMedicines } from '@/hooks/queries';
import { daysUntil, fmtDate, fmtNumber } from '@/lib/format';

export interface TransferPrefill {
  medicine?: MedicineRef;
  batch?: { id: string; batchNumber: string; quantityAvailable: number; expiryDate: string; facility: FacilityRef };
  destinationFacilityId?: string;
  quantity?: number;
  recommendationId?: string;
  reason?: string;
}

const schema = z.object({
  medicineId: z.string().min(1, 'Select a medicine'),
  batchId: z.string().min(1, 'Select a source batch'),
  destinationFacilityId: z.string().min(1, 'Select a destination'),
  quantity: z.coerce.number({ invalid_type_error: 'Enter a quantity' }).int('Whole units only').positive('Must be at least 1'),
  notes: z.string().trim().max(300, 'Keep notes under 300 characters').optional(),
});
type FormValues = z.infer<typeof schema>;

export function RequestTransferModal({ open, onClose, prefill }: { open: boolean; onClose: () => void; prefill?: TransferPrefill }) {
  const user = useCurrentUser();
  const toast = useToast();
  const create = useCreateTransfer();
  const facilities = useFacilities();

  const defaults = useMemo<Partial<FormValues>>(
    () => ({
      medicineId: prefill?.medicine?.id ?? '',
      batchId: prefill?.batch?.id ?? '',
      destinationFacilityId: prefill?.destinationFacilityId ?? (user.role !== 'ADMIN' && user.facilityId && user.facilityId !== prefill?.batch?.facility.id ? user.facilityId : ''),
      quantity: prefill?.quantity,
      notes: prefill?.reason ? `Recommendation: ${prefill.reason}`.slice(0, 300) : '',
    }),
    [prefill, user],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const medicineId = watch('medicineId');
  const batchId = watch('batchId');
  const destId = watch('destinationFacilityId');

  const medicines = useMedicines({ pageSize: 100, sortBy: 'name' });
  const batches = useBatches({ medicineId, pageSize: 100, sortBy: 'expiryDate', sortDir: 'asc' }, open && !!medicineId && !prefill?.batch);

  const sourceOptions = (batches.data?.data ?? []).filter((b) => b.quantityAvailable > 0 && daysUntil(b.expiryDate) >= 0 && b.facility.id !== destId);
  const selectedBatch = prefill?.batch ?? sourceOptions.find((b) => b.id === batchId);

  const close = () => {
    create.reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    if (selectedBatch && v.quantity > selectedBatch.quantityAvailable) {
      setError('quantity', { message: `Only ${fmtNumber(selectedBatch.quantityAvailable)} available in this batch` });
      return;
    }
    if (selectedBatch && selectedBatch.facility.id === v.destinationFacilityId) {
      setError('destinationFacilityId', { message: 'Destination must differ from the source facility' });
      return;
    }
    try {
      const t = await create.mutateAsync({
        batchId: v.batchId,
        destinationFacilityId: v.destinationFacilityId,
        quantity: v.quantity,
        notes: v.notes || undefined,
        recommendationId: prefill?.recommendationId,
      });
      toast.success(`Transfer ${t.code} requested`, `${fmtNumber(t.quantity)} × ${t.medicine.name} awaiting approval from ${t.sourceFacility.name}.`);
      close();
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        for (const [f, msgs] of Object.entries(e.details)) setError(f as keyof FormValues, { message: msgs[0] });
      }
      toast.error('Transfer request failed', e instanceof ApiError ? e.message : undefined);
    }
  });

  const destOptions = (facilities.data ?? []).filter((f) => f.id !== selectedBatch?.facility.id);
  const lockedDest = user.role !== 'ADMIN' && !!prefill?.destinationFacilityId;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Request transfer"
      description="The source facility's manager approves the request before dispatch. Requested units are reserved immediately."
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="request-transfer" loading={create.isPending}>
            Submit request
          </Button>
        </>
      }
    >
      <form id="request-transfer" onSubmit={onSubmit} noValidate className="space-y-4">
        {prefill?.batch ? (
          <div className="rounded-lg border border-line bg-subtle/60 p-3 text-sm">
            <p className="font-medium text-ink-900">
              {prefill.medicine?.name} <span className="font-normal text-ink-500">{prefill.medicine?.strength}</span>
            </p>
            <p className="mt-1 text-xs text-ink-600">
              Batch {prefill.batch.batchNumber} at {prefill.batch.facility.name} · {fmtNumber(prefill.batch.quantityAvailable)} available · expires {fmtDate(prefill.batch.expiryDate)}
            </p>
            <input type="hidden" {...register('medicineId')} />
            <input type="hidden" {...register('batchId')} />
          </div>
        ) : (
          <>
            <FormField label="Medicine" htmlFor="medicineId" error={errors.medicineId?.message} required>
              <Select id="medicineId" invalid={!!errors.medicineId} {...register('medicineId')}>
                <option value="">Select medicine…</option>
                {medicines.data?.data.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} {m.strength}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Source batch"
              htmlFor="batchId"
              error={errors.batchId?.message}
              hint={medicineId && !batches.isLoading && !sourceOptions.length ? 'No other facility holds usable stock of this medicine.' : 'Earliest-expiring batches are listed first.'}
              required
            >
              <Select id="batchId" invalid={!!errors.batchId} disabled={!medicineId || batches.isLoading} {...register('batchId')}>
                <option value="">{batches.isLoading ? 'Loading batches…' : 'Select batch…'}</option>
                {sourceOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.facility.name} · {b.batchNumber} · {fmtNumber(b.quantityAvailable)} avail · exp {fmtDate(b.expiryDate)}
                  </option>
                ))}
              </Select>
            </FormField>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-[1fr_auto_8rem] sm:items-start">
          <FormField label="Destination facility" htmlFor="destinationFacilityId" error={errors.destinationFacilityId?.message} required>
            {lockedDest ? (
              <>
                <Input id="destinationFacilityId" readOnly value={facilities.data?.find((f) => f.id === destId)?.name ?? ''} className="bg-subtle" />
                <input type="hidden" {...register('destinationFacilityId')} />
              </>
            ) : (
              <Select id="destinationFacilityId" invalid={!!errors.destinationFacilityId} {...register('destinationFacilityId')}>
                <option value="">Select destination…</option>
                {destOptions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <ArrowRight className="mt-8 hidden size-4 text-ink-400 sm:block" aria-hidden />
          <FormField label="Quantity" htmlFor="quantity" error={errors.quantity?.message} required>
            <Input id="quantity" type="number" min={1} max={selectedBatch?.quantityAvailable} inputMode="numeric" invalid={!!errors.quantity} {...register('quantity')} />
          </FormField>
        </div>
        {selectedBatch && (
          <p className="flex items-center gap-1.5 text-xs text-ink-500">
            <Info className="size-3.5" /> Maximum {fmtNumber(selectedBatch.quantityAvailable)} units from batch {selectedBatch.batchNumber}.
          </p>
        )}
        <FormField label="Notes for approver" htmlFor="notes" error={errors.notes?.message}>
          <Textarea id="notes" rows={2} placeholder="Clinical need, urgency, delivery instructions…" {...register('notes')} />
        </FormField>
      </form>
    </Modal>
  );
}
