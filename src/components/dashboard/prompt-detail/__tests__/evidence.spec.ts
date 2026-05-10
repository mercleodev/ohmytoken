import { describe, it, expect } from 'vitest';
import { collapseEvidenceToCounts } from '../evidence';
import type { EvidenceStatus, InjectedEvidenceItem } from '../types';

const makeItem = (
  status: EvidenceStatus,
  overrides: Partial<InjectedEvidenceItem> = {},
): InjectedEvidenceItem => ({
  path: `/tmp/${status}-${Math.random().toString(36).slice(2, 6)}.md`,
  category: 'rules',
  estimated_tokens: 100,
  status,
  reason: `${status} fixture`,
  ...overrides,
});

const makeByStatus = (
  confirmed: InjectedEvidenceItem[] = [],
  likely: InjectedEvidenceItem[] = [],
  unverified: InjectedEvidenceItem[] = [],
): Record<EvidenceStatus, InjectedEvidenceItem[]> => ({
  confirmed,
  likely,
  unverified,
});

describe('collapseEvidenceToCounts', () => {
  it('returns all zeros for empty input', () => {
    expect(collapseEvidenceToCounts(makeByStatus())).toEqual({
      confirmed: 0,
      notConfirmed: 0,
      total: 0,
    });
  });

  it('counts confirmed-only buckets', () => {
    const items = [makeItem('confirmed'), makeItem('confirmed')];
    expect(collapseEvidenceToCounts(makeByStatus(items))).toEqual({
      confirmed: 2,
      notConfirmed: 0,
      total: 2,
    });
  });

  it('treats likely as not-confirmed', () => {
    const items = [makeItem('likely'), makeItem('likely'), makeItem('likely')];
    expect(collapseEvidenceToCounts(makeByStatus([], items))).toEqual({
      confirmed: 0,
      notConfirmed: 3,
      total: 3,
    });
  });

  it('treats unverified as not-confirmed', () => {
    const items = [makeItem('unverified')];
    expect(collapseEvidenceToCounts(makeByStatus([], [], items))).toEqual({
      confirmed: 0,
      notConfirmed: 1,
      total: 1,
    });
  });

  it('sums likely + unverified into not-confirmed for mixed input', () => {
    const byStatus = makeByStatus(
      [makeItem('confirmed')],
      [makeItem('likely'), makeItem('likely')],
      [makeItem('unverified'), makeItem('unverified'), makeItem('unverified')],
    );
    expect(collapseEvidenceToCounts(byStatus)).toEqual({
      confirmed: 1,
      notConfirmed: 5,
      total: 6,
    });
  });

  it('preserves the invariant total = confirmed + notConfirmed across cases', () => {
    const cases: Array<Record<EvidenceStatus, InjectedEvidenceItem[]>> = [
      makeByStatus(),
      makeByStatus([makeItem('confirmed')]),
      makeByStatus([], [makeItem('likely')]),
      makeByStatus([], [], [makeItem('unverified')]),
      makeByStatus(
        [makeItem('confirmed'), makeItem('confirmed')],
        [makeItem('likely')],
        [makeItem('unverified'), makeItem('unverified')],
      ),
    ];
    for (const byStatus of cases) {
      const counts = collapseEvidenceToCounts(byStatus);
      expect(counts.total).toBe(counts.confirmed + counts.notConfirmed);
    }
  });
});
