import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Building2, CheckCheck, ChevronDown, LogOut, Menu } from 'lucide-react';
import type { Notification } from '@/api/types';
import { useAuth } from '@/auth/AuthContext';
import { useFacilityScope } from '@/auth/FacilityScope';
import { rolesOf } from '@/auth/permissions';
import { useFacilityDirectory, useMarkNotificationRead, useNotifications } from '@/hooks/queries';
import { fmtRelative } from '@/lib/format';
import { ROLE_LABEL } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui';

/** Closes a popover on outside click or Escape. */
function useDismiss(open: boolean, setOpen: (o: boolean) => void, ref: RefObject<HTMLElement | null>) {
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
  }, [open, setOpen, ref]);
}

function FacilitySelector() {
  const { facilityId, setFacilityId, canSwitch, scopeIds } = useFacilityScope();
  const { user } = useAuth();
  const { facilities, byId, isLoading } = useFacilityDirectory();
  const inScope = facilities.filter((f) => scopeIds.includes(f.id));

  if (!canSwitch) {
    const only = byId(scopeIds[0]);
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-line bg-subtle px-2.5 py-1.5 text-xs text-ink-700" title="Your account is scoped to this facility">
        <Building2 className="size-3.5 shrink-0 text-ink-500" aria-hidden />
        <span className="truncate">{only?.name ?? (isLoading ? 'Loading…' : scopeIds.length ? `Facility ${scopeIds[0]}` : 'No facility scope')}</span>
      </div>
    );
  }
  return (
    <div className="relative min-w-0">
      <Building2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
      <select
        aria-label="Facility scope"
        value={facilityId ?? ''}
        onChange={(e) => setFacilityId(e.target.value ? Number(e.target.value) : undefined)}
        className="h-8 w-full max-w-72 appearance-none truncate rounded-md border border-line-strong bg-surface pr-7 pl-8 text-xs font-medium text-ink-900 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
      >
        <option value="">
          {user?.platformScope ? 'All facilities' : 'All my facilities'} ({scopeIds.length})
        </option>
        {inScope.map((f) => (
          <option key={f.id} value={f.id}>
            {f.code} · {f.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-ink-500" aria-hidden />
    </div>
  );
}

/** Where a notification leads, when it names an entity the app has a page for. */
function notificationLink(n: Notification): string | null {
  if (!n.entityType || !n.entityId) return null;
  switch (n.entityType) {
    case 'TRANSFER':
      return `/transfers?open=${n.entityId}`;
    case 'STOCK_REQUEST':
      return '/stock-requests';
    case 'RECOMMENDATION':
      return '/redistribution';
    default:
      return null;
  }
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, ref);
  const navigate = useNavigate();
  const toast = useToast();
  const q = useNotifications({ pageSize: 8 });
  const mark = useMarkNotificationRead();
  const unread = q.data?.unreadCount ?? 0;

  const onOpen = (n: Notification) => {
    if (!n.readAt) mark.mutate(n.id);
    const to = notificationLink(n);
    if (to) {
      setOpen(false);
      navigate(to);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-md p-1.5 text-ink-600 hover:bg-subtle hover:text-ink-900"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <Bell className="size-4.5" />
        {unread > 0 && (
          <span className="tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notifications" className="fixed inset-x-2 top-14 z-40 rounded-lg border border-line bg-surface shadow-pop sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-1 sm:w-96">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-sm font-semibold text-ink-900">Notifications</p>
            <button
              type="button"
              disabled={!unread || mark.isPending}
              onClick={() => mark.mutate('all', { onError: (e) => toast.error('Could not mark notifications as read', (e as Error).message) })}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs font-medium text-ink-600 hover:bg-subtle hover:text-ink-900 disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          </div>
          <div className="scrollbar-thin max-h-96 overflow-y-auto">
            {q.isLoading ? (
              <p className="px-3 py-6 text-center text-xs text-ink-500">Loading…</p>
            ) : q.isError ? (
              <p className="px-3 py-6 text-center text-xs text-danger-600">Could not load notifications.</p>
            ) : !q.data?.data.length ? (
              <p className="px-3 py-6 text-center text-xs text-ink-500">You have no notifications.</p>
            ) : (
              <ul className="divide-y divide-line">
                {q.data.data.map((n) => (
                  <li key={n.id}>
                    <button type="button" onClick={() => onOpen(n)} className={cn('block w-full px-3 py-2.5 text-left hover:bg-subtle/60', !n.readAt && 'bg-brand-50/50')}>
                      <span className="flex items-start gap-2">
                        {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" aria-label="Unread" />}
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium text-ink-900">{n.title}</span>
                          {n.body && <span className="mt-0.5 block text-xs text-ink-600">{n.body}</span>}
                          <span className="mt-0.5 block text-[11px] text-ink-400">{fmtRelative(n.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, setOpen, ref);

  if (!user) return null;
  const initials = user.fullName
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  const roles = rolesOf(user);
  const primary = roles[0] ? ROLE_LABEL[roles[0]] : 'No role';

  const lines: ReactNode[] = [
    ...user.roles.map((r, i) => (
      <li key={`o${i}`}>
        {ROLE_LABEL[r.role]} · {r.organizationName ?? 'Platform'}
      </li>
    )),
    ...user.facilities.map((f) => (
      <li key={`f${f.facilityId}${f.role}`}>
        {ROLE_LABEL[f.role]} · {f.facilityCode}
      </li>
    )),
  ];

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-md p-1 hover:bg-subtle" aria-haspopup="menu" aria-expanded={open}>
        <span className="flex size-7 items-center justify-center rounded-full bg-ink-900 text-[11px] font-semibold text-white">{initials}</span>
        <span className="hidden text-left md:block">
          <span className="block max-w-44 truncate text-xs leading-tight font-medium text-ink-900">{user.fullName}</span>
          <span className="block text-[11px] leading-tight text-ink-500">
            {primary}
            {roles.length > 1 && ` +${roles.length - 1}`}
          </span>
        </span>
        <ChevronDown className="hidden size-3.5 text-ink-500 md:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-40 mt-1 w-64 rounded-lg border border-line bg-surface p-1 shadow-pop">
          <div className="border-b border-line px-3 py-2">
            <p className="text-sm font-medium text-ink-900">{user.fullName}</p>
            <p className="truncate text-xs text-ink-500">{user.email}</p>
            <ul className="mt-1.5 space-y-0.5 text-xs text-ink-600">{lines.length ? lines : <li>No roles assigned</li>}</ul>
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
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur sm:gap-3 sm:px-6">
      <button onClick={onMenu} className="rounded p-1.5 text-ink-600 hover:bg-subtle lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" />
      </button>
      <div className="min-w-0 flex-1">
        <FacilitySelector />
      </div>
      <NotificationBell />
      <UserMenu />
    </header>
  );
}
