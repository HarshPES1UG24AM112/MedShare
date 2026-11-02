const env = import.meta.env;

export const config = {
  /** When true, all services resolve against the in-browser mock database. */
  useMocks: (env.VITE_USE_MOCKS ?? 'true') !== 'false',
  apiBaseUrl: env.VITE_API_BASE_URL ?? '/api/v1',
  /** Artificial latency for mock services so loading states are exercised. */
  mockLatencyMs: Number(env.VITE_MOCK_LATENCY_MS ?? 350),
};
