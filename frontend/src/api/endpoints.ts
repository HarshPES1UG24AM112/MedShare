/**
 * Every backend path the frontend calls, in one place (relative to VITE_API_BASE_URL, default /api/v1).
 * Source of truth: API_CONTRACT.md. No component references a URL directly.
 */
export const endpoints = {
  auth: {
    login: '/auth/login',
    me: '/auth/me',
    changePassword: '/auth/change-password',
  },
  users: {
    list: '/users',
    detail: (id: number) => `/users/${id}`,
    roles: (id: number) => `/users/${id}/roles`,
    role: (id: number, grantId: number) => `/users/${id}/roles/${grantId}`,
    facilityRoles: (id: number) => `/users/${id}/facility-roles`,
  },
  admin: {
    roles: '/admin/roles',
    engineConfig: '/admin/engine-config',
  },
  regions: '/regions',
  organizations: '/organizations',
  facilities: {
    list: '/facilities',
    detail: (id: number) => `/facilities/${id}`,
    summary: (id: number) => `/facilities/${id}/summary`,
    settings: (id: number) => `/facilities/${id}/settings`,
    setting: (id: number, medicineId: number) => `/facilities/${id}/settings/${medicineId}`,
  },
  medicines: {
    list: '/medicines',
    detail: (id: number) => `/medicines/${id}`,
    sources: (id: number) => `/medicines/${id}/sources`,
  },
  catalogue: {
    categories: '/catalogue/categories',
    units: '/catalogue/units',
    substances: '/catalogue/substances',
    manufacturers: '/catalogue/manufacturers',
  },
  batches: {
    list: '/batches',
    detail: (id: number) => `/batches/${id}`,
    status: (id: number) => `/batches/${id}/status`,
  },
  inventory: {
    list: '/inventory',
    detail: (id: number) => `/inventory/${id}`,
    movements: '/inventory/movements',
    receipts: '/inventory/receipts',
    action: (id: number, action: string) => `/inventory/${id}/${action}`,
  },
  alerts: {
    shortages: '/alerts/shortages',
    expiry: '/alerts/expiry',
    expirySummary: '/alerts/expiry/summary',
    acknowledge: (kind: 'shortages' | 'expiry', alertId: number) => `/alerts/${kind}/${alertId}/acknowledge`,
  },
  notifications: {
    list: '/notifications',
    read: (id: number) => `/notifications/${id}/read`,
    readAll: '/notifications/read-all',
  },
  redistribution: {
    recommendations: '/redistribution/recommendations',
    run: '/redistribution/run',
    accept: (id: number) => `/redistribution/recommendations/${id}/accept`,
    dismiss: (id: number) => `/redistribution/recommendations/${id}/dismiss`,
  },
  transfers: {
    list: '/transfers',
    detail: (id: number) => `/transfers/${id}`,
    action: (id: number, action: string) => `/transfers/${id}/${action}`,
  },
  stockRequests: {
    list: '/stock-requests',
    cancel: (id: number) => `/stock-requests/${id}/cancel`,
  },
  dashboard: {
    summary: '/dashboard/summary',
  },
  analytics: {
    overview: '/analytics/overview',
  },
  audit: {
    list: '/audit-logs',
  },
  network: {
    status: '/network/status',
    graph: '/network/graph',
    distance: '/network/distance',
    suppliers: (facilityId: number) => `/network/facilities/${facilityId}/suppliers`,
    sync: '/admin/jobs/graph-sync',
    queries: '/network/queries',
    runQuery: '/network/queries/run',
  },
} as const;
