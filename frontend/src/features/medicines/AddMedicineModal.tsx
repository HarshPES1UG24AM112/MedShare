import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError } from '@/api';
import type { DosageForm, StrengthUom } from '@/api/types';
import { Button, FormField, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { useCategories, useCreateMedicine, useSubstances, useUnits } from '@/hooks/queries';
import { useDebouncedValue } from '@/hooks/useListParams';
import { DOSAGE_FORM_LABEL } from '@/lib/labels';

const FORMS = Object.keys(DOSAGE_FORM_LABEL) as [DosageForm, ...DosageForm[]];
const UOMS = ['mg', 'mcg', 'g', 'IU', 'mL', '%', 'mg/mL', 'mg/5mL', 'IU/mL', 'mcg/dose', 'g/L'] as const satisfies readonly StrengthUom[];

const num = (msg = 'Enter a number') => z.coerce.number({ invalid_type_error: msg });

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(MED-\d{4})?$/, 'Use the format MED-0000, or leave blank to auto-assign'),
  name: z.string().trim().min(2, 'Required').max(160),
  categoryId: num('Choose a category').int().positive('Choose a category'),
  dosageForm: z.enum(FORMS),
  dispensingUnitId: num('Choose a unit').int().positive('Choose a unit'),
  unitVolumeMl: z.union([z.literal(''), num().positive('Must be greater than 0').max(10_000)]).optional(),
  requiresColdChain: z.boolean(),
  isEssential: z.boolean(),
  description: z.string().trim().max(1000).optional(),
  ingredients: z
    .array(
      z.object({
        substanceName: z.string().trim().min(2, 'Enter a substance').max(120),
        strengthValue: num().positive('Must be greater than 0').max(1_000_000),
        strengthUom: z.enum(UOMS),
      }),
    )
    .min(1, 'Add at least one ingredient')
    .max(8, 'At most 8 ingredients'),
});

type FormValues = z.input<typeof schema>;
type Parsed = z.output<typeof schema>;

/** Text input with substance suggestions from /catalogue/substances (new names are created on save). */
function SubstanceInput({ id, invalid, value, onChange }: { id: string; invalid?: boolean; value: string; onChange: (v: string) => void }) {
  const search = useDebouncedValue(value.trim(), 250);
  const { data } = useSubstances(search.length >= 2 ? search : '');
  const listId = `${id}-options`;
  return (
    <>
      <Input id={id} list={listId} autoComplete="off" invalid={invalid} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Paracetamol" />
      <datalist id={listId}>
        {data?.slice(0, 20).map((s) => (
          <option key={s.id} value={s.name}>
            {s.medicineCount} medicine{s.medicineCount === 1 ? '' : 's'}
          </option>
        ))}
      </datalist>
    </>
  );
}

export function AddMedicineModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const create = useCreateMedicine();
  const { data: categories } = useCategories();
  const { data: units } = useUnits();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues, unknown, Parsed>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: '',
      name: '',
      dosageForm: 'TABLET',
      categoryId: '' as unknown as number,
      dispensingUnitId: '' as unknown as number,
      unitVolumeMl: '',
      requiresColdChain: false,
      isEssential: true,
      ingredients: [{ substanceName: '', strengthValue: '' as unknown as number, strengthUom: 'mg' }],
    },
  });
  const ingredients = useFieldArray({ control, name: 'ingredients' });

  const close = () => {
    reset();
    create.reset();
    setFormError(null);
    onClose();
  };

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      const med = await create.mutateAsync({
        code: v.code || undefined,
        name: v.name,
        categoryId: v.categoryId,
        dosageForm: v.dosageForm,
        dispensingUnitId: v.dispensingUnitId,
        unitVolumeMl: v.unitVolumeMl === '' || v.unitVolumeMl === undefined ? undefined : Number(v.unitVolumeMl),
        requiresColdChain: v.requiresColdChain,
        isEssential: v.isEssential,
        description: v.description || undefined,
        ingredients: v.ingredients.map((i) => ({ substanceName: i.substanceName, strengthValue: i.strengthValue, strengthUom: i.strengthUom })),
      });
      toast.success('Medicine added', `${med.displayName} (${med.code}) is now in the catalogue.`);
      close();
      navigate(`/medicines/${med.id}`);
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        for (const [f, msgs] of Object.entries(e.details)) setError(f as keyof FormValues, { message: msgs[0] });
      }
      setFormError(e instanceof ApiError ? e.message : 'Could not add the medicine.');
    }
  });

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add medicine"
      description="The strength label is composed from the ingredients. A composition that already exists is refused."
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
      {formError && (
        <p role="alert" className="mb-4 rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
          {formError}
        </p>
      )}
      <form id="add-medicine" onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <FormField label="Name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" invalid={!!errors.name} placeholder="e.g. Paracetamol" {...register('name')} />
        </FormField>
        <FormField label="Medicine code" htmlFor="code" error={errors.code?.message} hint="Leave blank to auto-assign">
          <Input id="code" invalid={!!errors.code} placeholder="MED-0000" {...register('code')} />
        </FormField>
        <FormField label="Category" htmlFor="categoryId" error={errors.categoryId?.message} required>
          <Select id="categoryId" invalid={!!errors.categoryId} {...register('categoryId')}>
            <option value="">Choose…</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </Select>
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
        <FormField label="Issue unit" htmlFor="dispensingUnitId" error={errors.dispensingUnitId?.message} required>
          <Select id="dispensingUnitId" invalid={!!errors.dispensingUnitId} {...register('dispensingUnitId')}>
            <option value="">Choose…</option>
            {units?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Volume per unit (mL)" htmlFor="unitVolumeMl" error={errors.unitVolumeMl?.message} hint="Liquids only, e.g. 10 for a 10 mL vial">
          <Input id="unitVolumeMl" type="number" min={0} step="any" inputMode="decimal" invalid={!!errors.unitVolumeMl} {...register('unitVolumeMl')} />
        </FormField>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="mb-1.5 text-xs font-medium text-ink-700">
            Ingredients<span className="ml-0.5 text-danger-500">*</span>
          </legend>
          {ingredients.fields.map((f, i) => {
            const e = errors.ingredients?.[i];
            return (
              <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_6.5rem_auto] items-start gap-2">
                <div>
                  <label htmlFor={`ing-${i}`} className="sr-only">
                    Substance {i + 1}
                  </label>
                  <SubstanceInput
                    id={`ing-${i}`}
                    invalid={!!e?.substanceName}
                    value={watch(`ingredients.${i}.substanceName`) ?? ''}
                    onChange={(v) => setValue(`ingredients.${i}.substanceName`, v, { shouldValidate: !!e })}
                  />
                  {e?.substanceName && <p className="mt-1 text-xs text-danger-600">{e.substanceName.message}</p>}
                </div>
                <div>
                  <Input aria-label={`Strength ${i + 1}`} type="number" min={0} step="any" inputMode="decimal" placeholder="500" invalid={!!e?.strengthValue} {...register(`ingredients.${i}.strengthValue`)} />
                  {e?.strengthValue && <p className="mt-1 text-xs text-danger-600">{e.strengthValue.message}</p>}
                </div>
                <Select aria-label={`Unit of strength ${i + 1}`} {...register(`ingredients.${i}.strengthUom`)}>
                  {UOMS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="md"
                  aria-label={`Remove ingredient ${i + 1}`}
                  disabled={ingredients.fields.length === 1}
                  onClick={() => ingredients.remove(i)}
                  icon={<Trash2 className="size-4" />}
                />
              </div>
            );
          })}
          {errors.ingredients?.root?.message && <p className="text-xs text-danger-600">{errors.ingredients.root.message}</p>}
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="size-3.5" />}
            disabled={ingredients.fields.length >= 8}
            onClick={() => ingredients.append({ substanceName: '', strengthValue: '' as unknown as number, strengthUom: 'mg' })}
          >
            Add ingredient
          </Button>
        </fieldset>

        <FormField label="Description" htmlFor="description" error={errors.description?.message} className="sm:col-span-2">
          <Textarea id="description" rows={2} {...register('description')} />
        </FormField>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 rounded border-line-strong accent-brand-600" {...register('isEssential')} />
          On the essential medicines list
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" className="size-4 rounded border-line-strong accent-brand-600" {...register('requiresColdChain')} />
          Requires cold chain
        </label>
      </form>
    </Modal>
  );
}
