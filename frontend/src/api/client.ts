import axios, { AxiosError, type AxiosInstance } from 'axios';
import { config } from '@/lib/config';
import { tokenStore } from '@/auth/tokenStore';

/** Normalised error every service throws, regardless of mock or HTTP. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, string[]>;

  constructor(message: string, status: number, code = 'ERROR', details?: Record<string, string[]>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get isUnauthorized() {
    return this.status === 401;
  }
  get isForbidden() {
    return this.status === 403;
  }
  get isNotFound() {
    return this.status === 404;
  }
  get isNetwork() {
    return this.status === 0;
  }
}

/**
 * Error body shape we expect from the backend:
 *   { error: { code: string, message: string, details?: { field: string[] } } }
 * Also tolerates a flat { message } body.
 */
interface ErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, string[]> };
  message?: string;
}

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (axios.isAxiosError(err)) {
    const e = err as AxiosError<ErrorBody>;
    if (!e.response) {
      return new ApiError('Unable to reach the MedShare server. Check your connection.', 0, 'NETWORK');
    }
    const body = e.response.data ?? {};
    const message = body.error?.message ?? body.message ?? defaultMessage(e.response.status);
    return new ApiError(message, e.response.status, body.error?.code ?? 'HTTP_ERROR', body.error?.details);
  }
  return new ApiError(err instanceof Error ? err.message : 'Unexpected error', 500, 'UNKNOWN');
}

function defaultMessage(status: number) {
  if (status === 401) return 'Your session has expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to perform this action.';
  if (status === 404) return 'The requested record was not found.';
  if (status === 409) return 'This record was changed by someone else. Refresh and try again.';
  if (status >= 500) return 'The server encountered an error. Please try again shortly.';
  return 'Request failed.';
}

/** Listeners notified when the server rejects our token. */
const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(listener: () => void) {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}
export function emitUnauthorized() {
  unauthorizedListeners.forEach((l) => l());
}

export const http: AxiosInstance = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((req) => {
  const token = tokenStore.get();
  if (token) req.headers.Authorization = `Bearer ${token}`;
  return req;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    const apiErr = toApiError(err);
    // A 401 on the login call itself is "wrong password", not an expired session.
    const url = (err as AxiosError).config?.url ?? '';
    if (apiErr.isUnauthorized && !url.includes('/auth/login')) emitUnauthorized();
    return Promise.reject(apiErr);
  },
);
