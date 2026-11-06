import { http } from '../client';
import { endpoints } from '../endpoints';
import type { MedShareApi, WriteOpts } from './types';

/** Strip undefined/empty values so query strings stay clean. */
function q<T extends object>(params: T | undefined) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return { params: out };
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);
const none = (p: Promise<unknown>) => p.then(() => undefined);

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RFC 4122 v4 fallback for non-secure contexts.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Stock and transfer writes carry an Idempotency-Key so a retried request never executes twice. */
const idem = (opts?: WriteOpts) => ({ headers: { 'Idempotency-Key': opts?.idempotencyKey ?? newIdempotencyKey() } });

/** Real implementation backed by the MedShare REST API (API_CONTRACT.md). */
export const httpApi: MedShareApi = {
  auth: {
    login: (input) => data(http.post(endpoints.auth.login, input)),
    me: () => data(http.get(endpoints.auth.me)),
    changePassword: (input) => none(http.post(endpoints.auth.changePassword, input)),
  },
  users: {
    list: (params) => data(http.get(endpoints.users.list, q(params))),
    get: (id) => data(http.get(endpoints.users.detail(id))),
    create: (input) => data(http.post(endpoints.users.list, input)),
    update: (id, input) => data(http.patch(endpoints.users.detail(id), input)),
    grantRole: (id, input) => data(http.post(endpoints.users.roles(id), input)),
    revokeRole: (id, grantId) => data(http.delete(endpoints.users.role(id, grantId))),
    grantFacilityRole: (id, input) => data(http.post(endpoints.users.facilityRoles(id), input)),
    revokeFacilityRole: (id, input) => data(http.delete(endpoints.users.facilityRoles(id), { data: input })),
    roles: () => data(http.get(endpoints.admin.roles)),
  },
  organizations: {
    regions: () => data(http.get(endpoints.regions)),
    list: () => data(http.get(endpoints.organizations)),
  },
  facilities: {
    list: (params) => data(http.get(endpoints.facilities.list, q({ pageSize: 100, ...params }))),
    get: (id) => data(http.get(endpoints.facilities.detail(id))),
    summary: (id) => data(http.get(endpoints.facilities.summary(id))),
    settings: (id, params) => data(http.get(endpoints.facilities.settings(id), q(params))),
    updateSetting: (id, medicineId, input) => data(http.put(endpoints.facilities.setting(id, medicineId), input)),
  },
  medicines: {
    list: (params) => data(http.get(endpoints.medicines.list, q(params))),
    get: (id) => data(http.get(endpoints.medicines.detail(id))),
    create: (input) => data(http.post(endpoints.medicines.list, input)),
    sources: (id, destinationFacilityId) => data(http.get(endpoints.medicines.sources(id), q({ destinationFacilityId }))),
  },
  catalogue: {
    categories: () => data(http.get(endpoints.catalogue.categories)),
    units: () => data(http.get(endpoints.catalogue.units)),
    substances: (search) => data(http.get(endpoints.catalogue.substances, q({ search }))),
    manufacturers: () => data(http.get(endpoints.catalogue.manufacturers)),
  },
  batches: {
    list: (params) => data(http.get(endpoints.batches.list, q(params))),
    get: (id) => data(http.get(endpoints.batches.detail(id))),
    setStatus: (id, input) => data(http.post(endpoints.batches.status(id), input)),
  },
  inventory: {
    list: (params) => data(http.get(endpoints.inventory.list, q(params))),
    movements: (params) => data(http.get(endpoints.inventory.movements, q(params))),
    receive: (input, opts) => data(http.post(endpoints.inventory.receipts, input, idem(opts))),
    act: (inventoryId, { action, ...body }, opts) => data(http.post(endpoints.inventory.action(inventoryId, action), body, idem(opts))),
  },
  alerts: {
    shortages: (params) => data(http.get(endpoints.alerts.shortages, q(params))),
    expiry: (params) => data(http.get(endpoints.alerts.expiry, q(params))),
    expirySummary: (params) => data(http.get(endpoints.alerts.expirySummary, q(params))),
    acknowledge: (kind, alertId) => none(http.post(endpoints.alerts.acknowledge(kind, alertId), {})),
  },
  notifications: {
    list: (params) => data(http.get(endpoints.notifications.list, q(params))),
    read: (id) => none(http.post(endpoints.notifications.read(id), {})),
    readAll: () => none(http.post(endpoints.notifications.readAll, {})),
  },
  redistribution: {
    recommendations: (params) => data(http.get(endpoints.redistribution.recommendations, q(params))),
    run: () => data(http.post(endpoints.redistribution.run, {})),
    accept: (id, input, opts) => data(http.post(endpoints.redistribution.accept(id), input, idem(opts))),
    dismiss: (id, reason) => data(http.post(endpoints.redistribution.dismiss(id), { reason })),
  },
  transfers: {
    list: (params) => data(http.get(endpoints.transfers.list, q(params))),
    get: (id) => data(http.get(endpoints.transfers.detail(id))),
    create: (input, opts) => data(http.post(endpoints.transfers.list, input, idem(opts))),
    act: (id, { action, ...body }, opts) => data(http.post(endpoints.transfers.action(id, action), body, idem(opts))),
  },
  stockRequests: {
    list: (params) => data(http.get(endpoints.stockRequests.list, q(params))),
    create: (input) => data(http.post(endpoints.stockRequests.list, input)),
    cancel: (id, reason) => data(http.post(endpoints.stockRequests.cancel(id), { reason })),
  },
  dashboard: {
    summary: (params) => data(http.get(endpoints.dashboard.summary, q(params))),
  },
  analytics: {
    overview: (params) => data(http.get(endpoints.analytics.overview, q(params))),
  },
  audit: {
    list: (params) => data(http.get(endpoints.audit.list, q(params))),
  },
  network: {
    status: () => data(http.get(endpoints.network.status)),
    graph: () => data(http.get(endpoints.network.graph)),
    distance: (from, to) => data(http.get(endpoints.network.distance, q({ from, to }))),
    suppliers: (facilityId, medicineId) => data(http.get(endpoints.network.suppliers(facilityId), q({ medicineId }))),
    sync: () => data(http.post(endpoints.network.sync, {})),
    queries: () => data(http.get(endpoints.network.queries)),
    runQuery: (input) => data(http.post(endpoints.network.runQuery, input)),
  },
};
