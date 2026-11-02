import { http } from '../client';
import { endpoints } from '../endpoints';
import type { MedShareApi } from './types';

/** Strip undefined/empty values so query strings stay clean. */
function q<T extends object>(params: T) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return { params: out };
}

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

/** Real implementation backed by Agent 1's REST API. */
export const httpApi: MedShareApi = {
  auth: {
    login: (input) => data(http.post(endpoints.auth.login, input)),
    register: (input) => data(http.post(endpoints.auth.register, input)),
    me: () => data(http.get(endpoints.auth.me)),
  },
  dashboard: {
    summary: (params) => data(http.get(endpoints.dashboard.summary, q(params))),
  },
  facilities: {
    list: () => data(http.get(endpoints.facilities.list)),
    get: (id) => data(http.get(endpoints.facilities.detail(id))),
    summary: (id) => data(http.get(endpoints.facilities.summary(id))),
  },
  medicines: {
    list: (params) => data(http.get(endpoints.medicines.list, q(params))),
    categories: () => data(http.get(endpoints.medicines.categories)),
    get: (id) => data(http.get(endpoints.medicines.detail(id))),
    create: (input) => data(http.post(endpoints.medicines.list, input)),
  },
  inventory: {
    batches: (params) => data(http.get(endpoints.inventory.batches, q(params))),
    receive: (input) => data(http.post(endpoints.inventory.batches, input)),
    adjust: (batchId, input) => data(http.post(endpoints.inventory.adjust(batchId), input)),
    movements: (params) => data(http.get(endpoints.inventory.movements, q(params))),
  },
  alerts: {
    shortages: (params) => data(http.get(endpoints.alerts.shortages, q(params))),
    expiry: (params) => data(http.get(endpoints.alerts.expiry, q(params))),
    expirySummary: (params) => data(http.get(endpoints.alerts.expirySummary, q(params))),
  },
  redistribution: {
    recommendations: (params) => data(http.get(endpoints.redistribution.recommendations, q(params))),
  },
  transfers: {
    list: (params) => data(http.get(endpoints.transfers.list, q(params))),
    get: (id) => data(http.get(endpoints.transfers.detail(id))),
    create: (input) => data(http.post(endpoints.transfers.list, input)),
    act: (id, action, body) => data(http.post(endpoints.transfers.action(id, action), body ?? {})),
  },
  analytics: {
    overview: (params) => data(http.get(endpoints.analytics.overview, q(params))),
  },
  audit: {
    list: (params) => data(http.get(endpoints.audit.list, q(params))),
  },
};
