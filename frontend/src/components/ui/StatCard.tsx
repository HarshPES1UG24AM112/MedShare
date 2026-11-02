import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Skeleton } from './States';

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger' | 'warning';
  to?: string;
  loading?: boolean;
}

export function StatCard({ label, value, icon, hint, tone = 'default', to, loading }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-ink-500">{label}</p>
        <span
          className={cn('flex size-7 items-center justify-center rounded-md', {
            'bg-subtle text-ink-600': tone === 'default',
            'bg-danger-50 text-danger-600': tone === 'danger',
            'bg-warning-50 text-warning-700': tone === 'warning',
          })}
          aria-hidden
        >
          {icon}
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p
          className={cn('tabular mt-1.5 text-2xl font-semibold tracking-tight', {
            'text-ink-950': tone === 'default',
            'text-danger-600': tone === 'danger',
            'text-warning-700': tone === 'warning',
          })}
        >
          {value}
        </p>
      )}
      {hint && <p className="mt-1 truncate text-xs text-ink-500">{hint}</p>}
    </>
  );
  const cls = cn(
    'block rounded-[var(--radius-card)] border bg-surface p-4 shadow-card',
    tone === 'danger' ? 'border-danger-100' : 'border-line',
    to && 'transition-colors hover:border-line-strong hover:bg-subtle/40',
  );
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
