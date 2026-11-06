/**
 * TanStack Query hooks: the only layer components use to talk to the API.
 * Query keys are centralised so mutations can invalidate precisely.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api';
import type { WriteOpts } from '@/api/services/types';
import type {
  AnalyticsParams,
  AuditListParams,
  BatchListParams,
  BatchStatus,
  CreateMedicineInput,
  CreateStockRequestInput,
  CreateTransferInput,
  CreateUserInput,
  ExpiryListParams,
  FacilityListParams,
  FacilityRole,
  InventoryListParams,
  ListParams,
  MedicineListParams,
  MovementListParams,
  OrgRole,
  ReceiptInput,
  RecommendationListParams,
  ShortageListParams,
  StockActionInput,
  StockPolicyInput,
  StockRequestListParams,
  TransferCommand,
  TransferListParams,
  UserListParams,
} from '@/api/types';

export const qk = {
  dashboard: (facilityId?: number) => ['dashboard', facilityId ?? 'all'] as const,
  facilities: (p?: FacilityListParams) => ['facilities', 'list', p ?? {}] as const,
  facility: (id: number) => ['facilities', 'detail', id] as const,
  facilitySummary: (id: number) => ['facilities', 'summary', id] as const,
  facilitySettings: (id: number, p: ListParams) => ['facilities', 'settings', id, p] as const,
  regions: ['reference', 'regions'] as const,
  organizations: ['reference', 'organizations'] as const,
  medicines: (p: MedicineListParams) => ['medicines', 'list', p] as const,
  medicine: (id: number) => ['medicines', 'detail', id] as const,
  sources: (id: number, dest: number) => ['medicines', 'sources', id, dest] as const,
  categories: ['reference', 'categories'] as const,
  units: ['reference', 'units'] as const,
  substances: (search: string) => ['reference', 'substances', search] as const,
  manufacturers: ['reference', 'manufacturers'] as const,
  batches: (p: BatchListParams) => ['batches', 'list', p] as const,
  batch: (id: number) => ['batches', 'detail', id] as const,
  inventory: (p: InventoryListParams) => ['inventory', 'list', p] as const,
  movements: (p: MovementListParams) => ['inventory', 'movements', p] as const,
  shortages: (p: ShortageListParams) => ['alerts', 'shortages', p] as const,
  expiry: (p: ExpiryListParams) => ['alerts', 'expiry', p] as const,
  expirySummary: (facilityId?: number) => ['alerts', 'expiry-summary', facilityId ?? 'all'] as const,
  notifications: (p: object) => ['notifications', p] as const,
  recommendations: (p: RecommendationListParams) => ['redistribution', p] as const,
  transfers: (p: TransferListParams) => ['transfers', 'list', p] as const,
  transfer: (id: number) => ['transfers', 'detail', id] as const,
  stockRequests: (p: StockRequestListParams) => ['stock-requests', p] as const,
  analytics: (p: AnalyticsParams) => ['analytics', p] as const,
  audit: (p: AuditListParams) => ['audit', p] as const,
  users: (p: UserListParams) => ['users', 'list', p] as const,
  user: (id: number) => ['users', 'detail', id] as const,
  roles: ['reference', 'roles'] as const,
  networkStatus: ['network', 'status'] as const,
  networkQueries: ['network', 'queries'] as const,
  networkGraph: ['network', 'graph'] as const,
  networkDistance: (from: number, to: number) => ['network', 'distance', from, to] as const,
  networkSuppliers: (facilityId: number, medicineId?: number) => ['network', 'suppliers', facilityId, medicineId ?? 'all'] as const,
};

/** Stock-affecting mutations invalidate every view derived from inventory. */
const STOCK_ROOTS = [
  'dashboard',
  'inventory',
  'alerts',
  'redistribution',
  'analytics',
  'medicines',
  'facilities',
  'batches',
  'transfers',
  'stock-requests',
  'notifications',
  'audit',
];

/** Fire-and-forget: the mutation resolves (and its toast shows) without waiting for refetches. */
function useInvalidate() {
  const qc = useQueryClient();
  return (roots: string[]) => {
    for (const r of roots) void qc.invalidateQueries({ queryKey: [r] });
  };
}

const REFERENCE = 10 * 60_000;

/* ---------------------------------- reads --------------------------------- */

export const useDashboardSummary = (facilityId?: number) =>
  useQuery({ queryKey: qk.dashboard(facilityId), queryFn: () => api.dashboard.summary({ facilityId }) });

/** The facility directory (everyone may read it). Defaults to the full list of up to 100. */
export const useFacilities = (p?: FacilityListParams) =>
  useQuery({ queryKey: qk.facilities(p), queryFn: () => api.facilities.list(p), staleTime: 5 * 60_000, placeholderData: keepPreviousData });

/** All facilities as a plain array, for selectors and name lookups. */
export function useFacilityDirectory() {
  const q = useFacilities();
  return { ...q, facilities: q.data?.data ?? [], byId: (id: number | undefined) => q.data?.data.find((f) => f.id === id) };
}

export const useFacility = (id: number) => useQuery({ queryKey: qk.facility(id), queryFn: () => api.facilities.get(id) });

export const useFacilitySummary = (id: number, enabled = true) =>
  useQuery({ queryKey: qk.facilitySummary(id), queryFn: () => api.facilities.summary(id), enabled });

export const useFacilitySettings = (id: number, p: ListParams, enabled = true) =>
  useQuery({ queryKey: qk.facilitySettings(id, p), queryFn: () => api.facilities.settings(id, p), placeholderData: keepPreviousData, enabled });

export const useRegions = () => useQuery({ queryKey: qk.regions, queryFn: () => api.organizations.regions(), staleTime: REFERENCE });

export const useOrganizations = () => useQuery({ queryKey: qk.organizations, queryFn: () => api.organizations.list(), staleTime: REFERENCE });

export const useMedicines = (p: MedicineListParams, enabled = true) =>
  useQuery({ queryKey: qk.medicines(p), queryFn: () => api.medicines.list(p), placeholderData: keepPreviousData, enabled });

export const useMedicine = (id: number) => useQuery({ queryKey: qk.medicine(id), queryFn: () => api.medicines.get(id), enabled: id > 0 });

export const useSources = (medicineId: number | undefined, destinationFacilityId: number | undefined) =>
  useQuery({
    queryKey: qk.sources(medicineId ?? 0, destinationFacilityId ?? 0),
    queryFn: () => api.medicines.sources(medicineId!, destinationFacilityId!),
    enabled: !!medicineId && !!destinationFacilityId,
  });

export const useCategories = () => useQuery({ queryKey: qk.categories, queryFn: () => api.catalogue.categories(), staleTime: REFERENCE });
export const useUnits = () => useQuery({ queryKey: qk.units, queryFn: () => api.catalogue.units(), staleTime: REFERENCE });
export const useManufacturers = () => useQuery({ queryKey: qk.manufacturers, queryFn: () => api.catalogue.manufacturers(), staleTime: REFERENCE });
export const useSubstances = (search: string) =>
  useQuery({ queryKey: qk.substances(search), queryFn: () => api.catalogue.substances(search || undefined), staleTime: REFERENCE, placeholderData: keepPreviousData });

export const useBatches = (p: BatchListParams) =>
  useQuery({ queryKey: qk.batches(p), queryFn: () => api.batches.list(p), placeholderData: keepPreviousData });

export const useBatch = (id: number | undefined) => useQuery({ queryKey: qk.batch(id ?? 0), queryFn: () => api.batches.get(id!), enabled: !!id });

export const useInventory = (p: InventoryListParams, enabled = true) =>
  useQuery({ queryKey: qk.inventory(p), queryFn: () => api.inventory.list(p), placeholderData: keepPreviousData, enabled });

export const useMovements = (p: MovementListParams, enabled = true) =>
  useQuery({ queryKey: qk.movements(p), queryFn: () => api.inventory.movements(p), placeholderData: keepPreviousData, enabled });

export const useShortages = (p: ShortageListParams) =>
  useQuery({ queryKey: qk.shortages(p), queryFn: () => api.alerts.shortages(p), placeholderData: keepPreviousData });

export const useExpiring = (p: ExpiryListParams) =>
  useQuery({ queryKey: qk.expiry(p), queryFn: () => api.alerts.expiry(p), placeholderData: keepPreviousData });

export const useExpirySummary = (facilityId?: number) =>
  useQuery({ queryKey: qk.expirySummary(facilityId), queryFn: () => api.alerts.expirySummary({ facilityId }) });

export const useNotifications = (p: ListParams & { unreadOnly?: 'true' | 'false' }) =>
  useQuery({ queryKey: qk.notifications(p), queryFn: () => api.notifications.list(p), refetchInterval: 60_000 });

export const useRecommendations = (p: RecommendationListParams) =>
  useQuery({ queryKey: qk.recommendations(p), queryFn: () => api.redistribution.recommendations(p), placeholderData: keepPreviousData });

export const useTransfers = (p: TransferListParams) =>
  useQuery({ queryKey: qk.transfers(p), queryFn: () => api.transfers.list(p), placeholderData: keepPreviousData });

export const useTransfer = (id: number | undefined) =>
  useQuery({ queryKey: qk.transfer(id ?? 0), queryFn: () => api.transfers.get(id!), enabled: !!id });

export const useStockRequests = (p: StockRequestListParams) =>
  useQuery({ queryKey: qk.stockRequests(p), queryFn: () => api.stockRequests.list(p), placeholderData: keepPreviousData });

/* The facility network comes from the Neo4j read model, which changes only when it is re-synced. */
export const useNetworkStatus = () => useQuery({ queryKey: qk.networkStatus, queryFn: () => api.network.status() });
export const useNetworkGraph = () => useQuery({ queryKey: qk.networkGraph, queryFn: () => api.network.graph(), staleTime: 60_000 });
export const useNetworkDistance = (from?: number, to?: number) =>
  useQuery({
    queryKey: qk.networkDistance(from ?? 0, to ?? 0),
    queryFn: () => api.network.distance(from!, to!),
    enabled: Boolean(from && to && from !== to),
    staleTime: 60_000,
  });
export const useNetworkSuppliers = (facilityId?: number, medicineId?: number) =>
  useQuery({
    queryKey: qk.networkSuppliers(facilityId ?? 0, medicineId),
    queryFn: () => api.network.suppliers(facilityId!, medicineId),
    enabled: Boolean(facilityId),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

export const useCypherCatalogue = (enabled = true) =>
  useQuery({ queryKey: qk.networkQueries, queryFn: () => api.network.queries(), staleTime: REFERENCE, enabled });

/** Read-only Cypher, run on demand (a mutation so each Run is a fresh request, not a cached read). */
export const useRunCypher = () => useMutation({ mutationFn: (input: { id: string } | { statement: string }) => api.network.runQuery(input) });

export const useAnalytics = (p: AnalyticsParams) =>
  useQuery({ queryKey: qk.analytics(p), queryFn: () => api.analytics.overview(p), placeholderData: keepPreviousData });

export const useAuditLogs = (p: AuditListParams) =>
  useQuery({ queryKey: qk.audit(p), queryFn: () => api.audit.list(p), placeholderData: keepPreviousData });

export const useUsers = (p: UserListParams) => useQuery({ queryKey: qk.users(p), queryFn: () => api.users.list(p), placeholderData: keepPreviousData });

export const useUser = (id: number | undefined) => useQuery({ queryKey: qk.user(id ?? 0), queryFn: () => api.users.get(id!), enabled: !!id });

export const useRoleDefinitions = () => useQuery({ queryKey: qk.roles, queryFn: () => api.users.roles(), staleTime: REFERENCE });

/* -------------------------------- mutations ------------------------------- */

export function useCreateMedicine() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateMedicineInput) => api.medicines.create(input),
    onSuccess: () => invalidate(['medicines', 'reference', 'dashboard', 'audit']),
  });
}

export function useReceiveStock() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ input, opts }: { input: ReceiptInput; opts?: WriteOpts }) => api.inventory.receive(input, opts),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useStockAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ inventoryId, input, opts }: { inventoryId: number; input: StockActionInput; opts?: WriteOpts }) =>
      api.inventory.act(inventoryId, input, opts),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useUpdateStockPolicy() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ facilityId, medicineId, input }: { facilityId: number; medicineId: number; input: StockPolicyInput }) =>
      api.facilities.updateSetting(facilityId, medicineId, input),
    onSuccess: () => invalidate(['facilities', 'alerts', 'dashboard', 'medicines', 'analytics', 'audit']),
  });
}

export function useSetBatchStatus() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, status, reason }: { id: number; status: BatchStatus; reason?: string }) => api.batches.setStatus(id, { status, reason }),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useAcknowledgeAlert() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ kind, alertId }: { kind: 'shortages' | 'expiry'; alertId: number }) => api.alerts.acknowledge(kind, alertId),
    onSuccess: () => invalidate(['alerts', 'dashboard', 'audit']),
  });
}

export function useMarkNotificationRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: number | 'all') => (id === 'all' ? api.notifications.readAll() : api.notifications.read(id)),
    onSuccess: () => invalidate(['notifications', 'dashboard']),
  });
}

export function useRunEngine() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.redistribution.run(), onSuccess: () => invalidate(['redistribution', 'dashboard', 'analytics', 'audit']) });
}

/** Rebuilds the Neo4j graph from PostgreSQL (system administrators only). */
export function useSyncNetwork() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: () => api.network.sync(), onSuccess: () => invalidate(['network', 'audit']) });
}

export function useAcceptRecommendation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, quantity, notes, opts }: { id: number; quantity?: number; notes?: string; opts?: WriteOpts }) =>
      api.redistribution.accept(id, { quantity, notes }, opts),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useDismissRecommendation() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.redistribution.dismiss(id, reason),
    onSuccess: () => invalidate(['redistribution', 'dashboard', 'audit']),
  });
}

export function useCreateTransfer() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ input, opts }: { input: CreateTransferInput; opts?: WriteOpts }) => api.transfers.create(input, opts),
    onSuccess: () => invalidate(STOCK_ROOTS),
  });
}

export function useTransferCommand() {
  const invalidate = useInvalidate();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, command, opts }: { id: number; command: TransferCommand; opts?: WriteOpts }) => api.transfers.act(id, command, opts),
    onSuccess: (detail) => {
      qc.setQueryData(qk.transfer(detail.id), detail);
      invalidate(STOCK_ROOTS);
    },
  });
}

export function useCreateStockRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateStockRequestInput) => api.stockRequests.create(input),
    onSuccess: () => invalidate(['stock-requests', 'dashboard', 'audit', 'notifications']),
  });
}

export function useCancelStockRequest() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.stockRequests.cancel(id, reason),
    onSuccess: () => invalidate(['stock-requests', 'dashboard', 'audit']),
  });
}

export function useCreateUser() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (input: CreateUserInput) => api.users.create(input), onSuccess: () => invalidate(['users', 'audit']) });
}

/** Activate/deactivate, rename, and grant or revoke roles; every change refreshes the user lists. */
export function useUserCommand() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (
      c:
        | { kind: 'update'; id: number; input: { fullName?: string; isActive?: boolean } }
        | { kind: 'grantRole'; id: number; role: OrgRole; organizationId: number | null }
        | { kind: 'revokeRole'; id: number; grantId: number }
        | { kind: 'grantFacilityRole' | 'revokeFacilityRole'; id: number; facilityId: number; role: FacilityRole },
    ) => {
      switch (c.kind) {
        case 'update':
          return api.users.update(c.id, c.input);
        case 'grantRole':
          return api.users.grantRole(c.id, { role: c.role, organizationId: c.organizationId });
        case 'revokeRole':
          return api.users.revokeRole(c.id, c.grantId);
        case 'grantFacilityRole':
          return api.users.grantFacilityRole(c.id, { facilityId: c.facilityId, role: c.role });
        case 'revokeFacilityRole':
          return api.users.revokeFacilityRole(c.id, { facilityId: c.facilityId, role: c.role });
      }
    },
    onSuccess: () => invalidate(['users', 'audit']),
  });
}
