import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Loader2, Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui';
import { useAuth } from './AuthContext';
import { can, type Permission } from './permissions';

export function ProtectedRoute() {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        <Loader2 className="size-5 animate-spin" aria-label="Restoring session" />
      </div>
    );
  }
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <Outlet />;
}

/** Guards a page by permission and explains the restriction instead of failing silently. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { user } = useAuth();
  if (!can(user, permission)) {
    return (
      <EmptyState
        className="py-24"
        icon={<Lock className="size-5" />}
        title="You don't have access to this page"
        description="Your role doesn't include this permission. Contact a MedShare administrator if you need access."
      />
    );
  }
  return <>{children}</>;
}
