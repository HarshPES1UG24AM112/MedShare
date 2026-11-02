import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastApi {
  success(title: string, message?: string): void;
  error(title: string, message?: string): void;
  info(title: string, message?: string): void;
}

const ToastContext = createContext<ToastApi | null>(null);

let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: ToastKind, title: string, message?: string) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-3), { id, kind, title, message }]);
      setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (t, m) => push('success', t, m),
      error: (t, m) => push('error', t, m),
      info: (t, m) => push('info', t, m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 left-4 z-[60] flex flex-col items-end gap-2 sm:left-auto" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface p-3 shadow-pop', {
              'border-brand-200': t.kind === 'success',
              'border-danger-100': t.kind === 'error',
              'border-line': t.kind === 'info',
            })}
          >
            {t.kind === 'success' && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand-600" />}
            {t.kind === 'error' && <XCircle className="mt-0.5 size-4 shrink-0 text-danger-500" />}
            {t.kind === 'info' && <Info className="mt-0.5 size-4 shrink-0 text-info-500" />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink-900">{t.title}</p>
              {t.message && <p className="mt-0.5 text-xs text-ink-600">{t.message}</p>}
            </div>
            <button onClick={() => dismiss(t.id)} className="rounded p-0.5 text-ink-400 hover:text-ink-900" aria-label="Dismiss notification">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
