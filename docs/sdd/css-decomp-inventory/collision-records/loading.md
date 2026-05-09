# Collision risk record: `.loading`

- Pair: `dashboard.css` ↔ `src/App.css`
- Generated: 2026-05-08
- Decision: **BENIGN** — no reconciliation required.

## Source A — `src/components/dashboard/dashboard.css:587`

```css
.dashboard-refresh-btn.loading {
  animation: spin 1s linear infinite;
}
```

Compound selector. The `.loading` token only matches when combined with `.dashboard-refresh-btn`.

## Source B — `src/App.css:115`

```css
.icon-btn.loading {
  animation: spin 1s linear infinite;
}
```

Compound selector. The `.loading` token only matches when combined with `.icon-btn`.

## Bundle overlap proof

Both `dashboard.css` and `App.css` ship in the renderer bundle (App.css is imported transitively from `src/main.tsx` via `src/App.tsx`; dashboard.css is imported by `src/components/dashboard/UsageDashboard.tsx`). `.loading` therefore appears in both compiled stylesheets.

Verified post-build by grepping `dist/assets/*.css` for `\.loading\b`: matches exist in the bundle exclusively as part of the two compound selectors above (no standalone `.loading` rule exists in either source file).

## DOM overlap proof

- `.icon-btn.loading` consumer: `src/components/Header.tsx:11` — `className={\`icon-btn ${loading ? 'loading' : ''}\`}`. Header is rendered outside the dashboard tree.
- `.dashboard-refresh-btn.loading` consumer: `src/components/dashboard/UsageDashboard.tsx:296` — `className={\`dashboard-refresh-btn ${loading ? 'loading' : ''}\`}`. Used only on the dashboard refresh button.

No DOM node carries both `icon-btn` and `dashboard-refresh-btn` simultaneously. The two compound selectors are mutually exclusive at the element level, so neither rule can win against the other for the same node.

The shared declarations are also identical (`animation: spin 1s linear infinite;`), so even if a hypothetical compound match existed, the cascade outcome would be unchanged.

## Decision rationale (per §7 P1 step 1)

Both Source A and Source B are compound selectors that require a base class the other does not use. Bundle co-presence is not sufficient for collision — there must be a DOM node where both selectors apply. There is none.

→ **Benign**. No rename, dedup, or scope-tightening needed.

## Forward-compat note

If a future component introduces an element that holds both `icon-btn` and `dashboard-refresh-btn` simultaneously (unlikely; they are semantically distinct), this record should be revisited. Until then, Tier 1/2/3 moves of the dashboard `.loading` rule into a sibling stylesheet are safe with respect to App.css cascade.
