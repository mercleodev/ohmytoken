import { describe, it, expect } from 'vitest';
import { toLocalDateKey, formatCost, formatTokens, formatTimeAgo } from '../format';

describe('toLocalDateKey', () => {
  it('returns YYYY-MM-DD for a given date', () => {
    // Use a fixed local date to avoid timezone sensitivity
    const d = new Date(2026, 1, 15); // Feb 15, 2026 (month is 0-indexed)
    expect(toLocalDateKey(d)).toBe('2026-02-15');
  });

  it('pads single-digit month and day', () => {
    const d = new Date(2026, 0, 5); // Jan 5, 2026
    expect(toLocalDateKey(d)).toBe('2026-01-05');
  });

  it('handles midnight boundary correctly', () => {
    // Create a date at exactly midnight local time
    const midnight = new Date(2026, 1, 15, 0, 0, 0);
    expect(toLocalDateKey(midnight)).toBe('2026-02-15');

    // One second before midnight → still previous day
    const beforeMidnight = new Date(2026, 1, 14, 23, 59, 59);
    expect(toLocalDateKey(beforeMidnight)).toBe('2026-02-14');
  });

  it('uses local date, not UTC', () => {
    // Create a Date from a UTC string that may cross a day boundary locally
    const utcStr = '2026-02-10T23:30:00.000Z';
    const d = new Date(utcStr);
    // The local date key should match JS local date methods, not UTC
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(toLocalDateKey(d)).toBe(expected);
  });

  it('handles Dec 31 → Jan 1 year boundary', () => {
    const dec31 = new Date(2025, 11, 31); // Dec 31, 2025
    expect(toLocalDateKey(dec31)).toBe('2025-12-31');

    const jan1 = new Date(2026, 0, 1); // Jan 1, 2026
    expect(toLocalDateKey(jan1)).toBe('2026-01-01');
  });
});

describe('formatCost', () => {
  it('returns $0.00 for null/undefined/0/negative', () => {
    expect(formatCost(null)).toBe('$0.00');
    expect(formatCost(undefined)).toBe('$0.00');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(-1)).toBe('$0.00');
  });

  it('formats sub-millicent values in milli-dollars', () => {
    expect(formatCost(0.0005)).toBe('$0.50m');
  });

  it('formats normal costs to 4 decimal places', () => {
    expect(formatCost(1.2345)).toBe('$1.2345');
    expect(formatCost(0.05)).toBe('$0.0500');
  });
});

describe('formatTokens', () => {
  it('returns "0" for null/undefined/NaN', () => {
    expect(formatTokens(null)).toBe('0');
    expect(formatTokens(undefined)).toBe('0');
    expect(formatTokens(NaN)).toBe('0');
  });

  it('formats millions with M suffix', () => {
    expect(formatTokens(1_500_000)).toBe('1.5M');
  });

  it('formats thousands with K suffix', () => {
    expect(formatTokens(9_500)).toBe('9.5K');
  });

  it('returns raw number for small values', () => {
    expect(formatTokens(500)).toBe('500');
  });
});

describe('formatTimeAgo', () => {
  it('returns "just now" for < 10s', () => {
    const ts = new Date(Date.now() - 5000).toISOString();
    expect(formatTimeAgo(ts)).toBe('just now');
  });

  it('returns seconds for < 60s', () => {
    const ts = new Date(Date.now() - 30000).toISOString();
    expect(formatTimeAgo(ts)).toBe('30s ago');
  });

  it('returns minutes for < 60m', () => {
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('5m ago');
  });

  it('returns hours for < 24h', () => {
    const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('3h ago');
  });

  it('returns days for >= 24h', () => {
    const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeAgo(ts)).toBe('2d ago');
  });
});
