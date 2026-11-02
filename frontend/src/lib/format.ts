const numberFmt = new Intl.NumberFormat('en-IN');
const compactFmt = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const currencyFmt = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit' });

export const fmtNumber = (n: number | null | undefined) => (n == null ? '—' : numberFmt.format(n));
export const fmtCompact = (n: number) => compactFmt.format(n);
export const fmtCurrency = (n: number) => currencyFmt.format(n);
export const fmtPercent = (ratio: number, digits = 0) => `${(ratio * 100).toFixed(digits)}%`;

export const fmtDate = (iso: string | null | undefined) => (iso ? dateFmt.format(parseDate(iso)) : '—');
export const fmtDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
/** "2026-11" → "Nov 26" */
export const fmtMonth = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  return monthFmt.format(new Date(y, m - 1, 1));
};

export function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days} d ago`;
  return fmtDate(iso);
}

/** Parses "YYYY-MM-DD" as a local calendar date (new Date() would treat it as UTC). */
export function parseDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export function daysUntil(iso: string) {
  const d = parseDate(iso);
  d.setHours(0, 0, 0, 0);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

export function fmtDaysToExpiry(days: number) {
  if (days < 0) return `Expired ${Math.abs(days)} d ago`;
  if (days === 0) return 'Expires today';
  return `${days} d`;
}

export const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

export const todayISODate = () => new Date().toISOString().slice(0, 10);
