import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, Eye, EyeOff, FlaskConical } from 'lucide-react';
import { ApiError, usingMocks } from '@/api';
import { DEMO_ACCOUNTS } from '@/api/mock/demoAccounts';
import { useAuth } from '@/auth/AuthContext';
import { Button, FormField, Input } from '@/components/ui';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const { login, status, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [formError, setFormError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      navigate(from, { replace: true });
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.');
    }
  });

  return (
    <AuthLayout title="Sign in to MedShare" subtitle="Use your facility account credentials.">
      {sessionExpired && !formError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-warning-100 bg-warning-50 p-3 text-xs text-warning-700" role="status">
          <AlertCircle className="mt-px size-4 shrink-0" /> Your session expired. Please sign in again.
        </div>
      )}
      {formError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700" role="alert">
          <AlertCircle className="mt-px size-4 shrink-0" /> {formError}
        </div>
      )}
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormField label="Work email" htmlFor="email" error={errors.email?.message} required>
          <Input id="email" type="email" autoComplete="username" placeholder="name@facility.org" invalid={!!errors.email} {...register('email')} />
        </FormField>
        <FormField label="Password" htmlFor="password" error={errors.password?.message} required>
          <div className="relative">
            <Input id="password" type={showPw ? 'text' : 'password'} autoComplete="current-password" invalid={!!errors.password} className="pr-9" {...register('password')} />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-900"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </FormField>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-ink-500">
        New to MedShare?{' '}
        <Link to="/register" className="font-medium text-brand-700 hover:underline">
          Request an account
        </Link>
      </p>

      {usingMocks && (
        <div className="mt-8 rounded-lg border border-line bg-subtle/60 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-ink-700">
            <FlaskConical className="size-3.5 text-warning-700" /> Demo accounts (mock mode only)
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => {
                  setValue('email', a.email, { shouldValidate: true });
                  setValue('password', a.password, { shouldValidate: true });
                }}
                className="rounded-md border border-line bg-surface px-2 py-1.5 text-left text-xs hover:border-line-strong"
              >
                <span className="block font-medium text-ink-900">{a.label}</span>
                <span className="block truncate text-[11px] text-ink-500">{a.scope}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
