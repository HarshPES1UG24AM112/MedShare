import { cn } from '@/lib/utils';

export function Logo({ dark, className }: { dark?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill={dark ? '#0f2341' : '#ffffff14'} />
        <path d="M13 8h6v5h5v6h-5v5h-6v-5H8v-6h5z" fill="#34b27b" />
      </svg>
      <span className={cn('text-[15px] font-semibold tracking-tight', dark ? 'text-ink-950' : 'text-white')}>MedShare</span>
    </div>
  );
}
