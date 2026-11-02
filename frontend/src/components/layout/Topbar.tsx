import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, FlaskConical, LogOut, Menu } from 'lucide-react';
import { usingMocks } from '@/api';
import { useAuth } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { useFacilities } from '@/hooks/queries';
import { ROLE_LABEL } from '@/lib/labels';
import { useToast } from '@/components/ui';

function FacilitySelector() {
  const { facilityId, setFacilityId, canSwitch } = useFacilityScope();
  const { data: facilities, isLoading } = useFacilities();
  const current = facilities?.find((f) => f.id === facilityId);

  if (!canSwitch) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-subtle px-2.5 py-1.5 text-xs text-ink-700" title="Your account is assigned to this facility">
        <Building2 className="size-3.5 shrink-0 text-ink-500" aria-hidden />
        <span className="truncate">{current?.name ?? (isLoading ? 'Loading…' : 'No facility')}</span>
      </div>
    );
  }
  return (
    <div className="relative min-w-0">
      <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
      <select
        aria-label="Facility scope"
        value={facilityId ?? ''}
        onChange={(e) => setFacilityId(e.target.value || undefined)}
        className="h-8 w-full max-w-72 appearance-none truncate rounded-md border border-line-strong bg-surface pr-7 pl-8 text-xs font-medium text-ink-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
      >
        <option value="">All facilities ({facilities?.length ?? '…'})</option>
        {facilities?.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md p-1 hover:bg-subtle" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex size-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">{initials}</span>
        <span className="hidden text-left md:block">
          <span className="block text-xs leading-tight font-medium text-ink-900">{user.name}</span>
          <span className="block text-[11px] leading-tight text-ink-500">{ROLE_LABEL[user.role]}</span>
        </span>
        <ChevronDown className="hidden size-3.5 text-ink-500 md:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-60 rounded-lg border border-line bg-surface p-1 shadow-pop">
          <div className="border-b border-line px-3 py-2">
            <p className="text-sm font-medium text-ink-900">{user.name}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            <p className="mt-1 text-xs text-ink-600">
              {ROLE_LABEL[user.role]}
              {user.facilityName ? ` · ${user.facilityName}` : ' · All facilities'}
            </p>
          </div>
          <button
            role="menuitem"
            onClick={() => {
              logout();
              toast.info('Signed out');
            }}
            className="mt-1 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-subtle hover:text-ink-900"
          >
            <LogOut className="size-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu }: { onMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
      <button onClick={onMenu} className="rounded p-1.5 text-ink-600 hover:bg-subtle lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <FacilitySelector />
      </div>
      {usingMocks && (
        <span
          className="hidden items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-[11px] font-medium text-warning-700 ring-1 ring-warning-100 ring-inset sm:inline-flex"
          title="All figures come from synthetic demonstration data generated in the browser. Set VITE_USE_MOCKS=false to use the live API."
        >
          <FlaskConical className="size-3" aria-hidden /> Demo data
        </span>
      )}
      <UserMenu />
    </header>
  );
}
