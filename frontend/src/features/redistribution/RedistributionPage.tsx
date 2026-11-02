import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CalendarClock, Info, Play, Route, Send, TriangleAlert, X } from 'lucide-react';
import { ApiError, newIdempotencyKey } from '@/api';
import type { Recommendation, RecommendationReason, RecommendationStatus } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can, canAt, canRunEngine } from '@/auth/permissions';
import { Forbidden } from '@/auth/ProtectedRoute';
import { Badge, Button, Card, EmptyState, ErrorState, FilterSelect, FormField, Input, Modal, PageHeader, Pagination, SearchInput, Skeleton, Textarea, Toolbar, useToast } from '@/components/ui';
import { useAcceptRecommendation, useDismissRecommendation, useRecommendations, useRunEngine } from '@/hooks/queries';
import { useListParams } from '@/hooks/useListParams';
import { fmtDate, fmtNumber, fmtRelative } from '@/lib/format';
import { REASON_LABEL, RECOMMENDATION_STATUS_LABEL, options } from '@/lib/labels';
import { cn } from '@/lib/utils';

const FILTERS = ['reasonCode', 'status'] as const;
const SORTS = [
  { value: 'priorityScore:desc', label: 'Highest priority' },
  { value: 'distanceKm:asc', label: 'Shortest distance' },
  { value: 'expiryDate:asc', label: 'Earliest expiry' },
  { value: 'quantity:desc', label: 'Largest quantity' },
  { value: 'reduction:desc', label: 'Largest shortage reduction' },
];

function PriorityPill({ score }: { score: number }) {
  const tone = score >= 70 ? 'bg-danger-50 text-danger-700 ring-danger-100' : score >= 45 ? 'bg-warning-50 text-warning-700 ring-warning-100' : 'bg-subtle text-ink-700 ring-line';
  const label = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  return (
    <span className={cn('tabular inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset', tone)} title="Priority score (0–100) from shortage severity, expiry urgency and distance">
      {Math.round(score)}
      <span className="font-medium">{label}</span>
    </span>
  );
}

type Decision = { kind: 'accept' | 'dismiss'; rec: Recommendation };

export default function RedistributionPage() {
  const user = useCurrentUser();
  const toast = useToast();
  const navigate = useNavigate();
  const scope = useFacilityScope();
  const lp = useListParams(FILTERS, { sortBy: 'priorityScore', sortDir: 'desc', pageSize: 10 });
  const status = (lp.filters.status as RecommendationStatus | undefined) ?? 'OPEN';
  const q = useRecommendations({ ...lp.query, facilityId: scope.facilityId, reasonCode: lp.filters.reasonCode as RecommendationReason | undefined, status });
  const run = useRunEngine();
  const [decision, setDecision] = useState<Decision | null>(null);

  if (!can(user, 'inventory:read')) return <Forbidden />;

  const canAccept = (r: Recommendation) => canAt(user, 'transfer:request', r.sourceFacility.id) || canAt(user, 'transfer:request', r.destinationFacility.id);
  const canDismiss = (r: Recommendation) =>
    canRunEngine(user) || canAt(user, 'recommendation:manage', r.sourceFacility.id) || canAt(user, 'recommendation:manage', r.destinationFacility.id);

  const runEngine = () =>
    run.mutate(undefined, {
      onSuccess: (r) => toast.success('Recommendations regenerated', `${fmtNumber(r.generated)} open recommendations from the current stock snapshot.`),
      onError: (e) => toast.error('Engine run failed', e instanceof ApiError ? e.message : undefined),
    });

  return (
    <>
      <PageHeader
        title="Redistribution recommendations"
        description="Suggested moves that cover shortages or rescue near-expiry stock. Accepting creates a pending transfer request; nothing moves until people approve it."
        actions={
          canRunEngine(user) && (
            <Button variant="secondary" icon={<Play className="size-4" />} loading={run.isPending} onClick={runEngine}>
              Run engine
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info-100 bg-info-50 px-4 py-3 text-xs text-info-700">
        <Info className="mt-px size-4 shrink-0" />
        <p>
          The engine weighs shortage severity, demand, safety stock, batch expiry (FEFO), remaining shelf life, distance and dispatch radius. It runs on one consistent
          snapshot; a recommendation marked <strong>stale</strong> means stock has changed since, and approval re-validates it either way. Data is synthetic.
        </p>
      </div>
      <Card>
        <Toolbar onClear={lp.clearFilters} showClear={lp.hasActiveFilters}>
          <SearchInput value={lp.search} onChange={lp.setSearch} placeholder="Search medicine or facility…" />
          <FilterSelect label="Reason" value={lp.filters.reasonCode} onChange={(v) => lp.setFilter('reasonCode', v)} options={options(REASON_LABEL)} />
          <FilterSelect label="Status" allLabel="Open" value={lp.filters.status} onChange={(v) => lp.setFilter('status', v)} options={options(RECOMMENDATION_STATUS_LABEL).filter((o) => o.value !== 'OPEN')} />
          <select
            aria-label="Sort recommendations"
            value={`${lp.sortBy}:${lp.sortDir}`}
            onChange={(e) => {
              const [by, dir] = e.target.value.split(':');
              lp.setSort(by, dir as 'asc' | 'desc');
            }}
            className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-sm text-ink-700 sm:ml-auto"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                Sort: {s.label}
              </option>
            ))}
          </select>
        </Toolbar>

        {q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : q.isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full" />
            ))}
          </div>
        ) : !q.data?.data.length ? (
          <EmptyState
            title={status === 'OPEN' ? 'No open recommendations' : `No ${RECOMMENDATION_STATUS_LABEL[status].toLowerCase()} recommendations`}
            description={status === 'OPEN' ? 'Nothing in your scope needs redistributing right now.' : undefined}
          />
        ) : (
          <ul className="divide-y divide-line">
            {q.data.data.map((r) => (
              <li key={r.id} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <PriorityPill score={r.priorityScore} />
                      <Badge tone={r.reasonCode === 'SHORTAGE_COVER' ? 'danger' : 'warning'}>
                        {r.reasonCode === 'SHORTAGE_COVER' ? <TriangleAlert className="size-3" /> : <CalendarClock className="size-3" />}
                        {REASON_LABEL[r.reasonCode]}
                      </Badge>
                      {r.crossOrganization && <Badge tone="info">Cross-organisation</Badge>}
                      {r.stale && <Badge tone="warning">Stale</Badge>}
                      {r.status !== 'OPEN' && <Badge>{RECOMMENDATION_STATUS_LABEL[r.status]}</Badge>}
                    </div>
                    <p className="mt-2 text-sm font-medium text-ink-900">
                      {fmtNumber(r.recommendedQuantity)} × {r.medicine.name} <span className="font-normal text-ink-500">{r.medicine.strengthLabel}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-600">
                      <span className="font-medium text-ink-800">{r.sourceFacility.code}</span> {r.sourceFacility.name}
                      <ArrowRight className="size-3 text-ink-400" />
                      <span className="font-medium text-ink-800">{r.destinationFacility.code}</span> {r.destinationFacility.name}
                    </p>
                    <p className="mt-2 text-xs leading-relaxed text-ink-600">{r.explanation}</p>
                    <p className="tabular mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-500">
                      <span>
                        Batch {r.batch.batchNumber} · exp {fmtDate(r.expiryDate)} ({r.daysToExpiry} d)
                      </span>
                      {r.distanceKm != null && (
                        <span className="inline-flex items-center gap-1">
                          <Route className="size-3" /> {r.distanceKm} km
                        </span>
                      )}
                      <span>Shortage reduction {fmtNumber(r.projectedShortageReduction)}</span>
                      <span>Generated {fmtRelative(r.generatedAt)}</span>
                    </p>
                  </div>
                  {r.status === 'OPEN' && (
                    <div className="flex gap-2">
                      {canDismiss(r) && (
                        <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => setDecision({ kind: 'dismiss', rec: r })}>
                          Dismiss
                        </Button>
                      )}
                      {canAccept(r) && (
                        <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => setDecision({ kind: 'accept', rec: r })}>
                          Accept
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination meta={q.data?.meta} onPageChange={lp.setPage} onPageSizeChange={lp.setPageSize} />
      </Card>
      <DecisionModal decision={decision} onClose={() => setDecision(null)} onAccepted={(transferId) => navigate(`/transfers?open=${transferId}`)} />
    </>
  );
}

function DecisionModal({ decision, onClose, onAccepted }: { decision: Decision | null; onClose: () => void; onAccepted: (transferId: number) => void }) {
  const toast = useToast();
  const accept = useAcceptRecommendation();
  const dismiss = useDismissRecommendation();
  const [quantity, setQuantity] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newIdempotencyKey);
  const [lastId, setLastId] = useState<number | null>(null);

  if (!decision) return null;
  const r = decision.rec;
  if (lastId !== r.id) {
    setLastId(r.id);
    setQuantity(String(r.recommendedQuantity));
    setText('');
    setError(null);
  }

  const submit = async () => {
    setError(null);
    try {
      if (decision.kind === 'accept') {
        const n = Number(quantity);
        if (!Number.isInteger(n) || n < 1) return setError('Enter a whole number of units');
        const res = await accept.mutateAsync({ id: r.id, quantity: n, notes: text.trim() || undefined, opts: { idempotencyKey: `${key.slice(0, 24)}${String(r.id).padStart(12, '0')}` } });
        toast.success('Transfer request created', 'It is pending approval at the source facility.');
        onClose();
        onAccepted(res.transferId);
      } else {
        if (text.trim().length < 3) return setError('Give a reason (3+ characters)');
        await dismiss.mutateAsync({ id: r.id, reason: text.trim() });
        toast.success('Recommendation dismissed');
        onClose();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The request failed.');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={decision.kind === 'accept' ? 'Accept recommendation' : 'Dismiss recommendation'}
      description={
        decision.kind === 'accept'
          ? 'Creates a PENDING transfer request. The source facility still approves it, and stock is reserved only then.'
          : 'The recommendation is closed for everyone; the engine may suggest it again if the situation persists.'
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={decision.kind === 'dismiss' ? 'danger' : 'primary'} loading={accept.isPending || dismiss.isPending} onClick={submit}>
            {decision.kind === 'accept' ? 'Create transfer request' : 'Dismiss'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="rounded-lg border border-line bg-subtle/60 p-3 text-sm text-ink-800">
          {r.medicine.name} {r.medicine.strengthLabel} · batch {r.batch.batchNumber}
          <span className="block text-xs text-ink-500">
            {r.sourceFacility.code} → {r.destinationFacility.code} · {fmtNumber(r.batch.quantityAvailable)} available at source
          </span>
        </p>
        {error && (
          <p role="alert" className="rounded-md border border-danger-100 bg-danger-50 p-3 text-xs text-danger-700">
            {error}
          </p>
        )}
        {decision.kind === 'accept' && (
          <FormField label="Quantity" htmlFor="rec-qty" hint={`Recommended ${fmtNumber(r.recommendedQuantity)}`} required>
            <Input id="rec-qty" type="number" min={1} inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </FormField>
        )}
        <FormField label={decision.kind === 'accept' ? 'Notes for approver (optional)' : 'Reason'} htmlFor="rec-text" required={decision.kind === 'dismiss'}>
          <Textarea id="rec-text" rows={2} maxLength={decision.kind === 'accept' ? 500 : 300} value={text} onChange={(e) => setText(e.target.value)} />
        </FormField>
      </div>
    </Modal>
  );
}
