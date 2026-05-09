# Collision risk record: `.cache`

- Pair: `dashboard.css` ↔ `src/components/TokenTreemap.css`
- Generated: 2026-05-08
- Decision: **BENIGN** — no reconciliation required.

## Source A — `src/components/dashboard/dashboard.css:944`

```css
.prompt-card-journey-chip.cache {
  color: #0a5da8;
  background: rgba(10, 93, 168, 0.12);
}
```

Compound selector. The `.cache` token only matches when combined with `.prompt-card-journey-chip`.

## Source B — `src/components/TokenTreemap.css:586`

```css
.cost-row.cache {
  color: #27ae60;
}
```

Compound selector. The `.cache` token only matches when combined with `.cost-row`.

## Bundle overlap proof

`src/components/TokenTreemap.css` is **never imported** by any TypeScript/TSX source under `src/`:

```
$ grep -rn "TokenTreemap" src
(no matches)
```

There is no `TokenTreemap.tsx` component in the repo (the file does not exist) and no `import './TokenTreemap.css'` statement anywhere. The file is therefore an **orphaned stylesheet** that does not enter the Vite bundle graph.

Verified post-build by checking `dist/assets/*.css`:
- `.prompt-card-journey-chip.cache` appears in the dashboard bundle (from dashboard.css).
- `.cost-row.cache` does **not** appear anywhere in `dist/`. No selector with `cost-row.cache` is emitted.

→ Bundle overlap = **none**. The two rules are not co-present at runtime.

## DOM overlap proof

Even if both rules were in the bundle, no DOM node can carry both `prompt-card-journey-chip` and `cost-row` simultaneously. They belong to different component families:
- `.prompt-card-journey-chip cache` is rendered in `src/components/dashboard/SessionDetailView.tsx:529`.
- `.cost-row.cache` would have been rendered by the (non-existent) TokenTreemap component.

## Decision rationale (per §7 P1 step 1)

Bundle overlap is empty (Source B never enters the bundle) and DOM overlap is empty (different base classes). Two independent reasons for benignness.

→ **Benign**. No rename, dedup, or scope-tightening needed.

## Follow-up note (out of P1 scope)

`src/components/TokenTreemap.css` itself appears to be dead — no consumer in the source tree. Removal is **out of scope for this epic** (per §3 C4 Reuse-First / Pure Relocation Discipline; orphan handling is consolidated in U50 for `dashboard.css`-internal classes only). A separate follow-up issue should investigate deletion of the orphaned stylesheet.
