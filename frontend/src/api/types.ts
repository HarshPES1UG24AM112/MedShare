/**
 * Types for the MedShare REST API (v1). Source of truth: API_CONTRACT.md at the repo root.
 * IDs are integers, keys are camelCase, calendar dates are "YYYY-MM-DD", timestamps ISO-8601.
 */

/* ---------------------------------- common --------------------------------- */

export type SortDirection = 'asc' | 'desc';

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

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortDir?: SortDirection;
}

/** Compact reference used for facilities inside transfers, recommendations and stock requests. */
export interface FacilityRef {
  id: number;
  code: string;
  name: string;
}

export interface PersonRef {
  id: number;
  name: string;
}

/* ------------------------------- enumerations ------------------------------ */

export type Role = 'SYSTEM_ADMIN' | 'ORG_ADMIN' | 'FACILITY_MANAGER' | 'INVENTORY_MANAGER' | 'AUDITOR';
export type OrgRole = 'SYSTEM_ADMIN' | 'ORG_ADMIN' | 'AUDITOR';
export type FacilityRole = 'FACILITY_MANAGER' | 'INVENTORY_MANAGER';

export type Permission =
  | 'audit:read'
  | 'batch:manage'
  | 'catalogue:manage'
  | 'facility:manage'
  | 'inventory:read'
  | 'inventory:write'
  | 'organization:manage'
  | 'recommendation:manage'
  | 'report:read'
  | 'request:create'
  | 'settings:manage'
  | 'transfer:approve'
  | 'transfer:approve_org'
  | 'transfer:dispatch'
  | 'transfer:receive'
  | 'transfer:request'
  | 'user:manage';

export type FacilityType = 'HOSPITAL' | 'COMMUNITY_HEALTH_CENTRE' | 'PRIMARY_HEALTH_CENTRE' | 'PHARMACY' | 'WAREHOUSE';
export type DosageForm = 'TABLET' | 'CAPSULE' | 'SYRUP' | 'SUSPENSION' | 'INJECTION' | 'INFUSION' | 'INHALER' | 'SACHET' | 'CREAM' | 'DROPS';
export type BatchStatus = 'ACTIVE' | 'QUARANTINED' | 'RECALLED';
export type ExpiryBucket = 'EXPIRED' | 'WITHIN_7_DAYS' | 'WITHIN_30_DAYS' | 'WITHIN_60_DAYS' | 'HEALTHY';
export type MovementType =
  | 'RECEIPT'
  | 'DISPENSE'
  | 'RESERVE'
  | 'RELEASE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'TRANSIT_DAMAGE'
  | 'DAMAGE'
  | 'DISPOSAL'
  | 'EXPIRY_WRITE_OFF'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';
export type ShortageSeverity = 'CRITICAL' | 'LOW';
export type StockStatus = 'CRITICAL' | 'LOW' | 'OK';
export type DemandBasis = 'MEASURED' | 'ESTIMATED_SIMULATED' | 'ESTIMATED_CONFIGURED';
export type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type TransferStatus = 'PENDING' | 'APPROVED' | 'DISPATCHED' | 'RECEIVED' | 'REJECTED' | 'CANCELLED';
export type ApprovalStage = 'SOURCE_FACILITY' | 'SOURCE_ORGANIZATION';
export type RecommendationReason = 'SHORTAGE_COVER' | 'NEAR_EXPIRY_SURPLUS';
export type RecommendationStatus = 'OPEN' | 'ACCEPTED' | 'DISMISSED' | 'SUPERSEDED';
export type RequestPriority = 'ROUTINE' | 'URGENT' | 'EMERGENCY';
export type StockRequestStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';
export type ExpiryWindow = 'expired' | '7' | '30' | '60';
export type StrengthUom = 'mg' | 'mcg' | 'g' | 'IU' | 'mL' | '%' | 'mg/mL' | 'mg/5mL' | 'IU/mL' | 'mcg/dose' | 'g/L';

/* ----------------------------------- auth ---------------------------------- */

export interface Me {
  id: number;
  email: string;
  fullName: string;
  roles: { role: OrgRole; organizationId: number | null; organizationName: string | null }[];
  facilities: { facilityId: number; facilityCode: string; facilityName: string; role: FacilityRole }[];
  scopeFacilityIds: number[];
  platformScope: boolean;
  permissions: Permission[];
  /** Keyed by facility id (JSON object keys are strings). For showing/hiding controls only. */
  facilityPermissions: Record<string, Permission[]>;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: string | number;
  user: Me;
}

/* ---------------------------------- users ---------------------------------- */

export interface UserRow {
  id: number;
  email: string;
  fullName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Role[];
  facilityCodes: string | null;
}

export interface UserDetail {
  id: number;
  email: string;
  fullName: string;
  isActive: boolean;
  isSynthetic?: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { grantId: number; role: OrgRole; organizationId: number | null; organizationName: string | null }[];
  facilities: { facilityId: number; facilityCode: string; facilityName: string; role: FacilityRole }[];
}

export interface UserListParams extends ListParams {
  role?: Role;
  facilityId?: number;
  organizationId?: number;
  active?: 'true' | 'false';
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  password: string;
  roles?: { role: OrgRole; organizationId: number | null }[];
  facilities?: { facilityId: number; role: FacilityRole }[];
}

export interface RoleDefinition {
  code: Role;
  name: string;
  grantLevel: 'PLATFORM' | 'ORGANIZATION' | 'PLATFORM_OR_ORGANIZATION' | 'FACILITY';
  description: string;
  permissions: Permission[];
}

/* ------------------------- organisations & facilities ---------------------- */

export interface Region {
  id: number;
  parentId: number | null;
  code: string;
  name: string;
  depth: number;
  level: 'STATE' | 'DISTRICT' | 'TALUK';
  path: string;
}

export interface Organization {
  id: number;
  name: string;
  orgType: string;
  registrationNumber: string;
  contactEmail: string | null;
  isActive: boolean;
  isSynthetic: boolean;
  facilityCount: number;
}

export interface Facility {
  id: number;
  code: string;
  name: string;
  facilityType: FacilityType;
  organizationId: number;
  organizationName: string;
  regionId: number;
  regionPath: string;
  regionName: string;
  addressLine: string | null;
  latitude: number;
  longitude: number;
  hasColdChain: boolean;
  maxDispatchRadiusKm: number;
  contactPhone: string | null;
  isActive: boolean;
  isSynthetic: boolean;
  inScope: boolean;
}

export interface FacilityListParams extends ListParams {
  type?: FacilityType;
  organizationId?: number;
  regionId?: number;
}

export interface FacilitySummary {
  facilityId: number;
  code: string;
  name: string;
  facilityType: FacilityType;
  organizationId: number;
  organizationName: string;
  regionPath: string;
  usableUnits: number;
  reservedUnits: number;
  damagedUnits: number;
  usableValue: number;
  medicinesInStock: number;
  batchesOnHand: number;
  expiredBatches: number;
  expiring30dBatches: number;
  criticalShortages: number;
  lowStock: number;
}

export interface StockPolicy {
  medicineId: number;
  medicineCode: string;
  medicineName: string;
  strengthLabel: string;
  minStockLevel: number;
  reorderThreshold: number;
  safetyStock: number;
  estimatedDailyConsumption: number;
  estimateIsSimulated: boolean;
  measuredDailyConsumption: number | null;
  dailyRate: number | null;
  demandBasis: DemandBasis;
  possiblyCensored: boolean;
  usable: number;
  daysOfInventory: number | null;
  stockStatus: StockStatus;
  updatedAt: string;
}

export interface StockPolicyInput {
  minStockLevel: number;
  reorderThreshold: number;
  safetyStock: number;
  estimatedDailyConsumption: number;
  estimateIsSimulated?: boolean;
}

/* --------------------------------- catalogue -------------------------------- */

export interface Medicine {
  id: number;
  code: string;
  name: string;
  strengthLabel: string;
  displayName: string;
  dosageForm: DosageForm;
  unitVolumeMl: number | null;
  unit: string;
  categoryId: number;
  category: string;
  categoryPath: string;
  requiresColdChain: boolean;
  isEssential: boolean;
  isActive: boolean;
  description: string | null;
  substances: string;
  networkUsable: number;
  facilitiesHolding: number;
  facilitiesShort: number;
  nearestExpiry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Ingredient {
  substanceId: number;
  substance: string;
  strengthValue: number;
  strengthUom: StrengthUom;
}

export interface MedicineFacilityStock {
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  usable: number;
  reserved: number;
  damaged: number;
  expiredOnHand: number | null;
  batchesOnHand: number;
  nearestUsableExpiry: string | null;
  reorderThreshold: number | null;
  minStockLevel: number | null;
  stockStatus: StockStatus | null;
  daysOfInventory: number | null;
}

export interface MedicineDetail extends Medicine {
  ingredients: Ingredient[];
  manufacturers: { id: number; name: string }[];
  stockByFacility: MedicineFacilityStock[];
}

export interface MedicineListParams extends ListParams {
  categoryId?: number;
  dosageForm?: DosageForm;
  essential?: 'true' | 'false';
  coldChain?: 'true' | 'false';
  manufacturerId?: number;
  active?: 'true' | 'false';
}

export interface IngredientInput {
  substanceId?: number;
  substanceName?: string;
  strengthValue: number;
  strengthUom: StrengthUom;
}

export interface CreateMedicineInput {
  code?: string;
  name: string;
  dosageForm: DosageForm;
  unitVolumeMl?: number;
  categoryId: number;
  dispensingUnitId: number;
  requiresColdChain?: boolean;
  isEssential?: boolean;
  description?: string;
  ingredients: IngredientInput[];
}

export interface Category {
  id: number;
  parentId: number | null;
  name: string;
  depth: number;
  path: string;
  medicineCount: number;
}

export interface Unit {
  id: number;
  code: string;
  name: string;
}

export interface Substance {
  id: number;
  name: string;
  medicineCount: number;
}

export interface Manufacturer {
  id: number;
  name: string;
  licenseNumber: string;
  country: string;
  isSynthetic: boolean;
  batchCount: number;
}

/** One sourcing option returned by GET /medicines/:id/sources. */
export interface SourceOption {
  inventoryId: number;
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  daysToExpiry: number;
  qtyAvailable: number;
  facility: FacilityRef;
  distanceKm: number | null;
  crossOrganization: boolean;
  sourceStockStatus: StockStatus;
}

/* ---------------------------------- batches --------------------------------- */

export interface Batch {
  id: number;
  batchNumber: string;
  medicineId: number;
  medicineCode: string;
  medicineName: string;
  strengthLabel: string;
  manufacturerId: number;
  manufacturer: string;
  manufactureDate: string;
  expiryDate: string;
  daysToExpiry: number;
  expiryBucket: ExpiryBucket;
  unitCost: number;
  status: BatchStatus;
  statusReason: string | null;
  networkOnHand: number;
  facilitiesHolding: number;
  createdAt: string;
}

export interface BatchHolding {
  inventoryId: number;
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  qtyAvailable: number;
  qtyReserved: number;
  qtyDamaged: number;
  updatedAt: string;
}

export interface BatchDetail extends Batch {
  holdings: BatchHolding[];
}

export interface BatchListParams extends ListParams {
  medicineId?: number;
  manufacturerId?: number;
  status?: BatchStatus;
  expiryBucket?: ExpiryBucket;
  onHandOnly?: 'true' | 'false';
}

/* --------------------------------- inventory -------------------------------- */

export interface InventoryRow {
  inventoryId: number;
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  organizationId: number;
  batchId: number;
  batchNumber: string;
  medicineId: number;
  medicineCode: string;
  medicineName: string;
  manufacturer: string;
  manufactureDate: string;
  expiryDate: string;
  unitCost: number;
  batchStatus: BatchStatus;
  qtyAvailable: number;
  qtyReserved: number;
  qtyDamaged: number;
  updatedAt: string;
  daysToExpiry: number;
  expiryBucket: ExpiryBucket;
  isUsable: boolean;
  availableValue: number;
}

export interface InventoryListParams extends ListParams {
  facilityId?: number;
  medicineId?: number;
  batchId?: number;
  expiryBucket?: ExpiryBucket;
  batchStatus?: BatchStatus;
  onHandOnly?: 'true' | 'false';
}

export interface Movement {
  id: number;
  createdAt: string;
  movementType: MovementType;
  movementDescription: string;
  quantity: number;
  deltaAvailable: number;
  deltaReserved: number;
  deltaDamaged: number;
  inventoryId: number;
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  batchId: number;
  batchNumber: string;
  medicineId: number;
  medicineName: string;
  strengthLabel: string;
  reason: string | null;
  reference: string | null;
  transferItemId: number | null;
  transferId: number | null;
  transferCode: string | null;
  performedBy: number | null;
  performedByName: string | null;
}

export interface MovementListParams extends ListParams {
  facilityId?: number;
  medicineId?: number;
  batchId?: number;
  inventoryId?: number;
  type?: MovementType;
  from?: string;
  to?: string;
}

export interface ReceiptInput {
  facilityId: number;
  medicineId: number;
  manufacturerId: number;
  batchNumber: string;
  manufactureDate: string;
  expiryDate: string;
  unitCost: number;
  quantity: number;
  reference?: string;
}

export type StockAction = 'dispense' | 'damage' | 'dispose' | 'write-off' | 'adjust';

export type StockActionInput =
  | { action: 'dispense'; quantity: number; reference?: string }
  | { action: 'damage'; quantity: number; reason: string }
  | { action: 'dispose'; quantity: number; reason: string }
  | { action: 'write-off'; quantity?: number; reason?: string }
  | { action: 'adjust'; delta: number; reason: string };

/* ---------------------------------- alerts ---------------------------------- */

export interface Shortage {
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  medicineId: number;
  medicineCode: string;
  medicineName: string;
  strengthLabel: string;
  severity: ShortageSeverity;
  currentStock: number;
  minStockLevel: number;
  reorderThreshold: number;
  safetyStock: number;
  avgDailyConsumption: number | null;
  demandBasis: DemandBasis;
  possiblyCensored: boolean;
  daysRemaining: number | null;
  deficit: number;
  coverage: number;
  alertId: number | null;
  alertStatus: AlertStatus | null;
  detectedAt: string | null;
  acknowledgedAt: string | null;
}

export interface ShortageListParams extends ListParams {
  facilityId?: number;
  severity?: ShortageSeverity;
  medicineId?: number;
}

export interface ExpiringRow extends InventoryRow {
  valueAtRisk: number;
  alertId: number | null;
}

export interface ExpiryListParams extends ListParams {
  facilityId?: number;
  window?: ExpiryWindow;
}

export interface ExpirySummary {
  expired: number;
  within7: number;
  within30: number;
  within60: number;
  unitsAtRisk: number;
  valueAtRisk: number;
  expiredValue: number;
}

export interface Notification {
  id: number;
  category: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage extends Paginated<Notification> {
  unreadCount: number;
}

/* ------------------------------ redistribution ------------------------------ */

export interface Recommendation {
  id: number;
  generatedAt: string;
  reasonCode: RecommendationReason;
  status: RecommendationStatus;
  recommendedQuantity: number;
  projectedShortageReduction: number;
  priorityScore: number;
  explanation: string;
  sourceInventoryId: number;
  sourceFacility: FacilityRef;
  destinationFacility: FacilityRef;
  medicine: { id: number; code: string; name: string; strengthLabel: string };
  batch: { id: number; batchNumber: string; expiryDate: string; quantityAvailable: number };
  expiryDate: string;
  daysToExpiry: number;
  distanceKm: number | null;
  crossOrganization: boolean;
  stale: boolean;
}

export interface RecommendationListParams extends ListParams {
  facilityId?: number;
  reasonCode?: RecommendationReason;
  status?: RecommendationStatus;
}

/* --------------------------------- transfers -------------------------------- */

export interface TransferSummary {
  id: number;
  code: string;
  status: TransferStatus;
  createdAt: string;
  updatedAt: string;
  sourceFacility: FacilityRef;
  destinationFacility: FacilityRef;
  crossOrganization: boolean;
  requestedBy: PersonRef;
  requestNotes: string | null;
  rejectionReason: string | null;
  recommendationId: number | null;
  itemCount: number;
  totalUnits: number;
  medicines: string;
}

export interface TransferItem {
  id: number;
  batchId: number;
  batchNumber: string;
  expiryDate: string;
  batchStatus: BatchStatus;
  daysToExpiry: number;
  medicineId: number;
  medicineCode: string;
  medicineName: string;
  strengthLabel: string;
  unit: string;
  quantity: number;
  quantityReceived: number | null;
  quantityDamagedInTransit: number | null;
  sourceAvailable: number;
  sourceReserved: number;
  stockRequestItemId: number | null;
  stockRequestId: number | null;
}

export interface TransferApproval {
  stage: ApprovalStage;
  decision: 'APPROVED' | 'REJECTED';
  comment: string | null;
  decidedAt: string;
  decidedBy: PersonRef;
}

export interface TransferTimelineEntry {
  step: number;
  fromStatus: TransferStatus | null;
  toStatus: TransferStatus;
  note: string | null;
  changedAt: string;
  /** Postgres interval text, e.g. "05:00:00" or "2 days 03:00:00"; null for the current state. */
  timeInState: string | null;
  changedBy: PersonRef | null;
}

export interface AllowedActions {
  approve: ApprovalStage[];
  reject: ApprovalStage[];
  cancel: boolean;
  dispatch: boolean;
  receive: boolean;
}

export interface TransferDetail extends TransferSummary {
  requiredStages: ApprovalStage[];
  items: TransferItem[];
  approvals: TransferApproval[];
  timeline: TransferTimelineEntry[];
  allowedActions: AllowedActions;
}

export interface TransferListParams extends ListParams {
  status?: TransferStatus;
  facilityId?: number;
  direction?: 'incoming' | 'outgoing';
  actionable?: 'true';
}

export interface CreateTransferInput {
  sourceFacilityId: number;
  destinationFacilityId: number;
  items: { batchId: number; quantity: number; stockRequestItemId?: number }[];
  notes?: string;
}

export type TransferCommand =
  | { action: 'approve'; stage?: ApprovalStage; comment?: string }
  | { action: 'reject'; stage?: ApprovalStage; reason: string }
  | { action: 'cancel'; reason: string }
  | { action: 'dispatch'; note?: string }
  | { action: 'receive'; lines?: { itemId: number; received: number; damaged: number }[]; note?: string };

/* ------------------------------ stock requests ------------------------------ */

export interface StockRequestItem {
  id: number;
  medicineId: number;
  medicineName: string;
  strengthLabel: string;
  quantityRequested: number;
  quantityReceived: number;
  quantityInProgress: number;
}

export interface StockRequest {
  id: number;
  code: string;
  status: StockRequestStatus;
  priority: RequestPriority;
  neededBy: string | null;
  notes: string | null;
  createdAt: string;
  closedAt: string | null;
  facility: FacilityRef;
  requestedBy: PersonRef;
  items: StockRequestItem[];
}

export interface StockRequestListParams extends ListParams {
  status?: StockRequestStatus;
  facilityId?: number;
  priority?: RequestPriority;
}

export interface CreateStockRequestInput {
  facilityId: number;
  priority?: RequestPriority;
  neededBy?: string;
  notes?: string;
  items: { medicineId: number; quantity: number }[];
}

/* --------------------------- dashboard & analytics -------------------------- */

export interface DashboardSummary {
  totalFacilities: number;
  registeredMedicines: number;
  medicinesInStock: number;
  totalInventoryUnits: number;
  criticalShortages: number;
  lowStock: number;
  expiringBatches30d: number;
  expiredBatchesOnHand: number;
  pendingTransfers: number;
  awaitingDispatch: number;
  inTransit: number;
  openRecommendations: number;
  openStockRequests: number;
  unreadNotifications: number;
  scope: string;
}

export interface InventoryDistributionPoint {
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  organizationName: string;
  available: number;
  reserved: number;
  damaged: number;
}
export interface ExpiryTrendPoint {
  month: string;
  units: number;
  batches: number;
  value: number;
}
export interface ShortageRiskPoint {
  medicineId: number;
  medicineName: string;
  facilitiesAffected: number;
  criticalCount: number;
  minDaysRemaining: number | null;
  totalDeficit: number;
}
export interface RecurringShortagePoint {
  facilityId: number;
  facilityCode: string;
  facilityName: string;
  alerts: number;
  medicines: number;
  critical: number;
  rank: number;
}
export interface TransferStatsPoint {
  month: string;
  requested: number;
  received: number;
  rejectedOrCancelled: number;
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
  medicines: number;
}
export interface RegionAvailabilityPoint {
  regionId: number;
  region: string;
  level: Region['level'];
  depth: number;
  path: string;
  facilities: number;
  usableUnits: number;
  criticalShortages: number;
}
export interface ExpiryRiskPoint {
  medicineId: number;
  medicineName: string;
  units: number;
  value: number;
  soonestDays: number;
  batches: number;
}
export interface WastagePoint {
  movementType: MovementType;
  units: number;
  value: number;
}
export interface TopConsumedPoint {
  medicineId: number;
  medicineName: string;
  month: string;
  units: number;
  /** Units consumed minus the previous month's units; null when there is no previous month. */
  changeVsPrevious: number | null;
}

export interface AnalyticsOverview {
  inventoryDistribution: InventoryDistributionPoint[];
  expiryTrend: ExpiryTrendPoint[];
  shortageRisk: ShortageRiskPoint[];
  recurringShortages: RecurringShortagePoint[];
  transferStats: TransferStatsPoint[];
  transferStatusBreakdown: { status: TransferStatus; count: number }[];
  transferTiming: { received: number; closed: number; avgLeadTimeHours: number | null };
  transferCompletionRate: number | null;
  movementTrend: MovementTrendPoint[];
  stockByCategory: CategoryStockPoint[];
  availabilityByRegion: RegionAvailabilityPoint[];
  expiryRisk: ExpiryRiskPoint[];
  wastage: WastagePoint[];
  redistribution: {
    openRecommendations: number;
    units: number;
    shortageUnitsCovered: number;
    shortagesAddressed: number;
    nearExpiryValueRescuable: number;
  };
  monthlyConsumption: { month: string; units: number; events: number }[];
  topConsumedLastMonth: TopConsumedPoint[];
  demandBasis: { demandBasis: DemandBasis; policies: number }[];
  meta: { months: number; scope: string; generatedAt: string; synthetic: boolean; note: string; consistency: string };
}

export interface AnalyticsParams {
  facilityId?: number;
  months?: number;
  medicineId?: number;
}

/* ----------------------------------- audit ---------------------------------- */

export interface AuditLog {
  id: number;
  occurredAt: string;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
  actor: { id: number; name: string; email: string } | null;
  facility: FacilityRef | null;
}

export interface AuditListParams extends ListParams {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: number;
  facilityId?: number;
  from?: string;
  to?: string;
}

/* ------------------------------------------------- network (Neo4j graph) ---- */

export interface NetworkStatus {
  configured: boolean;
  reachable: boolean;
  syncedAt?: string | null;
  source?: string | null;
  nodes?: Record<string, number>;
  relationships?: Record<string, number>;
  error?: string;
}

export interface NetworkFacility {
  id: number;
  code: string;
  name: string;
  type: FacilityType;
  lat: number;
  lon: number;
  coldChain: boolean;
  radiusKm: number;
  active: boolean;
  organizationId: number;
  regionName: string;
  /** Facilities that may supply this one / this one may supply. */
  suppliers: number;
  canSupply: number;
  /** null outside the user's facility scope. */
  criticalShortages: number | null;
  lowShortages: number | null;
}

export interface NetworkGraph {
  syncedAt: string;
  source: string;
  facilities: NetworkFacility[];
  organisations: { id: number; name: string; type: string }[];
  /** Ordered pairs a transfer request would accept (inside the source's dispatch radius, legal route). */
  supplyLinks: { source: number; destination: number; km: number; sameOrg: boolean }[];
  /** Every pair once; distance is symmetric. */
  roads: { a: number; b: number; km: number }[];
  /** Completed deliveries per direction, limited to the user's scope. */
  corridors: { source: number; destination: number; transfers: number; units: number; lastReceivedAt: string }[];
}

export interface NetworkFacilityRef {
  id: number;
  code: string;
  name: string;
}

export interface NetworkDistance {
  from: NetworkFacilityRef;
  to: NetworkFacilityRef;
  routedKm: number;
  straightLineKm: number;
  fromCanSupplyTo: boolean;
  toCanSupplyFrom: boolean;
  supplyChain: { facilities: NetworkFacilityRef[]; hops: number; km: number } | null;
}

export interface NetworkSupplier extends NetworkFacilityRef {
  type: FacilityType;
  coldChain: boolean;
  organizationName: string;
  km: number;
  sameOrg: boolean;
  usable: number | null;
  nearestExpiry: string | null;
}

export interface NetworkSuppliers {
  syncedAt: string;
  facilityId: number;
  medicineId: number | null;
  suppliers: NetworkSupplier[];
}
