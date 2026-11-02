import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ApiError } from '@/api';
import type { DosageForm } from '@/api/types';
import { Button, FormField, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { useCategories, useCreateMedicine } from '@/hooks/queries';
import { DOSAGE_FORM_LABEL } from '@/lib/labels';

const FORMS = Object.keys(DOSAGE_FORM_LABEL) as [DosageForm, ...DosageForm[]];

const schema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^MED-\d{4}$/, 'Use the format MED-0000'),
    name: z.string().trim().min(2, 'Required').max(120),
    genericName: z.string().trim().min(2, 'Required').max(120),
    category: z.string().trim().min(2, 'Required').max(60),
    dosageForm: z.enum(FORMS),
    strength: z.string().trim().min(1, 'Required').max(40),
    unit: z.string().trim().min(1, 'Required').max(20),
    manufacturer: z.string().trim().min(2, 'Required').max(120),
    reorderThreshold: z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Whole units only').positive('Must be greater than 0'),
    criticalThreshold: z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Whole units only').positive('Must be greater than 0'),
    isEssential: z.boolean(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.criticalThreshold < v.reorderThreshold, {
    path: ['criticalThreshold'],
    message: 'Critical level must be below the reorder level',
  });

type FormValues = z.infer<typeof schema>;

export function AddMedicineModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const create = useCreateMedicine();
  const { data: categories } = useCategories();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { dosageForm: 'TABLET', isEssential: true, code: 'MED-', unit: 'tablet' },
  });

  const close = () => {
    reset();
    create.reset();
    onClose();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      const med = await create.mutateAsync({ ...values, description: values.description || undefined });
      toast.success('Medicine added', `${med.name} ${med.strength} is now in the catalogue.`);
      close();
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        for (const [f, msgs] of Object.entries(e.details)) setError(f as keyof FormValues, { message: msgs[0] });
      }
      toast.error('Could not add medicine', e instanceof ApiError ? e.message : undefined);
    }
  });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add medicine"
      description="Thresholds are per facility of standard size; larger facilities scale them up."
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="add-medicine" loading={create.isPending}>
            Add to catalogue
          </Button>
        </>
      }
    >
      <form id="add-medicine" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Medicine code" htmlFor="code" error={errors.code?.message} required>
          <Input id="code" invalid={!!errors.code} {...register('code')} />
        </FormField>
        <FormField label="Category" htmlFor="category" error={errors.category?.message} required>
          <Input id="category" list="category-options" invalid={!!errors.category} placeholder="e.g. Antibiotics" {...register('category')} />
          <datalist id="category-options">{categories?.map((c) => <option key={c} value={c} />)}</datalist>
        </FormField>
        <FormField label="Brand / display name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField label="Generic name" htmlFor="genericName" error={errors.genericName?.message} required>
          <Input id="genericName" invalid={!!errors.genericName} {...register('genericName')} />
        </FormField>
        <FormField label="Dosage form" htmlFor="dosageForm" error={errors.dosageForm?.message} required>
          <Select id="dosageForm" {...register('dosageForm')}>
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {DOSAGE_FORM_LABEL[f]}
              </option>
            ))}
          </Select>
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Strength" htmlFor="strength" error={errors.strength?.message} required>
            <Input id="strength" placeholder="500 mg" invalid={!!errors.strength} {...register('strength')} />
          </FormField>
          <FormField label="Issue unit" htmlFor="unit" error={errors.unit?.message} required>
            <Input id="unit" placeholder="tablet" invalid={!!errors.unit} {...register('unit')} />
          </FormField>
        </div>
        <FormField label="Manufacturer" htmlFor="manufacturer" error={errors.manufacturer?.message} required className="sm:col-span-2">
          <Input id="manufacturer" invalid={!!errors.manufacturer} {...register('manufacturer')} />
        </FormField>
        <FormField label="Reorder threshold (units)" htmlFor="reorderThreshold" error={errors.reorderThreshold?.message} required>
          <Input id="reorderThreshold" type="number" min={1} inputMode="numeric" invalid={!!errors.reorderThreshold} {...register('reorderThreshold')} />
        </FormField>
        <FormField label="Critical threshold (units)" htmlFor="criticalThreshold" error={errors.criticalThreshold?.message} required>
          <Input id="criticalThreshold" type="number" min={1} inputMode="numeric" invalid={!!errors.criticalThreshold} {...register('criticalThreshold')} />
        </FormField>
        <FormField label="Notes" htmlFor="description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea id="description" rows={2} {...register('description')} />
        </FormField>
        <label className="flex items-center gap-2 text-sm text-ink-700 sm:col-span-2">
          <input type="checkbox" className="size-4 rounded border-line-strong accent-brand-600" {...register('isEssential')} />
          On the essential medicines list
        </label>
      </form>
    </Modal>
  );
}
