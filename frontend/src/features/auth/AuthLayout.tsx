import type { ReactNode } from 'react';
import { ArrowLeftRight, CalendarClock, TriangleAlert } from 'lucide-react';
import { Logo } from '@/components/layout/Logo';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between bg-ink-950 p-10 text-ink-300 lg:flex">
        <Logo />
        <div className="max-w-md">
          <h2 className="text-2xl leading-snug font-semibold tracking-tight text-white">Coordinated medicine inventory across your facility network.</h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-400">
            See shortages before they reach the ward, move near-expiry stock to where it will be used, and track every transfer from request to receipt.
          </p>
          <ul className="mt-8 space-y-4 text-sm">
            {[
              { icon: TriangleAlert, title: 'Shortage monitoring', body: 'Days-of-stock estimates against reorder and critical thresholds.' },
              { icon: CalendarClock, title: 'Expiry surveillance', body: 'Batch-level alerts at 7, 30 and 60 days.' },
              { icon: ArrowLeftRight, title: 'Inter-facility transfers', body: 'Recommendation-driven redistribution with approval workflow.' },
            ].map((f) => (
              <li key={f.title} className="flex gap-3">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-white/5 text-brand-200">
                  <f.icon className="size-4" aria-hidden />
                </span>
                <span>
                  <span className="block font-medium text-white">{f.title}</span>
                  <span className="text-ink-400">{f.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-ink-500">For authorised staff of participating healthcare facilities.</p>
      </aside>
      <main className="flex items-center justify-center bg-surface px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <Logo dark className="mb-8 lg:hidden" />
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-ink-500">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  );
}
