import type {
  ApprovalStage,
  BatchStatus,
  DemandBasis,
  DosageForm,
  ExpiryBucket,
  FacilityType,
  MovementType,
  RecommendationReason,
  RecommendationStatus,
  RequestPriority,
  Role,
  StockRequestStatus,
  StockStatus,
  TransferStatus,
} from '@/api/types';

export const ROLE_LABEL: Record<Role, string> = {
  SYSTEM_ADMIN: 'System administrator',
  ORG_ADMIN: 'Organisation administrator',
  FACILITY_MANAGER: 'Facility manager',
  INVENTORY_MANAGER: 'Inventory manager',
  AUDITOR: 'Auditor',
};

export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = {
  HOSPITAL: 'Hospital',
  COMMUNITY_HEALTH_CENTRE: 'Community Health Centre',
  PRIMARY_HEALTH_CENTRE: 'Primary Health Centre',
  PHARMACY: 'Pharmacy',
  WAREHOUSE: 'Medical store / warehouse',
};

export const DOSAGE_FORM_LABEL: Record<DosageForm, string> = {
  TABLET: 'Tablet',
  CAPSULE: 'Capsule',
  SYRUP: 'Syrup',
  SUSPENSION: 'Suspension',
  INJECTION: 'Injection',
  INFUSION: 'Infusion',
  INHALER: 'Inhaler',
  SACHET: 'Sachet',
  CREAM: 'Cream / ointment',
  DROPS: 'Drops',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  RECEIPT: 'Receipt',
  DISPENSE: 'Dispensed',
  RESERVE: 'Reserved',
  RELEASE: 'Reservation released',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  TRANSIT_DAMAGE: 'Damaged in transit',
  DAMAGE: 'Damaged',
  DISPOSAL: 'Disposed',
  EXPIRY_WRITE_OFF: 'Expiry write-off',
  ADJUSTMENT_IN: 'Adjustment (+)',
  ADJUSTMENT_OUT: 'Adjustment (−)',
};

/** Badge tone per movement: green adds usable stock, red is a loss, neutral moves between buckets. */
export const MOVEMENT_TONE: Record<MovementType, 'success' | 'danger' | 'neutral' | 'info'> = {
  RECEIPT: 'success',
  TRANSFER_IN: 'success',
  ADJUSTMENT_IN: 'success',
  RELEASE: 'info',
  DISPENSE: 'neutral',
  RESERVE: 'info',
  TRANSFER_OUT: 'neutral',
  ADJUSTMENT_OUT: 'neutral',
  TRANSIT_DAMAGE: 'danger',
  DAMAGE: 'danger',
  DISPOSAL: 'danger',
  EXPIRY_WRITE_OFF: 'danger',
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  DISPATCHED: 'In transit',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const STAGE_LABEL: Record<ApprovalStage, string> = {
  SOURCE_FACILITY: 'Source facility',
  SOURCE_ORGANIZATION: 'Source organisation',
};

export const REASON_LABEL: Record<RecommendationReason, string> = {
  SHORTAGE_COVER: 'Shortage cover',
  NEAR_EXPIRY_SURPLUS: 'Near-expiry surplus',
};

export const RECOMMENDATION_STATUS_LABEL: Record<RecommendationStatus, string> = {
  OPEN: 'Open',
  ACCEPTED: 'Accepted',
  DISMISSED: 'Dismissed',
  SUPERSEDED: 'Superseded',
};

export const DEMAND_BASIS_LABEL: Record<DemandBasis, string> = {
  MEASURED: 'Measured',
  ESTIMATED_SIMULATED: 'Estimated (simulated)',
  ESTIMATED_CONFIGURED: 'Estimated (configured)',
};

export const DEMAND_BASIS_HINT: Record<DemandBasis, string> = {
  MEASURED: 'Daily rate derived from recent dispensing history.',
  ESTIMATED_SIMULATED: 'Daily rate is a simulated estimate; there is not enough dispensing history yet.',
  ESTIMATED_CONFIGURED: 'Daily rate is the estimate configured in the facility stock policy.',
};

export const POSSIBLY_CENSORED_HINT =
  'No dispensing in the measurement window, probably because the item was out of stock, so the estimate is used instead.';

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  ACTIVE: 'Active',
  QUARANTINED: 'Quarantined',
  RECALLED: 'Recalled',
};

export const EXPIRY_BUCKET_LABEL: Record<ExpiryBucket, string> = {
  EXPIRED: 'Expired',
  WITHIN_7_DAYS: '≤ 7 days',
  WITHIN_30_DAYS: '≤ 30 days',
  WITHIN_60_DAYS: '≤ 60 days',
  HEALTHY: 'In date',
};

export const STOCK_STATUS_LABEL: Record<StockStatus, string> = {
  CRITICAL: 'Critical',
  LOW: 'Low',
  OK: 'OK',
};

export const PRIORITY_LABEL: Record<RequestPriority, string> = {
  ROUTINE: 'Routine',
  URGENT: 'Urgent',
  EMERGENCY: 'Emergency',
};

export const STOCK_REQUEST_STATUS_LABEL: Record<StockRequestStatus, string> = {
  OPEN: 'Open',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

export const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));
