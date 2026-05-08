# Collision risk record: `.cost-row`

- Pair: `dashboard.css` ↔ `src/components/TokenTreemap.css`
- Generated: 2026-05-08
- Decision: **BENIGN** — no reconciliation required.

## Source A — `src/components/dashboard/dashboard.css:292`

```css
.cost-row {
  font-size: 13px;
  color: #676767;
  font-weight: 500;
  padding: 3px 0;
}

.cost-row span {
  color: #747474;
}
```

Standalone class selector. Matches any element with `class="cost-row"`.

## Source B — `src/components/TokenTreemap.css:578`

```css
.cost-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 4px 0;
  color: #ccc;
}

.cost-row.cache  { color: #27ae60; }
.cost-row.total  { … }
.cost-row.saved  { … }
```

Also standalone. Different declarations than Source A — this is the case the gate doc warned about (`Different declarations → rename one side`).

## Bundle overlap proof

`src/components/TokenTreemap.css` is **never imported** anywhere in `src/`:

```
$ grep -rn "TokenTreemap" src
(no matches)
```

No `TokenTreemap.tsx` exists; no `import './TokenTreemap.css'` exists. The stylesheet is an orphan and never enters the Vite bundle.

Verified post-build:
- `dist/assets/*.css` contains the dashboard `.cost-row` rule (from dashboard.css).
- `dist/assets/*.css` does **not** contain a second `.cost-row` rule with `display: flex` and `color: #ccc` (the TokenTreemap variant). The TokenTreemap declarations are absent from the build output entirely.

→ Bundle overlap = **none**.

## DOM overlap proof

Not strictly needed once bundle overlap is empty, but for the record:
- The dashboard `.cost-row` consumer is the cost-row DOM in `UsageDashboard.tsx` and related dashboard files (rendering small currency rows under cost cards).
- The TokenTreemap variant has no consumer because its component does not exist.

## Decision rationale (per §7 P1 step 1)

Source B never reaches the bundle, so the runtime CSS only contains Source A. There is no specificity contest. The collision exists only at the source-text level inside the repo.

→ **Benign**. The dashboard `.cost-row` rule can be relocated in Tier 1/2/3 without risk of being overridden by the TokenTreemap variant.

## Follow-up note (out of P1 scope)

Same as `cache.md` — `src/components/TokenTreemap.css` is dead code at the bundle level. Deletion is a separate follow-up issue, not part of this CSS decomposition epic.
