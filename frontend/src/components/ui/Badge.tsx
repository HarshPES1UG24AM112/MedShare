import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { BatchStatus, DemandBasis, ShortageSeverity, StockStatus, TransferStatus } from '@/api/types';
import { BATCH_STATUS_LABEL, DEMAND_BASIS_HINT, DEMAND_BASIS_LABEL, POSSIBLY_CENSORED_HINT, TRANSFER_STATUS_LABEL } from '@/lib/labels';

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'navy';

const tones: Record<Tone, string> = {
  neutral: 'bg-subtle text-ink-700 ring-line',
  success: 'bg-brand-50 text-brand-700 ring-brand-100',
  warning: 'bg-warning-50 text-warning-700 ring-warning-100',
  danger: 'bg-danger-50 text-danger-700 ring-danger-100',
  info: 'bg-info-50 text-info-700 ring-info-100',
  navy: 'bg-ink-900 text-white ring-ink-900',
};

const dots: Record<Tone, string> = {
  neutral: 'bg-ink-400',
  success: 'bg-brand-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-info-500',
  navy: 'bg-white',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset', tones[tone], className)}>
      {dot && <span className={cn('size-1.5 rounded-full', dots[tone])} aria-hidden />}
      {children}
    </span>
  );
}

export const TRANSFER_TONE: Record<TransferStatus, Tone> = {
  PENDING: 'warning',
  APPROVED: 'info',
  DISPATCHED: 'navy',
  RECEIVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
};

export function TransferStatusBadge({ status }: { status: TransferStatus }) {
  return (
    <Badge tone={TRANSFER_TONE[status]} dot>
      {TRANSFER_STATUS_LABEL[status]}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: ShortageSeverity }) {
  return severity === 'CRITICAL' ? (
    <Badge tone="danger" dot>
      Critical
    </Badge>
  ) : (
    <Badge tone="warning" dot>
      Low stock
    </Badge>
  );
}

export function ExpiryBadge({ days }: { days: number }) {
  if (days < 0) return <Badge tone="danger">Expired</Badge>;
  if (days <= 7) return <Badge tone="danger">≤ 7 days</Badge>;
  if (days <= 30) return <Badge tone="warning">≤ 30 days</Badge>;
  if (days <= 60) return <Badge tone="info">≤ 60 days</Badge>;
  return <Badge tone="success">In date</Badge>;
}

export function StockStatusBadge({ status }: { status: StockStatus | null | undefined }) {
  if (!status) return <Badge>No policy</Badge>;
  if (status === 'CRITICAL') return <SeverityBadge severity="CRITICAL" />;
  if (status === 'LOW') return <SeverityBadge severity="LOW" />;
  return (
    <Badge tone="success" dot>
      OK
    </Badge>
  );
}

export function BatchStatusBadge({ status }: { status: BatchStatus }) {
  const tone: Tone = status === 'ACTIVE' ? 'success' : status === 'RECALLED' ? 'danger' : 'warning';
  return <Badge tone={tone}>{BATCH_STATUS_LABEL[status]}</Badge>;
}

/** Where a daily-demand figure comes from; "possibly censored" means the history is unreliable (stock-out). */
export function DemandBasisBadge({ basis, possiblyCensored }: { basis: DemandBasis; possiblyCensored?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span title={DEMAND_BASIS_HINT[basis]}>
        <Badge tone={basis === 'MEASURED' ? 'info' : 'neutral'}>{DEMAND_BASIS_LABEL[basis]}</Badge>
      </span>
      {possiblyCensored && (
        <span title={POSSIBLY_CENSORED_HINT}>
          <Badge tone="warning">Possibly censored</Badge>
        </span>
      )}
    </span>
  );
}
