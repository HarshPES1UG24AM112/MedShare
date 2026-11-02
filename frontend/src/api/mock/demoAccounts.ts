/** Mock-mode demo logins shown on the sign-in page. Never used with the real API. */
export const DEMO_ACCOUNTS = [
  { label: 'Administrator', scope: 'All facilities', email: 'admin@medshare.health', password: 'MedShare@2026' },
  { label: 'Facility manager', scope: 'Central District Hospital', email: 'manager@medshare.health', password: 'MedShare@2026' },
  { label: 'Pharmacist', scope: 'Hoskote PHC', email: 'pharmacist@medshare.health', password: 'MedShare@2026' },
  { label: 'Viewer', scope: 'Whitefield CHC (read-only)', email: 'viewer@medshare.health', password: 'MedShare@2026' },
] as const;
