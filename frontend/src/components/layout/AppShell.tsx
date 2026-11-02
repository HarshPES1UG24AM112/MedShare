import { Suspense, useState, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell({ fallback }: { fallback?: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-50 rounded bg-ink-900 px-3 py-2 text-white focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="lg:pl-64">
        <Topbar onMenu={() => setNavOpen(true)} />
        <main id="main" className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
          <Suspense fallback={fallback}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
