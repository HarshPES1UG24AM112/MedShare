const KEY = 'medshare.accessToken';

/**
 * Access-token storage. localStorage keeps the user signed in across reloads;
 * every access is guarded because storage can be unavailable (private mode, policies).
 */
export const tokenStore = {
  get(): string | null {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* storage unavailable: session lasts for this tab only */
    }
  },
  clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  },
};
