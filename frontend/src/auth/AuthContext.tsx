import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/api';
import { onUnauthorized } from '@/api/client';
import type { LoginInput, Me } from '@/api/types';
import { tokenStore } from './tokenStore';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthState {
  user: Me | null;
  status: Status;
  /** Set when the session ended because the server rejected the token. */
  sessionExpired: boolean;
  login(input: LoginInput): Promise<Me>;
  logout(): void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>(() => (tokenStore.get() ? 'loading' : 'anonymous'));
  const [sessionExpired, setSessionExpired] = useState(false);

  // Restore the session from a stored token.
  useEffect(() => {
    if (!tokenStore.get()) return;
    let cancelled = false;
    api.auth
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        tokenStore.clear();
        setStatus('anonymous');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
    qc.clear();
  }, [qc]);

  // Any 401 from the API ends the session.
  useEffect(
    () =>
      onUnauthorized(() => {
        setSessionExpired(true);
        logout();
      }),
    [logout],
  );

  const login = useCallback(async (input: LoginInput) => {
    const res = await api.auth.login(input);
    tokenStore.set(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
    setSessionExpired(false);
    return res.user;
  }, []);

  const value = useMemo(() => ({ user, status, sessionExpired, login, logout }), [user, status, sessionExpired, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For components rendered only inside protected routes. */
export function useCurrentUser(): Me {
  const { user } = useAuth();
  if (!user) throw new Error('useCurrentUser called outside an authenticated route');
  return user;
}
