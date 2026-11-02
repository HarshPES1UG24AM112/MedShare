/**
 * Domain types shared by the mock and HTTP service implementations.
 * These mirror the response shapes the frontend expects from Agent 1's API.
 * See docs/API_INTEGRATION.md for the field-by-field contract.
 */

export type ID = string;
/** ISO-8601 timestamp or date string. */
export type ISODate = string;

/* ----------------------------------------------------------------------------
 * Pagination & queries
 * ------------------------------------------------------------------------- */

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export type SortDirection = 'asc' | 'desc';

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: SortDirection;
}

/* ----------------------------------------------------------------------------
 * Auth & users
 * ------------------------------------------------------------------------- */

export type Role = 'ADMIN' | 'FACILITY_MANAGER' | 'PHARMACIST' | 'VIEWER';

export interface User {
  id: ID;
  name: string;
  email: string;
  role: Role;
  /** Null for organisation-wide users (ADMIN). */
  facilityId: ID | null;
  facilityName?: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  facilityId: ID;
  role: Exclude<Role, 'ADMIN'>;
}

/* ----------------------------------------------------------------------------
 * Facilities
 * ------------------------------------------------------------------------- */

export type FacilityType = 'HOSPITAL' | 'COMMUNITY_HEALTH_CENTRE' | 'PRIMARY_HEALTH_CENTRE' | 'WAREHOUSE';

export interface Facility {
  id: ID;
  code: string;
  name: string;
  type: FacilityType;
  address: string;
  city: string;
  district: string;
  latitude: number;
  longitude: number;
  contactName: string;
  contactPhone: string;
  isActive: boolean;
}

export interface FacilitySummary {
  facility: Facility;
  totalUnits: number;
  batchCount: number;
  medicineCount: number;
  criticalShortages: number;
  lowStock: number;
  expiringIn30Days: number;
  expired: number;
}

export interface FacilityRef {
  id: ID;
  name: string;
  code: string;
}

/* ----------------------------------------------------------------------------
 * Medicines
 * ------------------------------------------------------------------------- */

export type DosageForm =
  | 'TABLET'
  | 'CAPSULE'
  | 'SYRUP'
  | 'INJECTION'
  | 'INFUSION'
  | 'INHALER'
  | 'SACHET'
  | 'CREAM';

export interface Medicine {
  id: ID;
  code: string;
  name: string;
  genericName: string;
  category: string;
  dosageForm: DosageForm;
  strength: string;
  unit: string;
  manufacturer: string;
  /** Per-facility units below which stock is "low". */
  reorderThreshold: number;
  /** Per-facility units below which stock is "critical". */
  criticalThreshold: number;
  isEssential: boolean;
  description?: string;
  createdAt: ISODate;
}

export interface MedicineRef {
  id: ID;
  name: string;
  strength: string;
  unit: string;
}

export interface MedicineStockByFacility {
  facility: FacilityRef;
  available: number;
  reserved: number;
  damaged: number;
  batchCount: number;
  nearestExpiry: ISODate | null;
}

export interface MedicineDetail extends Medicine {
  totalAvailable: number;
  stockByFacility: MedicineStockByFacility[];
}

export type CreateMedicineInput = Omit<Medicine, 'id' | 'createdAt'>;

export interface MedicineListParams extends ListParams {
  category?: string;
  dosageForm?: DosageForm;
  essentialOnly?: boolean;
}

/* ----------------------------------------------------------------------------
 * Inventory / batches
 * ------------------------------------------------------------------------- */

export interface Batch {
  id: ID;
  batchNumber: string;
  medicine: MedicineRef;
  facility: FacilityRef;
  manufactureDate: ISODate;
  expiryDate: ISODate;
  quantityAvailable: number;
  quantityReserved: number;
  quantityDamaged: number;
  unitCost: number;
  receivedAt: ISODate;
}

export type BatchStatus = 'EXPIRED' | 'EXPIRING' | 'OK';

export interface BatchListParams extends ListParams {
  facilityId?: ID;
  medicineId?: ID;
  status?: BatchStatus;
}

export interface ReceiveBatchInput {
  facilityId: ID;
  medicineId: ID;
  batchNumber: string;
  manufactureDate: ISODate;
  expiryDate: ISODate;
  quantity: number;
  unitCost: number;
}

/** WRITE_OFF removes expired stock and is recorded as an EXPIRED_WRITE_OFF movement. */
export type AdjustmentType = 'DISPENSE' | 'DAMAGE' | 'CORRECTION' | 'WRITE_OFF';

export interface StockAdjustmentInput {
  type: AdjustmentType;
  /** Positive integer. For CORRECTION the sign is given by `direction`. */
  quantity: number;
  direction?: 'INCREASE' | 'DECREASE';
  reason: string;
}

export type MovementType =
  | 'RECEIPT'
  | 'DISPENSE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'DAMAGE'
  | 'CORRECTION'
  | 'EXPIRED_WRITE_OFF';

export interface InventoryMovement {
  id: ID;
  type: MovementType;
  /** Signed: positive increases available stock, negative decreases it. */
  quantity: number;
  batch: { id: ID; batchNumber: string };
  medicine: MedicineRef;
  facility: FacilityRef;
  performedBy: { id: ID; name: string };
  reference?: string | null;
  note?: string | null;
  createdAt: ISODate;
}

export interface MovementListParams extends ListParams {
  facilityId?: ID;
  medicineId?: ID;
  batchId?: ID;
  type?: MovementType;
}

/* ----------------------------------------------------------------------------
 * Alerts: shortages & expiry
 * ------------------------------------------------------------------------- */

export type ShortageSeverity = 'CRITICAL' | 'LOW';

export interface Shortage {
  id: ID;
  medicine: MedicineRef & { category: string };
  facility: FacilityRef;
  currentStock: number;
  reorderThreshold: number;
  criticalThreshold: number;
  /** Average units consumed per day over the trailing 30 days. */
  avgDailyConsumption: number;
  /** null when consumption is zero (cannot be estimated). */
  daysRemaining: number | null;
  severity: ShortageSeverity;
}

export interface ShortageListParams extends ListParams {
  facilityId?: ID;
  severity?: ShortageSeverity;
}

export type ExpiryWindow = 'expired' | '7' | '30' | '60';

export interface ExpiringBatch extends Batch {
  /** Negative when already expired. */
  daysToExpiry: number;
}

export interface ExpiryListParams extends ListParams {
  facilityId?: ID;
  window: ExpiryWindow;
}

export interface ExpirySummary {
  expired: number;
  within7: number;
  within30: number;
  within60: number;
  /** Units (not batches) at risk within 60 days, excluding expired. */
  unitsAtRisk: number;
}

/* ----------------------------------------------------------------------------
 * Redistribution
 * ------------------------------------------------------------------------- */

export type RecommendationReason = 'NEAR_EXPIRY_SURPLUS' | 'SHORTAGE_COVER' | 'BALANCING';

export interface Recommendation {
  id: ID;
  sourceFacility: FacilityRef;
  destinationFacility: FacilityRef;
  medicine: MedicineRef;
  batch: { id: ID; batchNumber: string; quantityAvailable: number };
  suggestedQuantity: number;
  expiryDate: ISODate;
  distanceKm: number;
  reasonCode: RecommendationReason;
  reason: string;
  /** 0–100, higher is more urgent / more beneficial. */
  priorityScore: number;
}

export interface RecommendationListParams extends ListParams {
  facilityId?: ID;
  reasonCode?: RecommendationReason;
}

/* ----------------------------------------------------------------------------
 * Transfers
 * ------------------------------------------------------------------------- */

export type TransferStatus = 'PENDING' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';

export interface TransferEvent {
  status: TransferStatus;
  at: ISODate;
  by: { id: ID; name: string };
  note?: string | null;
}

export interface Transfer {
  id: ID;
  code: string;
  status: TransferStatus;
  medicine: MedicineRef;
  batch: { id: ID; batchNumber: string; expiryDate: ISODate };
  sourceFacility: FacilityRef;
  destinationFacility: FacilityRef;
  quantity: number;
  notes?: string | null;
  rejectionReason?: string | null;
  recommendationId?: ID | null;
  requestedBy: { id: ID; name: string };
  createdAt: ISODate;
  updatedAt: ISODate;
  history: TransferEvent[];
}

export interface TransferListParams extends ListParams {
  status?: TransferStatus;
  facilityId?: ID;
  direction?: 'incoming' | 'outgoing';
}

export interface CreateTransferInput {
  batchId: ID;
  destinationFacilityId: ID;
  quantity: number;
  notes?: string;
  recommendationId?: ID;
}

export type TransferAction = 'approve' | 'reject' | 'dispatch' | 'receive' | 'cancel';

/* ----------------------------------------------------------------------------
 * Dashboard & analytics
 * ------------------------------------------------------------------------- */

export interface DashboardSummary {
  totalFacilities: number;
  totalMedicines: number;
  totalInventoryUnits: number;
  criticalShortages: number;
  lowStock: number;
  expiringBatches30d: number;
  expiredBatches: number;
  pendingTransfers: number;
}

export interface InventoryDistributionPoint {
  facilityId: ID;
  facilityName: string;
  facilityCode: string;
  available: number;
  reserved: number;
  damaged: number;
}

export interface ExpiryTrendPoint {
  /** YYYY-MM */
  month: string;
  units: number;
  batches: number;
}

export interface ShortageRiskPoint {
  medicineId: ID;
  medicineName: string;
  facilitiesAffected: number;
  criticalCount: number;
  minDaysRemaining: number | null;
}

export interface TransferStatsPoint {
  month: string;
  requested: number;
  received: number;
  rejected: number;
}

export interface MovementTrendPoint {
  month: string;
  inbound: number;
  outbound: number;
  losses: number;
}

export interface CategoryStockPoint {
  category: string;
  units: number;
}

export interface AnalyticsOverview {
  inventoryDistribution: InventoryDistributionPoint[];
  expiryTrend: ExpiryTrendPoint[];
  shortageRisk: ShortageRiskPoint[];
  transferStats: TransferStatsPoint[];
  transferStatusBreakdown: { status: TransferStatus; count: number }[];
  /** received / (received + rejected + cancelled) over the period, 0–1. */
  transferCompletionRate: number;
  movementTrend: MovementTrendPoint[];
  stockByCategory: CategoryStockPoint[];
}

export interface AnalyticsParams {
  facilityId?: ID;
  months?: number;
}

/* ----------------------------------------------------------------------------
 * Audit logs
 * ------------------------------------------------------------------------- */

export type AuditEntity = 'MEDICINE' | 'BATCH' | 'TRANSFER' | 'FACILITY' | 'USER' | 'AUTH';

export interface AuditLog {
  id: ID;
  user: { id: ID; name: string; role: Role };
  action: string;
  entityType: AuditEntity;
  entityId: ID | null;
  description: string;
  facility?: FacilityRef | null;
  timestamp: ISODate;
}

export interface AuditListParams extends ListParams {
  entityType?: AuditEntity;
  action?: string;
  userId?: ID;
  from?: ISODate;
  to?: ISODate;
}
