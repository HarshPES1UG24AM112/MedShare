import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, Lock, RefreshCw, WifiOff } from 'lucide-react';
import { ApiError } from '@/api/client';
import { cn } from '@/lib/utils';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-subtle', className)} aria-hidden />;
}

interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-ink-500">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium text-ink-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs text-ink-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Renders the right message for network, permission and server errors. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const e = error instanceof ApiError ? error : null;
  if (e?.isForbidden) {
    return (
      <EmptyState
        className={className}
        icon={<Lock className="size-5" />}
        title="Access restricted"
        description={e.message || 'Your role does not have access to this information.'}
      />
    );
  }
  const network = e?.isNetwork;
  return (
    <EmptyState
      className={className}
      icon={network ? <WifiOff className="size-5 text-danger-500" /> : <AlertTriangle className="size-5 text-danger-500" />}
      title={network ? 'Connection problem' : 'Could not load data'}
      description={e?.message ?? (error instanceof Error ? error.message : 'Something went wrong.')}
      action={
        onRetry && (
          <Button variant="secondary" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        )
      }
    />
  );
}
