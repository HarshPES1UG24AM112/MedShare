/**
 * Synthetic accounts created by the backend's deterministic seed (backend/db/seed).
 * Shown on the sign-in page only when import.meta.env.DEV is true; production builds never render them.
 */
export const DEMO_PASSWORD = 'MedShare@2026';

export const DEMO_ACCOUNTS = [
  { email: 'admin@medshare.health', label: 'System administrator', scope: 'Whole network' },
  { email: 'auditor@medshare.health', label: 'Platform auditor', scope: 'Read-only, whole network' },
  { email: 'org1.admin@medshare.health', label: 'Organisation admin', scope: 'Organisation 1' },
  { email: 'org2.auditor@medshare.health', label: 'Organisation auditor', scope: 'Organisation 2' },
  { email: 'fac-001.manager@medshare.health', label: 'Facility manager', scope: 'FAC-001' },
  { email: 'fac-002.inventory@medshare.health', label: 'Inventory manager', scope: 'FAC-002' },
] as const;
