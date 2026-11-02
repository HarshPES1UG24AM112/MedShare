import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Clock, PackageCheck, Truck, X, XCircle } from 'lucide-react';
import { ApiError, newIdempotencyKey } from '@/api';
import type { ApprovalStage, TransferDetail, TransferStatus } from '@/api/types';
import { Badge, BatchStatusBadge, Button, ErrorState, ExpiryBadge, FormField, Input, Modal, Skeleton, Textarea, TransferStatusBadge, useToast } from '@/components/ui';
import { useTransfer, useTransferCommand } from '@/hooks/queries';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { STAGE_LABEL, TRANSFER_STATUS_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

type Pending =
  | { action: 'approve'; stage: ApprovalStage }
  | { action: 'reject'; stage: ApprovalStage }
  | { action: 'cancel' }
  | { action: 'dispatch' }
  | { action: 'receive' };

const FLOW: TransferStatus[] = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED'];

/** Postgres interval text ("2 days 03:00:00", "05:30:00") → "2 d 3 h" / "5 h 30 min". */
export function fmtInterval(v: string | null): string {
  if (!v) return '';
  const m = /(?:(\d+) days? )?(\d+):(\d+):(\d+)/.exec(v);
  if (!m) return v;
  const [d, h, min] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
  if (d) return `${d} d${h ? ` ${h} h` : ''}`;
  if (h) return `${h} h${min ? ` ${min} min` : ''}`;
  return `${min} min`;
}

function Stepper({ t }: { t: TransferDetail }) {
  const reached = new Set(t.timeline.map((h) => h.toStatus));
  return (
    <ol className="flex items-center gap-1" aria-label="Transfer progress">
      {FLOW.map((s, i) => {
        const done = reached.has(s);
        return (
          <li key={s} className="flex flex-1 items-center gap-1">
            <div className="flex min-w-0 flex-col items-center gap-1 text-center">
              <span
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? 'bg-brand-600 text-white' : 'border border-line-strong bg-surface text-ink-400',
                )}
              >
                {done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('text-[11px] leading-tight', done ? 'text-ink-900' : 'text-ink-400')}>{TRANSFER_STATUS_LABEL[s]}</span>
            </div>
            {i < FLOW.length - 1 && <span className={cn('mb-5 h-px flex-1', reached.has(FLOW[i + 1]) ? 'bg-brand-500' : 'bg-line-strong')} />}
          </li>
        );
      })}
    </ol>
  );
}

function ActionPanel({ t, onDone }: { t: TransferDetail; onDone: () => void }) {
  const toast = useToast();
  const cmd = useTransferCommand();
  const a = t.allowedActions;
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<number, { received: string; damaged: string }>>({});
  const idemKey = useRef(newIdempotencyKey());

  useEffect(() => {
    setPending(null);
    setText('');
    setError(null);
  }, [t.id, t.status]);

  const begin = (p: Pending) => {
    setPending(p);
    setText('');
    setError(null);
    idemKey.current = newIdempotencyKey();
    if (p.action === 'receive') setLines(Object.fromEntries(t.items.map((i) => [i.id, { received: String(i.quantity), damaged: '0' }])));
  };

  const run = async () => {
    if (!pending) return;
    const reason = text.trim();
    if ((pending.action === 'reject' || pending.action === 'cancel') && reason.length < 3) {
      setError('Give a reason of at least 3 characters');
      return;
    }
    let receiveLines: { itemId: number; received: number; damaged: number }[] | undefined;
    if (pending.action === 'receive') {
      receiveLines = t.items.map((i) => ({ itemId: i.id, received: Number(lines[i.id]?.received), damaged: Number(lines[i.id]?.damaged) }));
      const bad = receiveLines.find((l, idx) => {
        const q = t.items[idx].quantity;
        return !Number.isInteger(l.received) || !Number.isInteger(l.damaged) || l.received < 0 || l.damaged < 0 || l.received + l.damaged !== q;
      });
      if (bad) {
        setError('For every line, received + damaged must equal the dispatched quantity.');
        return;
      }
      if (receiveLines.every((l) => l.damaged === 0)) receiveLines = undefined;
    }
    const command =
      pending.action === 'approve'
        ? { action: 'approve' as const, stage: pending.stage, comment: reason || undefined }
        : pending.action === 'reject'
          ? { action: 'reject' as const, stage: pending.stage, reason }
          : pending.action === 'cancel'
            ? { action: 'cancel' as const, reason }
            : pending.action === 'dispatch'
              ? { action: 'dispatch' as const, note: reason || undefined }
              : { action: 'receive' as const, lines: receiveLines, note: reason || undefined };
    try {
      const updated = await cmd.mutateAsync({ id: t.id, command, opts: { idempotencyKey: idemKey.current } });
      const outcome =
        pending.action === 'approve' && updated.status === 'PENDING'
          ? `${STAGE_LABEL[pending.stage]} approval recorded; another stage is still required.`
          : `Status: ${TRANSFER_STATUS_LABEL[updated.status]}.`;
      toast.success(`Transfer ${updated.code} updated`, outcome);
      setPending(null);
      onDone();
    } catch (e) {
      idemKey.current = newIdempotencyKey();
      setError(e instanceof ApiError ? e.message : 'The action failed.');
    }
  };

  const buttons: { key: string; p: Pending; label: string; icon: typeof Check; variant: 'primary' | 'secondary' | 'danger' }[] = [
    ...a.approve.map((stage) => ({ key: `ap-${stage}`, p: { action: 'approve' as const, stage }, label: t.requiredStages.length > 1 ? `Approve (${STAGE_LABEL[stage].toLowerCase()})` : 'Approve', icon: Check, variant: 'primary' as const })),
    ...(a.dispatch ? [{ key: 'dispatch', p: { action: 'dispatch' as const }, label: 'Mark dispatched', icon: Truck, variant: 'primary' as const }] : []),
    ...(a.receive ? [{ key: 'receive', p: { action: 'receive' as const }, label: 'Receive stock', icon: PackageCheck, variant: 'primary' as const }] : []),
    ...a.reject.map((stage) => ({ key: `rj-${stage}`, p: { action: 'reject' as const, stage }, label: t.requiredStages.length > 1 ? `Reject (${STAGE_LABEL[stage].toLowerCase()})` : 'Reject', icon: XCircle, variant: 'danger' as const })),
    ...(a.cancel ? [{ key: 'cancel', p: { action: 'cancel' as const }, label: 'Cancel transfer', icon: X, variant: 'secondary' as const }] : []),
  ];

  if (!buttons.length) return null;

  if (!pending) {
    return (
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {buttons.map((b) => (
          <Button key={b.key} variant={b.variant} icon={<b.icon className="size-4" />} onClick={() => begin(b.p)}>
            {b.label}
          </Button>
        ))}
      </div>
    );
  }

  const needsReason = pending.action === 'reject' || pending.action === 'cancel';
  const label =
    pending.action === 'reject' ? 'Reason for rejection' : pending.action === 'cancel' ? 'Reason for cancelling' : pending.action === 'approve' ? 'Comment (optional)' : 'Note (optional)';
  const confirm =
    pending.action === 'approve'
      ? 'Confirm approval'
      : pending.action === 'reject'
        ? 'Reject transfer'
        : pending.action === 'cancel'
          ? 'Cancel transfer'
          : pending.action === 'dispatch'
            ? 'Confirm dispatch'
            : 'Confirm receipt';

  return (
    <div className="space-y-3 border-t border-line pt-4">
      {pending.action === 'approve' && t.requiredStages.length === t.approvals.filter((x) => x.decision === 'APPROVED').length + 1 && (
        <p className="text-xs text-ink-600">This is the last required approval: the requested units will be reserved at the source now.</p>
      )}
      {pending.action === 'cancel' && t.status === 'APPROVED' && <p className="text-xs text-ink-600">Cancelling releases the reserved units back to the source.</p>}
      {pending.action === 'receive' && (
        <div className="scrollbar-thin overflow-x-auto">
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-ink-500">
                <th className="py-1.5 font-medium">Line</th>
                <th className="py-1.5 text-right font-medium">Sent</th>
                <th className="py-1.5 pl-2 font-medium">Received</th>
                <th className="py-1.5 pl-2 font-medium">Damaged</th>
              </tr>
            </thead>
            <tbody>
              {t.items.map((i) => (
                <tr key={i.id} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">
                    <span className="block text-ink-900">{i.medicineName}</span>
                    <span className="text-xs text-ink-500">{i.batchNumber}</span>
                  </td>
                  <td className="py-2 text-right">{fmtNumber(i.quantity)}</td>
                  <td className="py-2 pl-2">
                    <Input
                      aria-label={`Received ${i.batchNumber}`}
                      type="number"
                      min={0}
                      className="w-24"
                      value={lines[i.id]?.received ?? ''}
                      onChange={(e) => setLines((ls) => ({ ...ls, [i.id]: { received: e.target.value, damaged: String(Math.max(0, i.quantity - (Number(e.target.value) || 0))) } }))}
                    />
                  </td>
                  <td className="py-2 pl-2">
                    <Input
                      aria-label={`Damaged ${i.batchNumber}`}
                      type="number"
                      min={0}
                      className="w-24"
                      value={lines[i.id]?.damaged ?? ''}
                      onChange={(e) => setLines((ls) => ({ ...ls, [i.id]: { damaged: e.target.value, received: String(Math.max(0, i.quantity - (Number(e.target.value) || 0))) } }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormField label={label} htmlFor="transfer-text" error={error ?? undefined} required={needsReason}>
        <Textarea
          id="transfer-text"
          rows={2}
          maxLength={500}
          value={text}
          invalid={!!error && needsReason}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={pending.action === 'dispatch' ? 'Vehicle, courier, expected arrival…' : pending.action === 'receive' ? 'Condition on arrival…' : ''}
        />
      </FormField>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => setPending(null)} disabled={cmd.isPending}>
          Back
        </Button>
        <Button variant={pending.action === 'reject' ? 'danger' : 'primary'} loading={cmd.isPending} onClick={run}>
          {confirm}
        </Button>
      </div>
    </div>
  );
}

export function TransferDetailModal({ id, onClose }: { id: number | undefined; onClose: () => void }) {
  const q = useTransfer(id);
  const t = q.data;

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={t ? `Transfer ${t.code}` : 'Transfer'}
      description={t && `Requested by ${t.requestedBy.name} on ${fmtDateTime(t.createdAt)}${t.recommendationId ? ' · from a redistribution recommendation' : ''}`}
    >
      {q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !t ? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-base font-semibold text-ink-900">{t.medicines}</p>
              <p className="tabular mt-0.5 text-xs text-ink-500">
                {t.itemCount} line{t.itemCount === 1 ? '' : 's'} · {fmtNumber(t.totalUnits)} units
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {t.crossOrganization && <Badge tone="info">Cross-organisation</Badge>}
              <TransferStatusBadge status={t.status} />
            </div>
          </div>

          <div className="grid items-center gap-2 rounded-lg border border-line p-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">From</p>
              <p className="font-medium text-ink-900">
                {t.sourceFacility.code} · {t.sourceFacility.name}
              </p>
            </div>
            <ArrowRight className="hidden size-4 text-ink-400 sm:block" />
            <div className="min-w-0">
              <p className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">To</p>
              <p className="font-medium text-ink-900">
                {t.destinationFacility.code} · {t.destinationFacility.name}
              </p>
            </div>
          </div>

          {t.status === 'REJECTED' || t.status === 'CANCELLED' ? (
            <div className="rounded-lg border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
              <p className="font-medium">{TRANSFER_STATUS_LABEL[t.status]}</p>
              {t.rejectionReason && <p className="mt-0.5 text-xs">{t.rejectionReason}</p>}
            </div>
          ) : (
            <Stepper t={t} />
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Approvals</p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {t.requiredStages.map((stage) => {
                const d = t.approvals.find((x) => x.stage === stage);
                return (
                  <li key={stage} className="rounded-md border border-line p-2.5 text-xs">
                    <p className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink-900">{STAGE_LABEL[stage]}</span>
                      {d ? <Badge tone={d.decision === 'APPROVED' ? 'success' : 'danger'}>{d.decision === 'APPROVED' ? 'Approved' : 'Rejected'}</Badge> : <Badge tone="warning">Awaiting</Badge>}
                    </p>
                    {d && (
                      <p className="mt-1 text-ink-500">
                        {d.decidedBy.name} · {fmtDateTime(d.decidedAt)}
                        {d.comment ? ` · “${d.comment}”` : ''}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Items</p>
            <div className="scrollbar-thin overflow-x-auto rounded-lg border border-line">
              <table className="tabular w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-subtle/70 text-left text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">Medicine / batch</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Source avail / reserved</th>
                    <th className="px-3 py-2 text-right font-medium">Received</th>
                  </tr>
                </thead>
                <tbody>
                  {t.items.map((i) => (
                    <tr key={i.id} className="border-b border-line last:border-0">
                      <td className="px-3 py-2">
                        <span className="block text-ink-900">
                          {i.medicineName} <span className="text-ink-500">{i.strengthLabel}</span>
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                          {i.batchNumber} · exp {fmtDate(i.expiryDate)} <ExpiryBadge days={i.daysToExpiry} />
                          {i.batchStatus !== 'ACTIVE' && <BatchStatusBadge status={i.batchStatus} />}
                          {i.stockRequestItemId && <Badge tone="info">Stock request</Badge>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtNumber(i.quantity)} <span className="text-xs text-ink-500">{i.unit}s</span>
                      </td>
                      <td className="hidden px-3 py-2 text-right text-xs text-ink-600 sm:table-cell">
                        {fmtNumber(i.sourceAvailable)} / {fmtNumber(i.sourceReserved)}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        {i.quantityReceived == null ? (
                          <span className="text-ink-400">—</span>
                        ) : (
                          <>
                            {fmtNumber(i.quantityReceived)}
                            {i.quantityDamagedInTransit ? <span className="block text-danger-600">{fmtNumber(i.quantityDamagedInTransit)} damaged</span> : null}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {t.requestNotes && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-500">Request notes</p>
              <p className="rounded-md bg-subtle p-3 text-sm text-ink-700">{t.requestNotes}</p>
            </div>
          )}

          <TransferTimeline t={t} />

          <ActionPanel t={t} onDone={() => q.refetch()} />
        </div>
      )}
    </Modal>
  );
}

export function TransferTimeline({ t }: { t: TransferDetail }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-ink-500">Timeline</p>
      <ol className="relative space-y-3 border-l border-line pl-4">
        {t.timeline.map((h) => (
          <li key={h.step} className="text-sm">
            <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-400" aria-hidden />
            <p className="text-ink-900">
              {h.fromStatus ? (
                <>
                  <span className="text-ink-500">{TRANSFER_STATUS_LABEL[h.fromStatus]} →</span> <span className="font-medium">{TRANSFER_STATUS_LABEL[h.toStatus]}</span>
                </>
              ) : (
                <span className="font-medium">Requested</span>
              )}
              {h.changedBy && <span className="text-ink-500"> by {h.changedBy.name}</span>}
            </p>
            <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-500">
              {fmtDateTime(h.changedAt)}
              {h.timeInState && (
                <span className="inline-flex items-center gap-1" title="Time spent in this state before the next change">
                  <Clock className="size-3" /> {fmtInterval(h.timeInState)} as “{TRANSFER_STATUS_LABEL[h.toStatus].toLowerCase()}”
                </span>
              )}
              {h.note && <span>· {h.note}</span>}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
