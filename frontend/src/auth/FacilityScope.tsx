import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext';

const KEY = 'medshare.facilityScope';

interface FacilityScopeState {
  /** undefined = "All", meaning every facility in the user's scope. */
  facilityId: number | undefined;
  setFacilityId(id: number | undefined): void;
  /** Facilities the user may select (Me.scopeFacilityIds). */
  scopeIds: number[];
  /** True when there is more than one facility to choose from. */
  canSwitch: boolean;
}

const Ctx = createContext<FacilityScopeState | null>(null);

const read = () => {
  try {
    const v = Number(localStorage.getItem(KEY));
    return Number.isInteger(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Which facility the dashboard and monitoring pages are scoped to.
 * The selector lists Me.scopeFacilityIds; "All" means the whole scope, which the server applies itself.
 */
export function FacilityScopeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const scopeIds = useMemo(() => user?.scopeFacilityIds ?? [], [user?.scopeFacilityIds]);
  const [selected, setSelected] = useState<number | undefined>(read);

  useEffect(() => {
    try {
      if (selected) localStorage.setItem(KEY, String(selected));
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [selected]);

  const value = useMemo<FacilityScopeState>(() => {
    // A remembered facility outside the current user's scope is ignored, never sent.
    const valid = selected !== undefined && scopeIds.includes(selected) ? selected : undefined;
    return {
      facilityId: scopeIds.length === 1 ? scopeIds[0] : valid,
      setFacilityId: setSelected,
      scopeIds,
      canSwitch: scopeIds.length > 1,
    };
  }, [scopeIds, selected]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useFacilityScope() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useFacilityScope must be used inside FacilityScopeProvider');
  return ctx;
}
