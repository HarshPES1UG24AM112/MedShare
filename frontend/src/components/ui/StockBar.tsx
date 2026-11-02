import { cn } from '@/lib/utils';

/** Horizontal gauge showing current stock against critical and reorder thresholds. */
export function StockBar({ current, critical, reorder, className }: { current: number; critical: number; reorder: number; className?: string }) {
  const max = Math.max(reorder * 1.25, current, 1);
  const pct = Math.min(100, (current / max) * 100);
  const critPct = (critical / max) * 100;
  const reorderPct = (reorder / max) * 100;
  const tone = current < critical ? 'bg-danger-500' : current < reorder ? 'bg-warning-500' : 'bg-brand-500';
  return (
    <div
      className={cn('relative h-1.5 w-full min-w-24 rounded-full bg-subtle', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={Math.round(max)}
      aria-valuenow={current}
      aria-label={`Stock ${current} of reorder level ${reorder}`}
    >
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      <span className="absolute -top-0.5 h-2.5 w-px bg-danger-600/70" style={{ left: `${critPct}%` }} title="Critical threshold" />
      <span className="absolute -top-0.5 h-2.5 w-px bg-ink-500/70" style={{ left: `${reorderPct}%` }} title="Reorder threshold" />
    </div>
  );
}
