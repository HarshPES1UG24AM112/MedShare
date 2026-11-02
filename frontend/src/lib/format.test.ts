import { describe, expect, it } from 'vitest';
import { daysUntil, fmtDaysToExpiry, fmtMonth, parseDate, titleCase } from './format';

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('parseDate', () => {
  it('treats YYYY-MM-DD as a local calendar date, not UTC', () => {
    const d = parseDate('2026-11-03');
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 3, 0]);
  });
});

describe('daysUntil', () => {
  it('counts whole calendar days from today', () => {
    const today = new Date();
    const inFive = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    expect(daysUntil(localISO(today))).toBe(0);
    expect(daysUntil(localISO(inFive))).toBe(5);
    expect(daysUntil(localISO(yesterday))).toBe(-1);
  });
});

describe('formatters', () => {
  it('describes expiry distance', () => {
    expect(fmtDaysToExpiry(-3)).toBe('Expired 3 d ago');
    expect(fmtDaysToExpiry(0)).toBe('Expires today');
    expect(fmtDaysToExpiry(12)).toBe('12 d');
  });
  it('formats month keys and enum labels', () => {
    expect(fmtMonth('2026-01')).toMatch(/Jan/);
    expect(titleCase('TRANSFER_APPROVED')).toBe('Transfer Approved');
  });
});
