# Collision risk record: `.legend-value`

- Pair: `dashboard.css` ↔ `src/components/TokenTreemap.css`
- Generated: 2026-05-08
- Decision: **BENIGN** — no reconciliation required.

## Source A — `src/components/dashboard/dashboard.css:1887`

```css
.legend-value {
  color: #595959;
  font-weight: 500;
}
```

Standalone class selector.

## Source B — `src/components/TokenTreemap.css:204`

```css
.legend-value {
  font-size: 12px;
  color: #888;
  margin-left: auto;
}
```

Also standalone, different declarations.

## Bundle overlap proof

Identical to `cost-row.md` and `cache.md`: `src/components/TokenTreemap.css` is never imported in `src/` and there is no `TokenTreemap.tsx` component. The stylesheet does not enter the Vite bundle.

Verified post-build: `dist/assets/*.css` only emits the dashboard `.legend-value` rule (color #595959, font-weight 500). No second declaration block matching the TokenTreemap variant (color #888, margin-left auto) is present.

→ Bundle overlap = **none**.

## DOM overlap proof

Dashboard `.legend-value` is consumed by chart legends in the dashboard tree (e.g., context-breakdown legend, treemap legend). TokenTreemap variant has no consumer because the component does not exist.

## Decision rationale (per §7 P1 step 1)

Source B never reaches the bundle. No runtime collision is possible.

→ **Benign**. The dashboard `.legend-value` rule can be relocated in Tier 1/2/3 without specificity hazard.

## Follow-up note (out of P1 scope)

Same as `cost-row.md` and `cache.md` — TokenTreemap.css orphan deletion is a separate follow-up issue.
