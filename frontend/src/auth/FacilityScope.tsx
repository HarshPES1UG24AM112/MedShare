import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { can } from './permissions';

const KEY = 'medshare.facilityScope';

interface FacilityScopeState {
  /** undefined = all facilities (only possible for users with facility:switch). */
  facilityId: string | undefined;
  setFacilityId(id: string | undefined): void;
  canSwitch: boolean;
}

const Ctx = createContext<FacilityScopeState | null>(null);

const read = () => {
  try {
    return localStorage.getItem(KEY) || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Which facility the dashboard and monitoring pages are scoped to.
 * Admins may pick any facility or "all"; everyone else is pinned to their own.
 */
export function FacilityScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const canSwitch = can(user, 'facility:switch');
  const [selected, setSelected] = useState<string | undefined>(read);

  useEffect(() => {
    try {
      if (selected) localStorage.setItem(KEY, selected);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [selected]);

  const value = useMemo<FacilityScopeState>(
    () => ({
      facilityId: canSwitch ? selected : (user?.facilityId ?? undefined),
      setFacilityId: (id) => canSwitch && setSelected(id),
      canSwitch,
    }),
    [canSwitch, selected, user?.facilityId],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFacilityScope() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFacilityScope must be used inside FacilityScopeProvider');
  return ctx;
}
