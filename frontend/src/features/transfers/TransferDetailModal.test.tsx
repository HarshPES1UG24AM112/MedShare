import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { TransferDetail } from '@/api/types';
import { ToastProvider } from '@/components/ui';
import { createQueryClient } from '@/lib/queryClient';
import { fmtInterval, TransferDetailModal } from './TransferDetailModal';

const get = vi.fn();
const act = vi.fn();

vi.mock('@/api', async () => {
  const client = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ApiError: client.ApiError,
    newIdempotencyKey: () => '00000000-0000-4000-8000-000000000000',
    api: { transfers: { get: (...a: unknown[]) => get(...a), act: (...a: unknown[]) => act(...a) } },
  };
});

const base: TransferDetail = {
  id: 7,
  code: 'TRF-2026-00007',
  status: 'PENDING',
  createdAt: '2026-11-01T05:30:00.000Z',
  updatedAt: '2026-11-01T05:30:00.000Z',
  sourceFacility: { id: 3, code: 'FAC-001', name: 'Bengaluru Central District Hospital' },
  destinationFacility: { id: 4, code: 'FAC-002', name: 'Yelahanka Community Health Centre' },
  crossOrganization: false,
  requestedBy: { id: 20, name: 'Requester (Synthetic)' },
  requestNotes: null,
  rejectionReason: null,
  recommendationId: null,
  itemCount: 1,
  totalUnits: 100,
  medicines: 'Paracetamol',
  requiredStages: ['SOURCE_FACILITY'],
  items: [
    {
      id: 70,
      batchId: 1,
      batchNumber: 'PAR2411-0001',
      expiryDate: '2027-11-09',
      batchStatus: 'ACTIVE',
      daysToExpiry: 372,
      medicineId: 1,
      medicineCode: 'MED-0001',
      medicineName: 'Paracetamol',
      strengthLabel: '500 mg',
      unit: 'tablet',
      quantity: 100,
      quantityReceived: null,
      quantityDamagedInTransit: null,
      sourceAvailable: 500,
      sourceReserved: 0,
      stockRequestItemId: null,
      stockRequestId: null,
    },
  ],
  approvals: [],
  timeline: [{ step: 1, fromStatus: null, toStatus: 'PENDING', note: null, changedAt: '2026-11-01T05:30:00.000Z', timeInState: null, changedBy: { id: 20, name: 'Requester (Synthetic)' } }],
  allowedActions: { approve: [], reject: [], cancel: false, dispatch: false, receive: false },
};

const renderModal = () =>
  render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <TransferDetailModal id={7} onClose={() => {}} />
      </ToastProvider>
    </QueryClientProvider>,
  );

describe('TransferDetailModal', () => {
  beforeEach(() => {
    get.mockReset();
    act.mockReset();
  });

  it('shows no workflow buttons when the server allows no action', async () => {
    get.mockResolvedValue(base);
    renderModal();
    expect(await screen.findByText('Transfer TRF-2026-00007')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approve|Reject|Dispatch|Receive|Cancel transfer/ })).not.toBeInTheDocument();
  });

  it('renders exactly the actions in allowedActions, including org-stage approvals', async () => {
    get.mockResolvedValue({
      ...base,
      requiredStages: ['SOURCE_FACILITY', 'SOURCE_ORGANIZATION'],
      allowedActions: { approve: ['SOURCE_ORGANIZATION'], reject: ['SOURCE_ORGANIZATION'], cancel: false, dispatch: false, receive: false },
    });
    renderModal();
    expect(await screen.findByRole('button', { name: 'Approve (source organisation)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject (source organisation)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /source facility\)/ })).not.toBeInTheDocument();
  });

  it('requires a reason before rejecting and sends the stage', async () => {
    get.mockResolvedValue({ ...base, allowedActions: { ...base.allowedActions, approve: ['SOURCE_FACILITY'], reject: ['SOURCE_FACILITY'] } });
    act.mockResolvedValue({ ...base, status: 'REJECTED', rejectionReason: 'Reserved for a programme' });
    renderModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reject transfer' }));
    expect(await screen.findByText('Give a reason of at least 3 characters')).toBeInTheDocument();
    expect(act).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/Reason for rejection/), 'Reserved for a programme');
    await userEvent.click(screen.getByRole('button', { name: 'Reject transfer' }));
    expect(act).toHaveBeenCalledWith(7, { action: 'reject', stage: 'SOURCE_FACILITY', reason: 'Reserved for a programme' }, { idempotencyKey: '00000000-0000-4000-8000-000000000000' });
  });

  it('receives with per-line damaged quantities that must add up', async () => {
    get.mockResolvedValue({ ...base, status: 'DISPATCHED', allowedActions: { ...base.allowedActions, receive: true } });
    act.mockResolvedValue({ ...base, status: 'RECEIVED' });
    renderModal();
    await userEvent.click(await screen.findByRole('button', { name: 'Receive stock' }));
    const damaged = screen.getByLabelText('Damaged PAR2411-0001');
    await userEvent.clear(damaged);
    await userEvent.type(damaged, '4');
    expect(screen.getByLabelText('Received PAR2411-0001')).toHaveValue(96);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm receipt' }));
    expect(act).toHaveBeenCalledWith(7, { action: 'receive', lines: [{ itemId: 70, received: 96, damaged: 4 }], note: undefined }, expect.anything());
  });
});

describe('fmtInterval', () => {
  it('formats Postgres interval text', () => {
    expect(fmtInterval('05:00:00')).toBe('5 h');
    expect(fmtInterval('2 days 03:00:00')).toBe('2 d 3 h');
    expect(fmtInterval('00:45:00')).toBe('45 min');
    expect(fmtInterval(null)).toBe('');
  });
});
