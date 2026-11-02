import { useState, type ReactNode } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Card, CardHeader, EmptyState, ErrorState } from '@/components/ui';
import { cn } from '@/lib/utils';

export interface LegendItem {
  label: string;
  color: string;
}

interface ChartCardProps {
  title: string;
  description?: ReactNode;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyText?: string;
  legend?: LegendItem[];
  /** Accessible / exact-value alternative to the plot. */
  table: ReactNode;
  height?: number;
  className?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Card wrapper for every chart: legend, chart/table toggle, and loading/empty/error states. */
export function ChartCard({ title, description, loading, error, onRetry, isEmpty, emptyText, legend, table, height = 260, className, actions, children }: ChartCardProps) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <>
            {actions}
            <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Display as">
              {(['chart', 'table'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={cn('rounded px-1.5 py-1 text-ink-500', view === v ? 'bg-subtle text-ink-900' : 'hover:text-ink-900')}
                  title={v === 'chart' ? 'Chart view' : 'Table view'}
                >
                  {v === 'chart' ? <BarChart3 className="size-3.5" /> : <Table2 className="size-3.5" />}
                  <span className="sr-only">{v === 'chart' ? 'Chart view' : 'Table view'}</span>
                </button>
              ))}
            </div>
          </>
        }
      />
      <div className="flex-1 p-4">
        {error && !loading ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : loading ? null : isEmpty ? (
          <EmptyState title={emptyText ?? 'No data for this period'} />
        ) : view === 'table' ? (
          <div className="scrollbar-thin overflow-auto" style={{ maxHeight: height + 32 }}>
            {table}
          </div>
        ) : (
          <>
            {legend && legend.length > 1 && (
              <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-600">
                {legend.map((l) => (
                  <li key={l.label} className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm" style={{ background: l.color }} aria-hidden />
                    {l.label}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ height }}>{children}</div>
          </>
        )}
        {loading && <div style={{ height }} className="animate-pulse rounded bg-subtle" aria-hidden />}
      </div>
    </Card>
  );
}

/** Minimal table used for chart table views. */
export function MiniTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="tabular w-full text-xs">
      <thead>
        <tr className="border-b border-line text-ink-500">
          {head.map((h, i) => (
            <th key={h} className={cn('py-1.5 font-medium', i === 0 ? 'text-left' : 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className={cn('py-1.5', j === 0 ? 'text-left text-ink-900' : 'text-right text-ink-700')}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tooltip body shared by all Recharts charts. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter = (v) => v.toLocaleString('en-IN'),
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string | number; payload?: Record<string, unknown> }[];
  label?: string | number;
  labelFormatter?: (l: string) => string;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      {label !== undefined && <p className="mb-1 font-medium text-ink-900">{labelFormatter ? labelFormatter(String(label)) : label}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center gap-2 text-ink-600">
            <span className="size-2 rounded-sm" style={{ background: p.color }} aria-hidden />
            <span className="flex-1">{p.name}</span>
            <span className="tabular font-medium text-ink-900">{valueFormatter(Number(p.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
