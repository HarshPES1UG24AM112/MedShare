import { NavLink } from 'react-router-dom';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  CalendarClock,
  LayoutDashboard,
  Pill,
  ScrollText,
  Shuffle,
  TriangleAlert,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { can, type Permission } from '@/auth/permissions';
import { useDashboardSummary } from '@/hooks/queries';
import { cn } from '@/lib/utils';
import { Logo } from './Logo';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: Permission;
  count?: (s: NonNullable<ReturnType<typeof useDashboardSummary>['data']>) => number;
  countTone?: 'danger' | 'warning' | 'neutral';
}

const NAV: { heading: string; items: NavItem[] }[] = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    heading: 'Inventory',
    items: [
      { to: '/medicines', label: 'Medicine catalogue', icon: Pill },
      { to: '/inventory', label: 'Stock & batches', icon: Boxes },
      { to: '/facilities', label: 'Facilities', icon: Building2 },
    ],
  },
  {
    heading: 'Monitoring',
    items: [
      { to: '/shortages', label: 'Shortages', icon: TriangleAlert, count: (s) => s.criticalShortages, countTone: 'danger' },
      { to: '/expiry', label: 'Expiry', icon: CalendarClock, count: (s) => s.expiringBatches30d, countTone: 'warning' },
    ],
  },
  {
    heading: 'Coordination',
    items: [
      { to: '/redistribution', label: 'Redistribution', icon: Shuffle },
      { to: '/transfers', label: 'Transfers', icon: ArrowLeftRight, count: (s) => s.pendingTransfers, countTone: 'neutral' },
      { to: '/inventory/movements', label: 'Stock movements', icon: Activity },
    ],
  },
  {
    heading: 'Administration',
    items: [{ to: '/audit', label: 'Audit log', icon: ScrollText, permission: 'audit:view' }],
  },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { facilityId } = useFacilityScope();
  const { data: summary } = useDashboardSummary(facilityId);

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-ink-950 text-ink-300 transition-transform lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-label="Primary"
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Logo />
          <button onClick={onClose} className="rounded p-1 text-ink-400 hover:text-white lg:hidden" aria-label="Close navigation">
            <X className="size-4" />
          </button>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 pt-2 pb-4">
          {NAV.map((group) => {
            const items = group.items.filter((i) => !i.permission || can(user, i.permission));
            if (!items.length) return null;
            return (
              <div key={group.heading} className="mb-4">
                <p className="mb-1 px-2 text-[11px] font-medium tracking-wider text-ink-500 uppercase">{group.heading}</p>
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const n = item.count && summary ? item.count(summary) : 0;
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.to === '/' || item.to === '/inventory'}
                          onClick={onClose}
                          className={({ isActive }) =>
                            cn(
                              'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors',
                              isActive ? 'bg-white/10 text-white' : 'hover:bg-white/5 hover:text-white',
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <item.icon className={cn('size-4', isActive ? 'text-brand-200' : 'text-ink-400')} aria-hidden />
                              <span className="flex-1">{item.label}</span>
                              {n > 0 && (
                                <span
                                  className={cn('tabular rounded px-1.5 py-px text-[11px] font-semibold', {
                                    'bg-danger-500/90 text-white': item.countTone === 'danger',
                                    'bg-warning-500/90 text-ink-950': item.countTone === 'warning',
                                    'bg-white/15 text-white': item.countTone === 'neutral',
                                  })}
                                  aria-label={`${n} items`}
                                >
                                  {n}
                                </span>
                              )}
                            </>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-ink-500">MedShare · v0.1.0</div>
      </aside>
    </>
  );
}
