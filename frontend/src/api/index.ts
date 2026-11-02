import { config } from '@/lib/config';
import { httpApi } from './services/http';
import { mockApi } from './mock/mockApi';
import type { MedShareApi } from './services/types';

/**
 * The one place that decides between mock and real services.
 * Toggle with VITE_USE_MOCKS (see .env.example). Nothing else imports mock code.
 */
export const api: MedShareApi = config.useMocks ? mockApi : httpApi;
export const usingMocks = config.useMocks;

export { ApiError } from './client';
export type * from './types';
