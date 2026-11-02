/**
 * Every backend path the frontend calls, in one place.
 * PROVISIONAL until Agent 1 publishes API_CONTRACT.md — see docs/API_INTEGRATION.md.
 * If the contract differs, change paths here; no component references a URL directly.
 */
export const endpoints = {
  auth: {
    login: '/auth/login',
    register: '/auth/register',
    me: '/auth/me',
  },
  dashboard: {
    summary: '/dashboard/summary',
  },
  facilities: {
    list: '/facilities',
    detail: (id: string) => `/facilities/${id}`,
    summary: (id: string) => `/facilities/${id}/summary`,
  },
  medicines: {
    list: '/medicines',
    categories: '/medicines/categories',
    detail: (id: string) => `/medicines/${id}`,
  },
  inventory: {
    batches: '/inventory/batches',
    batch: (id: string) => `/inventory/batches/${id}`,
    adjust: (id: string) => `/inventory/batches/${id}/adjustments`,
    movements: '/inventory/movements',
  },
  alerts: {
    shortages: '/alerts/shortages',
    expiry: '/alerts/expiry',
    expirySummary: '/alerts/expiry/summary',
  },
  redistribution: {
    recommendations: '/redistribution/recommendations',
  },
  transfers: {
    list: '/transfers',
    detail: (id: string) => `/transfers/${id}`,
    action: (id: string, action: string) => `/transfers/${id}/${action}`,
  },
  analytics: {
    overview: '/analytics/overview',
  },
  audit: {
    list: '/audit-logs',
  },
} as const;
