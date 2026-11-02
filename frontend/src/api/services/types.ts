import type {
  AnalyticsOverview,
  AnalyticsParams,
  AuditListParams,
  AuditLog,
  AuthResponse,
  Batch,
  BatchListParams,
  CreateMedicineInput,
  CreateTransferInput,
  DashboardSummary,
  ExpiringBatch,
  ExpiryListParams,
  ExpirySummary,
  Facility,
  FacilitySummary,
  InventoryMovement,
  LoginInput,
  Medicine,
  MedicineDetail,
  MedicineListParams,
  MovementListParams,
  Paginated,
  ReceiveBatchInput,
  Recommendation,
  RecommendationListParams,
  RegisterInput,
  Shortage,
  ShortageListParams,
  StockAdjustmentInput,
  Transfer,
  TransferAction,
  TransferListParams,
  User,
} from '../types';

/**
 * The contract every service implementation satisfies.
 * Components and hooks depend on this interface only — never on mock or HTTP code directly.
 */
export interface MedShareApi {
  auth: {
    login(input: LoginInput): Promise<AuthResponse>;
    register(input: RegisterInput): Promise<AuthResponse>;
    me(): Promise<User>;
  };
  dashboard: {
    summary(params: { facilityId?: string }): Promise<DashboardSummary>;
  };
  facilities: {
    list(): Promise<Facility[]>;
    get(id: string): Promise<Facility>;
    summary(id: string): Promise<FacilitySummary>;
  };
  medicines: {
    list(params: MedicineListParams): Promise<Paginated<Medicine>>;
    categories(): Promise<string[]>;
    get(id: string): Promise<MedicineDetail>;
    create(input: CreateMedicineInput): Promise<Medicine>;
  };
  inventory: {
    batches(params: BatchListParams): Promise<Paginated<Batch>>;
    receive(input: ReceiveBatchInput): Promise<Batch>;
    adjust(batchId: string, input: StockAdjustmentInput): Promise<Batch>;
    movements(params: MovementListParams): Promise<Paginated<InventoryMovement>>;
  };
  alerts: {
    shortages(params: ShortageListParams): Promise<Paginated<Shortage>>;
    expiry(params: ExpiryListParams): Promise<Paginated<ExpiringBatch>>;
    expirySummary(params: { facilityId?: string }): Promise<ExpirySummary>;
  };
  redistribution: {
    recommendations(params: RecommendationListParams): Promise<Paginated<Recommendation>>;
  };
  transfers: {
    list(params: TransferListParams): Promise<Paginated<Transfer>>;
    get(id: string): Promise<Transfer>;
    create(input: CreateTransferInput): Promise<Transfer>;
    act(id: string, action: TransferAction, body?: { reason?: string; note?: string }): Promise<Transfer>;
  };
  analytics: {
    overview(params: AnalyticsParams): Promise<AnalyticsOverview>;
  };
  audit: {
    list(params: AuditListParams): Promise<Paginated<AuditLog>>;
  };
}
