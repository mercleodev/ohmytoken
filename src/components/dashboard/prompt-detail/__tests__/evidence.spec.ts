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

// Issue #372: the rollup must expose all three tiers so the header summary
// is consistent with the per-row letter dots (C/L/U). The previous 2-way
// `notConfirmed` collapse hid the likely tier from the header.
describe('collapseEvidenceToCounts (3-tier)', () => {
  it('returns all zeros for empty input', () => {
    expect(collapseEvidenceToCounts(makeByStatus())).toEqual({
      confirmed: 0,
      likely: 0,
      unverified: 0,
      total: 0,
    });
  });

  it('counts confirmed-only buckets', () => {
    const items = [makeItem('confirmed'), makeItem('confirmed')];
    expect(collapseEvidenceToCounts(makeByStatus(items))).toEqual({
      confirmed: 2,
      likely: 0,
      unverified: 0,
      total: 2,
    });
  });

  it('counts likely-only buckets', () => {
    const items = [makeItem('likely'), makeItem('likely'), makeItem('likely')];
    expect(collapseEvidenceToCounts(makeByStatus([], items))).toEqual({
      confirmed: 0,
      likely: 3,
      unverified: 0,
      total: 3,
    });
  });

  it('counts unverified-only buckets', () => {
    const items = [makeItem('unverified')];
    expect(collapseEvidenceToCounts(makeByStatus([], [], items))).toEqual({
      confirmed: 0,
      likely: 0,
      unverified: 1,
      total: 1,
    });
  });

  it('keeps the three tiers independent for mixed input', () => {
    const byStatus = makeByStatus(
      [makeItem('confirmed')],
      [makeItem('likely'), makeItem('likely')],
      [makeItem('unverified'), makeItem('unverified'), makeItem('unverified')],
    );
    expect(collapseEvidenceToCounts(byStatus)).toEqual({
      confirmed: 1,
      likely: 2,
      unverified: 3,
      total: 6,
    });
  });

  it('preserves the invariant total = confirmed + likely + unverified', () => {
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
      expect(counts.total).toBe(
        counts.confirmed + counts.likely + counts.unverified,
      );
    }
  });
});
