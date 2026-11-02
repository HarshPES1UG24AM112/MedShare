import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const control =
  'w-full rounded-md border bg-surface px-3 text-sm text-ink-900 placeholder:text-ink-400 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 disabled:bg-subtle disabled:text-ink-500';
const okBorder = 'border-line-strong';
const errBorder = 'border-danger-500 focus:ring-danger-500/20 focus:border-danger-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return <input ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-9', invalid ? errBorder : okBorder, className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(function Textarea(
  { className, invalid, ...rest },
  ref,
) {
  return <textarea ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'min-h-20 py-2', invalid ? errBorder : okBorder, className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(function Select(
  { className, invalid, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} aria-invalid={invalid || undefined} className={cn(control, 'h-9 appearance-none pr-8', invalid ? errBorder : okBorder)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-500" aria-hidden />
    </div>
  );
});

interface FormFieldProps {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export function FormField({ label, htmlFor, error, hint, required, children, className }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-700">
        {label}
        {required && <span className="ml-0.5 text-danger-500">*</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-ink-500">{hint}</p>
      )}
    </div>
  );
}
