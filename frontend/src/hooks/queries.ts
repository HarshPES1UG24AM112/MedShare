/**
 * TanStack Query hooks — the only layer components use to talk to the API.
 * Query keys are centralised so mutations can invalidate precisely.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api';
import type {
  AnalyticsParams,
  AuditListParams,
  BatchListParams,
  CreateMedicineInput,
  CreateTransferInput,
  ExpiryListParams,
  MedicineListParams,
  MovementListParams,
  ReceiveBatchInput,
  RecommendationListParams,
  ShortageListParams,
  StockAdjustmentInput,
  TransferAction,
  TransferListParams,
} from '@/api/types';

export const qk = {
  dashboard: (facilityId?: string) => ['dashboard', facilityId ?? 'all'] as const,
  facilities: ['facilities'] as const,
  facility: (id: string) => ['facilities', id] as const,
  facilitySummary: (id: string) => ['facilities', id, 'summary'] as const,
  medicines: (p: MedicineListParams) => ['medicines', 'list', p] as const,
  medicine: (id: string) => ['medicines', 'detail', id] as const,
  categories: ['medicines', 'categories'] as const,
  batches: (p: BatchListParams) => ['inventory', 'batches', p] as const,
  movements: (p: MovementListParams) => ['inventory', 'movements', p] as const,
  shortages: (p: ShortageListParams) => ['alerts', 'shortages', p] as const,
  expiry: (p: ExpiryListParams) => ['alerts', 'expiry', p] as const,
  expirySummary: (facilityId?: string) => ['alerts', 'expiry-summary', facilityId ?? 'all'] as const,
  recommendations: (p: RecommendationListParams) => ['redistribution', p] as const,
  transfers: (p: TransferListParams) => ['transfers', 'list', p] as const,
  transfer: (id: string) => ['transfers', 'detail', id] as const,
  analytics: (p: AnalyticsParams) => ['analytics', p] as const,
  audit: (p: AuditListParams) => ['audit', p] as const,
};

/** Stock-affecting mutations invalidate every view derived from inventory. */
const STOCK_ROOTS = ['dashboard', 'inventory', 'alerts', 'redistribution', 'analytics', 'medicines', 'facilities', 'transfers', 'audit'];

/** Fire-and-forget: the mutation resolves (and its toast shows) without waiting for refetches. */
function useInvalidate() {
  const qc = useQueryClient();
  return (roots: string[]) => {
    for (const r of roots) void qc.invalidateQueries({ queryKey: [r] });
  };
}

/* ---------------------------------- reads --------------------------------- */

export const useDashboardSummary = (facilityId?: string) =>
  useQuery({ queryKey: qk.dashboard(facilityId), queryFn: () => api.dashboard.summary({ facilityId }) });

export const useFacilities = () =>
  useQuery({ queryKey: qk.facilities, queryFn: () => api.facilities.list(), staleTime: 5 * 60_000 });

export const useFacility = (id: string) => useQuery({ queryKey: qk.facility(id), queryFn: () => api.facilities.get(id) });

export const useFacilitySummary = (id: string) =>
  useQuery({ queryKey: qk.facilitySummary(id), queryFn: () => api.facilities.summary(id) });

export const useMedicines = (p: MedicineListParams) =>
  useQuery({ queryKey: qk.medicines(p), queryFn: () => api.medicines.list(p), placeholderData: keepPreviousData });

export const useMedicine = (id: string) => useQuery({ queryKey: qk.medicine(id), queryFn: () => api.medicines.get(id) });

export const useCategories = () =>
  useQuery({ queryKey: qk.categories, queryFn: () => api.medicines.categories(), staleTime: 5 * 60_000 });

export const useBatches = (p: BatchListParams, enabled = true) =>
  useQuery({ queryKey: qk.batches(p), queryFn: () => api.inventory.batches(p), placeholderData: keepPreviousData, enabled });

export const useMovements = (p: MovementListParams, enabled = true) =>
  useQuery({ queryKey: qk.movements(p), queryFn: () => api.inventory.movements(p), placeholderData: keepPreviousData, enabled });

export const useShortages = (p: ShortageListParams) =>
  useQuery({ queryKey: qk.shortages(p), queryFn: () => api.alerts.shortages(p), placeholderData: keepPreviousData });

export const useExpiring = (p: ExpiryListParams) =>
  useQuery({ queryKey: qk.expiry(p), queryFn: () => api.alerts.expiry(p), placeholderData: keepPreviousData });

export const useExpirySummary = (facilityId?: string) =>
  useQuery({ queryKey: qk.expirySummary(facilityId), queryFn: () => api.alerts.expirySummary({ facilityId }) });

export const useRecommendations = (p: RecommendationListParams) =>
  useQuery({ queryKey: qk.recommendations(p), queryFn: () => api.redistribution.recommendations(p), placeholderData: keepPreviousData });

export const useTransfers = (p: TransferListParams) =>
  useQuery({ queryKey: qk.transfers(p), queryFn: () => api.transfers.list(p), placeholderData: keepPreviousData });

export const useTransfer = (id: string | undefined) =>
  useQuery({ queryKey: qk.transfer(id ?? ''), queryFn: () => api.transfers.get(id!), enabled: !!id });

export const useAnalytics = (p: AnalyticsParams) => useQuery({ queryKey: qk.analytics(p), queryFn: () => api.analytics.overview(p) });

export const useAuditLogs = (p: AuditListParams) =>
  useQuery({ queryKey: qk.audit(p), queryFn: () => api.audit.list(p), placeholderData: keepPreviousData });

/* -------------------------------- mutations ------------------------------- */

export function useCreateMedicine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateMedicineInput) => api.medicines.create(input),
    onSuccess: () => invalidate(['medicines', 'dashboard', 'audit']),
  });
}

export function useReceiveBatch() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: ReceiveBatchInput) => api.inventory.receive(input), onSuccess: () => invalidate(STOCK_ROOTS) });
}

export function useAdjustStock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ batchId, input }: { batchId: string; input: StockAdjustmentInput }) => api.inventory.adjust(batchId, input),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useCreateTransfer() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateTransferInput) => api.transfers.create(input), onSuccess: () => invalidate(STOCK_ROOTS) });
}

export function useTransferAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, action, reason, note }: { id: string; action: TransferAction; reason?: string; note?: string }) =>
      api.transfers.act(id, action, { reason, note }),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}
