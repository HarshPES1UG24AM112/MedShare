import { httpApi } from './services/http';
import type { MedShareApi } from './services/types';

/** The MedShare REST client. Tests replace this module with vi.mock('@/api'). */
export const api: MedShareApi = httpApi;

export { ApiError } from './client';
export { newIdempotencyKey } from './services/http';
export type * from './types';
