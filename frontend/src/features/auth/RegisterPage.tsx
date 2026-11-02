import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { Button, FormField, Input, Select, useToast } from '@/components/ui';
import { ROLE_LABEL } from '@/lib/labels';
import { AuthLayout } from './AuthLayout';

const schema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name').max(80),
    email: z.string().trim().email('Enter a valid email address'),
    facilityId: z.string().min(1, 'Select your facility'),
    role: z.enum(['FACILITY_MANAGER', 'PHARMACIST', 'VIEWER'], { errorMap: () => ({ message: 'Select a role' }) }),
    password: z
      .string()
      .min(10, 'At least 10 characters')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[0-9]/, 'Include a number'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type FormValues = z.infer<typeof schema>;

/**
 * Registration needs the facility list before a token exists. This assumes
 * GET /facilities is reachable unauthenticated (or a public variant exists) —
 * flagged in docs/API_INTEGRATION.md as an open question for Agent 1.
 */
export function RegisterPage() {
  const { register: registerUser, status } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [formError, setFormError] = useState<string | null>(null);
  const facilitiesQ = useQuery({ queryKey: ['public-facilities'], queryFn: () => api.facilities.list().catch(() => []), retry: false });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { role: 'PHARMACIST', facilityId: '' } });

  if (status === 'authenticated') return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async ({ confirm: _c, ...values }) => {
    setFormError(null);
    try {
      await registerUser(values);
      toast.success('Account created', 'Welcome to MedShare.');
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        for (const [field, msgs] of Object.entries(e.details)) setError(field as keyof FormValues, { message: msgs[0] });
      }
      setFormError(e instanceof ApiError ? e.message : 'Registration failed.');
    }
  });

  return (
    <AuthLayout title="Create your account" subtitle="Accounts are tied to one facility. Administrators are provisioned separately.">
      {formError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700" role="alert">
          <AlertCircle className="mt-px size-4 shrink-0" /> {formError}
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Full name" htmlFor="name" error={errors.name?.message} required>
          <Input id="name" autoComplete="name" invalid={!!errors.name} {...register('name')} />
        </FormField>
        <FormField label="Work email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="email" invalid={!!errors.email} {...register('email')} />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Facility" htmlFor="facilityId" error={errors.facilityId?.message} required>
            <Select id="facilityId" invalid={!!errors.facilityId} disabled={facilitiesQ.isLoading} {...register('facilityId')}>
              <option value="">{facilitiesQ.isLoading ? 'Loading…' : 'Select…'}</option>
              {facilitiesQ.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="Role" htmlFor="role" error={errors.role?.message} required>
            <Select id="role" invalid={!!errors.role} {...register('role')}>
              {(['PHARMACIST', 'FACILITY_MANAGER', 'VIEWER'] as const).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <FormField label="Password" htmlFor="password" error={errors.password?.message} hint="10+ characters with upper, lower case and a number." required>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!errors.password} {...register('password')} />
        </FormField>
        <FormField label="Confirm password" htmlFor="confirm" error={errors.confirm?.message} required>
          <Input id="confirm" type="password" autoComplete="new-password" invalid={!!errors.confirm} {...register('confirm')} />
        </FormField>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-ink-500">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
}
