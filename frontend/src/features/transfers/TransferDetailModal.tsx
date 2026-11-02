import { useEffect, useState } from 'react';
import { ArrowRight, Check, PackageCheck, Truck, X, XCircle } from 'lucide-react';
import { ApiError } from '@/api';
import type { Transfer, TransferAction, TransferStatus } from '@/api/types';
import { useCurrentUser } from '@/auth/AuthContext';
import { transferActionsFor } from '@/auth/permissions';
import { Button, ErrorState, FormField, Modal, Skeleton, Textarea, TransferStatusBadge, useToast } from '@/components/ui';
import { useTransfer, useTransferAction } from '@/hooks/queries';
import { fmtDate, fmtDateTime, fmtNumber } from '@/lib/format';
import { TRANSFER_STATUS_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';

const ACTION_META: Record<TransferAction, { label: string; confirm: string; verb: string; icon: typeof Check; variant: 'primary' | 'secondary' | 'danger' }> = {
  approve: { label: 'Approve', confirm: 'Confirm approval', verb: 'approved', icon: Check, variant: 'primary' },
  dispatch: { label: 'Mark dispatched', confirm: 'Confirm dispatch', verb: 'dispatched', icon: Truck, variant: 'primary' },
  receive: { label: 'Receive stock', confirm: 'Confirm receipt', verb: 'received', icon: PackageCheck, variant: 'primary' },
  reject: { label: 'Reject', confirm: 'Reject transfer', verb: 'rejected', icon: XCircle, variant: 'danger' },
  cancel: { label: 'Cancel request', confirm: 'Cancel transfer', verb: 'cancelled', icon: X, variant: 'secondary' },
};

const FLOW: TransferStatus[] = ['PENDING', 'APPROVED', 'DISPATCHED', 'RECEIVED'];

function Stepper({ t }: { t: Transfer }) {
  const terminalBad = t.status === 'REJECTED' || t.status === 'CANCELLED';
  const reached = new Set(t.history.map((h) => h.status));
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
      {terminalBad && <span className="sr-only">Transfer was {t.status.toLowerCase()}</span>}
    </ol>
  );
}

export function TransferDetailModal({ id, onClose }: { id: string | undefined; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const q = useTransfer(id);
  const act = useTransferAction();
  const [pending, setPending] = useState<TransferAction | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);

  useEffect(() => {
    setPending(null);
    setReason('');
    setReasonError(null);
  }, [id]);

  const t = q.data;
  const actions = t ? transferActionsFor(user, t) : [];

  const run = async (action: TransferAction) => {
    if (!t) return;
    if (action === 'reject' && reason.trim().length < 3) {
      setReasonError('Give the requester a reason (at least 3 characters)');
      return;
    }
    try {
      const updated = await act.mutateAsync({ id: t.id, action, reason: action === 'reject' ? reason.trim() : undefined, note: action !== 'reject' && reason.trim() ? reason.trim() : undefined });
      toast.success(`Transfer ${updated.code} ${ACTION_META[action].verb}`, `${fmtNumber(updated.quantity)} × ${updated.medicine.name}: ${updated.sourceFacility.code} → ${updated.destinationFacility.code}`);
      setPending(null);
      setReason('');
    } catch (e) {
      toast.error(`Could not ${action} transfer`, e instanceof ApiError ? e.message : undefined);
    }
  };

  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={t ? `Transfer ${t.code}` : 'Transfer'} description={t && `Requested by ${t.requestedBy.name} on ${fmtDateTime(t.createdAt)}`}>
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
            <div>
              <p className="text-base font-semibold text-ink-900">
                {fmtNumber(t.quantity)} × {t.medicine.name} <span className="font-normal text-ink-500">{t.medicine.strength}</span>
              </p>
              <p className="tabular mt-0.5 text-xs text-ink-500">
                Batch {t.batch.batchNumber} · expires {fmtDate(t.batch.expiryDate)}
              </p>
            </div>
            <TransferStatusBadge status={t.status} />
          </div>

          <div className="grid items-center gap-2 rounded-lg border border-line p-3 text-sm sm:grid-cols-[1fr_auto_1fr]">
            <div>
              <p className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">From</p>
              <p className="font-medium text-ink-900">{t.sourceFacility.name}</p>
            </div>
            <ArrowRight className="hidden size-4 text-ink-400 sm:block" />
            <div>
              <p className="text-[11px] font-medium tracking-wide text-ink-500 uppercase">To</p>
              <p className="font-medium text-ink-900">{t.destinationFacility.name}</p>
            </div>
          </div>

          {t.status === 'REJECTED' || t.status === 'CANCELLED' ? (
            <div className="rounded-lg border border-danger-100 bg-danger-50 p-3 text-sm text-danger-700">
              <p className="font-medium">{t.status === 'REJECTED' ? 'Rejected' : 'Cancelled'}</p>
              {t.rejectionReason && <p className="mt-0.5 text-xs">{t.rejectionReason}</p>}
            </div>
          ) : (
            <Stepper t={t} />
          )}

          {t.notes && (
            <div>
              <p className="mb-1 text-xs font-medium text-ink-500">Request notes</p>
              <p className="rounded-md bg-subtle p-3 text-sm text-ink-700">{t.notes}</p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium text-ink-500">Activity</p>
            <ol className="relative space-y-3 border-l border-line pl-4">
              {t.history.map((h, i) => (
                <li key={i} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-ink-400" aria-hidden />
                  <p className="text-ink-900">
                    <span className="font-medium">{TRANSFER_STATUS_LABEL[h.status]}</span> <span className="text-ink-500">by {h.by.name}</span>
                  </p>
                  <p className="text-xs text-ink-500">
                    {fmtDateTime(h.at)}
                    {h.note ? ` · ${h.note}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          </div>

          {actions.length > 0 && (
            <div className="border-t border-line pt-4">
              {pending ? (
                <div className="space-y-3">
                  <FormField
                    label={pending === 'reject' ? 'Reason for rejection' : 'Note (optional)'}
                    htmlFor="transfer-reason"
                    error={reasonError ?? undefined}
                    required={pending === 'reject'}
                  >
                    <Textarea
                      id="transfer-reason"
                      rows={2}
                      value={reason}
                      invalid={!!reasonError}
                      onChange={(e) => {
                        setReason(e.target.value);
                        setReasonError(null);
                      }}
                      placeholder={pending === 'dispatch' ? 'Vehicle number, courier, expected arrival…' : pending === 'receive' ? 'Condition on arrival, discrepancies…' : ''}
                    />
                  </FormField>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="secondary" onClick={() => setPending(null)} disabled={act.isPending}>
                      Back
                    </Button>
                    <Button variant={ACTION_META[pending].variant === 'danger' ? 'danger' : 'primary'} loading={act.isPending} onClick={() => run(pending)}>
                      {ACTION_META[pending].confirm}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap justify-end gap-2">
                  {actions.map((a) => {
                    const M = ACTION_META[a];
                    return (
                      <Button key={a} variant={M.variant} icon={<M.icon className="size-4" />} onClick={() => setPending(a)}>
                        {M.label}
                      </Button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
