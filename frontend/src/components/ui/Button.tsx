import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md';

const variants: Record<Variant, string> = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 disabled:bg-ink-400',
  secondary: 'bg-surface text-ink-900 border border-line-strong hover:bg-subtle disabled:text-ink-400',
  ghost: 'text-ink-700 hover:bg-subtle hover:text-ink-900 disabled:text-ink-400',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-100 disabled:text-danger-500',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 disabled:text-ink-400',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
