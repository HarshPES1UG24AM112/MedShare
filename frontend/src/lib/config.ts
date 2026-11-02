const env = import.meta.env;

export const config = {
  /** Base URL for the REST API. "/api/v1" goes through the Vite dev proxy to the backend. */
  apiBaseUrl: env.VITE_API_BASE_URL ?? '/api/v1',
};
