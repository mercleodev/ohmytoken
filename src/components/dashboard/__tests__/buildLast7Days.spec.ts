import { describe, it, expect } from 'vitest';
import { buildLast7Days } from '../StatsCard';
import { toLocalDateKey } from '../../../utils/format';
import type { ScanStats } from '../../../types';

type CostByPeriod = ScanStats['cost_by_period'];

describe('buildLast7Days', () => {
  it('returns exactly 7 entries', () => {
    const result = buildLast7Days([]);
    expect(result).toHaveLength(7);
  });

  it('applies minBar (5% of max) for empty days', () => {
    const today = toLocalDateKey(new Date());
    const data: CostByPeriod = [{ period: today, cost_usd: 1.0, request_count: 5 }];
    const result = buildLast7Days(data);

    const todayEntry = result.find((d) => d.day === today)!;
    expect(todayEntry.cost).toBe(1.0);
    expect(todayEntry.actual).toBe(1.0);

    // Empty days should have minBar = 1.0 * 0.05 = 0.05
    const emptyEntries = result.filter((d) => d.actual === 0);
    expect(emptyEntries.length).toBeGreaterThan(0);
    for (const entry of emptyEntries) {
      expect(entry.cost).toBeCloseTo(0.05, 5);
      expect(entry.actual).toBe(0);
    }
  });

  it('uses actual values when all 7 days have data', () => {
    const now = new Date();
    const data: CostByPeriod = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      data.push({ period: toLocalDateKey(d), cost_usd: 0.1 * (7 - i), request_count: 1 });
    }

    const result = buildLast7Days(data);
    expect(result).toHaveLength(7);
    // All entries should have actual > 0, so cost === actual
    for (const entry of result) {
      expect(entry.actual).toBeGreaterThan(0);
      expect(entry.cost).toBe(entry.actual);
    }
  });

  it('last entry corresponds to today (local date)', () => {
    const result = buildLast7Days([]);
    const today = toLocalDateKey(new Date());
    expect(result[result.length - 1].day).toBe(today);
  });

  it('first entry is 6 days ago (local date)', () => {
    const result = buildLast7Days([]);
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    expect(result[0].day).toBe(toLocalDateKey(sixDaysAgo));
  });
});
