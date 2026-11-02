import type {
  AnalyticsOverview,
  AnalyticsParams,
  AuditListParams,
  AuditLog,
  BatchDetail,
  Batch,
  BatchListParams,
  BatchStatus,
  Category,
  CreateMedicineInput,
  CreateStockRequestInput,
  CreateTransferInput,
  CreateUserInput,
  DashboardSummary,
  ExpiringRow,
  ExpiryListParams,
  ExpirySummary,
  Facility,
  FacilityListParams,
  FacilityRole,
  FacilitySummary,
  InventoryListParams,
  InventoryRow,
  ListParams,
  LoginInput,
  LoginResponse,
  Manufacturer,
  Me,
  MedicineDetail,
  Medicine,
  MedicineListParams,
  Movement,
  MovementListParams,
  NotificationPage,
  OrgRole,
  Organization,
  Paginated,
  ReceiptInput,
  Recommendation,
  RecommendationListParams,
  Region,
  RoleDefinition,
  Shortage,
  ShortageListParams,
  SourceOption,
  StockActionInput,
  StockPolicy,
  StockPolicyInput,
  StockRequest,
  StockRequestListParams,
  Substance,
  TransferCommand,
  TransferDetail,
  TransferListParams,
  TransferSummary,
  Unit,
  UserDetail,
  UserListParams,
  UserRow,
} from '../types';

/** Optional Idempotency-Key for a write; one is generated when omitted. */
export type WriteOpts = { idempotencyKey?: string };

/**
 * The service contract components and hooks depend on. The only implementation is
 * the HTTP client in ./http.ts (tests replace it with vi.mock).
 */
export interface MedShareApi {
  auth: {
    login(input: LoginInput): Promise<LoginResponse>;
    me(): Promise<Me>;
    changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  };
  users: {
    list(params: UserListParams): Promise<Paginated<UserRow>>;
    get(id: number): Promise<UserDetail>;
    create(input: CreateUserInput): Promise<UserDetail>;
    update(id: number, input: { fullName?: string; isActive?: boolean }): Promise<UserDetail>;
    grantRole(id: number, input: { role: OrgRole; organizationId: number | null }): Promise<UserDetail>;
    revokeRole(id: number, grantId: number): Promise<UserDetail>;
    grantFacilityRole(id: number, input: { facilityId: number; role: FacilityRole }): Promise<UserDetail>;
    revokeFacilityRole(id: number, input: { facilityId: number; role: FacilityRole }): Promise<UserDetail>;
    roles(): Promise<RoleDefinition[]>;
  };
  organizations: {
    regions(): Promise<Region[]>;
    list(): Promise<Organization[]>;
  };
  facilities: {
    list(params?: FacilityListParams): Promise<Paginated<Facility>>;
    get(id: number): Promise<Facility>;
    summary(id: number): Promise<FacilitySummary>;
    settings(id: number, params: ListParams): Promise<Paginated<StockPolicy>>;
    updateSetting(id: number, medicineId: number, input: StockPolicyInput): Promise<StockPolicy>;
  };
  medicines: {
    list(params: MedicineListParams): Promise<Paginated<Medicine>>;
    get(id: number): Promise<MedicineDetail>;
    create(input: CreateMedicineInput): Promise<MedicineDetail>;
    sources(id: number, destinationFacilityId: number): Promise<SourceOption[]>;
  };
  catalogue: {
    categories(): Promise<Category[]>;
    units(): Promise<Unit[]>;
    substances(search?: string): Promise<Substance[]>;
    manufacturers(): Promise<Manufacturer[]>;
  };
  batches: {
    list(params: BatchListParams): Promise<Paginated<Batch>>;
    get(id: number): Promise<BatchDetail>;
    setStatus(id: number, input: { status: BatchStatus; reason?: string }): Promise<BatchDetail>;
  };
  inventory: {
    list(params: InventoryListParams): Promise<Paginated<InventoryRow>>;
    movements(params: MovementListParams): Promise<Paginated<Movement>>;
    receive(input: ReceiptInput, opts?: WriteOpts): Promise<InventoryRow>;
    act(inventoryId: number, input: StockActionInput, opts?: WriteOpts): Promise<InventoryRow>;
  };
  alerts: {
    shortages(params: ShortageListParams): Promise<Paginated<Shortage>>;
    expiry(params: ExpiryListParams): Promise<Paginated<ExpiringRow>>;
    expirySummary(params: { facilityId?: number }): Promise<ExpirySummary>;
    acknowledge(kind: 'shortages' | 'expiry', alertId: number): Promise<void>;
  };
  notifications: {
    list(params: ListParams & { unreadOnly?: 'true' | 'false' }): Promise<NotificationPage>;
    read(id: number): Promise<void>;
    readAll(): Promise<void>;
  };
  redistribution: {
    recommendations(params: RecommendationListParams): Promise<Paginated<Recommendation>>;
    run(): Promise<{ generated: number }>;
    accept(id: number, input: { quantity?: number; notes?: string }, opts?: WriteOpts): Promise<{ transferId: number; recommendationId: number }>;
    dismiss(id: number, reason: string): Promise<unknown>;
  };
  transfers: {
    list(params: TransferListParams): Promise<Paginated<TransferSummary>>;
    get(id: number): Promise<TransferDetail>;
    create(input: CreateTransferInput, opts?: WriteOpts): Promise<TransferDetail>;
    act(id: number, command: TransferCommand, opts?: WriteOpts): Promise<TransferDetail>;
  };
  stockRequests: {
    list(params: StockRequestListParams): Promise<Paginated<StockRequest>>;
    create(input: CreateStockRequestInput): Promise<StockRequest>;
    cancel(id: number, reason: string): Promise<StockRequest>;
  };
  dashboard: {
    summary(params: { facilityId?: number }): Promise<DashboardSummary>;
  };
  analytics: {
    overview(params: AnalyticsParams): Promise<AnalyticsOverview>;
  };
  audit: {
    list(params: AuditListParams): Promise<Paginated<AuditLog>>;
  };
}
