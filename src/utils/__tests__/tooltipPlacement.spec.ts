import { describe, expect, it } from 'vitest';
import { clampTooltipX } from '../tooltipPlacement';

describe('clampTooltipX', () => {
  it('returns the target x unchanged when tooltip fits at that position', () => {
    expect(clampTooltipX({ targetX: 400, halfWidth: 80, viewportWidth: 1024 })).toBe(400);
  });

  it('shifts right when target would push tooltip past the left edge', () => {
    expect(clampTooltipX({ targetX: 20, halfWidth: 80, viewportWidth: 1024 })).toBe(84);
  });

  it('shifts left when target would push tooltip past the right edge', () => {
    expect(
      clampTooltipX({ targetX: 1020, halfWidth: 80, viewportWidth: 1024 }),
    ).toBe(940);
  });

  it('honours a custom margin', () => {
    expect(
      clampTooltipX({ targetX: 5, halfWidth: 80, viewportWidth: 1024, margin: 12 }),
    ).toBe(92);
  });

  it('falls back to the left-edge clamp when viewport is narrower than tooltip', () => {
    // When viewport < 2 * halfWidth + 2 * margin the min bound wins; the
    // tooltip will still overflow the right edge, but the caller chooses to
    // prefer left-alignment over right-alignment in that degenerate case.
    expect(clampTooltipX({ targetX: 500, halfWidth: 80, viewportWidth: 100 })).toBe(84);
  });
});
