import type { DosageForm, FacilityType, MovementType, RecommendationReason, Role, TransferStatus } from '@/api/types';

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Administrator',
  FACILITY_MANAGER: 'Facility Manager',
  PHARMACIST: 'Pharmacist',
  VIEWER: 'Viewer',
};

export const FACILITY_TYPE_LABEL: Record<FacilityType, string> = {
  HOSPITAL: 'Hospital',
  COMMUNITY_HEALTH_CENTRE: 'Community Health Centre',
  PRIMARY_HEALTH_CENTRE: 'Primary Health Centre',
  WAREHOUSE: 'Medical Store',
};

export const DOSAGE_FORM_LABEL: Record<DosageForm, string> = {
  TABLET: 'Tablet',
  CAPSULE: 'Capsule',
  SYRUP: 'Syrup / Suspension',
  INJECTION: 'Injection',
  INFUSION: 'Infusion',
  INHALER: 'Inhaler',
  SACHET: 'Sachet',
  CREAM: 'Cream / Ointment',
};

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  RECEIPT: 'Receipt',
  DISPENSE: 'Dispensed',
  TRANSFER_OUT: 'Transfer out',
  TRANSFER_IN: 'Transfer in',
  DAMAGE: 'Damaged',
  CORRECTION: 'Correction',
  EXPIRED_WRITE_OFF: 'Expiry write-off',
};

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  PENDING: 'Pending approval',
  APPROVED: 'Approved',
  DISPATCHED: 'In transit',
  RECEIVED: 'Received',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export const REASON_LABEL: Record<RecommendationReason, string> = {
  SHORTAGE_COVER: 'Shortage cover',
  NEAR_EXPIRY_SURPLUS: 'Near-expiry surplus',
  BALANCING: 'Stock balancing',
};
