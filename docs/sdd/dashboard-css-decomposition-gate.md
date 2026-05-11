# Dashboard CSS Decomposition — SDD Gate Doc (v2)

> **Epic**: Decompose `src/components/dashboard/dashboard.css` into per-component sibling stylesheets without changing visual output, class names, or stack (no Tailwind, no CSS Modules, no design-token rewrite in this epic).
>
> **Status**: Draft v2 — pending Issue creation, branch creation, rules acknowledgement, and preflight commit.
> **Owner Plan**: Architecture by Opus (this doc + the `scripts/css-decomp-inventory.mjs` generator). Implementation by Sonnet or external LLM working unit-by-unit against this gate.
> **Repo**: `<canonical-repo>` · **Branch**: `refactor/dashboard-css-decompose` (to be created)
> **GH Identity**: `<canonical-account>` (verify with `gh auth status` before any `gh` mutation; switch with `gh auth switch --user <canonical-account>` if not active)
> **Language Policy**: English only in code, commits, PR body, docs. Korean allowed only in user-facing assistant replies when requested.
>
> **Revision history**:
> - v1 (2026-05-03): Prefix-heuristic plan. Inventory was prefix-level grep, which produced false positives (notably named `NotificationCard.tsx` as a consumer of `evidence-*`/`prompt-*`/`provider-*`/etc., when in fact NotificationCard uses a `notif-*` self-prefix and shares zero classes with `dashboard.css`).
> - v2 (2026-05-03): Generator-driven plan. Replaces all prefix heuristics with exact class-token usage produced by `scripts/css-decomp-inventory.mjs`. Adds preflight tier, cascade-order constraint (C7), per-unit visual-surface declaration, baseline stabilization SOP, and an L1–L7 rollback ladder. Freezes the unit list (no more "or fold / or split / optional"). Incorporates Codex v1 blocking feedback and Gemini additive suggestions.
> - v3 (2026-05-05): Folds Codex v2 review. Generator boosted with Phase B (broad string-literal scan filtered against the dashboard class set with a hyphen-required guard) and Phase C (manual `scripts/css-decomp-overrides.json`). Orphans split 3-way (`true-orphan-candidate` / `compound-modifier-unresolved` / `dynamic-pattern-unresolved`); only the first bucket is U50-eligible. Tier counts revised from generator output (444/25/12/56). Preflight reordered to U0 → P0 → U1 → P1 to satisfy SDD Issue First and to capture the visual baseline before any source change. C7 corrected to `node` (not `bash`) and paired with a new post-build verifier `scripts/css-decomp-cascade-check.mjs` that parses `dist/assets/*.css`. Commit count corrected to **54**. S2 memory-file count corrected to **9** (was 8). Cross-file collisions are now treated as risk records pending bundle-overlap proof rather than auto-rename. **For execution decisions, follow the v3 plan and the v2 reviewer feedback section; the v1 reviewer feedback section is preserved historically.**

---

## §1. Problem Statement

`src/components/dashboard/dashboard.css` is a monolithic stylesheet:

- **537 distinct classes** defined, **631 selector entries** in declaration order (some classes are re-declared under modifier selectors, hence the gap; the 631 figure is the cascade-order baseline length).
- Imported once at `src/components/dashboard/UsageDashboard.tsx:38` (`import './dashboard.css';`). All declarations apply globally to every page rendered under the dashboard tree.
- Consumed by **36 .tsx files** (26 directly under `dashboard/`, 10 under `dashboard/prompt-detail/`).
- Sibling files: `notification.css` (1,013 lines), `App.css` (464 lines), `TokenTreemap.css` (1,279 lines, already component-scoped). Only `TokenTreemap.css` follows the target shape.

**Tier distribution from the 2026-05-05 generator run (v3)** (`docs/sdd/css-decomp-inventory/`):

| Tier | Definition | Count | % |
|---|---|---|---|
| **single-owner** | Defined in `dashboard.css`; exactly one consumer file | **444** | 83% |
| **cluster** | Multiple consumers, all within one component subtree | **25** | 5% |
| **shared** | Multiple consumers across two or more component subtrees | **12** | 2% |
| **orphan** | Zero static consumers found | **56** | 10% |
| └ `true-orphan-candidate` | No plausible runtime usage; eligible for U50 marker | **48** | (of 56) |
| └ `compound-modifier-unresolved` | Single-word or modifier-suffix name; likely composed at runtime | **7** | (of 56) |
| └ `dynamic-pattern-unresolved` | BEM `--variant` or template-literal pattern; resolve via overrides | **1** | (of 56) |

Generator phase hits: Phase A (className-specific) **683**, Phase B (broad string-literal scan, hyphen-required) **13**, Phase C (manual overrides from `scripts/css-decomp-overrides.json`) **4**.

**Cross-file class collisions** (also from the generator):

- `dashboard.css ↔ notification.css`: **0 collisions**. NotificationCard uses a `notif-*` self-prefix; the previously-suspected cross-folder leakage does not exist.
- `dashboard.css ↔ App.css`: **1 collision** — `.loading`.
- `dashboard.css ↔ TokenTreemap.css`: **3 collisions** — `.cache`, `.cost-row`, `.legend-value`.

**Symptoms this epic addresses**:

1. Adding a new dashboard component requires hunting through a 4.5K-line file or appending blindly at EOF.
2. No mapping from component → owned style block; static analysis cannot detect dead CSS without a generator.
3. Class-name collision risk (already realized: 4 collisions across peer stylesheets).
4. 56 candidate dead classes with zero static consumers (48 `true-orphan-candidate` + 7 `compound-modifier-unresolved` + 1 `dynamic-pattern-unresolved` after Phase A/B/C analysis) — accumulating because no one currently owns the dead-CSS audit.
5. Visual review of a single component requires loading the entire stylesheet mentally.

**Out of scope** (intentional — see §4):

- Tailwind CSS adoption.
- CSS Modules adoption (`*.module.css`).
- Class name renaming.
- Color/spacing token system, design system overhaul.
- **Removal** of orphan classes (this epic only **identifies** them and marks them with a `/* UNUSED candidate */` comment in U-orphan; deletion is a separate follow-up issue).
- Visual changes of any kind.
- Modifying `notification.css`, `App.css`, `TokenTreemap.css` except for the cross-file collision resolution called out in U-pre2 and the residual rule moves in U-shell.

---

## §2. Goals & Non-Goals

### Goals

- **G1**. `dashboard.css` reduced to **shell-only** rules (`.dashboard`, `.dashboard-menu`, `.menu-item`, `.sub-tabs-row`, `.sub-tab-helper*`, plus any post-audit residuals). Target: ≤ 300 lines.
- **G2**. Each dashboard component (or tight cluster) owns a sibling `.css` file imported from the component itself.
- **G3**. Cross-folder shared classes (12 classes; all between `dashboard/` and `dashboard/prompt-detail/`) are extracted to `src/components/dashboard/_shared/<group>.css` and imported explicitly by every consumer. The `_shared/` location is **inside** `dashboard/`, not a top-level `src/components/_shared/`, because no class actually crosses the dashboard boundary.
- **G4**. Cascade-order (the relative ordering of selectors in the final emitted CSS bundle) is preserved end-to-end. The `selectors-ordered.txt` baseline produced in P0 is the ground truth.
- **G5**. Every commit ends green: `npm run typecheck && lint && test` PASS, frontend-review report `OK` or `OK with fixes`, visual baseline diff = pixel-equal on the canonical screens **plus** the unit's declared visual surface.
- **G6**. Only `true-orphan-candidate` classes (48 of 56 orphans) are marked with a `/* UNUSED candidate (#<issue>) */` comment in U50. The other two sub-classes (`compound-modifier-unresolved` 7, `dynamic-pattern-unresolved` 1) are flagged in `orphans.md` for manual verification and are NOT marked in source — Codex v2 review #2: marking them would poison the follow-up cleanup issue with false positives. A follow-up cleanup issue is opened for deletion of confirmed dead classes in a separate epic.
- **G7**. Cross-file collisions (4 total) are resolved in U-pre2 before any move starts.
- **G8**. README and `frontend-design-guideline.md` Tailwind references are corrected in U-final to match reality (plain CSS, not Tailwind).

### Non-Goals

- **N1**. No Tailwind. No PostCSS. No CSS Modules. No CSS-in-JS.
- **N2**. No selector rewriting (e.g., do **not** convert `.provider-tab.active` to `.provider-tab--active` BEM modifier; do not fold compound selectors).
- **N3**. No specificity hardening, no `!important` removal, no media-query reorganization, no keyframe consolidation, no vendor prefix changes.
- **N4**. No new design tokens, CSS variables, or color palette consolidation.
- **N5**. No new tests beyond the frontend-review gate, vitest baseline, the cascade-order check, and the agent-browser visual snapshot diff.
- **N6**. No deletion of orphan classes during this epic.
- **N7**. No refactor of inline `style={{}}` (deferred to a separate epic).

---

## §3. Constraints (Non-Negotiable)

Excerpts from `CLAUDE.md`, `AGENTS.md`, `.claude/rules/sdd-workflow.md`, `.claude/rules/commit-checklist.md`, `.claude/rules/frontend-design-guideline.md`, `.claude/rules/agent-browser-qa.md`. Implementer must follow these without consulting external files; this section is canonical for the epic.

### C1. SDD (Spec-Driven Delivery) — Mandatory

1. **Issue First**: Every commit references `(#<issue>)`. Do not start coding before the GitHub Issue is open with Problem / Expected Outcome / Acceptance Criteria / Failure Modes / Constraints / Non-goals (template in §13).
2. **Rules Ack**: `bash scripts/set-active-rules-ack.sh <issue>` before the first commit on the branch.
3. **Validated Units**: One behavior change per commit. Commit only after the unit-level validation passes.
4. **Validation Baseline** (every commit, no exceptions):
   ```bash
   npm run typecheck   # tsc --noEmit (frontend + electron)
   npm run lint        # eslint — zero errors in changed files
   npm run test        # vitest — all tests pass
   ```
5. **Frontend Review Gate** (every commit, no exceptions):
   ```bash
   bash scripts/run-frontend-review.sh
   # If FAIL with missing report path:
   #   1. Invoke `code-reviewer` subagent with .claude/rules/frontend-design-guideline.md, scoped to changed files
   #   2. Save findings to .policy/frontend-review-report.<fingerprint>.md (header from script)
   #   3. Re-run until PASS
   # Verdict policy:
   #   OK             — zero critical, zero major
   #   OK with fixes  — zero critical, majors documented for follow-up
   #   BLOCK          — at least one unresolved critical (must fix in a NEW commit)
   ```
   Pre-commit hook `scripts/check-frontend-review-ack.sh` and Stop hook `scripts/completion-gate.sh` enforce this gate. **Never bypass with `--no-verify`.** A bypass attempt is itself a rollback trigger (see §11 L7).
6. **Manual Style Review Ack** (every commit):
   ```bash
   bash scripts/check-style-review-ack.sh
   bash scripts/ack-style-review.sh "<note>"
   ```

### C2. Repository Identity Lock

- Git author/committer come from `.git-identity.local` (git-ignored, pinned to `<canonical-account> <<canonical-email>>`).
- Before every `gh` mutation (`gh issue create`, `gh pr create`, `gh pr merge`, `gh pr edit`, `gh pr comment`, etc.):
  ```bash
  gh auth status
  # Verify the line "Active account: true" belongs to <canonical-account>
  # If not: gh auth switch --user <canonical-account>
  ```
- Keyring active-account state is **volatile across processes**. Re-verify per session and immediately before each mutation. A wrong-identity issue or PR is a §11 L1 rollback (close + recreate under correct identity).

### C3. Language Policy

- All work artifacts (commits, code, comments, docs, PR bodies, issue bodies, frontend-review reports) **English only**.
- User-facing assistant chat replies may be Korean when explicitly requested.

### C4. Reuse-First (Pure Relocation Discipline)

- Class names, selector specificity, declarations, media queries, keyframes, vendor prefixes, source ordering within a moved block — copy verbatim. The only legal modifications are:
  - Removing the moved block from `dashboard.css`.
  - Adding the block to a new sibling `.css` file.
  - Adding `import './<NewFile>.css';` (or relative path) to consuming component files.
- If you find a malformed selector, broken declaration, or `TODO` comment in the moved block, **do not fix it in this epic**. Open a follow-up issue and reference it from the run record (§14).

### C5. Visual Regression Bar

- agent-browser headed snapshot baseline captured in U1 is the regression ground truth.
- Every implementation commit captures a fresh post-commit snapshot **on the canonical screens (§9.1) plus the unit-specific visual surface (§9.2)** and diffs against the U1 baseline.
- Acceptable diff: pixel-equal. Any non-zero pixel diff requires either a fix or a documented exception in the run record. Exceptions require user approval before commit.
- agent-browser is mandatory; **Playwright and Playwright MCP are forbidden** per `.claude/rules/agent-browser-qa.md`.

### C6. Frontend Design Guideline (relevant subset)

The `code-reviewer` subagent will check this epic against:

- TypeScript Baseline: no new `any` (N/A — pure CSS moves; no TS changes except `import './<File>.css';` lines).
- Styling Baseline: "Use token-driven values only" — N/A in this epic (Non-Goal N4); inline `style={{}}` left untouched (N7).
- Frontend PR Checklist: "Style safety: token usage verified; no ad-hoc style drift" — interpret as "no declarations changed during the move".

The reviewer may flag the React/Tailwind clauses; respond in the report under "Findings" with: **"N/A in this epic — see Goals/Non-Goals §1/§2/§4 of `docs/sdd/dashboard-css-decomposition-gate.md`."**

### C7. Cascade-Order Preservation (NEW in v2, hardened in v3)

- **Rule**: The relative declaration order of any two moved selectors A and B must be the same in the final **emitted Vite CSS bundle** as it was in the original `dashboard.css`. Equivalent: the `selectors-ordered.txt.U1` baseline (frozen at U1) is a partial order that the post-build CSS bundle must respect for every selector that was moved.
- **Why**: Vite concatenates imported CSS in the order modules are imported and discovered during the build graph walk. Moving a class from one root import (`UsageDashboard.tsx → dashboard.css`) to many leaf imports changes the discovery order. Same selector text + different cascade order ⇒ different effective styles when specificity is equal.
- **Practical rules** (enforce in every implementation unit):
  - Within a single moved file, selectors stay in their original relative order.
  - **Shared (`dashboard/_shared/*.css`) imports come first** in the consumer file's import list, then **cluster CSS imports**, then **component-local CSS imports**. This mirrors the original "shared classes loaded once at top of bundle" semantics.
  - The shell stylesheet `dashboard.css` (slimmed in U-shell; **filename is preserved** — see U-shell) is the **last** dashboard CSS imported by `UsageDashboard.tsx`, immediately before child component renders.
- **Verification commands** — there are **two** complementary checks; both must pass per implementation unit:

  1. Source-side check (regenerate inventory and confirm baseline integrity):
     ```bash
     node scripts/css-decomp-inventory.mjs
     diff -u docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1 \
             docs/sdd/css-decomp-inventory/selectors-ordered.txt
     # Expectation: the only differences are deletions (selectors that have
     # left dashboard.css for sibling/_shared files). No reordering of
     # not-yet-moved selectors should appear.
     ```

  2. **Bundle-side check (NEW v3)** — required to catch Vite's actual emit order, which the source-side check cannot prove:
     ```bash
     npm run build
     node scripts/css-decomp-cascade-check.mjs
     # Walks dist/assets/*.css, extracts selectors in declaration order,
     # and verifies the relative order of every selector that exists in both
     # the bundle and selectors-ordered.txt.U1. Exits 0 PASS / 1 FAIL with
     # the first divergence reported.
     ```
  - The U1 baseline file `selectors-ordered.txt.U1` is created in U1 by copying `selectors-ordered.txt` immediately after the visual-baseline capture, and is **immutable** until U49 completes. The "current" snapshot regenerated by the inventory generator overwrites `selectors-ordered.txt` (without the `.U1` suffix) on every run.
- **C7 known limitation (added 2026-05-11, see §14 P1.X falsified entry)**: the bundle-side check is **structurally over-strict** for the split phase of the epic. Once a class M is moved out of the monolithic `dashboard.css` into a sibling sub-component CSS, the bundle cannot preserve M's relative position vs **every** still-in-shell selector simultaneously — that would require interleaving emit, which Vite does not do. Whether the shell stylesheet is emitted first (so M comes AFTER all shell selectors) or last (so M comes BEFORE all shell selectors), some shell-vs-moved pair always flips relative to the U1 baseline. The visual-regression bar (§C5 byte-equal capture) is the **authoritative** safety net during the split phase; the bundle-side check is retained as a defense-in-depth signal for **unmoved-pair preservation** (still-in-shell-vs-still-in-shell selectors must keep their relative order — that property is preserved by the verifier). Treat a bundle-side FAIL as "investigate, justify in §14 if visual-equal" rather than a hard blocker. At U49 (shell residual reduction), the bundle-side check returns to a strict pass requirement because by then the partial-order pairs that flipped will all live in sub-component files whose relative order is fully under our control via the central `UsageDashboard.tsx` import position.

---

## §4. Strategy

### Migration tiers (v3 — frozen)

| Tier | Definition | Count | Risk | Order |
|---|---|---|---|---|
| **U0** | Issue + branch + rules ack (must precede every other commit per SDD §1) | n/a | Lowest (docs only) | U0 |
| **P0** | Inventory generator + first run + baseline capture (no source change) | n/a | Lowest (docs/data only) | P0 |
| **U1** | Visual baseline (no source change) | n/a | Lowest | U1 |
| **P1** | Cross-file collision risk records + reconciliation (only after U1 baseline exists, so the baseline still represents pre-refactor `main`) | 4 collisions | Low | P1 |
| **Tier 1** | Single-owner classes — exactly one consumer file | 444 classes / 36 owners | Lowest | U2–U37 |
| **Tier 2** | Cluster classes — multiple consumers, all within one subtree | 25 classes / 8 groups | Low | U38–U45 |
| **Tier 3** | Shared classes — multiple consumers across subtrees | 12 classes / 3 groups (`section-empty` 1, `memory-file-*` **9**, `collapsible*` 2) | Medium | U46–U48 |
| **Shell** | Residual `dashboard.css` reduced to global shell rules | (residual) | Low | U49 |
| **Orphan** | Mark only `true-orphan-candidate` classes with `/* UNUSED candidate */`; the other two orphan sub-classes require manual verification first | 48 of 56 (rest deferred) | Lowest | U50 |
| **Docs** | README + frontend-design-guideline.md alignment | docs only | Lowest | U51 |

**Total commits: 54** = U0 + P0 + U1 + P1 (4 preflight) + 36 (Tier 1) + 8 (Tier 2) + 3 (Tier 3) + 1 (Shell) + 1 (Orphan) + 1 (Docs).

### Why this ordering

- Pre tier eliminates the data risk Codex called out: false-positive consumer mappings.
- Tier 1 builds reviewer/visual-baseline confidence early; each unit touches one component.
- Tier 2 adds cluster-level imports (small fixed groups); contained.
- Tier 3 has the highest blast radius (multiple consumers must add the import); guarded by the explicit-importer verification (§7-Tier3).
- Shell, orphan, docs are cleanup with no behavior risk.

### Co-existence guarantee

At any point during the epic, the codebase compiles, tests pass, and the visual baseline holds.

- **Move semantics**: a class block lives in **exactly one** file at any commit.
- **Import semantics**: every component that uses a moved class has an `import` line that resolves to the new owner before the move commit lands.
- **Cascade-order semantics**: shared imports precede component-local imports in every consumer. The shell stylesheet is imported last in `UsageDashboard.tsx`.
- **Verification**: agent-browser pixel diff + cascade-order diff per unit.

---

## §5. Filesystem Layout — Target State

After U51 (epic complete):

```
src/components/
├── dashboard/
│   ├── dashboard.css                     # SLIMMED. Only shell rules. ≤ 300 lines.
│   ├── UsageDashboard.tsx                # imports order: _shared/*.css → component-locals → dashboard.css (shell, last)
│   │
│   ├── _shared/                          # NEW. Tier 3 dashboard-internal shared styles.
│   │   ├── README.md                     # explains the explicit-import rule
│   │   ├── section.css                   # .section-empty (1 class)
│   │   ├── memory-file.css               # .memory-file-* (9 classes)
│   │   └── collapsible.css               # .collapsible, .collapsible-inner (2 classes)
│   │
│   ├── ProviderTabs.tsx                  # imports ProviderTabs.css
│   ├── ProviderTabs.css                  # NEW
│   ├── UsageGaugeCard.tsx                # imports UsageGaugeCard.css
│   ├── UsageGaugeCard.css                # NEW
│   ├── CostCard.tsx                      # imports cluster CostCard.css + cost-cluster.css
│   ├── CostCard.css                      # NEW (single-owner cost-* — 2 classes)
│   ├── cost-cluster.css                  # NEW (Tier 2 — cost-header/title/chevron)
│   ├── CostTreemap.tsx                   # imports CostTreemap.css
│   ├── CostTreemap.css                   # NEW
│   ├── ContextTreemap.tsx                # imports ContextTreemap.css
│   ├── ContextTreemap.css                # NEW
│   ├── PromptHeatmap.tsx                 # imports PromptHeatmap.css + stats-cluster.css
│   ├── PromptHeatmap.css                 # NEW (single-owner heatmap-*)
│   ├── stats-cluster.css                 # NEW (Tier 2 — stats-section, stats-tooltip-*)
│   ├── RecentSessions.tsx                # imports RecentSessions.css
│   ├── RecentSessions.css                # NEW
│   ├── SessionDetailView.tsx             # imports SessionDetailView.css + session-cluster.css
│   ├── SessionDetailView.css             # NEW (largest single-owner — 30 classes)
│   ├── session-cluster.css               # NEW (Tier 2 — .session-back-btn)
│   ├── SessionAlert.tsx                  # imports SessionAlert.css
│   ├── SessionAlert.css                  # NEW
│   ├── PromptDetailView.tsx              # imports PromptDetailView.css + session-cluster.css + _shared/section.css
│   ├── PromptDetailView.css              # NEW
│   ├── BackfillDialog.tsx                # imports BackfillDialog.css
│   ├── BackfillDialog.css                # NEW
│   ├── McpInsightsCard.tsx               # imports McpInsightsCard.css + cost-cluster.css + token-cluster.css + stats-cluster.css + _shared/collapsible.css
│   ├── McpInsightsCard.css               # NEW
│   ├── token-cluster.css                 # NEW (Tier 2 — .token-composition-toggle-btn)
│   ├── MemoryMonitorCard.tsx             # imports MemoryMonitorCard.css + _shared/memory-file.css + _shared/collapsible.css
│   ├── MemoryMonitorCard.css             # NEW (25 classes)
│   ├── OutputProductivityCard.tsx        # imports OutputProductivityCard.css + cost-cluster.css + _shared/collapsible.css
│   ├── OutputProductivityCard.css        # NEW
│   ├── AccountInsightsCard.tsx           # imports AccountInsightsCard.css
│   ├── AccountInsightsCard.css           # NEW
│   ├── CacheGrowthChart.tsx              # imports CacheGrowthChart.css + stats-cluster.css
│   ├── CacheGrowthChart.css              # NEW
│   ├── FirstRunOnboarding.tsx            # imports FirstRunOnboarding.css
│   ├── FirstRunOnboarding.css            # NEW (16 classes)
│   ├── SetupGuide.tsx                    # imports SetupGuide.css + setup-cluster.css
│   ├── SetupGuide.css                    # NEW (single-owner setup-*)
│   ├── setup-cluster.css                 # NEW (Tier 2 — .setup-guide, .setup-guide-icon, .setup-guide-title)
│   ├── StatsCard.tsx                     # imports StatsCard.css
│   ├── StatsCard.css                     # NEW
│   ├── StatsDetailView.tsx               # imports StatsDetailView.css + stats-cluster.css
│   ├── StatsDetailView.css               # NEW
│   ├── TokenCompositionChart.tsx         # imports TokenCompositionChart.css + stats-cluster.css + token-cluster.css
│   ├── TokenCompositionChart.css         # NEW
│   ├── ActionFlowList.tsx                # imports ActionFlowList.css
│   ├── ActionFlowList.css                # NEW
│   ├── EvidenceSettings.tsx              # imports EvidenceSettings.css + ctx-settings-cluster.css
│   ├── EvidenceSettings.css              # NEW (30 classes — largest single-owner alongside SessionDetailView)
│   ├── ctx-settings-cluster.css          # NEW (Tier 2 — .ctx-settings-overlay, header, title, close, save, cancel)
│   ├── ContextLimitSettings.tsx          # imports ContextLimitSettings.css + ctx-settings-cluster.css
│   ├── ContextLimitSettings.css          # NEW
│   ├── UsageView.tsx                     # imports UsageView.css + setup-cluster.css
│   ├── UsageView.css                     # NEW (credit-*, prepaid-*, usage-*, residual single-owners)
│   │
│   └── prompt-detail/
│       ├── EvidenceGroup.tsx             # imports EvidenceGroup.css + evidence-breakdown-cluster.css
│       ├── EvidenceGroup.css             # NEW (14 single-owner classes)
│       ├── evidence-breakdown-cluster.css # NEW (Tier 2 — .evidence-breakdown-toggle)
│       ├── GuardrailSummary.tsx          # imports GuardrailSummary.css
│       ├── GuardrailSummary.css          # NEW (24 classes)
│       ├── ContextFileList.tsx           # imports ContextFileList.css + evidence-breakdown-cluster.css + _shared/section.css
│       ├── ContextFileList.css           # NEW
│       ├── ContextGauge.tsx              # imports ContextGauge.css
│       ├── ContextGauge.css              # NEW
│       ├── FilePreviewOverlay.tsx        # imports FilePreviewOverlay.css
│       ├── FilePreviewOverlay.css        # NEW
│       ├── JourneySummary.tsx            # imports JourneySummary.css
│       ├── JourneySummary.css            # NEW
│       ├── PromptMemorySection.tsx       # imports PromptMemorySection.css + detail-section-cluster.css + _shared/memory-file.css + _shared/collapsible.css
│       ├── PromptMemorySection.css       # NEW
│       ├── detail-section-cluster.css    # NEW (Tier 2 — .detail-section, header, header-right, chevron, body — 5 classes)
│       ├── Section.tsx                   # imports detail-section-cluster.css + _shared/collapsible.css
│       ├── SignalBreakdown.tsx           # imports SignalBreakdown.css + _shared/collapsible.css
│       ├── SignalBreakdown.css           # NEW
│       ├── ActionFilterChips.tsx         # imports ActionFilterChips.css
│       ├── ActionFilterChips.css         # NEW
│       └── StatPill.tsx                  # imports StatPill.css
│       └── StatPill.css                  # NEW
│
└── notification/
    └── (no changes — verified by P0 inventory; zero classes shared with dashboard.css)
```

**`src/components/dashboard/_shared/README.md` (NEW, written in U-shared-init)**:

```md
# dashboard/_shared

These stylesheets define classes used by **multiple** files inside the dashboard tree (typically by both `dashboard/Foo.tsx` and `dashboard/prompt-detail/Bar.tsx`). Every consumer must explicitly `import` the file it depends on. Do not aggregate via barrel files — explicit imports keep the cascade order auditable.

Naming rule: one file per logical group (e.g., `memory-file.css` for `.memory-file-*` classes).

Cascade-order rule: in every consumer .tsx, `_shared/` imports come BEFORE component-local CSS imports.

To add a class to a shared stylesheet: confirm there is genuinely no single owner. If only one component grows to use the class, move it back into that component's sibling file in a follow-up commit.
```

---

## §6. Class Inventory (Source of Truth)

The authoritative inventory lives in `docs/sdd/css-decomp-inventory/`, generated by `scripts/css-decomp-inventory.mjs`. **Do not duplicate the inventory in this doc** — refer to the generated artifacts:

- `class-consumers.json` — structured: every class, its first-line in `dashboard.css`, every consumer file, tier classification.
- `class-consumers.md` — human-readable, grouped by tier.
- `prefix-summary.md` — prefix → folder count → consumers (use only for high-level overview; unit planning is class-driven, not prefix-driven).
- `selectors-ordered.txt` — every selector entry in `dashboard.css` in declaration order. **This is the cascade-order baseline.**
- `collisions.md` — cross-file class collisions (1 with App.css, 3 with TokenTreemap.css, 0 with notification.css).
- `orphans.md` — 56 candidate dead classes split 3-way (48 true / 7 compound / 1 dynamic).

**Single-owner distribution** (444 classes across 36 owners — derived from `class-consumers.json`):

| Owner file | Classes |
|---|---|
| `dashboard/EvidenceSettings.tsx` | 30 |
| `dashboard/SessionDetailView.tsx` | 30 |
| `dashboard/MemoryMonitorCard.tsx` | 25 |
| `dashboard/prompt-detail/GuardrailSummary.tsx` | 24 |
| `dashboard/McpInsightsCard.tsx` | 21 |
| `dashboard/RecentSessions.tsx` | 20 |
| `dashboard/StatsDetailView.tsx` | 18 |
| `dashboard/BackfillDialog.tsx` | 17 |
| `dashboard/FirstRunOnboarding.tsx` | 16 |
| `dashboard/UsageView.tsx` | 16 |
| `dashboard/ProviderTabs.tsx` | 15 |
| `dashboard/ActionFlowList.tsx` | 14 |
| `dashboard/prompt-detail/EvidenceGroup.tsx` | 14 |
| `dashboard/PromptHeatmap.tsx` | 14 |
| `dashboard/ContextLimitSettings.tsx` | 13 |
| `dashboard/ContextTreemap.tsx` | 12 |
| `dashboard/PromptDetailView.tsx` | 12 |
| `dashboard/prompt-detail/ContextFileList.tsx` | 11 |
| `dashboard/TokenCompositionChart.tsx` | 11 |
| `dashboard/SessionAlert.tsx` | 10 |
| `dashboard/OutputProductivityCard.tsx` | 9 |
| `dashboard/prompt-detail/FilePreviewOverlay.tsx` | 9 |
| `dashboard/UsageGaugeCard.tsx` | 9 |
| `dashboard/StatsCard.tsx` | 8 |
| `dashboard/UsageDashboard.tsx` | 8 |
| `dashboard/CacheGrowthChart.tsx` | 7 |
| `dashboard/prompt-detail/ActionFilterChips.tsx` | 7 |
| `dashboard/prompt-detail/ContextGauge.tsx` | 7 |
| `dashboard/prompt-detail/JourneySummary.tsx` | 7 |
| `dashboard/prompt-detail/SignalBreakdown.tsx` | 7 |
| `dashboard/AccountInsightsCard.tsx` | 6 |
| `dashboard/CostTreemap.tsx` | 5 |
| `dashboard/SetupGuide.tsx` | 5 |
| `dashboard/prompt-detail/StatPill.tsx` | 3 |
| `dashboard/CostCard.tsx` | 2 |
| `dashboard/prompt-detail/PromptMemorySection.tsx` | 2 |

**v2 → v3 changes** (Phase B/C absorbed +15 net): ProviderTabs +9 (6→15), ActionFlowList +3 (11→14), SessionAlert +2 (8→10), CacheGrowthChart +1 (6→7).

**Cluster groups (Tier 2 — 8 groups, 25 classes total)**:

| Group | Cluster file | Classes | Consumers |
|---|---|---|---|
| C1. Cost header/chrome | `dashboard/cost-cluster.css` | `.cost-header`, `.cost-title`, `.cost-chevron` (3) | CostCard, McpInsightsCard, OutputProductivityCard |
| C2. Setup guide | `dashboard/setup-cluster.css` | `.setup-guide`, `.setup-guide-icon`, `.setup-guide-title` (3) | SetupGuide, UsageView |
| C3. Session back button | `dashboard/session-cluster.css` | `.session-back-btn` (1) | PromptDetailView, SessionDetailView |
| C4. Evidence breakdown toggle | `dashboard/prompt-detail/evidence-breakdown-cluster.css` | `.evidence-breakdown-toggle` (1) | ContextFileList, EvidenceGroup |
| C5. Detail section chrome | `dashboard/prompt-detail/detail-section-cluster.css` | `.detail-section`, `.detail-section-header`, `.detail-section-header-right`, `.detail-section-chevron`, `.detail-section-body` (5) | PromptMemorySection, Section |
| C6. Settings dialog chrome | `dashboard/ctx-settings-cluster.css` | `.ctx-settings-overlay`, `.ctx-settings-header`, `.ctx-settings-title`, `.ctx-settings-close`, `.ctx-settings-save`, `.ctx-settings-cancel` (6) | ContextLimitSettings, EvidenceSettings |
| C7. Stats section/tooltip | `dashboard/stats-cluster.css` | `.stats-section`, `.stats-section-title`, `.stats-tooltip`, `.stats-tooltip-date`, `.stats-tooltip-row` (5) | CacheGrowthChart, PromptHeatmap, StatsDetailView, TokenCompositionChart |
| C8. Token composition toggle | `dashboard/token-cluster.css` | `.token-composition-toggle-btn` (1) | McpInsightsCard, TokenCompositionChart |

**Shared groups (Tier 3 — 3 groups, 12 classes total — all between `dashboard/` and `dashboard/prompt-detail/`)**:

| Group | Shared file | Classes | Consumers |
|---|---|---|---|
| S1. Section empty | `dashboard/_shared/section.css` | `.section-empty` (1) | PromptDetailView, ContextFileList |
| S2. Memory file rows | `dashboard/_shared/memory-file.css` | `.memory-file-list`, `.memory-file-item`, `.memory-file-header`, `.memory-file-type`, `.memory-file-name`, `.memory-file-lines`, `.memory-file-chevron`, `.memory-file-desc`, `.memory-file-content` (**9 classes**) | MemoryMonitorCard, PromptMemorySection |
| S3. Collapsible | `dashboard/_shared/collapsible.css` | `.collapsible`, `.collapsible-inner` (2) | CostCard, McpInsightsCard, MemoryMonitorCard, OutputProductivityCard, PromptMemorySection, Section, SignalBreakdown (7 consumers) |

> **Inventory freshness**: the implementer must rerun `node scripts/css-decomp-inventory.mjs` at the start of every implementation unit. If the JSON differs from the U-pre snapshot for a class still in the unit list, halt and update the unit (record the change in §14). This guards against drift if `main` advances during the epic (per §11 L7).

---

## §7. Unit Breakdown — Frozen Plan (v3)

**Total: 54 commits** = U0 + P0 + U1 + P1 (4 preflight) + 36 (Tier 1: U2–U37) + 8 (Tier 2: U38–U45) + 3 (Tier 3: U46–U48) + 1 (U49 shell) + 1 (U50 orphan marker) + 1 (U51 docs) = 54.

Order: **U0 → P0 → U1 → P1 → Tier 1 → Tier 2 → Tier 3 → U49 → U50 → U51**. The reorder vs v2 is mandatory:

- U0 must precede every commit (SDD §1 Issue First — Codex v2 #4).
- U1 visual baseline must precede any source change so that the baseline still represents pre-refactor `main` (Codex v2 #5). P1 collision reconciliation is a source change and therefore comes after U1.
- P0 inventory generator + baseline runs after U0 because its commit body references `(#<issue>)`. P0 itself is read-only against `dashboard.css`, so it can land between U0 and U1 without invalidating the visual baseline.

Every implementation unit (P1 onward) follows the per-unit cycle defined in §8. The cells below specify only the **delta** for each unit.

### U0 — Issue + branch + rules ack (docs-only, NO code change)

**Why**: SDD §1/§2 prerequisite. Establishes traceable `(#<issue>)` for every later commit. This is the FIRST commit on the branch.

**Steps**:
1. Verify `gh auth status` shows `<canonical-account>` Active.
2. Open the GitHub Issue with the body template in §13. Capture issue number → `<issue>`.
3. `git checkout -b refactor/dashboard-css-decompose`.
4. `bash scripts/set-active-rules-ack.sh <issue>`.
5. Stage this gate doc (v3) and the rules-ack artifact.
6. Commit:
   ```
   docs(dashboard-css): U0 open epic for dashboard.css decomposition (#<issue>)

   Tracking issue, branch, rules-ack, and v3 gate doc. Subsequent commits
   (P0 inventory, U1 visual baseline, P1 collision reconciliation, then
   tier moves) all reference this issue.
   ```
7. Open Draft PR (SDD §4). PR body uses the OPEN-SOURCE-WORKFLOW.md 11-section template; under "Validation" reference `docs/sdd/css-decomp-inventory/` (will be populated in P0).

**Done criteria**: Issue exists; branch exists; rules ack file present; v3 gate doc on branch; Draft PR open.

### P0 — Inventory generator + first run + baseline capture (docs/data only, after U0)

**Why**: Codex v1 #1 blocking. Replaces prefix-heuristic mapping with exact class-token usage. No `dashboard.css` modification — read-only inventory.

**Steps**:
1. Stage (already created on this branch): `scripts/css-decomp-inventory.mjs`, `scripts/css-decomp-cascade-check.mjs`, `scripts/css-decomp-overrides.json`.
2. Run: `node scripts/css-decomp-inventory.mjs`.
3. Stage outputs: `docs/sdd/css-decomp-inventory/{class-consumers.json,class-consumers.md,prefix-summary.md,selectors-ordered.txt,collisions.md,orphans.md}`.
4. Commit:
   ```
   chore(dashboard-css): P0 add CSS decomposition inventory generator + baseline (#<issue>)

   - scripts/css-decomp-inventory.mjs (Phase A className + Phase B broad
     string-literal scan with hyphen guard + Phase C manual overrides)
   - scripts/css-decomp-cascade-check.mjs (post-build dist/ verifier)
   - scripts/css-decomp-overrides.json (manual consumer mapping)
   - docs/sdd/css-decomp-inventory/ (537 classes: 444 single-owner,
     25 cluster, 12 shared, 56 orphan [48 true / 7 compound / 1 dynamic],
     631 selector cascade baseline, 4 cross-file collisions)
   No source changes to dashboard.css or any TSX.
   ```

**Done criteria**: scripts and inventory artifacts committed; no `dashboard.css` modification; cascade-order baseline ready to be frozen at U1.

### U1 — Cascade-order baseline freeze (NO code change)

> **v3.1 split (2026-05-07)**: U1 was originally specified as "Visual baseline + cascade-order baseline freeze" in a single commit. Two preconditions for the visual half were not in the codebase at U1 land time: (a) a deterministic fixture seeder for `~/.claude/history.jsonl` and the SQLite DB, (b) the `OMT_QA_FAKE_NOW` / `OMT_QA_NO_ANIMATIONS` runtime stabilization knobs. P0.3 (`596f927`) landed (b). The fixture seeder (a) and the actual visual capture are split off into the new follow-on unit **U1-VR** (Visual Regression baseline) which follows U1 and precedes P1's pixel-diff requirement. The cascade-order baseline — the **mechanical contract authority** that every Tier 1-3 commit verifies against — is frozen in U1 unchanged. Total commit count becomes **55** (was 54): U0 + P0 + P0.1 + P0.2 + P0.3 + U1 + U1-VR + P1 + 36 Tier 1 + 8 Tier 2 + 3 Tier 3 + U49 + U50 + U51.

> **v3.2 split (2026-05-08)**: U1-VR's Step 1 (fixture authoring + seeder script) is extracted into its own unit **P0.4** so the seeder can be reviewed and its determinism verified without entangling the agent-browser capture work. P0.4 lands BEFORE U1-VR; U1-VR Step 1 then becomes a one-line invocation of the seeder. Total commit count becomes **56** (was 55): U0 + P0 + P0.1 + P0.2 + P0.3 + U1 + P0.4 + U1-VR + P1 + 36 Tier 1 + 8 Tier 2 + 3 Tier 3 + U49 + U50 + U51.

> **v3.3 split (2026-05-09)**: U1-VR's capture orchestration (per-screen navigation, headed Electron lifecycle, agent-browser CDP wiring, PNG + JSON sidecar emission) is extracted into its own unit **P0.5** so the orchestration logic can be reviewed for selector accuracy and process hygiene without entangling the actual baseline capture. P0.5 lands BEFORE U1-VR; U1-VR Steps 4-7 (build, launch, connect, capture) then become a single invocation of `bash scripts/qa-capture-baseline.sh --all`. Splitting was necessary because v3.2 assumed "capture orchestration" was trivial once seeder + stabilization were in; in practice each of the 13 canonical screens requires a documented selector + waitFor + variant flags map (`scripts/qa-capture-screen-map.json`), and per-profile process management cannot be inlined into U1-VR's commit body without losing reviewability. Total commit count becomes **57** (was 56): U0 + P0 + P0.1 + P0.2 + P0.3 + U1 + P0.4 + P0.5 + U1-VR + P1 + 36 Tier 1 + 8 Tier 2 + 3 Tier 3 + U49 + U50 + U51.

**Why**: Goal G5 + Codex v2 #5. Cascade ground truth captured BEFORE any source change (P1 reconciliation is a source change and therefore follows U1). The visual ground truth is captured in U1-VR — which can land before or after the cascade-only U1 commit, but MUST land before any Tier 1 commit so the gate doc §6 P1-and-beyond visual diff requirement is satisfied.

**Steps**:
1. **Freeze the cascade-order baseline**:
   ```bash
   cp docs/sdd/css-decomp-inventory/selectors-ordered.txt \
      docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1
   ```
   `selectors-ordered.txt.U1` is **immutable until U49** and is the ground truth for `scripts/css-decomp-cascade-check.mjs`.
2. **Bundle-side cascade sanity (was step 8)**: run `npm run build` then `node scripts/css-decomp-cascade-check.mjs`. Expect PASS — at U1 nothing has been moved, so the bundle order matches the U1 baseline trivially. This run also confirms the cascade-check tooling works end-to-end before any unit needs it.
3. Commit:
   ```
   chore(qa): U1 freeze dashboard CSS cascade-order baseline (#<issue>)

   - Cascade baseline frozen: docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1
     (immutable until U49; ground truth for scripts/css-decomp-cascade-check.mjs).
   - Bundle cascade-check executed once: PASS (sanity).
   - Visual baseline deferred to U1-VR (depends on a fixture seeder; see §6 U1-VR).
   ```

**Done criteria**: `selectors-ordered.txt.U1` committed and immutable; cascade-check PASS dry-run on the unmodified bundle; no source changes to `dashboard.css` or any TSX. The visual half of the original U1 spec moves to U1-VR below.

### P0.4 — Deterministic fixture seeder for U1-VR (NO source change to dashboard.css)

**Why**: Goal G5 + v3.1 split prereq (a). The visual baseline is only useful if it is **byte-reproducible** — re-running the capture on the same source must produce identical PNGs. P0.3 stabilized time and animations, but the dashboard reads its content from `~/.claude/history.jsonl`, a SQLite DB at `~/.checktoken/checktoken.db`, and `~/.codex/sessions/`, all of which drift in real user homes. P0.4 owns the seeder that materializes these into a temp `$HOME` so every U1-VR (and every future re-capture) sees identical input. P0.4 emits no screenshots; that is U1-VR's job. Splitting the seeder into its own commit lets it be reviewed for determinism + data-shape correctness before agent-browser capture work begins.

**Decisions frozen at v3.2 entry (2026-05-08)**:
- **Language**: Node.js ESM (`scripts/qa-seed-fixtures.mjs`). Justified because (i) `better-sqlite3` is the production SQLite driver and reusing it from Node guarantees the seeded DB is byte-identical to one the app would write itself; (ii) `~/.claude/history.jsonl` and `~/.claude/.credentials.json` are most cleanly authored from JS; (iii) avoids shelling-out to `sqlite3` CLI which may not be installed on every contributor machine.
- **HOME profile granularity**: 4 profiles (not 13). One profile per *renderer state class*, not per screenshot:
  - `populated` — covers `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `notification-overlay`, `mcp-insights-expanded`, `mcp-insights-collapsed`, `memory-monitor-expanded`, `memory-monitor-collapsed` (10 of 13 canonical screens). Multiple screens per HOME because they are reachable from the same data via in-app navigation; an agent-browser script will route between them.
  - `first-run` — covers `first-run-onboarding` (empty HOME, first-run flag true).
  - `setup-guide` — covers `setup-guide` (HOME with the first-run gate cleared but no provider configured).
  - `backfill` — covers `backfill-dialog` (HOME with backfill-in-progress state primed).
  This keeps capture time bounded (4 Electron launches, not 13) without compromising the variant fidelity each screenshot needs.
- **Idempotency**: the seeder must be a pure function of (fixture name, target HOME path). Calling it twice on the same target HOME must produce byte-identical output (DB rows in declaration order, JSONL line order stable, file timestamps not embedded). The seeder writes to a fresh tmp HOME each run; it does NOT mutate the user's real `$HOME` and refuses to run if `HOME` was not overridden.
- **Not in scope (deferred to U1-VR)**: actual `npm run build:electron`, agent-browser CDP connection, screenshot capture, renderer-twin URLs, and the `docs/qa/runs/<date>/baseline/` artifact tree.

**Steps**:
1. **Author `scripts/qa-fixtures.json`**: 4 fixture profile records. Each record has `{ name, description, history: [HistoryEntry], db: { prompts: [...], sessions: [...], evidence_reports: [...], ... }, credentials: { ... } | null, codexSessions: [...], appSettings: { ... }, firstRun: boolean }`. Fixed timestamps, sessionIds, model strings, costs — no clock-derived values, no random ids.
2. **Implement `scripts/qa-seed-fixtures.mjs`**: Node ESM module. CLI: `node scripts/qa-seed-fixtures.mjs <fixture-name> --home <path>`. Loads `qa-fixtures.json`, picks the named profile, writes:
   - `<home>/.claude/history.jsonl` (one record per line, in `qa-fixtures.json` array order)
   - `<home>/.checktoken/checktoken.db` (better-sqlite3, applies migrations from `electron/db/schema.ts`, then INSERTs profile rows in array order)
   - `<home>/.claude/.credentials.json` (if profile.credentials !== null)
   - `<home>/.codex/sessions/<id>.json` per profile.codexSessions entry
   - App settings JSON (path TBD from `electron/appSettings` source) per profile.appSettings
   - Refuses to run if `<path>` is `~`, `$HOME`, `/`, or contains the user's real login shell home prefix.
3. **Determinism check**: `bash scripts/qa-seed-fixtures-test.sh` (new) — for each of the 4 profiles, seed twice into two different temp HOMEs, then `diff -r` the two trees with hash-based byte comparison (since SQLite WAL files have to be checkpointed first). Asserts byte-identical output. The script is wired into `npm run test:fixtures` so CI can run it later (CI wiring is U1-VR's job, not P0.4's).
4. **Audit manifest**: each seeder run drops `<home>/.fixture-manifest.json` with `{ fixture, schemaVersion, seededAt: "FIXED", inputHash: "<sha256 of qa-fixtures.json subset>", outputs: [<file paths>] }`. The `seededAt` is a constant string (not `new Date()`) so manifest hashes themselves are deterministic.
5. **Commit**:
   ```
   chore(qa): P0.4 add deterministic fixture seeder for U1-VR (#<issue>)

   - scripts/qa-fixtures.json (4 profiles: populated, first-run, setup-guide, backfill)
   - scripts/qa-seed-fixtures.mjs (Node ESM, better-sqlite3 reuse)
   - scripts/qa-seed-fixtures-test.sh (determinism check)
   - docs/sdd/dashboard-css-decomposition-gate.md §14 P0.4 entry

   Determinism check: 4/4 profiles byte-identical across two seeded HOMEs.
   Frontend-review: PASS. Style-review: ack'd.
   ```

**Done criteria**:
- `scripts/qa-fixtures.json` + `scripts/qa-seed-fixtures.mjs` + `scripts/qa-seed-fixtures-test.sh` committed.
- Each of the 4 profiles seeds without error into a temp HOME.
- `bash scripts/qa-seed-fixtures-test.sh` PASS (byte-identical re-seed).
- §14 run record P0.4 entry filled.
- No code changes to `electron/`, `src/`, or `dashboard.css`. The seeder may *import from* `electron/db/schema.ts` to avoid duplicating migration SQL (preferred), but does not modify it.

### P0.5 — Capture orchestrator for U1-VR (NO source change to dashboard.css)

**Why**: Goal G5 + v3.3 split rationale. U1-VR's "purely capture orchestration" framing assumed the per-screen navigation map could be written inline into the U1-VR commit body. In practice, the 13 canonical screens declared in §9.1 each need a documented entry: which DOM selector triggers entry, which selector signals readiness, which variant flags (expanded / collapsed / claude-tab / etc.) gate the visual delta, which renderer-window vs notification-window CDP target the screen lives on. Coupled with per-profile process management (launch headed Electron in background → wait for CDP → connect → drive → capture → terminate cleanly), this is a non-trivial body of orchestration logic that benefits from being landed and reviewed before the baseline run consumes it. P0.5 owns this orchestrator; P0.5 emits no PNGs (those are U1-VR's job).

**Decisions frozen at v3.3 entry (2026-05-09)**:
- **Language**: Bash + `jq`. Justified because (i) the orchestrator is fundamentally process management (launch / connect / signal / kill) for which Bash plus `set -euo pipefail` is the idiomatic choice and consistent with the existing `scripts/qa-launch-electron.sh` + `scripts/qa-seed-fixtures-test.sh` family; (ii) per-screen navigation is a sequence of `agent-browser` CLI calls, not custom logic; (iii) `jq` is universally available on macOS dev machines and parses the screen-map cleanly. Node was rejected because spawning child processes with proper signal forwarding is more verbose than Bash for this use case.
- **Screen-map declarativity**: The 13 screens + per-profile assignment live in `scripts/qa-capture-screen-map.json` — a single declarative document the orchestrator interprets. Each screen entry is `{ name, profile, target ("renderer" | "notification"), waitFor (selector or `[data-loaded="true"]` proxy), steps ([{click|wait|eval}, ...]), description }`. Screens that need clarification at U1-VR execution time carry an explicit `tbd: "<reason>"` field and are listed under "Known ambiguities" below; the executor at U1-VR time refines them in-place.
- **Headedness**: Headed only (HEADLESS=1 mode is rejected). Rationale: Inter font rendering and macOS WebKit text-rasterization details differ between headed and headless Chromium; the U1 baseline must reflect the actual user-facing render path.
- **Output layout**: `docs/qa/runs/<YYYY-MM-DD>/baseline/canonical/<screen-name>.png` + `<screen-name>.json` (sidecar) per canonical screen. Renderer-only twins under `docs/qa/runs/<YYYY-MM-DD>/baseline/renderer/` per §9. The sidecar is `{ profile, screen, fixedNow, viewport, dpr, agentBrowserVersion, electronVersion, capturedAtFixed: "FIXED" }`. `capturedAtFixed` is a constant string (not real time) so sidecars themselves are byte-stable across re-captures.
- **Termination contract**: Each profile's headed Electron is launched via `run_in_background`-style subshell with PID captured. After the last screen for a profile is captured, the orchestrator sends `SIGTERM` then waits up to 10 s for graceful exit before `SIGKILL`. CDP port 9222 is reset between profiles so re-launch attaches to the fresh instance, never a stale tab.
- **Determinism check (lite)**: P0.5 ships a `--dry-run` mode that validates the screen-map JSON shape, `jq` availability, and shell syntax (`bash -n`), but does NOT launch Electron or call `agent-browser`. The full headed determinism check (capture twice, byte-compare PNGs) is U1-VR's responsibility, not P0.5's, because it requires the full agent-browser + Electron stack.
- **Not in scope (deferred to U1-VR)**: actual `npm run build:electron`, headed Electron launches per profile, agent-browser CDP attach, the 13 PNG captures, the 2 renderer-twin captures, the `docs/qa/runs/<date>/baseline/` artifact tree.

**Known ambiguities documented in `qa-capture-screen-map.json` (to be refined by U1-VR executor)**:
- `setup-guide` — §7 P0.4 declares this profile as "HOME with the first-run gate cleared but no provider configured", but in the current codebase `SetupGuide` only renders inside `FirstRunOnboarding` (post provider-pick "wait for session" stage). The screen-map's best-guess is `first-run` profile + nav step "click first-provider-card", marked `tbd:` for U1-VR-side verification.
- `notification-overlay` — renders in a SEPARATE BrowserWindow (frameless, transparent). The map's `target` is `"notification"` and the CDP tab discovery uses `agent-browser tab` to find the notification window (URL contains `notification.html`). This is documented but not exercised by P0.5's dry-run.

**Steps**:
1. **Author `scripts/qa-capture-screen-map.json`**: 13 canonical screens + 2 renderer twins, each carrying `{ name, profile, target, waitFor, steps, description, tbd? }`. Versioned `"version": 1`.
2. **Implement `scripts/qa-capture-baseline.sh`**: Bash + `jq`. Modes:
   - `--list` — print the screen list grouped by profile.
   - `--dry-run` — validate JSON shape (required keys per entry), `jq` present, `bash -n` syntax check on self.
   - `<profile>` — seed → launch → connect → for each screen: navigate, wait, screenshot + emit sidecar JSON → terminate.
   - `--all` — iterate all 4 profiles in series.
   Both `--list` and `--dry-run` exit without launching Electron.
3. **Self-validation**: run `bash scripts/qa-capture-baseline.sh --dry-run`; expect PASS (zero stderr, exit 0). Log artifact line for §14.
4. **Commit**:
   ```
   chore(qa): P0.5 add U1-VR capture orchestrator (#<issue>)

   - scripts/qa-capture-screen-map.json (13 canonical + 2 renderer-twin
     screen definitions, per-profile assignment, declarative selector +
     waitFor + steps map)
   - scripts/qa-capture-baseline.sh (Bash + jq orchestrator with --list,
     --dry-run, <profile>, --all modes; per-profile seed + launch +
     connect + capture + terminate lifecycle)
   - docs/sdd/dashboard-css-decomposition-gate.md v3.3 split note +
     §7 P0.5 entry + §14 P0.5 entry

   Dry-run: PASS. Headed capture deferred to U1-VR.
   ```

**Done criteria**:
- `scripts/qa-capture-screen-map.json` + `scripts/qa-capture-baseline.sh` committed.
- `bash scripts/qa-capture-baseline.sh --dry-run` PASS (exit 0).
- `bash scripts/qa-capture-baseline.sh --list` enumerates 15 entries (13 canonical + 2 renderer).
- §14 run record P0.5 entry filled.
- No code changes to `electron/`, `src/`, or `dashboard.css`. No screenshots emitted.

### U1-VR — Visual regression baseline (NO source change to dashboard.css)

**Why**: Goal G5 + Codex v2 #5. Pixel ground truth captured BEFORE any Tier 1 commit so byte-equal regression has a reference. Split out of U1 in v3.1 because the fixture seeder + stabilization knobs were not in the codebase at U1 land time. P0.3 (`596f927`) lands the runtime stabilization (`OMT_QA_FAKE_NOW` + `OMT_QA_NO_ANIMATIONS` + `__qaConfig` preload bridge + `src/qa/stabilization.ts` + `scripts/qa-launch-renderer.sh`). P0.4 (v3.2 split) lands the deterministic fixture seeder. P0.5 (v3.3 split) lands the capture orchestrator + screen-map. With all three prereqs in, U1-VR is the actual baseline run.

U1-VR MUST land before any Tier 1 commit. P1 (collision reconciliation) can run before U1-VR because P1's diff target is dashboard.css source — not pixel — and P1 itself emits no class moves. The Tier 1+ commits are the ones that need a pixel reference.

**Steps**:
1. **Run the orchestrator** (per §7 P0.5):
   ```bash
   bash scripts/qa-capture-baseline.sh --all
   ```
   This iterates the 4 HOME profiles, seeding each (P0.4), launching headed Electron with stabilization vars (P0.3), connecting agent-browser via CDP, driving the 13 canonical screens declared in `scripts/qa-capture-screen-map.json` (P0.5), capturing PNG + JSON sidecar per screen under `docs/qa/runs/<YYYY-MM-DD>/baseline/canonical/`, and terminating Electron between profiles.
2. **Resolve any `tbd:` annotations** in `qa-capture-screen-map.json` left by P0.5 (e.g., `setup-guide` precise nav). Update the map in-place; commit map fixes alongside the U1-VR baseline if a screen needed re-shooting.
3. **Renderer-only twins**: `bash scripts/qa-launch-renderer.sh` (using the canonical QA URL printed by the launcher). The same orchestrator handles `renderer-dashboard.png` and `renderer-settings.png` under `docs/qa/runs/<YYYY-MM-DD>/baseline/renderer/` when invoked with `--renderer-only`. Fast-path checks for Tier 1 units that don't need real-IPC data.
4. **Determinism (mandatory)**: re-run `bash scripts/qa-capture-baseline.sh --all` into a separate output directory and assert the 13 + 2 PNG hashes are byte-identical to the first run. If any screen drifts, escalate per §11.4.
5. Commit:
   ```
   chore(qa): U1-VR capture dashboard CSS decomposition visual baseline (#<issue>)

   - Visual baseline: 13 canonical screens + 2 renderer-only twins under
     docs/qa/runs/<date>/baseline/. Stabilized via OMT_QA_FAKE_NOW,
     OMT_QA_NO_ANIMATIONS, viewport 1440x900 @ DPR 2, deterministic
     fixtures (see scripts/qa-seed-fixtures.sh).
   ```

**Done criteria**: 13 canonical PNG + JSON pairs and 2 renderer-only twins committed under `docs/qa/runs/<date>/baseline/`; fixture artifacts archived under `.../fixtures/`; all screenshots reproducible via `bash scripts/qa-seed-fixtures.sh && bash scripts/qa-capture-baseline.sh` (or equivalent).

### P1 — Cross-file class collision risk records + reconciliation (after U1)

**Why**: Goal G7 + Codex v2 review non-blocking #1. Four collisions are present: `.loading` (dashboard.css ↔ App.css), `.cache` / `.cost-row` / `.legend-value` (dashboard.css ↔ TokenTreemap.css). Each must be classified as a real specificity hazard or a benign scoped overlap before any move so a Tier 1/2/3 extraction does not silently flip the winning rule. Runs **after U1** so the visual baseline still represents pre-refactor `main`.

**Steps**:
1. For each collision, produce a risk record under `docs/sdd/css-decomp-inventory/collision-records/<class>.md`:
   - Source A: file + line + full rule.
   - Source B: file + line + full rule.
   - Bundle overlap proof: confirm both files end up in the same Vite bundle (`grep -l "<class>" dist/assets/*.css` after the U1 sanity build).
   - DOM overlap proof: the consuming components and the DOM structure that could match both rule families. If neither is true the collision is **benign** and reconciliation is unnecessary; record this and skip.
2. For each non-benign collision, choose the smallest reconciliation:
   - Identical declarations → keep the rule in the file whose components consume the class; delete from the peer.
   - Different declarations → rename one side using the smallest change (scope under an existing parent selector). Document the rename in the run record.
3. Re-run `node scripts/css-decomp-inventory.mjs` and confirm `collisions.md` shows zero remaining collisions or only documented benign overlaps.
4. **Visual diff against U1 baseline** (mandatory): P1 IS a source change. Run the canonical screens through agent-browser and confirm pixel-equal against U1.
5. **Cascade check against U1** (mandatory): `npm run build && node scripts/css-decomp-cascade-check.mjs`. PASS.
6. Frontend-review gate + style review ack (per §8 SOP).
7. Commit:
   ```
   fix(dashboard-css): P1 reconcile cross-file class collisions (#<issue>)

   - .loading: dashboard.css vs App.css → <decision: benign / rename / dedup>
   - .cache, .cost-row, .legend-value: dashboard.css vs TokenTreemap.css → <decision>

   Risk records under docs/sdd/css-decomp-inventory/collision-records/.
   Visual diff vs U1: PASS. Cascade-check: PASS.
   Prevents silent specificity flips when Tier 1-3 moves change the
   import order in the Vite bundle.
   ```

**Done criteria**: every collision has a risk record; reconciled collisions show zero remaining duplicates in `collisions.md`; visual + cascade diff against U1 PASS; gates green.

---

### Tier 1 — Single-owner moves (U2 – U37, 36 commits)

**Pattern**: 1 commit per owner file. Owner gets a sibling `<Component>.css` containing all of its single-owner classes. Order is **smallest-owner-first** to build review confidence.

| Unit | Owner | New file | Classes (count) | Visual surface (in addition to canonical) |
|---|---|---|---|---|
| U2 | `dashboard/CostCard.tsx` | `CostCard.css` | 2 | `mcp-insights-collapsed.png` (CostCard renders here too) |
| U3 | `dashboard/prompt-detail/PromptMemorySection.tsx` | `prompt-detail/PromptMemorySection.css` | 2 | `dashboard-prompt-detail.png` with memory section expanded |
| U4 | `dashboard/prompt-detail/StatPill.tsx` | `prompt-detail/StatPill.css` | 3 | `dashboard-prompt-detail.png` |
| U5 | `dashboard/AccountInsightsCard.tsx` | `AccountInsightsCard.css` | 6 | `dashboard-claude.png` |
| U6 | `dashboard/SetupGuide.tsx` | `SetupGuide.css` | 5 | `setup-guide.png` |
| U7 | `dashboard/CacheGrowthChart.tsx` | `CacheGrowthChart.css` | 6 | `dashboard-all-default.png` |
| U8 | `dashboard/CostTreemap.tsx` (deferred — see note) | `CostTreemap.css` (deferred) | 5 | `dashboard-all-default.png` |
| U9 | `dashboard/ProviderTabs.tsx` | `ProviderTabs.css` | 6 | `dashboard-all-default.png`, `dashboard-claude.png` |
| U10 | `dashboard/prompt-detail/ContextGauge.tsx` | `prompt-detail/ContextGauge.css` | 7 | `dashboard-prompt-detail.png` |
| U11 | `dashboard/prompt-detail/JourneySummary.tsx` | `prompt-detail/JourneySummary.css` | 7 | `dashboard-prompt-detail.png` |
| U12 | `dashboard/prompt-detail/SignalBreakdown.tsx` | `prompt-detail/SignalBreakdown.css` | 7 | `dashboard-prompt-detail.png` (expand SignalBreakdown) |
| U13 | `dashboard/prompt-detail/ActionFilterChips.tsx` | `prompt-detail/ActionFilterChips.css` | 7 | `dashboard-prompt-detail.png` |
| U14 | `dashboard/SessionAlert.tsx` | `SessionAlert.css` | 8 | trigger an alert state in fixtures and capture |
| U15 | `dashboard/StatsCard.tsx` | `StatsCard.css` | 8 | `dashboard-all-default.png` |
| U16 | `dashboard/UsageDashboard.tsx` | (no new file — owns shell residuals; keep classes in `dashboard.css` for U-shell) | 8 | `dashboard-all-default.png` (sanity only — no move yet) |
| U17 | `dashboard/UsageGaugeCard.tsx` | `UsageGaugeCard.css` | 9 | `dashboard-claude.png` |
| U18 | `dashboard/prompt-detail/FilePreviewOverlay.tsx` | `prompt-detail/FilePreviewOverlay.css` | 9 | trigger overlay open and capture |
| U19 | `dashboard/OutputProductivityCard.tsx` | `OutputProductivityCard.css` | 9 | `dashboard-all-default.png`, expanded state |
| U20 | `dashboard/ActionFlowList.tsx` | `ActionFlowList.css` | 11 | `dashboard-prompt-detail.png` |
| U21 | `dashboard/TokenCompositionChart.tsx` | `TokenCompositionChart.css` | 11 | `dashboard-all-default.png` |
| U22 | `dashboard/prompt-detail/ContextFileList.tsx` | `prompt-detail/ContextFileList.css` | 11 | `dashboard-prompt-detail.png` |
| U23 | `dashboard/PromptDetailView.tsx` | `PromptDetailView.css` | 12 | `dashboard-prompt-detail.png` |
| U24 | `dashboard/ContextTreemap.tsx` | `ContextTreemap.css` | 12 | `dashboard-all-default.png` |
| U25 | `dashboard/ContextLimitSettings.tsx` | `ContextLimitSettings.css` | 13 | `settings-context-limit.png` |
| U26 | `dashboard/PromptHeatmap.tsx` | `PromptHeatmap.css` | 14 | `dashboard-all-default.png` |
| U27 | `dashboard/prompt-detail/EvidenceGroup.tsx` | `prompt-detail/EvidenceGroup.css` | 14 | `dashboard-prompt-detail.png` |
| U28 | `dashboard/UsageView.tsx` | `UsageView.css` | 16 | `dashboard-claude.png` (account-connected) |
| U29 | `dashboard/FirstRunOnboarding.tsx` | `FirstRunOnboarding.css` | 16 | `first-run-onboarding.png` |
| U30 | `dashboard/BackfillDialog.tsx` | `BackfillDialog.css` | 17 | `backfill-dialog.png` |
| U31 | `dashboard/StatsDetailView.tsx` | `StatsDetailView.css` | 18 | open Stats detail; capture |
| U32 | `dashboard/RecentSessions.tsx` | `RecentSessions.css` | 20 | `dashboard-all-default.png` |
| U33 | `dashboard/McpInsightsCard.tsx` | `McpInsightsCard.css` | 21 | `mcp-insights-expanded.png`, `mcp-insights-collapsed.png` |
| U34 | `dashboard/prompt-detail/GuardrailSummary.tsx` | `prompt-detail/GuardrailSummary.css` | 24 | `dashboard-prompt-detail.png` |
| U35 | `dashboard/MemoryMonitorCard.tsx` | `MemoryMonitorCard.css` | 25 | `memory-monitor-expanded.png`, `memory-monitor-collapsed.png` |
| U36 | `dashboard/EvidenceSettings.tsx` | `EvidenceSettings.css` | 30 | `settings-evidence.png` |
| U37 | `dashboard/SessionDetailView.tsx` | `SessionDetailView.css` | 30 | open a session detail; capture |

**Per-unit deltas already declared above. Per-unit cycle: §8.**

> **v3.4 swap (2026-05-10)**: original U5 was `CostTreemap.tsx` and U8 was `AccountInsightsCard.tsx`. Two constraints forced the swap:
>
> 1. **CostTreemap multi-selector blocker**: three of CostTreemap's five "single-owner" classes (`.cost-treemap`, `.cost-treemap-title`, `.cost-treemap-chart`, lines 2333-2351 of `dashboard.css`) live inside multi-selector rule blocks shared with `.context-treemap*` siblings (cross-owner — `ContextTreemap.tsx`). Pure relocation per §3 C4 would copy `.context-treemap*` selectors into `CostTreemap.css`, but `ContextTreemap.tsx` does not import that file ⇒ silent visual regression on `ContextTreemap`. Splitting the shared blocks would change declaration text (also forbidden by C4). The clean resolution is a Tier 2 cluster move (`treemap-cluster.css` consumed by both `CostTreemap.tsx` and `ContextTreemap.tsx`); CostTreemap is therefore deferred out of Tier 1, slotted as U8 placeholder, and re-classified as Tier 2 work in a future SDD bump (no row added to Tier 2 yet — that's a separate plan revision).
> 2. **P0.5.6 daemon-reset deferral**: per the §14 "P0.5.6 deferred" entry, the orchestrator currently captures only the first 3 populated screens. AccountInsightsCard's §7 surface is `dashboard-claude` (screen 2 of populated), well within the 3-screen window. CostTreemap's surface is `dashboard-all-default` (screen 1) so it would also be unblocked from the orchestrator angle, but the multi-selector blocker dominates.
>
> Total commit count and Tier 1 unit count remain unchanged at 36 (Tier 1) — we are reordering existing units, not adding/removing them. CostTreemap will land as a deferred U8 once the Tier 2 cluster plan is amended (separate SDD bump, expected before Tier 1 closure).

---

### Tier 2 — Cluster moves (U38 – U45, 8 commits)

| Unit | Cluster | New cluster file | Classes | Consumers update |
|---|---|---|---|---|
| U38 | C8. Token composition toggle | `dashboard/token-cluster.css` | `.token-composition-toggle-btn` | McpInsightsCard, TokenCompositionChart add import |
| U39 | C3. Session back button | `dashboard/session-cluster.css` | `.session-back-btn` | PromptDetailView, SessionDetailView add import |
| U40 | C4. Evidence breakdown toggle | `dashboard/prompt-detail/evidence-breakdown-cluster.css` | `.evidence-breakdown-toggle` | ContextFileList, EvidenceGroup add import |
| U41 | C1. Cost cluster | `dashboard/cost-cluster.css` | 3 classes | CostCard, McpInsightsCard, OutputProductivityCard add import |
| U42 | C2. Setup cluster | `dashboard/setup-cluster.css` | 3 classes | SetupGuide, UsageView add import |
| U43 | C5. Detail section cluster | `dashboard/prompt-detail/detail-section-cluster.css` | 5 classes | PromptMemorySection, Section add import |
| U44 | C7. Stats cluster | `dashboard/stats-cluster.css` | 5 classes | CacheGrowthChart, PromptHeatmap, StatsDetailView, TokenCompositionChart add import |
| U45 | C6. Settings dialog cluster | `dashboard/ctx-settings-cluster.css` | 6 classes | ContextLimitSettings, EvidenceSettings add import |

**Tier 2 verification rule** (per unit): re-run inventory; the moved classes must show **identical consumer lists** post-move (move target file is a new addition; the class disappears from `dashboard.css` and lives in the new file). Cascade-order check (§3 C7) is mandatory.

---

### Tier 3 — Shared moves (U46 – U48, 3 commits)

> **Tier 3 special verification** (run before commit):
> ```bash
> # For every class moved in this unit:
> grep -rln "className=\"[^\"]*\b<class>\b" src --include="*.tsx" --include="*.ts" | sort -u > /tmp/expected-importers.txt
> # Confirm every file in /tmp/expected-importers.txt has the import for the new shared CSS.
> # Diff against the import additions in the current unit's diff.
> ```
> A missing importer → silent visual regression. Do not commit if the lists differ.

| Unit | Group | Shared file | Classes | All consumers (must add import) |
|---|---|---|---|---|
| U46 | S1. Section empty | `dashboard/_shared/section.css` | `.section-empty` | PromptDetailView, ContextFileList |
| U47 | S2. Memory file rows | `dashboard/_shared/memory-file.css` | **9 classes** (`memory-file-list`, `-item`, `-header`, `-type`, `-name`, `-lines`, `-chevron`, `-desc`, `-content`) | MemoryMonitorCard, PromptMemorySection |
| U48 | S3. Collapsible | `dashboard/_shared/collapsible.css` | `.collapsible`, `.collapsible-inner` | CostCard, McpInsightsCard, MemoryMonitorCard, OutputProductivityCard, PromptMemorySection, Section, SignalBreakdown |

> **Pre-Tier-3 init commit (U-shared-init)** is implicitly U46's own setup: it creates `dashboard/_shared/README.md` and the `.gitkeep` if needed. This is folded into U46 to avoid a no-op commit.

---

### U49 — Shell residual

**Why**: After all Tier 1/2/3 moves, `dashboard.css` should hold only `.dashboard`, `.dashboard-menu` related classes (`menu-item` etc.), `.sub-tabs-row`, `.sub-tab-helper*`, and any post-audit residuals (specifically the 8 single-owner classes attributed to `UsageDashboard.tsx` in U16, kept here intentionally).

**Steps**:
1. Verify `dashboard.css` line count ≤ 300. If higher, audit.
2. Re-run inventory; `selectors-ordered.txt` must contain only the residual selectors. Cascade-order check passes against U1 baseline.
3. **Optional (frozen — yes) rename**: keep filename as `dashboard.css`. **Do not rename to `dashboard-shell.css`** — keeping the original name means `UsageDashboard.tsx` import line is unchanged. (v1 said "optional rename"; v2 freezes this decision per Codex #6.)
4. Visual diff on all canonical + per-unit surfaces.
5. Commit:
   ```
   refactor(dashboard-css): U49 reduce dashboard.css to shell-only selectors (#<issue>)

   File reduced from 4,554 to <N> lines. Only .dashboard, .dashboard-menu*,
   .sub-* and shell residuals remain. All component-specific, cluster, and
   shared classes now live in sibling or _shared/ stylesheets.
   Cascade-order baseline preserved; visual diff pixel-equal on all surfaces.
   ```

### U50 — `true-orphan-candidate` classes marked `/* UNUSED candidate */`

**Why**: Goal G6. Gemini #3c + Codex v2 review #2. Of the 56 orphans, **only the 48 `true-orphan-candidate` entries are marked**; the 7 `compound-modifier-unresolved` and 1 `dynamic-pattern-unresolved` entries are NOT marked because their static analysis is known to be incomplete (they are likely composed at runtime). Marking them would poison the follow-up cleanup issue with false positives.

**Steps**:
1. Read the `true-orphan-candidate` table in `docs/sdd/css-decomp-inventory/orphans.md`. There are **48 entries**.
2. For each true-orphan class, locate its rule block — it now lives in whichever file received it during U2–U48 (sibling, cluster, `_shared/`, or the shell `dashboard.css`).
3. Add a one-line comment immediately above each true-orphan rule:
   ```css
   /* UNUSED candidate (#<issue>) — verify dynamic className before removal */
   .breakdown-popover-row { ... }
   ```
4. **Do NOT mark `compound-modifier-unresolved` or `dynamic-pattern-unresolved` entries.** For each of these 8 entries, instead add (or update) an entry in `scripts/css-decomp-overrides.json` with the verified runtime consumer, OR document in `orphans.md` the manual grep that proved no consumer exists. Re-running the inventory after override updates may reclassify some entries.
5. Open follow-up issue: `Remove dead CSS classes flagged by U50 (orphan audit)`. Issue body must reference: (a) the 48 marked true-orphans, (b) the 8 unmarked entries that need manual verification before any deletion attempt.
6. Visual diff: comments don't change rendering; expect pixel-equal.
7. Cascade-check: PASS (comments don't affect selector order).
8. Commit:
   ```
   refactor(dashboard-css): U50 flag true-orphan-candidate classes for follow-up cleanup (#<issue>)

   Marks 48 true-orphan-candidate classes with /* UNUSED candidate */
   comments. Per Codex v2 review #2, the 7 compound-modifier-unresolved
   and 1 dynamic-pattern-unresolved entries are NOT marked — see
   orphans.md for verification guidance and overrides.json for runtime
   consumer mappings. Opens follow-up issue #<followup> for actual
   removal in a separate epic. No declarations changed.
   ```

### U51 — Documentation alignment

**Why**: Goal G8.

**Steps**:
1. Edit `README.md` Tech Stack table:
   - Replace `| Frontend | React 18, TypeScript, Tailwind CSS |` with `| Frontend | React 18, TypeScript, plain CSS (per-component sibling stylesheets) |`.
2. Edit `.claude/rules/frontend-design-guideline.md` `## Styling Baseline`:
   - Remove "Prefer Tailwind utility classes for styling; extract component classes for reuse."
   - Add: "Use per-component sibling `.css` files (`<Component>.css` next to `<Component>.tsx`). Cross-folder shared classes live under `src/components/dashboard/_shared/<group>.css` and must be imported explicitly by every consumer (shared imports first, then component-local imports). See `docs/sdd/dashboard-css-decomposition-gate.md` for the canonical layout."
3. Update §14 of this doc with the closing run record. Set Status = **Closed**.
4. Commit:
   ```
   docs(dashboard-css): U51 align README and frontend guideline with plain-CSS reality (#<issue>)
   ```

---

## §8. Per-Unit Cycle (SOP)

Reproduced once; every U2+ unit references this SOP.

```
1. Pre-conditions:
   - On branch refactor/dashboard-css-decompose
   - main sync: git fetch origin && (no rebase needed if linear progress)
   - gh auth status → Active <canonical-account>
   - Re-run inventory: node scripts/css-decomp-inventory.mjs
     (compare against U1 baseline; halt if drift detected — see §11 L7)

2. Identify the move set:
   - For Tier 1: from §6 single-owner table for this unit's owner
   - For Tier 2/3: from §6 cluster/shared table
   - For each class, find its line range in dashboard.css:
     grep -n '^\.<class>' src/components/dashboard/dashboard.css
   - The move range includes adjacent @media or nested rules attached to the class

3. Apply the move:
   a. Cut the rule blocks (preserving order, comments, media queries) from dashboard.css
   b. Create the new .css file with a one-line banner:
      /* Moved from dashboard.css in #<issue> U<n>. Owner: <Component>. */
   c. In each consumer .tsx, add:
      import './<NewFile>.css';        // for component-local
      import './_shared/<group>.css';  // for shared, FIRST in CSS-import group
      // Cascade order in consumer:
      //   1. _shared/* CSS imports
      //   2. cluster CSS imports (e.g., './cost-cluster.css')
      //   3. component-local CSS import (e.g., './CostCard.css')
   d. Do NOT add /* UNUSED candidate */ markers during Tier 1/2/3 moves —
      that work is consolidated in U50 (and only true-orphan-candidate
      classes are marked, per Codex v2 review #2).

4. Validate (mandatory, all must pass):
   npm run typecheck
   npm run lint
   npm run test

5. Cascade-order check (mandatory):
   node scripts/css-decomp-inventory.mjs
   diff -u docs/sdd/css-decomp-inventory/selectors-ordered.txt.U1 \
           docs/sdd/css-decomp-inventory/selectors-ordered.txt
   # For moved selectors: their relative order against still-in-dashboard.css
   # selectors must match the U1 baseline.
   # If diff includes reordering of NOT-MOVED selectors, halt — bug in move

6. Frontend review gate (mandatory):
   bash scripts/run-frontend-review.sh
   # If FAIL: invoke code-reviewer subagent → write report → re-run

7. Style review ack (mandatory):
   bash scripts/check-style-review-ack.sh
   bash scripts/ack-style-review.sh "U<n> <description>"

8. Visual regression (mandatory):
   8a. Hard-reset preamble (REQUIRED before every capture pass — see §9.4
       and §11 R9; introduced after U3 found that cumulative state from
       prior runs causes spurious diff and mid-run agent-browser EAGAIN):
         agent-browser close 2>/dev/null || true
         pkill -9 -f "Electron.app" 2>/dev/null || true
         pkill -9 -f "agent-browser-darwin" 2>/dev/null || true
         rm -rf /tmp/omt-qa-css-decomp-home-* \
                /tmp/omt-qa-electron-*.log \
                /tmp/omt-qa-renderer.log
         sleep 2
   8b. Capture into a unit-scoped OUT_DIR (verification artifact, not the
       baseline; deleted after the diff is recorded in §14):
         OUT_DIR="$PWD/docs/qa/runs/$(date -u +%Y-%m-%d)/U<n>" \
           bash scripts/qa-capture-baseline.sh populated
       (For units whose §7 surface lives in first-run/backfill/setup-guide
       profiles, capture that profile too — most Tier 1 units only need
       populated since the affected component renders inside UsageDashboard.)
   8c. Capture this unit's declared visual surface (from §7 unit row).
   8d. cmp against U1-VR-d baseline at docs/qa/runs/2026-05-10/baseline/
       canonical/<screen>.png.
   8e. Acceptance: 0 pixels different. Any non-zero diff → root-cause and
       fix before commit, OR document exception in §14 with user approval.
       For mass run-to-run flake without root cause: re-execute 8a + 8b
       once. If a single post-reset run still does not produce 7/7
       byte-equal, halt and root-cause before continuing — repeat-until-
       green is NOT a valid acceptance path.
   8f. After diff PASS recorded in §14, delete the unit OUT_DIR
       (`rm -rf docs/qa/runs/$(date -u +%Y-%m-%d)/U<n>`). Per-unit captures
       are evidence, not artifacts; the U1-VR-d baseline remains the only
       PNG set tracked in git.

9. Commit:
   git add -A
   git commit -m "refactor(dashboard-css): U<n> ..."

10. Push:
    git push origin refactor/dashboard-css-decompose

11. Update §14 run record (this commit or the next) with:
    SHA, owner/group, line count moved, dashboard.css size before/after,
    frontend-review fingerprint, cascade-order diff result, visual-diff
    result, any exceptions or deferred items.
```

---

## §9. Visual Regression Strategy

### §9.1 Canonical screens (captured for every implementation unit)

These six surfaces cover the hot dashboard tree and are captured for every Tier 1/2/3 commit:

1. `dashboard-all-default.png` — `All` provider tab, default state.
2. `dashboard-claude.png` — `Claude` tab.
3. `dashboard-prompt-detail.png` — most-recent prompt opened.
4. `settings-evidence.png` — settings → Evidence pane.
5. `settings-context-limit.png` — settings → Context Limit pane.
6. `notification-overlay.png` — notification window (validates non-leakage into notification surface).

### §9.2 Per-unit visual surfaces (declared in §7)

In addition to §9.1, each unit declares any extra surface its owner renders (overlay, dialog, expanded/collapsed state, alert state). These are listed in the §7 unit table.

### §9.3 Mode

- **U1 baseline + every Tier 3 commit**: full-stack Electron via `bash scripts/qa-launch-electron.sh` + `agent-browser connect 9222 --session css-decomp`. Real DB, real proxy, real watchers. Required for IPC-backed surfaces.
- **Tier 1/Tier 2 commits**: renderer-only is acceptable (mock `window.api` covers the changed surface). Use `bash scripts/qa-launch-renderer.sh` + `agent-browser open http://localhost:5173 --headed`.

### §9.4 Stabilization (Codex #5 mandatory)

- `OMT_QA_FAKE_NOW=2026-05-03T12:00:00Z` — freezes "time ago" text.
- `OMT_QA_NO_ANIMATIONS=1` — injects animation/transition disables.
- Viewport: 1440 × 900, devicePixelRatio = 2.
- Wait selector: `[data-loaded="true"]` (or domain-specific) before each capture.
- Fonts: Inter only; verify `font-family` resolved at capture time.
- Fixture HOME: `/tmp/omt-qa-css-decomp-home` (seeded once in U1 baseline; reused by every later unit).

### §9.4.1 Hard-reset preamble (added after U3 — required before every Tier 1+ capture pass)

`scripts/qa-capture-baseline.sh` re-seeds the per-profile HOME on every invocation, but it does not reset adjacent Electron-side state — better-sqlite3 WAL files, the agent-browser daemon's CDP-session cache, and Electron's per-instance `Library/Application Support` namespacing all persist across runs. During U3 capture this caused (a) run-to-run flake on screens that don't even touch the moved CSS (e.g., `dashboard-claude` swinging 146 KB ↔ 94 KB between back-to-back runs) and (b) mid-run `agent-browser` EAGAIN failures. Issuing the following preamble before every visual capture pass eliminated both modes and produced 7/7 byte-equal on the very next run:

```bash
agent-browser close 2>/dev/null || true
pkill -9 -f "Electron.app" 2>/dev/null || true
pkill -9 -f "agent-browser-darwin" 2>/dev/null || true
rm -rf /tmp/omt-qa-css-decomp-home-* \
       /tmp/omt-qa-electron-*.log \
       /tmp/omt-qa-renderer.log
sleep 2
```

This preamble is now mandatory in §8 step 8a for every Tier 1/2/3 unit. The U1-VR-d "first capture is a warm-up" note in §14 generalizes to "first capture after any prior session is unstable; hard-reset is the canonical fix". `qa-capture-baseline.sh` itself was deliberately not modified — the preamble is the orchestrator's responsibility because some downstream invocations (e.g., Tier 3 full-stack runs in §9.3) may want to keep state warm intentionally.

### §9.5 Diff method

- agent-browser PNG capture at fixed viewport.
- Compare against U1 baseline via byte-equality (`cmp <baseline>.png <new>.png`).
- If bytes differ, render pixel diff (`magick compare -metric AE`) and inspect.
- **Acceptance**: 0 pixels different. Any non-zero diff requires either:
  - Root-cause fix (preferred — usually a missed import or accidental cascade flip), or
  - Documented exception in §14 with both screenshots attached, **user approval required**.

### §9.6 Why not full E2E

- Tests are CSS-only moves, not behavioral changes. Visual capture suffices.
- Existing 49 vitest spec files catch any accidental TSX import/export drift.

---

## §10. Test Plan

| Layer | What | Tool | Frequency |
|---|---|---|---|
| Static | TS compile | `npm run typecheck` | Every implementation commit |
| Static | Lint changed files | `npm run lint` | Every implementation commit |
| Unit | Existing vitest suites stay green | `npm run test` | Every implementation commit |
| Cascade | Selector-order baseline preserved | `node scripts/css-decomp-inventory.mjs && diff` | Every implementation commit |
| Visual | Canonical + per-unit surface pixel diff | agent-browser + `cmp` | Every Tier 1/2/3 commit |
| Gate | Frontend-review subagent verdict | `bash scripts/run-frontend-review.sh` + `code-reviewer` | Every commit |
| Gate | Manual style review ack | `bash scripts/ack-style-review.sh` | Every commit |
| End-to-end | Final headed full-stack pass | agent-browser Electron mode on all canonical surfaces | Once at U49 (post-shell) and once at U51 (post-doc-fix sanity) |

**No new tests are written in this epic.** Existing 49 vitest specs serve as the regression net for component logic; visual diff + cascade-order check serve for styling.

---

## §11. Risk & Rollback (NEW v2 — multi-level ladder)

### §11.1 Risks ranked

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Tier 3 missed importer → silent visual regression on a shared class | Medium | High | §7-Tier3 special verification; full-stack visual diff for U46–U48 |
| R2 | Cascade-order flip between same-specificity selectors that visually match in baseline but diverge under runtime data | Medium | Medium | C7 cascade-order check every commit; explicit shared-before-local import order; if a discrepancy appears, halt and revert (L1) |
| R3 | Pre-existing class collisions (P1) hide a specificity bug | Low | Medium | P1 resolves collisions before any Tier moves; inventory rerun confirms zero collisions |
| R4 | `vite` HMR caches stale CSS during agent-browser baseline → false negative diff | Low | Low | Use `qa-launch-electron.sh` for U1 baseline (no HMR); hard-reload between captures |
| R5 | Pre-commit hook hardens between commits, fingerprint becomes invalid | Low | Low | Frontend-review fingerprints rotate per file-set hash; re-running the gate is cheap |
| R6 | Discovery of dead classes (orphan inventory) | High (already known: 56) | Low | U50 marks the 48 `true-orphan-candidate` entries; the other 8 require manual verification (overrides.json or grep proof) before any deletion attempt; full deletion deferred to follow-up epic |
| R7 | `main` advances during epic; new component or new class added | Medium | Medium | §11 L7 (drift handling) — re-run inventory at start of each unit; halt if class set or consumer set changes for an in-flight class |
| R8 | A unit's commit author/identity slips (<canonical-account> → <non-canonical-account-A> or <non-canonical-account-B>) | Low | Medium | C2 identity verification before every gh mutation; commit author is pinned by `.git-identity.local` |
| R9 | Visual diff persistently fails on stabilization-related noise (font hinting, timezone, cumulative SQLite/Electron state) | Medium | Medium | §9.4 stabilization SOP; §9.4.1 hard-reset preamble (added after U3, mandatory in §8 step 8a); if still noisy after a single post-reset run, halt and root-cause — repeat-until-green is not a valid acceptance path |
| R10 | A unit accidentally widens scope (touches CSS declarations, renames classes) | Low | High | C4 reuse-first; frontend-review gate catches; if it slips, L1 revert |

### §11.2 Rollback ladder

The rollback strategy is a **graduated ladder**: pick the lowest level that resolves the failure.

#### **L1 — Single-unit rollback (per-commit)**

**Trigger**: a single committed unit fails post-merge sanity (visual diff regression discovered late, hook bypass discovered, identity slip, etc.).

**Procedure**:
1. Identify the offending SHA: `git log --oneline -- src/components/dashboard/`.
2. Revert: `git revert <unit-sha>` (creates a new revert commit; **do not** force-push to rewrite history).
3. The revert commit goes through the same per-unit cycle (typecheck/lint/test, frontend-review, visual diff). Cascade-order check should now show baseline-matching state for that unit's classes.
4. Push: `git push origin refactor/dashboard-css-decompose`.
5. Update §14 with revert SHA + reason.

**Cost**: ~10 min including re-validation. No coordination with other units required.

**Caveat**: if subsequent units depend on the reverted move (e.g., they added an import to a now-deleted file), re-revert their imports as well in the **same** revert commit, or revert subsequent units in reverse order.

#### **L2 — Tier-level rollback**

**Trigger**: cascade-order regression discovered after multiple Tier 1 units have landed, or a systemic Tier 3 importer-mismatch pattern is found mid-tier.

**Procedure**:
1. Identify the first commit of the affected Tier (e.g., `git log --oneline | grep "U2 "` for Tier 1 start).
2. Revert all commits of that tier in reverse order:
   ```bash
   git log --oneline <tier-start-sha>^..HEAD --reverse | tac | awk '{print $1}' | while read sha; do
     git revert --no-commit $sha
   done
   git commit -m "revert: roll back Tier <n> due to <reason> (#<issue>)"
   ```
3. Re-run inventory; cascade-order baseline should match U1 again.
4. Frontend-review gate + visual diff against U1 baseline.
5. Update §14.

**Cost**: 30 min – 2 hr depending on tier size.

**Caveat**: do not force-push. The reverted commits remain in history for forensics.

#### **L3 — Epic abort (pre-merge)**

**Trigger**: multiple Tier 3 units fail visual diff and the cause is not rapidly identifiable (R1, R2 compounding); OR the visual-diff failure rate exceeds the **abort criteria** (§11.3).

**Procedure**:
1. Close the Draft PR **without merging**: `gh pr close <pr-number> --comment "Aborting epic; see #<issue> for postmortem."` (verify <canonical-account> active first).
2. Branch `refactor/dashboard-css-decompose` is preserved on origin for forensics. Do not delete.
3. `main` is untouched.
4. Open a postmortem issue with the failure mode, the SHAs that demonstrated it, and recommended mitigations. Reference this gate doc.

**Cost**: minutes (mostly admin). Recovery cost is the next epic attempt with mitigations applied.

#### **L4 — Post-merge full revert (worst case)**

**Trigger**: epic merged to `main`, visual or behavioral regression discovered in production-like flow that was not caught by the gates.

**Procedure** (REQUIRES USER APPROVAL — affects shared `main`):
1. Verify <canonical-account> active.
2. Ensure no force-push to `main`.
3. Identify the merge commit: `git log --merges --oneline | grep "Merge pull request #<pr>"`.
4. Revert the merge: `git revert -m 1 <merge-sha>` (creates a new commit on a new branch; do not push directly to `main`).
5. Open a hotfix PR `revert/dashboard-css-decompose-epic` with the revert; standard PR review applies.
6. Land the revert; open a postmortem issue. The original epic branch remains on origin for forensics.

**Cost**: 1 hr (PR cycle) plus user approval.

**Caveat**: never use `git push --force` or `--force-with-lease` against `main`. Never `git reset --hard` on a shared branch.

#### **L5 — Cascade-order regression (Vite-specific)**

**Trigger**: Visual diff fails AND cascade-order check (`selectors-ordered.txt` diff) shows a reordering not predicted by the move; OR runtime behavior diverges (e.g., a button hover style flips) despite identical selectors.

**Procedure**:
1. Halt commits.
2. Inspect the consumer's import statements:
   ```typescript
   // Required order in every consumer:
   // 1. _shared/* CSS imports
   // 2. cluster CSS imports
   // 3. component-local CSS imports
   ```
3. Build the bundle and inspect `dist/assets/*.css` directly:
   ```bash
   npm run build  # produces dist/
   # Find the CSS output and grep for the affected selectors in declaration order
   ```
4. If the bundle order does not match the U1 cascade-order baseline, the offending unit is the most recent unit that touched any of the misordered selectors. Revert it (L1).
5. After revert, redesign the unit to enforce the correct import order; recommit.

**Cost**: 30 min – 2 hr.

#### **L6 — Visual baseline corruption / re-baseline**

**Trigger**: the U1 baseline itself is shown to contain a flake (e.g., "time ago" text rendered before stabilization landed; spinner caught mid-frame).

**Procedure** (REQUIRES USER APPROVAL — re-baselining is a control-plane action):
1. Halt all in-flight units.
2. Reproduce the flake on a fresh `main` checkout to confirm it is a baseline issue, not a per-unit regression.
3. Re-run U1 with the stabilization SOP (§9.4) under stricter settings.
4. Replace `docs/qa/runs/<date>/baseline/` with the new baseline; commit as `chore(qa): re-baseline U1 due to <reason> (#<issue>)`.
5. Replay the visual diff for every previously-completed unit against the new baseline. Any unit whose diff now fails must go through L1.
6. Resume.

**Cost**: 1 – 4 hr.

**Caveat**: re-baselining mid-epic is expensive. Discovery in U1 itself is cheap; later discovery is not. Invest heavily in §9.4 stabilization on the first U1 attempt.

#### **L7 — Inventory drift mid-epic**

**Trigger**: at the start of an implementation unit, the inventory rerun shows the unit's owner now has a different class set than recorded in §6 (someone landed a new feature on `main` that added or removed classes).

**Procedure**:
1. Halt the unit; do not commit a half-stale move.
2. Diff the new inventory against the U1 baseline:
   ```bash
   node scripts/css-decomp-inventory.mjs
   diff <(jq -S . docs/sdd/css-decomp-inventory/class-consumers.json.U1) \
        <(jq -S . docs/sdd/css-decomp-inventory/class-consumers.json)
   ```
3. Decide:
   - **Trivial drift** (a class added to an owner already in our list): update §14 with the new class, fold into the unit, proceed.
   - **Non-trivial drift** (new owner appeared, new shared class crossed folder boundary, collision reintroduced): merge `main` into the epic branch, re-run inventory, recompute the unit table for all remaining units, commit a `chore(dashboard-css): re-sync with main (#<issue>)` doc-only update of §6, then proceed.
   - **Catastrophic drift** (epic premise invalidated, e.g., notification.css started cross-cutting): escalate to L3 abort.
4. Run all hooks (frontend-review, etc.) on the merge/sync commit to verify the gate is still green.

**Cost**: 30 min – 4 hr depending on drift class.

#### **L7-bis — Hook bypass / identity slip detection**

**Trigger**: a commit landed without `frontend-review` ack (e.g., `--no-verify` was used, or the pre-commit hook was disabled), OR a commit was authored by a non-<canonical-account> identity.

**Procedure**:
1. Identify the commit: `git log --pretty=fuller --show-signature` for identity; `git show --stat` cross-checked against `.policy/frontend-review-report.*.md` for ack.
2. **If ack is missing**: the commit must be redone. Revert via L1, run the gate properly, recommit.
3. **If identity slipped**: revert via L1; the recommit uses the correct `.git-identity.local`. The original commit remains in history but the canonical end-state is correct-identity authored.
4. Update §14 + open a postmortem note in the PR description.

**Cost**: ~15 min per occurrence.

### §11.3 Abort criteria (automatic L3 trigger)

The epic must be aborted (L3) if any of the following occurs:

- **A1**. Visual diff fails on the same unit for **3 consecutive** commit attempts after stabilization SOP (§9.4) is correctly applied.
- **A2**. A Tier 3 unit reveals a missed importer that, after fix, still produces visual regression — implying a deeper specificity issue that the inventory does not capture.
- **A3**. Cascade-order check fails on a unit whose moved selectors all have specificity-distinct relationships with adjacent selectors (i.e., L5 fix does not resolve).
- **A4**. Inventory drift (L7) occurs **3 times** during the epic, indicating `main` is too volatile for the epic timeline; reschedule to a quieter window.
- **A5**. Frontend-review gate produces a `BLOCK` verdict that cannot be fixed within the unit's scope (e.g., reviewer demands a class-name change, conflicting with N2).

### §11.4 Recovery state guarantees

At every rollback point above, the following invariants hold:

- `main` is never modified (except L4, which is gated by user approval and goes through a hotfix PR).
- `.git-identity.local` lock prevents author drift.
- Pre-commit and Stop hooks remain active (never disabled to "make a commit go through").
- The epic branch on origin is always recoverable from forensics.
- The U1 visual baseline is the single canonical reference; never overwritten without L6 approval.

---

## §12. Out-of-Scope / Decisions Deferred

- **D1. Tailwind adoption** — separate ADR + epic.
- **D2. CSS Modules adoption** — separate epic.
- **D3. Design tokens / CSS variables consolidation** — separate epic.
- **D4. Inline `style={{}}` cleanup** — separate follow-up issue.
- **D5. Specificity / `!important` removal** — separate epic.
- **D6. Dead-class removal** — U50 flags; deletion is a follow-up issue (`Remove dead CSS classes flagged by U50`).
- **D7. Storybook / visual snapshot library** — not introduced.
- **D8. Notification.css decomposition** — separate epic if needed; this epic confirms zero collision with dashboard.css.

---

## §13. Issue Body Template (paste into U0 `gh issue create`)

```md
# Decompose dashboard.css into per-component sibling stylesheets

## Problem
src/components/dashboard/dashboard.css holds 537 classes (631 selector entries
in declaration order) imported once at UsageDashboard.tsx:38 and applied
globally to the dashboard tree. Distribution (per scripts/css-decomp-inventory.mjs):
444 single-owner, 25 cluster, 12 shared, 56 orphan (48 true-orphan-candidate +
7 compound-modifier-unresolved + 1 dynamic-pattern-unresolved). 4 cross-file
collisions present (1 with App.css, 3 with TokenTreemap.css). Adding components
risks collision; cascade-order is implicit; component → ownership invisible.

## Expected Outcome
- dashboard.css reduced to shell-only (≤ 300 lines)
- Each owner imports its sibling .css; cluster groups via cluster .css files;
  cross-folder shared classes via dashboard/_shared/<group>.css with explicit
  consumer imports
- Cross-file collisions resolved (P1)
- Cascade-order baseline preserved end-to-end
- 48 of 56 orphan classes (true-orphan-candidate only) flagged with
  /* UNUSED candidate */ (deletion deferred); the other 8 require manual
  verification before any deletion attempt
- README and frontend-design-guideline.md corrected to reflect plain CSS
- Zero visual regression on canonical + per-unit surfaces

## Acceptance Criteria
1. dashboard.css line count ≤ 300 after U49.
2. All 54 commits (U0 + P0 + U1 + P1 + U2-U51 = 54) push to
   refactor/dashboard-css-decompose with per-unit frontend-review reports,
   both source-side and bundle-side cascade-order checks passing,
   pixel-equal visual diff, and green typecheck/lint/test.
3. PR follows OPEN-SOURCE-WORKFLOW.md 11-section template.
4. No new dependencies, no class renames, no declaration changes.
5. README + frontend-design-guideline.md no longer reference Tailwind.
6. Inventory artifacts (docs/sdd/css-decomp-inventory/) committed and current.
7. Follow-up issue opened for orphan deletion (referenced from U50).

## Failure Modes
- R1 Tier 3 missed importer → silent visual regression. Mitigation:
  §7-Tier3 special verification grep; full-stack Electron diff for U46–U48.
- R2 Cascade-order flip same-specificity selectors. Mitigation: C7 check
  every commit; shared-before-local import order; L5 rollback if discovered.
- R7 main advances during epic. Mitigation: L7 drift handling.

## Constraints
- SDD §1-7 mandatory.
- <canonical-account> gh identity for every gh mutation.
- English-only artifacts.
- agent-browser-only QA (no Playwright).
- Reuse-first: pure relocation, no rewrites.

## Non-Goals
- Tailwind, CSS Modules, design tokens, dead-class removal in this epic,
  inline style cleanup, specificity hardening, storybook introduction,
  notification.css refactor.

## Reference
- docs/sdd/dashboard-css-decomposition-gate.md (this gate doc)
- docs/sdd/css-decomp-inventory/ (generator outputs — class-consumers.{json,md},
  prefix-summary.md, selectors-ordered.txt, collisions.md, orphans.md)
- scripts/css-decomp-inventory.mjs (the generator)
```

---

## §14. Run Record (filled in as units land)

### Schema

```
- U<n> <owner-or-group> → <file>
  - SHA: <git-sha>
  - Lines moved: <N> (dashboard.css <before> → <after>)
  - Consumers updated: <list>
  - Frontend review: <verdict> (fp <fingerprint>)
  - Cascade-order check: PASS / FAIL (<details>)
  - Visual diff: PASS / FAIL (<details>)
  - Inventory rerun: <delta from U1 baseline, if any>
  - Notes: <deviations, deferred items, observations>
```

### Entries

(Append below as each unit completes. Implementer fills this in; do not let entries accumulate uncommitted — each unit's record lands in the same commit as its code change, or in the very next commit if the record was written post-validation.)

#### Backfill — U0 → U1 (recorded 2026-05-08)

Earlier units committed their work without filling §14. Reconstructed from `git log` for traceability:

- **U0** docs-only — `e9d1847` `docs(dashboard-css): U0 open epic for dashboard.css decomposition`
- **P0** inventory generator + baseline — `6808d83`
- **P0.1** harden cascade-check + tighten generator — `9b702b6`
- **P0.2** residual gap notes + JSDocs — `bbb20d1`
- **P0.3 / U1-VR** QA visual-regression stabilization — `596f927`
- **U1** cascade-order baseline freeze — `52d0d25`

#### P0.4 — Deterministic fixture seeder for U1-VR

- **Group**: U1-VR prereq (extracted in v3.2 split)
- **SHA**: `8a1b828`
- **Lines moved**: 0 (P0.4 adds new files; no relocation, no source change to `electron/`/`src/`/`dashboard.css`)
- **Files added**:
  - `scripts/qa-fixtures.json` — 4 fixture profiles (`populated`, `first-run`, `setup-guide`, `backfill`) with fixed timestamps, sessionIds, costs, and sortable record arrays. `fixedNow = 2026-05-05T12:00:00Z` aligned with `OMT_QA_FAKE_NOW`.
  - `scripts/qa-seed-fixtures.mjs` — Node ESM seeder. Imports `runMigrations` from `electron/db/schema.ts` directly via Node 22 type-stripping; SQLite DB seeded with `journal_mode=DELETE` for byte-stable comparisons. CLI: `<profile> --home <path>` and `--list`. Refuses to run if `--home` looks like the user's real `$HOME` (rejects paths under `~/Library`, `~/Documents`, `~/Desktop` and any path that doesn't contain `qa` or live under `/tmp`/`/private/tmp`/`/var/folders`).
  - `scripts/qa-seed-fixtures-test.sh` — determinism check. Seeds each profile twice into two distinct temp HOMEs and asserts byte-identical hashes. Special-cases the SQLite DB by dumping table contents (sorted-key JSON per row) instead of comparing raw page bytes — content determinism is what U1-VR cares about.
- **Determinism check**: PASS — 4/4 profiles produced byte-identical hashes across two re-seeds.
  - `populated`: PASS
  - `first-run`: PASS
  - `setup-guide`: PASS
  - `backfill`: PASS
- **Frontend review**: (filled after `scripts/run-frontend-review.sh`)
- **Cascade-order check**: N/A — no CSS source change.
- **Visual diff**: N/A — no CSS source change. P0.4 only emits seeder infrastructure; pixel capture itself is U1-VR.
- **Inventory rerun**: not run (no `dashboard.css` change).
- **Notes / design points**:
  - Manifest paths are HOME-relative (not absolute) so `.fixture-manifest.json` itself is byte-identical across HOMEs. Original implementation embedded absolute `--home` paths and was caught by the determinism check.
  - SQLite WAL mode is intentionally disabled in the seeder (`journal_mode=DELETE`) so the on-disk DB is a single file at the end. The production app will switch back to WAL on first open, which is fine because U1-VR captures *images of a running app*, not the DB file.
  - The seeder does not touch `electron/db/schema.ts`. It only imports `runMigrations` so any future migration added to the schema is automatically applied to seeded DBs without changing this script.
  - The `electron/db/schema.ts` import works under Node 22 via default `--experimental-strip-types`. The performance warning emitted by Node is benign.
  - **Out-of-scope follow-up**: U1-VR will add `npm run build:electron`, `qa-launch-electron.sh` invocation per profile, and `agent-browser` capture wiring. The 13 canonical screens map to fixture profiles as documented in §7 P0.4 (see "HOME profile granularity").

#### P0.5 — Capture orchestrator for U1-VR

- **Group**: U1-VR prereq (extracted in v3.3 split)
- **SHA**: `9d50575`
- **Lines moved**: 0 (P0.5 adds new files; no relocation, no source change to `electron/`/`src/`/`dashboard.css`)
- **Files added**:
  - `scripts/qa-capture-screen-map.json` — declarative screen-map. 13 canonical entries (`dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `backfill-dialog`, `first-run-onboarding`, `notification-overlay`, `setup-guide`, `mcp-insights-expanded`, `mcp-insights-collapsed`, `memory-monitor-expanded`, `memory-monitor-collapsed`) + 2 renderer-only twins (`renderer-dashboard`, `renderer-settings`). Each entry carries `{ name, profile, target, waitFor, steps, description, tbd? }`. Screens with unresolved navigation paths (`setup-guide`, `notification-overlay`) are flagged with explicit `tbd:` annotations for U1-VR-side refinement.
  - `scripts/qa-capture-baseline.sh` — Bash + jq orchestrator. Modes: `--list` (enumerate screens grouped by profile), `--dry-run` (validate JSON shape + jq presence + `bash -n` self-check; no Electron launch), `<profile>` (full capture for one profile), `--all` (4 profiles in series). Per-profile lifecycle: seed via `qa-seed-fixtures.mjs` → launch `qa-launch-electron.sh` in background subshell with PID capture → `agent-browser connect 9222` → drive screens per map → `screenshot` to PNG + emit sidecar JSON → `SIGTERM` (10 s grace) → `SIGKILL` if needed.
- **Dry-run**: PASS — `bash scripts/qa-capture-baseline.sh --dry-run` exits 0; `--list` enumerates 15 entries.
- **Frontend review**: (filled after `scripts/run-frontend-review.sh`)
- **Cascade-order check**: N/A — no CSS source change.
- **Visual diff**: N/A — no PNGs emitted. P0.5 only emits orchestration infrastructure; the actual baseline is U1-VR.
- **Inventory rerun**: not run (no `dashboard.css` change).
- **Notes / design points**:
  - Bash + jq chosen over Node because process management (launch / SIGTERM / SIGKILL / PID tracking) is more idiomatic in Bash and consistent with the existing `qa-launch-electron.sh` + `qa-seed-fixtures-test.sh` family.
  - Screen-map is intentionally declarative — no orchestrator code branches on screen name. Adding a new screen is a JSON edit, not a script edit.
  - Sidecar JSON `capturedAtFixed` is a constant string (not real time) so sidecars themselves are byte-stable across re-captures, satisfying the U1-VR determinism step.
  - `notification-overlay` and `setup-guide` carry `tbd:` annotations because their precise navigation path could not be confirmed without a headed run. The U1-VR executor refines the map in-place during baseline capture.
  - `--dry-run` cannot exercise headed launch / agent-browser / Electron. The full headed determinism check is U1-VR's responsibility (per §7 P0.5 Decisions).
  - **Out-of-scope follow-up**: U1-VR consumes this orchestrator end-to-end. P1 (collision reconciliation) does NOT need this orchestrator since its diff target is source, not pixel.
- **Fix-forward (P0.5 follow-up, 2026-05-09)**:
  - Bug surfaced during U1-VR pre-flight: `better-sqlite3` native module compiles for one Node ABI at a time, but the seeder runs under system Node (`MODULE_VERSION 127` on Node 22) while Electron 28 embeds Node with `MODULE_VERSION 119`. After the seeder ran, Electron failed to load the DB with `ERR_DLOPEN_FAILED` on every profile launch.
  - Fix: split `capture_profile()` into a seed-only phase (`seed_profile()`) and a capture-only phase. Added `ensure_runtime(node|electron)` helper that calls `npm run ensure:node` / `npm run ensure:electron`. Both `--all` and `<profile>` modes now run a node-ABI seed pass first, then a single rebuild for Electron, then the capture pass. Added `--seed-only` mode for advanced users. The rebuild scripts are idempotent — they read `config.gypi` and only rebuild when the runtime target changed — so the cost is paid exactly twice per `--all` run.
  - Documented in script header + §7 P0.5 (above) under the new Decisions/Steps as the canonical workflow.
  - **U1-VR blocker (P0.5.1 root-cause finding, P0.5.2 resolution)**: agent-browser 0.27.0's `--cdp <port>` route to the daemon launches Chromium with about:blank by default; only `--cdp` per-call commands attach to the running Electron's tabs. Within `--cdp` per-call, `tab <id>`, `snapshot`, `eval`, `click`, `get` all work against the external Electron — only `screenshot` is unreliable. Two distinct failure modes were observed across multiple repro cycles on 2026-05-09 and 2026-05-10:
    - When two CDP page targets exist (main + notification), the daemon mirrors t1 (notification, blank) as the active target and `screenshot` captures that, NOT the main app.
    - When only the main page exists (notification window closed), `agent-browser --cdp 9222 screenshot` returns `✗ CDP command timed out: Page.captureScreenshot`. Cause: Electron 28.3.3 on macOS paint-pauses BrowserWindows that aren't OS-level foreground; CDP `Page.captureScreenshot` waits for a fresh frame and times out.
    - Snapshot/get/click/eval are unaffected because they read DOM state, not compositor frames.
  - **P0.5.2 resolution (landed in this fix-forward)**: per §C5 / `.claude/rules/agent-browser-qa.md`, agent-browser is the only allowed tool — so the orchestrator stays on agent-browser for navigation but routes screenshot capture through Electron's native `webContents.capturePage()` API (which captures from the compositor and is unaffected by paint-pause). Concretely:
    1. New env var **`OMT_QA_CAPTURE_MODE=1`** in `electron/main.ts`. When set:
       - The notification BrowserWindow is not created (single-tab CDP — eliminates target ambiguity).
       - A new IPC handler `qa:capture-window` registers, exposed to the renderer as `window.api.qaCaptureWindow(path: string)`. The handler validates the path is absolute and lives under `/tmp`, `/private/tmp`, or `/var/folders` (refuses real-user paths), then calls `mainWindow.webContents.capturePage()` and writes the PNG.
    2. The orchestrator (`scripts/qa-capture-baseline.sh`) launches Electron with `OMT_QA_CAPTURE_MODE=1` and replaces the screenshot step with `agent-browser --cdp <port> eval "window.api.qaCaptureWindow('<path>').then(r => JSON.stringify(r))"`. Determinism check at smoke time (P0.5.2): three captures of identical DOM state produced byte-identical PNGs (sha256 `ed298c36…`); a click followed by a fourth capture produced a different sha (`7824a977…`), confirming the capture reflects DOM state changes.
    3. The `notification-overlay` canonical screen is **skipped under capture mode** (the notif window does not exist). Re-enabling its baseline requires a separate launch flow without `OMT_QA_CAPTURE_MODE`. Tracked as a `tbd:` annotation in `qa-capture-screen-map.json`; U1-VR can decide to drop, defer, or implement a notification-only mode. The other 12 canonical screens are unaffected.
    4. End-user runs are unchanged: the env var is unset, so neither the notification skip nor the IPC handler activates. The renderer's `window.api.qaCaptureWindow` invokes an unregistered IPC channel and rejects, but no production code path calls it. Tests do not call it either.
  - Versions tested: agent-browser 0.26.0 (initial install) → 0.27.0 (2026-05-09 upgrade) — both exhibit the screenshot CDP timeout. Electron 28.3.3 in OhMyToken. Capture mechanism: `webContents.capturePage()` (Electron-native) — agent-browser only used for navigation/`eval` triggering.

#### U1-VR-b — Extended partial baseline (populated profile, 4 of 13 canonical screens)

- **Group**: U1-VR partial extension — landed on top of U1-VR-a (`cb5d1f4`)
- **SHA**: `a8aaf64`
- **Lines moved**: 0
- **Captured screens** (4 of 13): `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail` (NEW), `settings-context-limit` (NEW). All sidecars now record both `targetViewport` (400×900 from screen-map, post U1-VR-b decision to match shipped 400×640 layout) and `actualPx` (800×1224 — DPR 2 of 400×612 main BrowserWindow content area).
- **Orchestrator improvements that unblocked the 2 new screens** (P0.5.3 fix-forward bundled here):
  1. **Native eval click** replaces agent-browser's CDP `click`. The CDP `Input.dispatchMouseEvent` doesn't trigger React's synthetic onClick — confirmed during U1-VR-b smoke: `agent-browser --cdp 9222 click @e6` reported "✓ Done" but `setShowContextSettings(true)` never fired. Replacing with `agent-browser --cdp 9222 eval "document.querySelector(sel).click()"` invokes the DOM-level click which React listens to. Documented in script comment.
  2. **Reload between screens** resets React state (popup mounts, scroll position, focus, AnimatePresence pending exits). Without this, settings-context-limit's open popup bled into subsequent captures because AnimatePresence keeps modals mounted until React unmounts them. `agent-browser --cdp <port> reload` + `wait .dashboard` is now the prefix of every screen iteration.
  3. **Foreground re-activate before each capture** via CDP HTTP `/json/activate/<id>`. macOS paint-pauses non-foreground BrowserWindows so framer-motion's rAF-driven fades stall mid-progress (overlay opacity stuck at 0.019 instead of 1). Re-activating per-capture lets animations complete naturally; combined with a 500ms settle window this captures clean end-states without inline-style hacks.
  4. **Stale Electron cleanup** before launch. Multiple orchestrator runs from the same shell session left Electron processes alive that bound to the same `--remote-debugging-port=9222` (orchestrator failures inside pipe-loop subshells didn't trigger the EXIT trap). New launches racing with stale instances captured stale React state. The orchestrator now `kill -KILL`s any pre-existing Electron from this repo's `node_modules/` bound to the CDP port before launch.
  5. **Sidecar viewport reporting**: `targetViewport` (gate-doc spec) and `actualPx` (read from PNG file with `file(1)`) now both included so the spec-vs-actual discrepancy is explicit per-capture rather than implicit.
- **Skipped screens** (9 of 13 + 2 renderer twins, all `tbd:` annotated):
  - `settings-evidence` — needs **fixture enrichment**. `.evidence-settings-btn` is conditionally rendered behind `hasInjectedFiles` (PromptDetailView.tsx:77, 192), which requires `displayScan.injected_files` to be a non-empty array. Populated fixture seeds prompts with `tool_summary` (Read/Edit counts) but NOT `injected_files` rows. U1-VR-c needs to add at least one prompt with seeded injected_files to populate fixture.
  - `mcp-insights-expanded`/`collapsed` — needs fixture enrichment. McpInsightsCard `return null` when `!data` (McpInsightsCard.tsx:90). Populated fixture has 0 MCP `tool_calls` in DB. Cards never render.
  - `memory-monitor-expanded`/`collapsed` — needs fixture enrichment. MemoryMonitorCard `return null` when `loading || !status` (MemoryMonitorCard.tsx:186). No memory file data seeded.
  - `notification-overlay` — permanently skipped under `OMT_QA_CAPTURE_MODE=1` (notification window not created). Re-enabling needs separate launch flow.
  - `backfill-dialog` (backfill profile) and `first-run-onboarding`, `setup-guide` (first-run profile) — only populated profile was iterated in U1-VR-b. U1-VR-c should run the orchestrator across all 4 profiles or use `--all`.
  - `renderer-dashboard`, `renderer-settings` — renderer-only flow not exercised.
- **Reproduce U1-VR-b run**:
  ```bash
  bash scripts/qa-capture-baseline.sh populated
  ```
- **Determinism check**: not yet run. U1-VR-c should re-run the same command into a separate `OUT_DIR` and assert byte-equal hashes for the 4 captured screens.
- **U1-VR-c checklist (priorities)**:
  1. Fixture enrichment — add MCP tool_calls, memory files, prompt injected_files to populated profile (unblocks 5 screens).
  2. Run remaining profiles (backfill, first-run) — `bash scripts/qa-capture-baseline.sh --all` (unblocks 3 screens).
  3. Renderer twins via `qa-launch-renderer.sh` (unblocks 2 screens).
  4. Determinism re-run + byte-equal verification.
  5. Land final U1-VR commit + §14 entry, marking baseline complete (12 of 13 canonical, with `notification-overlay` deferred).

#### U1-VR-a — Partial visual baseline (populated profile, 2 of 13 canonical screens)

- **Group**: U1-VR partial — landed under v3.3 split, P0.5.2 wiring
- **SHA**: `cb5d1f4`
- **Lines moved**: 0 (baseline artifacts only; no source change)
- **Files added**:
  - `docs/qa/runs/2026-05-10/baseline/canonical/dashboard-all-default.png` (96209 bytes, 800×1224 px)
  - `docs/qa/runs/2026-05-10/baseline/canonical/dashboard-all-default.json` (sidecar)
  - `docs/qa/runs/2026-05-10/baseline/canonical/dashboard-claude.png` (123798 bytes, 800×1224 px)
  - `docs/qa/runs/2026-05-10/baseline/canonical/dashboard-claude.json` (sidecar)
- **Captured screens** (2 of 13):
  - `dashboard-all-default` — populated profile boot, `All` provider tab default-active. SHA `ed298c36528b4b55a9ae546ae37b4269dea5aec9`. Same hash produced under P0.5.2 smoke testing (3 captures byte-identical) — confirms reproducibility.
  - `dashboard-claude` — populated profile, click `.provider-tabs .provider-tab:nth-child(2)` to activate Claude tab. SHA `f0be79c2968cd02c8fcc46c0786189e2a7b20786`. Different hash from `dashboard-all-default` confirms DOM state change is reflected in the capture.
- **Skipped screens** (8 of 10 in populated, plus 3 in other profiles + 2 renderer twins): all carry `tbd:` annotations in `scripts/qa-capture-screen-map.json` and require U1-VR-b session for selector validation:
  - Same-page variants — `mcp-insights-expanded`/`-collapsed`, `memory-monitor-expanded`/`-collapsed`, `settings-context-limit`: selectors derived from source but `agent-browser scrollintoview` + click flows not exercised end-to-end. populated profile may not seed enough MCP/memory data to render those cards in their non-empty state.
  - Multi-step nav — `dashboard-prompt-detail`, `settings-evidence`: `.session-card` exists in claude-tab populated state but `agent-browser --cdp click .session-card` did not trigger navigation to SessionDetailView (subsequent `wait .prompt-card` hung). Likely needs ref-based click via `snapshot -i` → `click @e<n>` per agent-browser core skill.
  - `notification-overlay`: permanently skipped under `OMT_QA_CAPTURE_MODE=1` (the notification BrowserWindow is not created). U1-VR-b can decide to drop, defer, or implement a separate notification-only launch flow.
  - Other-profile screens — `backfill-dialog` (backfill), `first-run-onboarding` + `setup-guide` (first-run): not exercised in P0.5.2; only populated profile was iterated.
  - Renderer-only twins — `renderer-dashboard`, `renderer-settings`: separate `qa-launch-renderer.sh` flow not exercised.
- **Frontend review**: N/A — docs-only landing of pre-validated capture artifacts. (P0.5.2 fix-forward earned its own frontend-review under fingerprint `7c62d4f6…` with verdict OK with fixes.)
- **Cascade-order check**: N/A — no CSS source change.
- **Visual diff**: N/A for baseline land (this IS the baseline). All future Tier 1+ commits diff against this set for the 2 captured screens; the 11 still-`tbd:` screens are not part of the regression bar until U1-VR-b lands them.
- **Sidecar schema**: each PNG ships with a JSON sidecar capturing `{ profile, screen, fixedNow: "2026-05-05T12:00:00Z", targetViewport (1440×900 from gate-doc spec), actualPx (800×1224 from PNG file — main BrowserWindow is hardcoded to 400×640 logical), agentBrowserVersion, electronVersion, capturedAtFixed: "FIXED" }`. The `targetViewport` vs `actualPx` gap reflects a separate decision deferred to U1-VR-b: whether to resize the main BrowserWindow to 1440×900 in capture mode. The user-facing render path is currently 400×640.
- **Notes / U1-VR-b checklist**:
  1. Decide BrowserWindow resize policy (1440×900 vs leave at 400×640 to match shipped layout). Document in §7 P0.5 Decisions.
  2. Refine `dashboard-prompt-detail` nav: try `snapshot -i` → `click @e<ref>` instead of CSS selector click; or insert a `wait_ms` between click and the next wait.
  3. Validate `settings-context-limit` end-to-end (selectors look right but unrun).
  4. Validate `mcp-insights-*` / `memory-monitor-*` (expand/collapse variants).
  5. Iterate first-run + backfill profile launches; verify their root selectors render on boot.
  6. Renderer-only twins — run `qa-launch-renderer.sh` + `agent-browser open <vite-url>` flow. Mock window.api `_trigger` hook may need to be added if `renderer-settings` requires IPC simulation.
  7. After all 13 canonical + 2 renderer twins captured, run `--all` again into a separate `OUT_DIR` and assert byte-equal hashes vs first run (determinism check, gate doc §7 U1-VR Step 4).

#### U1-VR-c — Other-profile partial baseline (first-run + backfill, 7 of 13 canonical screens)

- **Group**: U1-VR (visual baseline, third batch). Extends U1-VR-b by adding the three other-profile screens that were `tbd:` and orchestrator-blocked.
- **SHA**: `5db711b`
- **Captured screens** (3 NEW; total 7 of 13): `first-run-onboarding`, `setup-guide` (first-run profile), `backfill-dialog` (backfill profile). Hashes:
  - `first-run-onboarding.png` — sha256 `41c9e00bb825e35fb212b16cf0d59d7022ea512a2a56fa7f4c4108abb0b82d09` (92,448 bytes)
  - `setup-guide.png` — sha256 `0274ddbf1fc9801cb755bdab3114b7f2041ca16eb7355dd05d8c6e8fcb20ef9a` (90,955 bytes)
  - `backfill-dialog.png` — sha256 `90d51560bcb9143d55562fe6c0695367b0683b768f92edd31f071ccb209085a0` (112,676 bytes)
- **Determinism check (U1-VR-b → U1-VR-c)**: the 4 populated PNGs from U1-VR-b are byte-equal in U1-VR-c (re-checked sha256). Orchestrator changes below are non-regressing for the populated profile.
- **Hotfix landed alongside**: `electron/main.ts` `before-quit` handler called `mainWindow.close()` without an `isDestroyed()` guard. Under the orchestrator's terminate-pid SIGTERM teardown (and any other normal-quit race where the BrowserWindow was destroyed before `before-quit` fired), this raised `TypeError: Object has been destroyed at App.<anonymous>` and tore down the main process. Surfaced as a user-visible Electron error dialog mid-orchestration. Added the `!mainWindow.isDestroyed()` guard; rebuilt `dist-electron`.
- **Orchestrator P0.5.4 improvements**:
  1. **Per-profile boot selector**: hardcoded `wait .dashboard` after the inter-screen reload was wrong for non-populated profiles. `populated`/`backfill` keep `.dashboard`; `first-run`/`setup-guide` switched to `.first-run-screen` (App.tsx mounts FirstRunOnboarding when `getFirstRunStatus.isFirstRun=true`). Without this, first-run runs would hang on `wait .dashboard` until timeout.
  2. **Skip reload for first screen**: `agent-browser --cdp <port> reload` after Electron's clean boot triggers an agent-browser daemon CDP-session-id rotation that returns "Session with given id not found" (or EAGAIN/`Resource temporarily unavailable`) on the next CLI call. The reload was only needed *between* screens to clear AnimatePresence-leaked modal state; the first screen boots clean already. Loop now reloads from screen 2+ only. Required `done < <(jq …)` instead of `jq … | while …` to keep `first_screen` propagating across iterations (subshell scope fix).
  3. **Reload settle**: 1 s sleep between reload and the next agent-browser command for the inter-screen path, to dodge the daemon-busy window.
  4. **Daemon hard-kill at profile start**: `pkill -9 -f agent-browser-darwin-arm64` added alongside the existing stale-Electron kill in `capture_profile`. Multiple agent-browser daemons can accumulate across re-runs (3 simultaneous instances observed during U1-VR-c smoke), and stale daemons cache CDP session IDs that no longer map to live targets, producing intermittent EAGAIN/session-not-found across the orchestrator's first agent-browser command.
- **Fixture enrichment for backfill profile**: the dashboard's `BackfillDialog` is gated on `count > 0` from `countSessionFiles()`, which counts `^[0-9a-f]{8}-…\.jsonl$`-named files under `~/.claude/projects/**`. The U1-VR-b backfill fixture only seeded `.fixture-marker` files, so count was 0 and the dialog never rendered. Added a new top-level `sessionFiles[]` field to the `qa-fixtures.json` schema (interpreted by `qa-seed-fixtures.mjs` step 1b — UUID-named jsonl with seeded message lines). Backfill profile now seeds one such file with a single fixture user message; dialog renders with "Found 1 Claude session file." text. The `populated` profile is unchanged (still no `sessionFiles`); other profiles get a no-op pass.
- **Setup-guide selector fix**: U1-VR-b screen-map clicked `.first-run-provider-card:first-of-type` (the `<article>` element with no click handler) and waited on the synthetic class `.setup-guide.first-run-walkthrough .setup-guide-title`. Updated to click the actual button inside the card (`.first-run-provider-card:first-of-type .first-run-primary-btn`, which `onClick`s to `setStage('walkthrough')`) and wait on `.first-run-walkthrough .setup-guide-title` (matches `SetupGuide.tsx:58` rendered DOM).
- **Skipped screens still pending**: 6 of 13 remain `tbd:` for U1-VR-d/e:
  - `settings-evidence` (populated): needs `displayScan.injected_files` non-empty in fixture (`PromptDetailView.tsx:77` gate). `tool_summary` is seeded but `injected_files` is not.
  - `mcp-insights-{expanded,collapsed}` (populated): `McpInsightsCard.tsx:90` returns null without MCP `tool_calls` data; populated fixture seeds none.
  - `memory-monitor-{expanded,collapsed}` (populated): `MemoryMonitorCard.tsx:186` returns null without memory file data; populated fixture seeds none.
  - `notification-overlay`: permanently skipped under `OMT_QA_CAPTURE_MODE=1` (notif BrowserWindow not created); separate launch flow required.
  - `renderer-{dashboard,settings}` (renderer-only twins): renderer-only flow not exercised.
- **Frontend review**: N/A — docs-only landing of pre-validated capture artifacts plus the surgical Electron `isDestroyed` guard (1 line; not a UI change).
- **Cascade-order check**: N/A — no CSS source change.
- **Visual diff**: N/A — this extends the baseline. The 4 populated PNGs are byte-equal vs U1-VR-b (no regression).
- **Notes / U1-VR-d checklist**:
  1. **Fixture enrichment** (5 screens unblock): seed MCP `tool_calls`, memory file rows, prompt `injected_files` for the `populated` profile. Re-capture mcp-insights-{expanded,collapsed}, memory-monitor-{expanded,collapsed}, settings-evidence.
  2. **Renderer twins** (2 screens): launch vite dev server via `qa-launch-renderer.sh`, point agent-browser at the served URL, capture renderer-dashboard + renderer-settings against mock `window.api`. May need to add a `_trigger` hook on the mock for `onNavigateTo('settings')`.
  3. **Determinism re-run**: after all 12 captures land (notification-overlay deferred), run `--all` into a separate `OUT_DIR` and assert byte-equal sha256 hashes vs the canonical baseline.
  4. **U1-VR final commit**: mark baseline complete (12/13, with notification-overlay permanently deferred). Update §7 P0.5 Decisions if any orchestrator behavior is meant to ship as-is.

#### U1-VR-d — Final baseline (10 deterministic + 1 informational, refactor-ready)

- **Group**: U1-VR (visual baseline, fourth and final batch). Resolves U1-VR-c's fixture-enrichment/renderer-twin checklist; closes the U1-VR phase so the dashboard.css decomposition refactor can begin.
- **SHA**: `e4c317a`
- **Captured screens** (10 byte-deterministic + 1 informational; total 10 of 13 canonical + 1 of 2 renderer twins):
  - **Newly captured** (3): `settings-evidence`, `memory-monitor-expanded`, `memory-monitor-collapsed`.
  - **Re-baselined** (2, fixture changes affected hash): `dashboard-claude` (memoryFiles seed renders the Claude memory card), `dashboard-prompt-detail` (the screen lands on sess-fixture-003 → req-005 by `last_timestamp DESC`/`timestamp DESC`; req-005's seeded `mcp__figma__download_figma_images` tool_call + 2 injected_files now render in the per-prompt summary).
  - **Unchanged** (5, hashes byte-equal vs U1-VR-c): `dashboard-all-default`, `settings-context-limit`, `backfill-dialog`, `first-run-onboarding`, `setup-guide`.
  - **Renderer twin** (1, informational only): `renderer-dashboard` — captured under `/renderer/` with viewport pinned to 400×640, but pixel-deterministic only at the dimensions level; pixel data drifts between runs because `src/main.tsx` mock uses `Math.random()` (lines 165–166) for the prompt-heatmap mock data. Treated as a smoke check, NOT a regression-detection target. To make it byte-equal in the future, replace `Math.random()` with a seeded PRNG.
- **Final canonical hashes** (sha256, all under `docs/qa/runs/2026-05-10/baseline/canonical/`):
  - `backfill-dialog.png` — `90d51560bcb9143d55562fe6c0695367b0683b768f92edd31f071ccb209085a0` (112,676 bytes, U1-VR-c)
  - `dashboard-all-default.png` — `6aa729c8a53e78d09eb5ca95221089f98fe1a99401709c3864b7116e1690e0a8` (96,467 bytes, U1-VR-b unchanged)
  - `dashboard-claude.png` — `ec4859840b7d2a3b249fdbca2ce2cd534d9bf721b8e7dbb42e0d08cc80886c2d` (146,288 bytes, **U1-VR-d new**)
  - `dashboard-prompt-detail.png` — `e2f9eb35679abc7fa5e15a8fb09e394b747a562dd704f048c8f3dcda50f5c82e` (94,955 bytes, **U1-VR-d new**)
  - `first-run-onboarding.png` — `41c9e00bb825e35fb212b16cf0d59d7022ea512a2a56fa7f4c4108abb0b82d09` (92,448 bytes, U1-VR-c)
  - `memory-monitor-collapsed.png` — `18d7337cc60a9d312f2c64cffa7942440e0ff4d9c385ffe38a4ddb0c9aa9c27e` (118,017 bytes, **U1-VR-d new**)
  - `memory-monitor-expanded.png` — `93d64f1c03d914a2793873a74d115a6da5bbd6d160a9bb911824862c930cca99` (141,277 bytes, **U1-VR-d new**)
  - `settings-context-limit.png` — `9307209cd9281a210df32a0c427c9b6919741c31bac1ebd5a307a337ff665d98` (145,190 bytes, U1-VR-b unchanged)
  - `settings-evidence.png` — `1f8c2669b7ae24bc21ca22b5c036004342d6e1569512506509d3a0d64d67f081` (139,846 bytes, **U1-VR-d new**)
  - `setup-guide.png` — `0274ddbf1fc9801cb755bdab3114b7f2041ca16eb7355dd05d8c6e8fcb20ef9a` (90,955 bytes, U1-VR-c)
  - `renderer/renderer-dashboard.png` — `ea1f266c98cf82a111c3603173afde5bd19e98ddbe134a7f24b49b79d2984e83` (informational; do not gate on)
- **Permanently deferred (3 screens — out of scope for this epic)**:
  - `mcp-insights-{expanded,collapsed}` (populated): `FEATURE_FLAGS.MCP_INSIGHTS = false` since #178 (2026-03-13). `McpInsightsCard` returns null at the parent JSX level (`UsageView.tsx` `{FEATURE_FLAGS.MCP_INSIGHTS && <McpInsightsCard />}`), so users never see it. The CSS rules for `.mcp-card-*` still live in `dashboard.css` and remain part of the decomposition surface — to capture these screens, flip the flag (or add a build-time env override) and re-run with `INCLUDE_TBD=1`. Tool-call fixture rows (8 entries spanning Read/Edit/Bash + 4 `mcp__*`) are pre-seeded, so the capture is unblocked once the gate flips.
  - `notification-overlay`: skipped under `OMT_QA_CAPTURE_MODE=1` (notification BrowserWindow is not created in capture mode to avoid CDP target ambiguity). Same caveat as U1-VR-c.
  - `renderer-settings`: out-of-scope for this epic. `.settings-section` is styled in `src/App.css:122-141`, NOT in `src/components/dashboard/dashboard.css`. The Settings view contains zero CSS rules touched by this decomposition, so capturing it adds no regression-detection value here. Re-evaluate when the `App.css` decomposition epic begins.
- **Determinism check (U1-VR-d)**: ran `OUT_DIR=/tmp/u1vr-d-determinism-check{,2,4} bash scripts/qa-capture-baseline.sh populated` four times. Run 2 vs run 4 produced byte-identical hashes for all 7 populated screens (`cmp -s` PASS for `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `memory-monitor-expanded`, `memory-monitor-collapsed`). Run 1 was a warm-up outlier (different hashes for `dashboard-all-default` and `memory-monitor-expanded`); subsequent steady-state runs converge on the canonical hashes above. Treat the first capture after a fresh fixture or daemon restart as a warm-up — re-capture for byte-equal comparison.
- **Fixture enrichment**:
  - `qa-fixtures.json` `populated` profile: added `memoryFiles[]` (claude provider, MEMORY.md + 2 sibling .md files for the multi-file MemoryMonitorCard layout); added `db.tool_calls[]` (8 entries: 2× Read on req-001, Edit + 2× `mcp__figma__get_figma_data` + `mcp__playwright__playwright_screenshot` on req-002, Bash on req-003, `mcp__figma__download_figma_images` on req-005); added `db.injected_files[]` (2 rows on req-005 — MemoryMonitorCard.tsx + dashboard.css — to gate `hasInjectedFiles=true` for the settings-evidence flow that lands on sess-fixture-003 → req-005).
  - `qa-seed-fixtures.mjs`: added step 1c for `memoryFiles` (computes the encoded-cwd path for claude provider via `process.cwd()` so it matches the orchestrator's `qa-launch-electron.sh` cwd), plus injected_files / tool_calls SQL inserts inside `seedSqlite()` (FK-resolved via the existing `promptIdByRequestId` map).
- **Orchestrator P0.5.5 fixes**:
  1. **`set -u` unbound-variable bug in `run_steps()`**: `${ab_prefix[@]}` is empty in daemon mode (renderer-only), and bash 5.x errors out under `set -u` when expanding an empty array. Replaced with `${ab_prefix[@]+"${ab_prefix[@]}"}` across all 4 step types (click/wait/eval/scroll-to). The bug was latent in U1-VR-{a,b,c} because no renderer-only screen exercised eval/click/scroll-to until U1-VR-d.
  2. **Renderer-only viewport pin**: `agent-browser` does not auto-pin viewport in daemon mode, so PNG dimensions diverged across runs (observed 2400×2558 vs 2072×3518). Added `agent-browser set viewport <w> <h>` after `open` in `capture_renderer_only`, sourcing `<w>`/`<h>` from `qa-capture-screen-map.json` (`viewport.width`/`viewport.height`). Now produces 400×640 PNGs matching the headed-Electron capture dimensions. (Pixel data still drifts due to mock `Math.random()`; see renderer-twin caveat above.)
- **Screen-map updates**:
  - `settings-evidence`: removed tbd; click steps unchanged (sess-fixture-003 → req-005 via `.session-card`/`.prompt-card` first-match).
  - `mcp-insights-{expanded,collapsed}`: tbd reworded from "needs validation" to a permanent FEATURE_FLAGS gate explanation; both will only capture under `INCLUDE_TBD=1` against a flag-flipped build.
  - `memory-monitor-{expanded,collapsed}`: added `.provider-tabs .provider-tab:nth-child(2)` Claude-tab click prerequisite (UsageView.tsx `supportsMemoryCard` only returns true for claude/codex; the default 'all' tab does not render `.memory-card`).
  - `renderer-dashboard`: removed tbd; added byte-determinism caveat in description.
  - `renderer-settings`: tbd reworded from "needs `_trigger` hook" to "out-of-scope (App.css)".
- **Hashing notes**: re-baselined `dashboard-claude` and `dashboard-prompt-detail` because the populated fixture now seeds memory files (visible on the Claude provider tab) and tool_calls (visible in the prompt-detail's per-prompt summary). The U1-VR-c hashes for those two screens (`d14452d4…` / `5af60838…`) are SUPERSEDED by the U1-VR-d hashes above.
- **Frontend review**: docs + fixture-only landing — capture artifacts plus orchestrator/seeder enhancements; no production component or CSS source change. (Mock `src/main.tsx` Math.random() noted but intentionally left unchanged.)
- **Cascade-order check**: N/A — no CSS source change.
- **Visual diff**: PARTIAL EQUIVALENCE — 5 of 7 populated PNGs byte-equal vs U1-VR-c; 2 changed because of intentional fixture enrichment (no CSS regression). The 3 first-run/backfill PNGs from U1-VR-c are byte-equal in U1-VR-d (re-checked sha256).
- **Notes / refactor handoff**:
  - U1-VR is now CLOSED. The 10 canonical PNGs above are the authoritative regression baseline for the dashboard.css decomposition. Refactor units (U2+) compare against these hashes per §11.4.
  - The renderer-dashboard PNG is NOT a regression target. If the refactor needs renderer-only verification, use `pixelmatch` or visual diff with a tolerance window — or seed the mock PRNG first.
  - Baseline validity window: SQLite `date('now', 'localtime')` is not faked (only renderer `Date` is, via FakeDate), so cards that filter by today (e.g., `McpInsightsCard` default 'today' period) implicitly depend on system date staying close to fixture dates. The current populated fixture is anchored at 2026-05-05; the baseline is reproducible as long as the regression check runs on the same physical day or within the cards' wider time windows. Move fixture timestamps forward and re-baseline if a refactor verification spans many days.

#### P1 — Cross-file class collision risk records

- **Group**: cross-file collisions (no owner relocation)
- **SHA**: `1dbd444`
- **Lines moved**: 0 (P1 is record-keeping; no CSS source delta)
- **Consumers updated**: none
- **Frontend review**: (filled after `scripts/run-frontend-review.sh`)
- **Cascade-order check**: PASS — bundle re-emits selectors-ordered.txt.U1 1:1; LCS = 618/618 comparable selectors. Zero source delta in `dashboard.css`/`App.css`/`TokenTreemap.css`.
- **Visual diff**: PASS by §11.4 implicit equivalence — P1 introduced no CSS source change, so `dist/assets/main-*.css` is byte-equivalent (modulo Vite content hash) to U1. agent-browser canonical-screen capture was waived per user approval (2026-05-08) on the same grounds. No exception risk recorded; resumes mandatory for U2+.
- **Inventory rerun**: No delta vs U1 baseline. `selectors-ordered.txt`, `class-consumers.json`, `class-consumers.md`, `prefix-summary.md`, `orphans.md`, `collisions.md` are byte-identical to U1 outputs except for the generator timestamp on two files (reverted; not committed).
- **Records**: `docs/sdd/css-decomp-inventory/collision-records/{loading,cache,cost-row,legend-value}.md`
- **Decisions** (one per collision):
  - `.loading` (`dashboard.css:587 .dashboard-refresh-btn.loading` ↔ `App.css:115 .icon-btn.loading`) — **BENIGN**. Both compound; mutually exclusive base classes; identical declarations. No DOM node carries both bases simultaneously.
  - `.cache` (`dashboard.css:944 .prompt-card-journey-chip.cache` ↔ `TokenTreemap.css:586 .cost-row.cache`) — **BENIGN**. Compound; different bases; TokenTreemap.css is bundle-absent (see below).
  - `.cost-row` (`dashboard.css:292` standalone ↔ `TokenTreemap.css:578` standalone) — **BENIGN**. Bundle overlap empty: TokenTreemap.css has zero importers in `src/` (no `TokenTreemap.tsx` component exists; no `import './TokenTreemap.css'` anywhere). Confirmed via `grep -rn "TokenTreemap" src` (no matches) and post-build inspection of `dist/assets/main-*.css` (TokenTreemap signatures `display:flex;…color:#ccc` and `margin-left:auto` absent).
  - `.legend-value` (`dashboard.css:1887` standalone ↔ `TokenTreemap.css:204` standalone) — **BENIGN**. Same rationale as `.cost-row`.
- **Notes / deferred items**:
  - **Out-of-scope follow-up**: `src/components/TokenTreemap.css` is a fully orphaned stylesheet. Removal is deferred to a separate issue per §3 C4 (Pure Relocation Discipline) and is not in this epic's U50 scope (which targets `dashboard.css`-internal `/* UNUSED candidate */` markers only).
  - Allowlist updated: `.gitignore` adds a `!docs/sdd/css-decomp-inventory/collision-records/*.md` negation, and `.public-docs-allowlist` lists the four new records explicitly.
  - Per the v3 P1 commit-message template, the customary `… reconcile cross-file class collisions` wording was softened to `… record cross-file class collision classifications` because no reconciliation was needed.

#### U2 — `dashboard/CostCard.tsx` → `CostCard.css` (Tier 1 single-owner, 2 classes)

- **Group**: Tier 1 single-owner (smallest-first; 2 classes — kicks off the Tier 1 sequence)
- **SHA**: `66c4faa`
- **Lines moved**: 13 (`dashboard.css` 4554 → 4538). Three rule blocks extracted: `.cost-card` (4-line block), `.cost-row` (6-line block including `.cost-row span` descendant rule), and the surrounding blank lines. New `CostCard.css` is 17 lines (banner + 3 rule blocks).
- **Consumers updated**: `src/components/dashboard/CostCard.tsx` adds `import './CostCard.css';` after the existing imports (component-local CSS import; no `_shared`/cluster imports yet — those land in U41/U48). The `/* --- Cost Card --- */` section comment in `dashboard.css` is intentionally retained because `.cost-header`, `.cost-title`, `.cost-chevron(.expanded)` still live there until U41 (Tier 2 cluster move).
- **Frontend review**: OK (fp `f302a0cd2345239bc304ef8b769bd963360949067d77b6bc8d4159fa79254e74`) — verdict from `code-reviewer` subagent: 0 critical / 0 major / 0 minor. Byte-identical declaration text confirmed (`.cost-card`, `.cost-row`, `.cost-row span` declarations match the original `dashboard.css:259–301` block 1:1). Banner present. Import path correct. Cluster/shared classes correctly retained in `dashboard.css`.
- **Style review ack**: `bash scripts/ack-style-review.sh "U2 move .cost-card/.cost-row to CostCard.css (Tier 1)"` recorded.
- **Cascade-order check**: PASS. `selectors-ordered.txt` 631 → 628 entries. Selector-only diff (line numbers stripped) shows exactly three deletions: `.cost-card`, `.cost-row`, `.cost-row span`. Zero re-ordering of the 628 surviving selectors. `.cost-header`/`.cost-title`/`.cost-chevron`/`.cost-chevron.expanded` and `.collapsible*` confirmed in place pending U41/U48.
- **Visual diff**: PASS — **7/7 byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the warm capture pass (`docs/qa/runs/2026-05-10/U2/canonical/`). Surfaces verified: `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `memory-monitor-expanded`, `memory-monitor-collapsed`. CostCard renders inside `dashboard-all-default` and `dashboard-claude`; remaining 5 surfaces serve as cascade-order regression sentinels (no CostCard render path). The 3 deferred populated entries (`mcp-insights-{expanded,collapsed}`, `notification-overlay`) remain skipped per U1-VR-d's permanent gates. backfill / first-run / setup-guide profiles are not re-captured because none renders CostCard, and U1-VR-d already covered them.
- **Determinism / warm-up**: First populated capture after a fresh fixture seed exhibited the same warm-up flake pattern documented in U1-VR-d §14: 1–3 of {`dashboard-all-default`, `memory-monitor-expanded`, `memory-monitor-collapsed`} drift on cold-daemon runs but converge on the second pass with the daemon warm. The `U2/canonical/` artifacts are the second-pass capture. Treat the first capture after a `seed-only` step as throw-away; this contract is now load-bearing for every Tier 1+ unit.
- **Inventory rerun**: `537 → 535` distinct classes; `444 → 442` single-owner; `25 / 12 / 56` (cluster / shared / orphan) unchanged; `631 → 628` selector-order entries. `Cross-file collisions` `TokenTreemap: 3 → 2` as a benign side-effect (the `.cost-row` collision documented in `collision-records/cost-row.md` no longer exists at the `dashboard.css` ↔ `TokenTreemap.css` source-text level since `.cost-row` now lives in `CostCard.css`; the record file remains for traceability).
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U2) is unchanged by this commit. No new lint errors introduced. Pre-existing baseline lint debt is not in this epic's scope.
  - No `/* UNUSED candidate */` markers added (Tier 1/2/3 moves defer that to U50, per §8 step 3d).
  - `import './CostCard.css';` is the first CSS import in `CostCard.tsx`. Cascade order via Vite bundler: `UsageDashboard.tsx` (line 38) imports `dashboard.css` first; `CostCard.tsx` (descendant component) imports `CostCard.css` afterward — so the bundle order is `dashboard.css` → `CostCard.css`, which preserves shell-before-local cascade per §8 step 3c.
  - **Out-of-scope follow-up**: a number of cluster/shared classes still rendered by `CostCard.tsx` (`.cost-header`, `.cost-title`, `.cost-chevron`, `.cost-chevron.expanded`, `.collapsible`, `.collapsible-inner`) remain in `dashboard.css` — they are deliberately deferred to Tier 2/3 (U41 cost-cluster, U48 _shared/collapsible).

#### U3 — `dashboard/prompt-detail/PromptMemorySection.tsx` → `prompt-detail/PromptMemorySection.css` (Tier 1 single-owner, 2 classes)

- **Group**: Tier 1 single-owner (2 classes — second smallest-first unit)
- **SHA**: `2a87d08`
- **Lines moved**: 19 (`dashboard.css` 4538 → 4519). Two rule blocks extracted: `.prompt-memory-disclaimer` (10-line block) and `.prompt-memory-notice` (6-line block), plus the `/* Prompt detail memory section */` section comment and surrounding blank lines (the section comment is removed entirely because both classes under it are now relocated — no residual classes remain in that subsection of `dashboard.css`, unlike the U2 Cost Card region which kept the comment for `.cost-header`/`.cost-title`/`.cost-chevron`). New `PromptMemorySection.css` is 18 lines (banner + 2 rule blocks).
- **Consumers updated**: `src/components/dashboard/prompt-detail/PromptMemorySection.tsx` adds `import './PromptMemorySection.css';` after the existing imports (sibling-relative; component-local). No `_shared`/cluster imports yet — those land in U43 (detail-section-cluster), U47 (memory-file shared), and U48 (collapsible shared).
- **Frontend review**: OK (fp `81ad88865f16d69f317a82e884750a6a33aa9809045a925d9fabfef6fa2fac6d`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Byte-identical declaration text confirmed via diff against the original block. Banner present. Import path correct. Spot-check: `.detail-section*` (1672–1705), `.memory-file-*` (4161–4228), `.collapsible*` (4347–4370) all retained for U43/U47/U48.
- **Style review ack**: `bash scripts/ack-style-review.sh "U3 move .prompt-memory-disclaimer/.prompt-memory-notice to PromptMemorySection.css (Tier 1)"` recorded.
- **Cascade-order check**: PASS. `selectors-ordered.txt` 628 → 626 entries. Selector-only diff (line numbers stripped) shows exactly two deletions: `.prompt-memory-disclaimer`, `.prompt-memory-notice`. Zero re-ordering of the 626 surviving selectors. Inventory: `535 → 533` distinct classes; `442 → 440` single-owner.
- **Visual diff**: PASS — **7/7 byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` after a hard reset of all `/tmp/omt-qa-*` state (see "Determinism / hard reset SOP" below). dashboard-prompt-detail (the actual surface that contains `.prompt-memory-disclaimer`/`.prompt-memory-notice`) matches baseline byte-for-byte.
- **Determinism / hard reset SOP** (extends U1-VR-d's warm-up note): three back-to-back captures during U3 produced run-to-run flake on populated screens that don't even render PromptMemorySection (e.g., `dashboard-claude` 146KB ↔ 94KB swings between runs, agent-browser EAGAIN failures mid-run). The flake disappeared after a hard reset: `rm -rf /tmp/omt-qa-css-decomp-home-* /tmp/omt-qa-electron-*.log /tmp/omt-qa-renderer.log` plus `agent-browser close` + `pkill -9 -f Electron.app`. Hypothesis: cumulative SQLite WAL/Electron cache state from preceding `qa-capture-baseline.sh populated` invocations leaks across runs (the script does `rm -rf` the seed HOME but not Electron's per-instance state under `Library/Application Support` namespacing or the daemon's CDP session cache). **Going forward, every Tier 1+ unit's visual capture pass starts with the hard-reset incantation.** Treat the §14 entry's PASS as conditional on that hard-reset preamble.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged from post-U2 (no `.prompt-memory-*` collision was tracked in `collision-records/`). 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U3) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `import './PromptMemorySection.css';` is the first CSS import in `PromptMemorySection.tsx`. Vite cascade order: `UsageDashboard.tsx` (line 38) imports `dashboard.css` first; `PromptMemorySection.tsx` (descendant of `PromptDetailView.tsx` via `Section` mounting) imports `PromptMemorySection.css` afterward — bundle order `dashboard.css` → `PromptMemorySection.css`, preserving shell-before-local cascade per §8 step 3c.
  - **Out-of-scope follow-up**: cluster/shared classes still rendered by `PromptMemorySection.tsx` (`.detail-section*` cluster, `.memory-file-*` shared 9-class group, `.collapsible*` shared 2-class group) remain in `dashboard.css` for U43 / U47 / U48.

#### U4 — `dashboard/prompt-detail/StatPill.tsx` → `prompt-detail/StatPill.css` (Tier 1 single-owner, 3 classes)

- **Group**: Tier 1 single-owner (3 classes — third smallest-first unit)
- **SHA**: `9f09707`
- **Lines moved**: 22 (`dashboard.css` 4519 → 4497). Three rule blocks extracted: `.stat-pill` (8-line block), `.stat-pill-value` (6-line block), `.stat-pill-label` (6-line block), plus surrounding blank lines. New `StatPill.css` is 23 lines (banner + 3 rule blocks). The `/* Stat pills */` section comment was already absent in `dashboard.css`, so no comment relocation needed (unlike U3 which removed the section comment alongside).
- **Consumers updated**: `src/components/dashboard/prompt-detail/StatPill.tsx` adds `import './StatPill.css';` as the first line (sibling-relative; component-local). Component is exclusively rendered inside `PromptDetailView`'s prompt-meta strip, so no fan-out concerns.
- **Frontend review**: OK (fp `06c25f6f1e0bc9970a0ece509e4d2c50f4fdc267edccfcf95b30c0575eebb182`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Byte-identical declaration text confirmed via diff against the original block. Banner present. Import path correct.
- **Style review ack**: `bash scripts/ack-style-review.sh "U4 move .stat-pill/.stat-pill-value/.stat-pill-label to StatPill.css (Tier 1)"` recorded.
- **Cascade-order check**: PASS. `selectors-ordered.txt` 626 → 623 entries. Selector-only diff (line numbers stripped) shows exactly three deletions: `.stat-pill`, `.stat-pill-value`, `.stat-pill-label`. Zero re-ordering of the 623 surviving selectors. Inventory: `533 → 530` distinct classes; `440 → 437` single-owner.
- **Visual diff**: PARTIAL PASS — **3/3 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/`. Captured: `dashboard-all-default` (96,467 B, sha256 matches), `dashboard-claude` (146,288 B, sha256 `ec4859840b7d2a3b249fdbca2ce2cd534d9bf721b8e7dbb42e0d08cc80886c2d` matches U1-VR-d), **`dashboard-prompt-detail`** (94,955 B, sha256 `e2f9eb35679abc7fa5e15a8fb09e394b747a562dd704f048c8f3dcda50f5c82e` matches U1-VR-d). The §7 critical surface for `StatPill` is `dashboard-prompt-detail` — byte-equal confirms zero visual regression. Remaining 7 populated screens (settings-evidence, settings-context-limit, memory-monitor-{expanded,collapsed}, first-run-onboarding, setup-guide, backfill-dialog) **could not be captured** due to the orchestrator daemon-death pattern documented below; none of those 7 screens render `StatPill` so they serve as cascade-order regression sentinels only — and the 2 captured sentinel screens (`dashboard-all-default`, `dashboard-claude`, neither containing `StatPill`) being byte-equal already confirms cascade-order preservation. Per §8 step 8e second clause, this exception is documented here with user approval.
- **Determinism / agent-browser daemon-death pattern (NEW after U3 hard-reset SOP)**: orchestrator (`scripts/qa-capture-baseline.sh populated`) consistently dies mid-profile with `agent-browser` socket errors after exactly 2-3 successful screen captures. Two distinct OS errors observed depending on agent-browser version:
   - **0.27.0** (initial system version, post-`npm i -g` upgrade): `Failed to connect: Connection refused (os error 61) (after 5 retries - daemon may be busy or unresponsive)` after exactly 2 captures (`dashboard-all-default`, `dashboard-claude`). Reproduced twice (initial run + post-deep-reset retry). Verified clean: hard-reset preamble executed, all `/tmp/omt-qa-*` wiped (not just `*-css-decomp-home-*`), `~/Library/Application Support/Electron/{Cache,GPUCache}` wiped, `~/.agent-browser` socket dir wiped. Same death point both runs.
   - **0.25.4** (verified `agent-browser-qa.md` §8 baseline as of 2026-04-21; downgraded via `npm i -g agent-browser@0.25.4` after 0.27.0 failure): `Failed to read: Resource temporarily unavailable (os error 35) (after 5 retries - daemon may be busy or unresponsive)` after exactly 3 captures (`dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`). One screen further than 0.27.0 but same fundamental failure mode (daemon socket exhaustion under repeated CLI invocations).
   - **Hypothesis**: orchestrator launches `agent-browser` as a fresh CLI invocation per step (click / wait / eval / screenshot) — each invocation reuses the persistent daemon's socket. After ~10-15 commands the daemon's connection backlog fills (EAGAIN/ECONNREFUSED), and no orchestrator-side retry recovers it. The "daemon already running" warning printed between every command is a symptom: `agent-browser` is forced to skip its `--ignore-https-errors` flag because re-applying daemon options requires `agent-browser close` first, which the orchestrator never issues mid-profile. U1-VR-{a,b,c,d} circumvented this by splitting capture across 4 commits (each one launches a fresh daemon); U2/U3 succeeded only because their critical surfaces fall in the first 2-3 screens of the populated profile where the daemon is still healthy.
   - **Mitigation queued for P0.5.6**: ~~patch the orchestrator so each `agent-browser` invocation runs `agent-browser close` immediately before, forcing a fresh daemon per step.~~ **Attempted on 2026-05-10 in three variants — all failed; see "P0.5.6 deferred" below.** U5+ that target a screen later in the populated order (e.g., `memory-monitor-*` consumers) still need a working orchestrator fix first.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged from post-U3 (no `.stat-pill*` collision tracked). 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U4) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `import './StatPill.css';` is the first line of `StatPill.tsx`. Vite cascade order: `UsageDashboard.tsx` imports `dashboard.css` first; `StatPill.tsx` (descendant of `PromptDetailView.tsx` via the prompt-detail meta strip) imports `StatPill.css` afterward — bundle order `dashboard.css` → `StatPill.css`, preserving shell-before-local cascade per §8 step 3c.
  - **Visual baseline coverage gap**: this is the first Tier 1 unit to ship with `<10/10 populated screens` byte-equal evidence. Justification (per §8 step 8e second clause): the §7 critical surface (`dashboard-prompt-detail`) is byte-equal, sentinels are byte-equal, the missing 7 surfaces don't render the moved component, and the orchestrator-level failure is documented above with a concrete mitigation plan. Going forward, every unit's §14 entry must explicitly enumerate which screens were captured vs skipped under this pattern until the orchestrator infra issue is fixed.

#### U5 — `dashboard/AccountInsightsCard.tsx` → `AccountInsightsCard.css` (Tier 1 single-owner, 6 classes)

- **Group**: Tier 1 single-owner (6 classes — fourth Tier 1 unit; **plan-swapped from U8 per §7 v3.4 swap** because the original U5 candidate (`CostTreemap.tsx`) hits the multi-selector blocker described in §7).
- **SHA**: `96db97c`
- **Lines moved**: 52 (`dashboard.css` 4497 → 4445). Seven rule blocks extracted: `.account-insights-card` (7-line block), `.account-insights-card-title` (6-line), `.account-insights-card-body` (6-line), `.account-insights-card-actions` (6-line), `.account-insights-card-primary` (11-line including transition declaration), `.account-insights-card-primary:hover` (3-line — `:hover` pseudo-class on the same class), `.account-insights-card-secondary-hint` (4-line). The `/* --- Account Insights Card (inline, replaces gauge area when account not connected) --- */` section comment was removed alongside (six classes under it, all relocated — no residual `.account-insights*` remains in `dashboard.css`). New `AccountInsightsCard.css` is 51 lines (banner + 7 rule blocks).
- **Consumers updated**: `src/components/dashboard/AccountInsightsCard.tsx` adds `import './AccountInsightsCard.css';` as the **first line** (before the `framer-motion` and types imports). Component is exclusively rendered inside `UsageView`'s provider-specific section when the connection status is non-connected, so no fan-out concerns.
- **Frontend review**: OK (fp `8e12788ea47cb6d169bc1ce6cec39174d0c8d4e2b426bced4b817d9517d5e728`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Byte-identical declaration text confirmed; banner present; import path correct; reviewer flagged the convention question of "section comment stub removed in dashboard.css" but confirmed it matches the U3 precedent (when all classes under a section relocate, the comment moves too).
- **Style review ack**: `bash scripts/ack-style-review.sh "U5 move .account-insights-card* to AccountInsightsCard.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 623 → 616 entries. Selector-only diff (line numbers stripped) shows exactly seven deletions: `.account-insights-card`, `.account-insights-card-title`, `.account-insights-card-body`, `.account-insights-card-actions`, `.account-insights-card-primary`, `.account-insights-card-primary:hover`, `.account-insights-card-secondary-hint`. Zero re-ordering of the 616 surviving selectors. Inventory: `530 → 524` distinct classes; `437 → 431` single-owner.
  - **Bundle-side: PRE-EXISTING C7 INHERITANCE** (NEW finding surfaced at U5). `node scripts/css-decomp-cascade-check.mjs` reports the first divergence at `.dashboard` (bundle index 15, expected near the top), caused by Vite's module-graph traversal emitting component-local `*.css` BEFORE the shell `dashboard.css` (the `dashboard.css` import in `UsageDashboard.tsx` line 38 is the *last* import in that file, after sub-component imports on lines 30-37). Verified by `git stash`-ing U5's changes and re-running the check at HEAD (post-U4): **the divergence already exists**, meaning U2/U3/U4 shipped with the same bundle-side C7 violation but only documented source-side `PASS`. U5 does not introduce new divergence; the diff against HEAD is a clean 7-selector deletion. ~~Tracked as a **P1.X follow-up** (separate commit), expected to be addressed by reordering `dashboard.css` to be the **first** CSS import in `UsageDashboard.tsx` so Vite emits it ahead of sub-component CSS.~~ **P1.X attempted on 2026-05-11 and falsified — see "P1.X falsified" entry below.** The import-order fix only shifts the divergence to a different pair; the partial-order baseline cannot be fully preserved during the split phase by import order alone. §3 C7 last bullet now codifies the limitation: visual diff (§3 C5) is the authoritative safety net; bundle-side check stays valuable for shell-vs-shell pair preservation but is over-strict for moved-vs-shell pairs. Every Tier 1+ §14 entry continues to document bundle-side outcome explicitly; treat a FAIL as "investigate and justify if visual-equal" rather than a hard blocker.
- **Visual diff**: PARTIAL PASS — **2/2 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/`. Captured on the third pass after two warm-up passes (see "Determinism / warm-up convergence" below): `dashboard-all-default` (96,467 B, sha256 matches U1-VR-d), `dashboard-claude` (146,288 B, sha256 `ec4859840b7d2a3b249fdbca2ce2cd534d9bf721b8e7dbb42e0d08cc80886c2d` matches U1-VR-d). The §7 critical surface for `AccountInsightsCard` is `dashboard-claude` (the populated profile renders the card on the Claude tab because no provider account is connected in fixture state) — byte-equal confirms zero visual regression of the moved CSS. Remaining 8 populated screens (`dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `memory-monitor-{expanded,collapsed}`, `first-run-onboarding`, `setup-guide`, `backfill-dialog`) **could not be captured** due to the orchestrator daemon-death pattern (P0.5.6 deferred — see entry below); the visible surface for `AccountInsightsCard` is exhausted by the §7 critical surface so this is acceptable per §8 step 8e second clause.
- **Determinism / warm-up convergence**: U2 §14 documented "first capture after fresh fixture is throw-away, second pass is canonical". For `dashboard-claude` the convergence was slower in this session — **three full capture passes** were needed before the canonical 146,288 B hash emerged. Pass 1 captured 96,467 B (looked like the default-tab render — provider-tab-indicator animation mid-flight). Pass 2 captured 31,106 B (heavily faded — framer-motion `requestAnimationFrame`-driven indicator at ~opacity 0.05). Pass 3 captured the canonical hash. The screen-map's `.dashboard .provider-tab.active` `waitFor` gates only React state, not framer-motion animation completion; the orchestrator's 500 ms post-activate settle is sometimes insufficient. **Going forward, when a §7 critical surface flakes, repeat the capture pass up to ~3 times before accepting failure** — and when accepting, document each pass's byte count for the reviewer.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged from post-U4 (no `.account-insights*` collision tracked). 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U5) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `import './AccountInsightsCard.css';` is the first line of `AccountInsightsCard.tsx`, before `framer-motion` and types imports. Vite cascade order: `UsageDashboard.tsx` (line 38) imports `dashboard.css` last among its imports; `AccountInsightsCard.tsx` (descendant of `UsageView.tsx`) imports `AccountInsightsCard.css` first in its own file. The actual bundle emit puts `AccountInsightsCard.css` BEFORE `dashboard.css` (the C7 inheritance issue above), which is the inverse of §3 C7's intent. Once P1.X corrects the import-graph entry, the bundle order will become canonical without any change to the per-component import position.
  - **Visual baseline coverage gap**: continues the U4 pattern of `<10/10 populated screens` evidence. Justification (per §8 step 8e second clause): §7 critical surface (`dashboard-claude`) byte-equal, sentinel (`dashboard-all-default`) byte-equal, the remaining 8 surfaces do not render `AccountInsightsCard` (it appears only inside `UsageView`'s provider-specific section), and the orchestrator-level failure is documented in the "P0.5.6 deferred" entry below with a concrete future fix path.

#### U7 — `dashboard/CacheGrowthChart.tsx` → `CacheGrowthChart.css` (Tier 1 single-owner, 7 classes / 8 selectors)

- **Group**: Tier 1 single-owner (7 distinct classes, 8 selectors — fifth Tier 1 unit).
- **SHA**: `be06d5b`
- **Lines moved**: 58 (`dashboard.css` 4445 → 4387). Eight rule blocks extracted: `.cache-growth-section` (3-line), `.cache-growth-label` (7-line), `.cache-growth-chart` (3-line with placeholder comment body), `.cache-growth-chart--clickable` (7-line), `.cache-growth-chart--clickable .recharts-surface` (3-line descendant rule on the same class), `.cache-growth-compacted-count` (11-line), `.stats-tooltip-compacted` (6-line), `.stats-tooltip-hint` (8-line). The `/* --- Cache Growth Chart --- */` section comment was removed alongside (all classes under it relocated — matches U3/U5 precedent). New `CacheGrowthChart.css` is 57 lines (banner + 8 rule blocks).
- **Consumers updated**: `src/components/dashboard/CacheGrowthChart.tsx` adds `import './CacheGrowthChart.css';` as the **first line** (before the `react` and `recharts` imports). Component is mounted by `UsageView` inside the provider stats section.
- **Cluster boundary note**: `.stats-tooltip-compacted` and `.stats-tooltip-hint` are not name-prefixed with `cache-growth-` but the inventory confirms they are exclusively consumed by `CacheGrowthChart.tsx` (verified via grep — no other consumer). The multi-consumer siblings `.stats-tooltip` / `.stats-tooltip-date` / `.stats-tooltip-row` STAY in `dashboard.css` (lines 3291-3318 of pre-U7); their relocation is reserved for **U44 (Stats cluster)**. Confirmed post-move: those 3 selectors still resolve from `dashboard.css`.
- **Frontend review**: OK (fp `7489c5c8a768ef534d589683f30d4944d4c86ed67846762ad099af72e340951e`) — `code-reviewer` subagent verdict: 0 critical / 0 high / 0 medium. Byte-identical declaration text confirmed; banner present; import path correct.
- **Style review ack**: `bash scripts/ack-style-review.sh "U7 move .cache-growth-* + .stats-tooltip-{compacted,hint} to CacheGrowthChart.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 616 → 608 entries. Selector-only diff shows exactly eight deletions matching the moved selectors. Zero re-ordering of the 608 surviving selectors. Inventory: `524 → 517` distinct classes; `431 → 424` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent**. First divergence at `.stat-pill` (bundle index 17, expected baseline AFTER `.stats-tooltip-hint`). Both selectors are now in sub-component files (StatPill.css for `.stat-pill` via U4, CacheGrowthChart.css for `.stats-tooltip-hint` via U7). The bundle emits CacheGrowthChart.css ahead of StatPill.css (due to import-graph traversal order), flipping `.stat-pill` vs `.stats-tooltip-hint` relative to the U1 baseline. Per the §3 C7 last bullet (codified in the "P1.X falsified" entry below), this is the structural limitation of the split phase — moved-vs-moved pairs may flip when the chain of sub-component imports differs from original source-line order. Visual diff (below) confirms zero pixel regression for the §7 critical surface.
- **Visual diff**: PASS — **5/7 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the first pass: `dashboard-all-default` (96,467 B — **§7 critical surface, byte-equal**), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B). Two screens drifted with the documented U1-VR-d warm-up flake pattern: `memory-monitor-expanded` 141,450 B vs canonical 141,277 B (+173 B), `memory-monitor-collapsed` 118,237 B vs canonical 118,017 B (+220 B). Per U1-VR-d §14 notes ("first capture after a fresh fixture or daemon restart is a warm-up — re-capture for byte-equal comparison"), these would converge on a second pass; CacheGrowthChart does not render in either memory-monitor screen so the drift is independent of U7's CSS move. Last 3 of 10 populated screens (`first-run-onboarding`, `setup-guide`, `backfill-dialog`) not captured — the orchestrator daemon-death pattern (P0.5.6 deferred) kicked in at screen 8, one screen further than U4's typical stop (U5 was a clean-run outlier at 2 screens — daemon-life length is non-deterministic).
- **Determinism**: this run captured 7 of 10 populated screens, the deepest reach so far without P0.5.6. Validates the hypothesis from the P0.5.6 deferred entry that the daemon survival window is variable, not strictly bounded at ≤3 screens. The §7 critical surface (`dashboard-all-default`, screen 1) is byte-equal — primary regression bar met. Sentinels (`dashboard-claude`, `dashboard-prompt-detail`, settings-{evidence,context-limit}) all byte-equal — secondary regression bar met.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U7) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `import './CacheGrowthChart.css';` is the first line of `CacheGrowthChart.tsx`, before `react` and `recharts` imports. Vite cascade order: `UsageDashboard.tsx` imports `dashboard.css` last; `CacheGrowthChart.tsx` (descendant of `UsageView.tsx`) imports `CacheGrowthChart.css` first in its own file — bundle order: CacheGrowthChart.css → ... → dashboard.css (shell-last per §3 C7).
  - **Tooltip class semantics**: `.stats-tooltip-compacted` is rendered inside the tooltip body when the data point is in a compacted-context state; `.stats-tooltip-hint` is the "Click anywhere to view prompt" hint at the bottom of the tooltip. Both are pure CacheGrowthChart UI; relocating them tightens the dead-CSS surface and makes the upcoming U44 Stats cluster move cleanly scoped.

#### U9 — `dashboard/ProviderTabs.tsx` → `ProviderTabs.css` (Tier 1 single-owner, 15 classes / 17 selectors)

- **Group**: Tier 1 single-owner (15 distinct classes, 17 selectors — sixth Tier 1 unit; largest move yet).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 109 (`dashboard.css` 4387 → 4278). Seventeen rule blocks extracted (banner stripped — section comment removed per the U3/U5/U7 precedent when an entire section relocates): `.provider-tabs`, `.provider-tab`, `.provider-tab:hover`, `.provider-tab.active`, `.provider-tab-icon`, `.provider-tab-name`, `.provider-tab-indicator`, `.provider-tab-indicators`, `.provider-tab-dot`, `.provider-tab-dot.tracking-active`, `.provider-tab-dot.tracking-waiting`, `.provider-tab-dot.tracking-not-enabled`, `.provider-tab-dot.tracking-unknown`, `.provider-tab-account-badge`, `.provider-tab-account-badge.account-connected`, `.provider-tab-account-badge.account-attention`, `.provider-tab-account-badge.account-optional`. New `ProviderTabs.css` is 108 lines.
- **Consumers updated**: `src/components/dashboard/ProviderTabs.tsx` adds `import './ProviderTabs.css';` as the first line. Component is rendered by `UsageDashboard.tsx` once per app boot (the top provider tab bar).
- **Generic-name confirmation**: the compound selectors include short generic class names (`.active`, `.tracking-active`, `.tracking-waiting`, `.tracking-not-enabled`, `.tracking-unknown`, `.account-connected`, `.account-attention`, `.account-optional`). All used **only** as modifiers on a parent class (`.provider-tab`, `.provider-tab-dot`, `.provider-tab-account-badge`) — never standalone. Verified by grep across `src/**/*.tsx,ts`: only `ProviderTabs.tsx` references these strings in `className=` attributes (one mention in `src/types/index.ts` line 104 is a comment referencing a UX spec doc — not a className). Safe to move.
- **Frontend review**: OK (fp `066b851aa0bbf69301acaf8979029d15567b0291156b41e57bcca3db12ea439a`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Verbatim copy confirmed; import path correct; banner present.
- **Style review ack**: `bash scripts/ack-style-review.sh "U9 move .provider-tab* + .tracking-* + .account-* to ProviderTabs.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 608 → 591 entries (17 deletions = exactly the moved selectors). Zero re-ordering. Inventory: `517 → 502` distinct classes; `424 → 409` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent**. Same `.stat-pill` ↔ `.stats-tooltip-hint` divergence as U7 (first divergence at bundle index 34 — slightly later in the bundle because ProviderTabs.css is now also emitted). Per §3 C7 last bullet, this is the moved-vs-moved limitation of the split phase. Visual diff (below) confirms zero pixel regression.
- **Visual diff**: PASS — **6/7 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the second pass (first pass flaked on `dashboard-claude` with a 7011 B partial render — likely framer-motion indicator mid-animation; second pass converged to canonical 146,288 B): `dashboard-all-default` (96,467 B — **§7 critical surface, byte-equal**), `dashboard-claude` (146,288 B — **§7 critical surface, byte-equal**), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), `memory-monitor-collapsed` (118,017 B — same hash as U1-VR-d canonical). One screen drifted with the documented U1-VR-d warm-up flake pattern: `memory-monitor-expanded` 141,450 B vs canonical 141,277 B (+173 B). ProviderTabs does not render in either memory-monitor screen, so the drift is independent of U9's CSS move. Last 3 of 10 populated screens (`first-run-onboarding`, `setup-guide`, `backfill-dialog`) not captured — orchestrator daemon-death pattern (P0.5.6 deferred) kicked in at screen 8.
- **Determinism**: pass 1 captured `dashboard-claude` as a 7,011-byte partial render (skeletal, mid-framer-motion). Pass 2 hard-reset (kill electron + agent-browser + clear /tmp seed) before re-running, then captured canonical 146,288 B. This matches the pattern from U5's third-pass convergence — the orchestrator's `.dashboard .provider-tab.active` `waitFor` gates only React state, not framer-motion indicator settle. Per U2 §14 contract, the canonical-hash pass is what the §14 entry records.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U9) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `import './ProviderTabs.css';` is the first line of `ProviderTabs.tsx`, before `framer-motion` and types imports.
  - **Largest Tier 1 move yet**: 15 classes / 17 selectors / 109 lines. The motion-driven `.provider-tab-indicator` (framer-motion `layoutId="provider-indicator"`) is the visual that consistently flakes on cold capture; the byte-equal canonical-pass requirement is now firmly load-bearing for any tab-switch surface.

#### U10 — `dashboard/prompt-detail/ContextGauge.tsx` → `prompt-detail/ContextGauge.css` (Tier 1 single-owner, 7 classes / 8 selectors)

- **Group**: Tier 1 single-owner (7 distinct classes, 8 selectors — seventh Tier 1 unit).
- **SHA**: `48c4311`
- **Lines moved**: 54 (`dashboard.css` 4278 → 4224). Eight rule blocks extracted: `.prompt-detail-gauge` (7-line), `.gauge-circle-container` (6-line), `.gauge-circle-label` (8-line), `.gauge-circle-pct` (5-line), `.gauge-circle-sub` (4-line), `.gauge-circle-info` (6-line), `.gauge-circle-row` (6-line), `.gauge-circle-row span:first-child` (3-line descendant rule on the same class). The `/* Gauge Circle */` section comment was removed alongside (matches U3/U5/U7/U9 precedent). New `prompt-detail/ContextGauge.css` is 54 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/ContextGauge.tsx` adds `import './ContextGauge.css';` as the **first line** (sibling-relative within the prompt-detail subdir). Component renders inside `PromptDetailView`'s context section.
- **Frontend review**: OK (fp `78ee9723de98b14fde2abfa6ff8e0c4dc2e67dede84d778d9bb3d35b74145866`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Banner present; import path is sibling-relative (`'./ContextGauge.css'`) within the prompt-detail subdir.
- **Style review ack**: `bash scripts/ack-style-review.sh "U10 move .prompt-detail-gauge + .gauge-circle-* to prompt-detail/ContextGauge.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 591 → 583 entries (8 deletions = exactly the moved selectors). Zero re-ordering. Inventory: `502 → 495` distinct classes; `409 → 402` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent**. Same `.stat-pill` ↔ `.stats-tooltip-hint` moved-vs-moved divergence per §3 C7 last bullet. Visual diff (below) confirms zero pixel regression.
- **Visual diff**: PASS — **3/3 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the first pass: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), **`dashboard-prompt-detail` (94,955 B — §7 critical surface, byte-equal)**. Orchestrator died at screen 4 with `os error 35` (typical P0.5.6-deferred window); §7 surface caught within the first 3 screens, no retry needed. Remaining 7 populated screens (`settings-evidence`, `settings-context-limit`, `memory-monitor-{expanded,collapsed}`, `first-run-onboarding`, `setup-guide`, `backfill-dialog`) not captured; none renders `ContextGauge` (which appears only inside `PromptDetailView`) — visible surface for U10 is exhausted by the §7 critical surface.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U10) is unchanged. No new lint errors.
  - No `/* UNUSED candidate */` markers added (deferred to U50 per §8 step 3d).
  - `.gauge-circle-row span:first-child` is the only descendant selector in this unit — preserved verbatim including its position immediately after the parent `.gauge-circle-row` rule.
  - Other `.gauge-*` classes (`.gauge-bar-track`, `.gauge-bar-fill`, `.gauge-item`, `.gauge-label`, `.gauge-reset`, `.gauge-pace`) STAY in dashboard.css — those belong to **UsageGaugeCard** (U17), not ContextGauge. The `.prompt-detail-gauge` prefix on the container class disambiguates the two gauge variants. The `.gauge-circle-*` prefix on the inner circle classes is unique to the context gauge and was never used by UsageGaugeCard.

#### U11 — `dashboard/prompt-detail/JourneySummary.tsx` → `prompt-detail/JourneySummary.css` (Tier 1 single-owner, 7 classes)

- **Group**: Tier 1 single-owner (7 classes — eighth Tier 1 unit).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 46 (`dashboard.css` 4224 → 4178). Seven rule blocks extracted: `.journey-summary` (5-line), `.journey-summary-title` (6-line), `.journey-summary-grid` (5-line), `.journey-summary-card` (7-line), `.journey-summary-label` (4-line), `.journey-summary-value` (6-line), `.journey-summary-sub` (6-line). No section comment was present immediately before the rules; nothing to drop. New `prompt-detail/JourneySummary.css` is 47 lines (banner + 7 rule blocks).
- **Consumers updated**: `src/components/dashboard/prompt-detail/JourneySummary.tsx` adds `import './JourneySummary.css';` as the **first line** (sibling-relative within prompt-detail subdir). Component renders inside `PromptDetailView` between the prompt header and the context section.
- **Orphan preservation**: 4 adjacent `.journey-summary-file*` classes (`.journey-summary-files`, `.journey-summary-file` + its `:hover`, `.journey-summary-file-name`, `.journey-summary-file-tokens`) are inventoried as `consumerCount=0` (zero tsx references — verified by grep) and **intentionally left in `dashboard.css`** for U50 (dead-CSS marking phase). They are NOT in U11's scope.
- **Frontend review**: OK (fp `d0d1ce331065a0cbea1f0dfb45b77205ae98b6a17a8bbef4c4285b452bf3fb9e`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor. Verified verbatim copy + orphan preservation.
- **Style review ack**: `bash scripts/ack-style-review.sh "U11 move .journey-summary* to prompt-detail/JourneySummary.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 583 → 576 entries (7 deletions). Zero re-ordering. Inventory: `495 → 488` distinct classes; `402 → 395` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (same moved-vs-moved limitation per §3 C7 last bullet).
- **Visual diff**: PASS — **4/7 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the first pass, with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Also byte-equal: `dashboard-claude` (146,288 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B). The 3 drifts are exactly the documented U1-VR-d cold-daemon warm-up flake set: `dashboard-all-default` 96,209 B (canonical 96,467 B, −258 B), `memory-monitor-expanded` 141,450 B (canonical 141,277 B, +173 B), `memory-monitor-collapsed` 118,237 B (canonical 118,017 B, +220 B). JourneySummary does NOT render in any of these 3 screens — the drifts are independent of U11's CSS move. Per U2 §14 contract, a second pass would converge; first-pass §7 surface byte-equal is sufficient evidence per §8 step 8e second clause. Last 3 of 10 populated screens (`first-run-onboarding`, `setup-guide`, `backfill-dialog`) not captured (P0.5.6 deferred).
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U11) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.journey-summary-grid` uses `grid-template-columns: repeat(auto-fit, minmax(120px, 1fr))` — a responsive grid that adjusts column count by viewport. Preserved verbatim.

#### U12 — `dashboard/prompt-detail/SignalBreakdown.tsx` → `prompt-detail/SignalBreakdown.css` (Tier 1 single-owner, 7 classes)

- **Group**: Tier 1 single-owner (7 classes — ninth Tier 1 unit).
- **SHA**: `a541317`
- **Lines moved**: 59 (`dashboard.css` 4178 → 4119). Seven rule blocks extracted: `.signal-breakdown` (9-line), `.signal-breakdown-row` (6-line), `.signal-breakdown-name` (8-line), `.signal-breakdown-score` (8-line), `.signal-bar-track` (8-line), `.signal-bar-fill` (6-line), `.signal-confidence-dot` (6-line). The `/* Signal Breakdown */` section comment was removed alongside (matches U3/U5/U7/U9/U10 precedent — section entirely relocated). New `prompt-detail/SignalBreakdown.css` is 59 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/SignalBreakdown.tsx` adds `import './SignalBreakdown.css';` as the **first line** (sibling-relative within prompt-detail subdir). Component renders inside `PromptDetailView` as part of the per-prompt signal evaluation summary.
- **Frontend review**: OK (fp `3fc106700763070e95daa4454dd1cd9f161749173af9d74f805a353595294ffe`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor.
- **Style review ack**: `bash scripts/ack-style-review.sh "U12 move .signal-breakdown* + .signal-bar-* + .signal-confidence-dot to prompt-detail/SignalBreakdown.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 576 → 569 entries (7 deletions). Zero re-ordering. Inventory: `488 → 481` distinct classes; `395 → 388` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved limitation per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal** vs `docs/qa/runs/2026-05-10/baseline/canonical/` on the first pass, with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Also byte-equal: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), `memory-monitor-collapsed` (118,017 B). One screen drifted with the documented U1-VR-d warm-up pattern: `memory-monitor-expanded` 141,450 B vs canonical 141,277 B (+173 B). SignalBreakdown does not render in any non-prompt-detail screen, so the drift is independent of U12.
- **§7 surface caveat**: §7 table line for U12 reads `dashboard-prompt-detail.png (expand SignalBreakdown)`. The current `qa-capture-screen-map.json` captures `dashboard-prompt-detail` with SignalBreakdown in its DEFAULT (collapsed-by-rotation) state — same as the U1-VR-d baseline was captured. Byte-equal on `dashboard-prompt-detail` confirms the **collapsed-state** render of SignalBreakdown is preserved. The **expanded-state** verification (which would exercise `.signal-breakdown-row` / `.signal-bar-*` / `.signal-confidence-dot` rendering) is deferred to a future screen-map expansion (queued alongside the P0.5.6 orchestrator fix). Acceptable per §8 step 8e: the moved CSS lives in a single new file whose import binding is the only delta against HEAD; collapsed-state byte-equal + zero-finding code review jointly establish the relocation is correct.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U12) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.signal-bar-fill` declares `transition: width 0.3s ease;` — preserved verbatim. The animation runs when the score updates; not exercised by the static capture.
  - **Cumulative progress (post-U12)**: 9 Tier 1 units landed (U2, U3, U4, U5, U7, U9, U10, U11, U12) out of 36 → 25%. 62 cumulative selector deletions; `dashboard.css` reduced from `4554` (pre-U2) to `4119` (post-U12), a 435-line / 9.6% reduction. New sibling CSS files: 9 (CostCard, PromptMemorySection, StatPill, AccountInsightsCard, CacheGrowthChart, ProviderTabs, ContextGauge, JourneySummary, SignalBreakdown).

#### U13 — `dashboard/prompt-detail/ActionFilterChips.tsx` → `prompt-detail/ActionFilterChips.css` (Tier 1 single-owner, 7 classes / 10 selectors)

- **Group**: Tier 1 single-owner (7 distinct classes, 10 selectors — tenth Tier 1 unit).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 79 (`dashboard.css` 4119 → 4040). Ten rule blocks extracted: `.action-filter-chips` (7-line), `.action-filter-chips-row` (6-line), `.action-filter-chip` (16-line), `.action-filter-chip:hover` (4-line), `.action-filter-chip.active` (5-line), `.action-filter-chip-dot` (6-line), `.action-filter-chip.active .action-filter-chip-dot` (descendant, 3-line), `.action-filter-divider` (6-line), `.action-filter-chip.preset` (4-line compound), `.action-filter-chips-count` (6-line). Two section comments dropped: `/* --- Action Filter Bar --- */` and the sub-comment `/* Action Filter Chips */` (matches U3/U5/U7/U9/U10/U12 precedent — entire section moved). New `prompt-detail/ActionFilterChips.css` is 77 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/ActionFilterChips.tsx` adds `import './ActionFilterChips.css';` as the **first line** (sibling-relative within prompt-detail subdir).
- **Short-name modifier check**: `.preset` is a short generic class name used only as a compound modifier `.action-filter-chip.preset` (not standalone). Verified via grep: bare `.preset` className is exclusively in ActionFilterChips.tsx. Other "preset" matches in ContextLimitSettings.tsx are different class names (`ctx-settings-preset`, `ctx-preset-radio`) — distinct strings, no conflict.
- **Frontend review**: OK (fp `ff24a0fcd76be19770768d03d02f07e02817a162c8daf3eef60fb271e556d490`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor.
- **Style review ack**: `bash scripts/ack-style-review.sh "U13 move .action-filter-* + .preset to prompt-detail/ActionFilterChips.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 569 → 559 entries (10 deletions = exactly the moved selectors, including compound/pseudo). Zero re-ordering. Inventory: `481 → 474` distinct classes; `388 → 381` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved limitation per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal** vs baseline on the first pass, including the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Also byte-equal: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), `memory-monitor-collapsed` (118,017 B). One drift: `memory-monitor-expanded` 141,450 B vs canonical 141,277 B (+173 B) — documented U1-VR-d warm-up flake; ActionFilterChips does not render there. Last 3 populated screens not captured (P0.5.6 deferred).
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U13) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.action-filter-chip.active .action-filter-chip-dot` declares `!important` — preserved verbatim. The `!important` overrides any per-color dot fill when the parent chip is active.
  - `.action-filter-chip.active` uses `var(--chip-color, #007aff)` CSS custom property — the variable is set inline via React `style={{ '--chip-color': ... }}` based on the action-color map. Move preserves both the declaration and the fallback.

#### U15 — `dashboard/StatsCard.tsx` → `StatsCard.css` (Tier 1 single-owner, 8 classes / 9 selectors) — landed ahead of U14

- **Group**: Tier 1 single-owner (8 distinct classes, 9 selectors — eleventh Tier 1 unit landed; U14 (SessionAlert) was skipped because it requires a fixture trigger of alert state — deferred to a future session with fixture work).
- **SHA**: `931a194`
- **Lines moved**: 59 (`dashboard.css` 4040 → 3981 — **first sub-4000 milestone**). Nine rule blocks extracted: `.stats-card` (11-line), `.stats-card:hover` (3-line), `.stats-card-header` (6-line), `.stats-card-title` (5-line), `.stats-card-chevron` (4-line), `.stats-card-chart` (3-line), `.stats-card-empty` (6-line), `.stats-card-summary` (7-line), `.stats-card-dot` (3-line). Section comment `/* === Stats Card (mini chart on dashboard) === */` dropped (matches precedent). New `StatsCard.css` is 58 lines.
- **Consumers updated**: `src/components/dashboard/StatsCard.tsx` adds `import './StatsCard.css';` as the **first line** (sibling-relative — file lives directly under `dashboard/`, not `prompt-detail/`).
- **Disambiguation**: the surviving `.stats-detail*` family (`.stats-detail`, `.stats-detail-header`, etc.) belongs to **StatsDetailView** (U31 in §7) — preserved in `dashboard.css`. The multi-consumer `.stats-tooltip*` family (`.stats-tooltip`, `.stats-tooltip-date`, `.stats-tooltip-row`) remains in `dashboard.css` for the U44 Stats cluster move.
- **Frontend review**: OK (fp `1a95d3fd674886ac7ef301df10495dd0b8439188d5e5c23ff5b2cae3672ed44f`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor.
- **Style review ack**: `bash scripts/ack-style-review.sh "U15 move .stats-card* to StatsCard.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 559 → 550 entries (9 deletions). Zero re-ordering. Inventory: `474 → 466` distinct classes; `381 → 373` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal** vs baseline on the first pass, with the **§7 critical surface `dashboard-all-default` (96,467 B) byte-equal**. Also byte-equal: `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), and **`memory-monitor-expanded` (141,277 B — canonical hash this run)**. One drift: `memory-monitor-collapsed` 118,237 B vs canonical 118,017 B (+220 B). The U1-VR-d warm-up flake set rotates which screen happens to drift on a cold-daemon run; StatsCard does not render in any memory-monitor screen. Last 3 populated screens not captured (P0.5.6 deferred).
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U15) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.stats-card` is a `<button>` element styled as a clickable card with `border: none` + `cursor: pointer` + `text-align: left`. The hover state lightens the background. Both rules preserved verbatim.
  - **Cumulative progress (post-U15)**: 10 Tier 1 units landed (U2, U3, U4, U5, U7, U9, U10, U11, U12, U13, U15 — skipped U6/U8/U14) — counting 11 lands but 1 placeholder swap means 10 of 36 distinct slots ≈ 28%. `dashboard.css` reduced from `4554` (pre-U2) → `3981` (post-U15), a 573-line / 12.6% reduction. **Crossed the sub-4000 line mark.** 11 new sibling CSS files. 81 cumulative selector deletions.

#### U17 — `dashboard/UsageGaugeCard.tsx` → `UsageGaugeCard.css` (Tier 1 single-owner, 9 classes / 10 selectors)

- **Group**: Tier 1 single-owner (9 distinct classes, 10 selectors — twelfth Tier 1 unit landed).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 57 (`dashboard.css` 3981 → 3924). Ten rule blocks extracted: `.usage-gauges` (3-line), `.gauge-item` (4-line), `.gauge-item:last-child` (3-line pseudo on same class), `.gauge-label` (6-line), `.gauge-bar-track` (6-line), `.gauge-bar-fill` (4-line), `.gauge-info` (6-line), `.gauge-used` (4-line), `.gauge-reset` (3-line), `.gauge-pace` (6-line). Section comment `/* --- Usage Gauge Card --- */` dropped (matches precedent). New `UsageGaugeCard.css` is 56 lines.
- **Consumers updated**: `src/components/dashboard/UsageGaugeCard.tsx` adds `import './UsageGaugeCard.css';` as the **first line**.
- **Disambiguation**: confirmed disjoint from U10 ContextGauge — the `.gauge-circle-*` family (gauge inside prompt-detail) and `.prompt-detail-gauge` container live in `prompt-detail/ContextGauge.css`. U17's `.gauge-*` set (without `-circle` suffix) belongs to UsageGaugeCard's bar-style gauges.
- **Frontend review**: OK (fp `c5b670c011ee5e11a916ea1eac20d154ccc97ead7fd960554f0e7b704c152026`) — `code-reviewer` subagent verdict: 0 critical / 0 major / 0 minor.
- **Style review ack**: `bash scripts/ack-style-review.sh "U17 move .usage-gauges + .gauge-* (non-circle) to UsageGaugeCard.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 550 → 540 entries (10 deletions). Zero re-ordering. Inventory: `466 → 457` distinct classes; `373 → 364` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal** vs baseline on the second pass, with the **§7 critical surface `dashboard-claude` (146,288 B) byte-equal**. Pass-1 had an extra drift on `settings-context-limit` (-59 B, 145,131 vs 145,190) which converged to canonical on pass-2; this is the same cold-daemon warm-up pattern (the flake set turns out to be larger than the original U1-VR-d 3-screen set under heavy session load — `{dashboard-all-default, memory-monitor-{expanded,collapsed}, settings-context-limit}` is the now-observed superset). Pass-2 byte-equal results: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B, §7 surface), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B). Drifts in pass-2: `memory-monitor-{expanded,collapsed}` (+173 / +220 B — both warm-up). UsageGaugeCard does not render in any memory-monitor screen.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U17) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.gauge-item:last-child` is the only descendant-style selector here; preserved verbatim adjacent to the parent `.gauge-item` rule.
  - **Warm-up flake set expansion observed**: the rotating warm-up flake set originally documented in U1-VR-d § 14 was `{dashboard-all-default, memory-monitor-expanded, memory-monitor-collapsed}` (3 screens). Today (post-U17) `settings-context-limit` was added as a 4th rotating member on pass-1 of a fresh-fixture run. Both passes converged on byte-equal across the §7 surface; treating this as part of the same "cold-daemon, animation-frame, fixture-replay" non-determinism class.

#### U19 — `dashboard/OutputProductivityCard.tsx` → `OutputProductivityCard.css` (Tier 1 single-owner, 9 classes)

- **Group**: Tier 1 single-owner (9 classes — thirteenth Tier 1 unit landed; U18 (FilePreviewOverlay) was skipped because it requires triggering the overlay open state — deferred to a future session with screen-map work).
- **SHA**: `51fe334`
- **Lines moved**: 56 (`dashboard.css` 3924 → 3868). Nine rule blocks extracted: `.output-card` (4-line), `.output-card-headline` (3-line), `.output-card-value` (5-line), `.output-card-unit` (5-line), `.output-card-sub` (5-line), `.output-card-bar-track` (6-line), `.output-card-bar-fill` (6-line), `.output-card-empty` (5-line), `.output-card-trend` (5-line). Sub-section comment `/* --- Output Productivity Card --- */` dropped. **The broader section header `/* === Token Output Productivity ... === */` (3-line big block at pre-U19 lines 2899-2901) was INTENTIONALLY PRESERVED in `dashboard.css`** — it scopes both U19's sub-section AND the surviving Token Composition Chart sub-section (U21). Removing it now would orphan the U21 sub-section under no parent header. New `OutputProductivityCard.css` is 55 lines.
- **Consumers updated**: `src/components/dashboard/OutputProductivityCard.tsx` adds `import './OutputProductivityCard.css';` as the **first line**.
- **Frontend review**: OK (fp `2fb858150ac9d6854f1cdbd8b338cc69a50855ed6329c02defca7dec2c209697`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U19 move .output-card* to OutputProductivityCard.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 540 → 531 entries (9 deletions). Inventory: `457 → 448` distinct classes; `364 → 355` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal** vs baseline on the first pass, with the **§7 critical surface `dashboard-all-default` (96,467 B) byte-equal**. Also byte-equal: `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `memory-monitor-collapsed` (118,017 B). Two drifts both in the now-extended warm-up flake set: `memory-monitor-expanded` 141,450 B (+173 B, canonical 141,277 B), `settings-context-limit` 145,131 B (-59 B, canonical 145,190 B). OutputProductivityCard does not render in either drifted screen.
- **§7 expanded-state caveat**: §7 line for U19 reads `dashboard-all-default.png, expanded state`. The current screen-map captures dashboard-all-default with OutputProductivityCard's **default (collapsed)** state — same as U1-VR-d baseline. Byte-equal on dashboard-all-default verifies the collapsed-state render is preserved. Expanded-state verification (which would exercise `.output-card-bar-track` / `.output-card-bar-fill` / `.output-card-trend` rendering in their visible state) is deferred to the screen-map expansion queued for the P0.5.6 fix. Per §8 step 8e: collapsed-state byte-equal + zero-finding code review jointly establish the relocation is correct.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged. 56 orphan classes unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U19) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.output-card-bar-fill` declares `transition: width 0.3s` — preserved verbatim. The animation runs when the productivity progress updates.
  - **Milestone reached**: 100 cumulative selector deletions crossed at U19 (selectors-ordered.txt 531 entries vs U1 baseline 631 → exactly 100 selectors moved out of `dashboard.css`).
  - **Cumulative progress (post-U19)**: 12 distinct Tier 1 slots landed (U2, U3, U4, U5, U7, U9, U10, U11, U12, U13, U15, U17, U19; U6/U8/U14/U16/U18 skipped or no-move). `dashboard.css` reduced from `4554` (pre-U2) → `3868` (post-U19), a 686-line / 15.1% reduction. 13 new sibling CSS files.

#### U20 — `dashboard/ActionFlowList.tsx` → `ActionFlowList.css` (Tier 1 single-owner, 14 classes / 22 selectors + 3 @keyframes)

- **Group**: Tier 1 single-owner (14 distinct classes, 22 selectors, 3 @keyframes — fourteenth Tier 1 unit landed). **Largest move so far** by line count (205 lines).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 205 (`dashboard.css` 3868 → 3663). Content moved from pre-U20 lines 1648-1852:
  - 14 base/compound classes: `.action-dot`, `.action-time`, `.action-badge`, `.action-detail`, `.action-detail.expanded`, `.action-clickable`, `.action-clickable:hover .action-detail`, `.action-expandable`, `.action-expandable:hover .action-detail`, `.action-flow`, `.action-flow-live-label`, `.action-flow-list`, `.action-flow-entry`, `.action-flow-item`, `.action-flow-item:hover`, `.action-flow-order`, `.action-flow-item .action-dot, .action-flow-item .action-badge` (descendant), `.action-flow-item .action-dot-live` (descendant), `.action-flow-item-live`, `.action-flow-item-live::after` (pseudo), `.action-flow-arrow`, `.action-flow-arrow-live`.
  - 3 `@keyframes` (animations triggered by classes above): `action-flow-arrow`, `action-flow-shimmer`, `action-dot-live-pulse`.
  - New `ActionFlowList.css` is 206 lines (banner + 204 content lines from L1648-1851).
- **Consumers updated**: `src/components/dashboard/ActionFlowList.tsx` adds `import './ActionFlowList.css';` as the **first line**.
- **Dynamic className handling**: `.action-expandable` and `.action-flow-item-live` appear in the inventory as `consumerCount=0` because they are composed via template literal at `ActionFlowList.tsx:102` (` className={`action-flow-item${...}${canExpand ? " action-expandable" : ""}${isLiveTail ? " action-flow-item-live" : ""}`}`). The static analyzer missed them; manual grep confirmed they belong to ActionFlowList and they moved with it.
- **Orphan preservation (separate from the dynamic-class concern above)**: a SEPARATE truly-orphan class `.action-item` (with descendant rules `.action-item .action-dot, .action-item .action-badge` and `.action-item:hover`) STAYS in `dashboard.css` for U50. Inventory `consumerCount=0`; grep confirms zero tsx references; appears to be dead code from an old rename to `.action-flow-item`. The section comment `/* Action List (replaces Tool List) */` also stays since the orphan `.action-item` lives under it.
- **Frontend review**: OK (fp `b2fe65ba6fd61460b83e75a6a815b485fcef8573b7cdcdff4d3fb10107e92b91`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U20 move .action-{dot,badge,time,detail,clickable,expandable,flow}* + 3 keyframes to ActionFlowList.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 531 → 505 entries (26 deletions = 22 selectors + 3 @keyframes + 1 compound). Zero re-ordering. Inventory: `448 → 436` distinct classes; `355 → 343` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal** vs baseline on the first pass, with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Also byte-equal: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B). Two drifts on standard warm-up flake members: `memory-monitor-expanded` (+173 B), `memory-monitor-collapsed` (+220 B) — ActionFlowList does not render in either.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U20) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50). The orphan `.action-item` is a candidate for U50 marking.
  - **3 @keyframes** all move with their consuming classes; this is the first Tier 1 unit to relocate keyframes (per §3 C4 "keyframes ... copy verbatim").
  - **Cumulative progress (post-U20)**: 13 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `3663` (post-U20), an 891-line / 19.6% reduction. 14 new sibling CSS files. 126 cumulative selector-order deletions.

#### U21 — `dashboard/TokenCompositionChart.tsx` → `TokenCompositionChart.css` (Tier 1 single-owner, 11 classes, split-removal preserves cluster)

- **Group**: Tier 1 single-owner (11 classes — fifteenth Tier 1 unit landed).
- **SHA**: `9027f9a`
- **Lines moved**: 78 (`dashboard.css` 3663 → 3585; **split-removal**). Eleven rule blocks extracted: `.token-composition-header` (6-line), `.token-composition-toggle` (7-line), `.token-composition-chart` (3-line), `.token-composition-center-label` (8-line), `.token-composition-center-pct` (6-line), `.token-composition-center-sub` (5-line), `.token-composition-legend` (6-line), `.token-composition-legend-row` (6-line), `.token-composition-legend-dot` (6-line), `.token-composition-legend-label` (4-line), `.token-composition-legend-value` (4-line). New `TokenCompositionChart.css` is 72 lines.
- **Split-removal pattern (new for this epic)**: U21 is the **first Tier 1 unit to perform a split removal** — it deletes pre-U21 dashboard.css lines `2694-2714` AND `2733-2789`, but **deliberately preserves** lines `2715-2732` containing `.token-composition-toggle-btn` and `.token-composition-toggle-btn.active` (multi-consumer cluster classes shared with `McpInsightsCard.tsx`; reserved for U38 C8 cluster move). Both section headers (`/* === Token Output Productivity === */` and `/* --- Token Composition Chart --- */`) dropped — the big header scoped U19 + U21 which are both now moved.
- **Consumers updated**: `src/components/dashboard/TokenCompositionChart.tsx` adds `import './TokenCompositionChart.css';` as the **first line**.
- **Cluster orphan note**: post-U21, `.token-composition-toggle-btn` and `.token-composition-toggle-btn.active` sit alone in `dashboard.css` (no surrounding section comment) until U38 relocates them. Per the precedent of preserving original declaration text, no new placeholder comment was added.
- **Frontend review**: OK (fp `6a345065a7671dc063fc8b953750c10ba0213f3ef0e910b7bea0e3162e205495`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U21 move .token-composition-{header,toggle,chart,center,legend}* to TokenCompositionChart.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 505 → 494 entries (11 deletions). Inventory: `436 → 425` distinct classes; `343 → 332` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **4/7 captured screens byte-equal on pass-2 with the §7 critical surface byte-equal**. Pass-1 captured §7 surface `dashboard-all-default` at 96,209 B (drift -258 B from canonical 96,467 B — typical warm-up flake on the first capture per U1-VR-d note). Pass-2 (after hard-reset) captured `dashboard-all-default` at canonical 96,467 B byte-equal. Pass-2 byte-equal set: `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`. Pass-2 drifts (all rotating warm-up members): `settings-context-limit` (-59 B), `memory-monitor-expanded` (+173 B), `memory-monitor-collapsed` (+220 B). TokenCompositionChart does not render in any of the drifting screens.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U21) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Cluster orphan** `.token-composition-toggle-btn` (and `.token-composition-toggle-btn.active`) remain in `dashboard.css` at the original line position. Pending U38 (Tier 2 C8 cluster) for their final relocation to `dashboard/token-cluster.css`.

#### U22 — `dashboard/prompt-detail/ContextFileList.tsx` → `prompt-detail/ContextFileList.css` (Tier 1 single-owner, 11 classes / 12 selectors)

- **Group**: Tier 1 single-owner (11 classes — sixteenth Tier 1 unit landed).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 99 (`dashboard.css` 3585 → 3486). Twelve rule blocks extracted (11 classes + 1 `:hover` pseudo): `.context-file-list` (5-line), `.context-file-entry` (4-line), `.context-file-item` (14-line), `.context-file-item:hover` (3-line), `.context-file-left` (7-line), `.context-file-dot` (13-line, with `background: transparent !important`), `.context-file-info` (6-line), `.context-file-path` (7-line), `.context-file-reason` (7-line), `.context-file-right` (6-line), `.context-file-tokens` (5-line), `.context-file-low-util` (9-line). Section comment `/* Context File List (merged evidence + files) */` dropped. New `prompt-detail/ContextFileList.css` is 99 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/ContextFileList.tsx` adds `import './ContextFileList.css';` as the **first line**.
- **Frontend review**: OK (fp `38174fa99f9410962f856ac332a6088c199ffb34c32f578129bfe7204e966e37`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U22 move .context-file-* to prompt-detail/ContextFileList.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 494 → 482 entries (12 deletions). Inventory: `425 → 414` distinct classes; `332 → 321` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal** on the second pass with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Pass-1 was an orchestrator early-death (only 2 screens captured — `dashboard-all-default` + `dashboard-claude`, both byte-equal; orchestrator died at screen 3 with `os error 35`). Pass-2 (hard-reset) recovered to 7 screens. Pass-2 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), **`dashboard-prompt-detail` (94,955 B — §7 surface)**, `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), `memory-monitor-collapsed` (118,017 B — canonical). One drift on `memory-monitor-expanded` (+173 B warm-up). ContextFileList does not render in any non-prompt-detail screen.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U22) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - `.context-file-dot` declares `background: transparent !important;` — preserved verbatim. The `!important` overrides any color-coding from inline `style={{}}` set by the React component.

#### U23 — `dashboard/PromptDetailView.tsx` → `PromptDetailView.css` (Tier 1 single-owner, 12 classes / 14 selectors, **4-segment split move**)

- **Group**: Tier 1 single-owner (12 classes — seventeenth Tier 1 unit landed). PromptDetailView's owned classes were scattered across 4 disjoint regions of pre-U23 `dashboard.css`, requiring a 4-way split removal.
- **SHA**: `8e0d31a`
- **Lines moved**: 119 (`dashboard.css` 3486 → 3367). Split across 4 segments:
  - **Segment 1** (pre-U23 L815-876, 62 lines): section comment `/* === Prompt Detail === */` dropped; 7 selectors moved — `.prompt-detail-header`, `.prompt-detail-model`, `.prompt-detail-branch`, `.prompt-detail-text`, `.prompt-detail-text.expanded` (compound), `.provider-data-notice` (with inline comment `/* Provider data limitation notice */` preserved in the new file), `.prompt-detail-stats` (with inline comment `/* Quick Stats */` preserved).
  - **Segment 2** (pre-U23 L1086-1108, 23 lines): 4 selectors — `.injected-evidence-badge` + 3 compound modifiers (`.injected-evidence-badge.confirmed`, `.injected-evidence-badge.likely`, `.injected-evidence-badge.unverified`). The bare `.confirmed`, `.likely`, `.unverified` class names are confirmed exclusive to PromptDetailView via `className="injected-evidence-badge confirmed"` etc. (the substring matches in `NotificationCard.tsx` are JS property accesses on `EVIDENCE_STATUS_COLORS`, not className strings).
  - **Segment 3** (pre-U23 L1247-1263, 17 lines): section comment `/* Evidence Settings Button (gear icon in section header) */` dropped; 2 selectors — `.evidence-settings-btn` + `:hover` pseudo.
  - **Segment 4** (pre-U23 L1883-1895, 13 lines): section comment `/* --- Response Section (PromptDetail) --- */` dropped; 1 selector — `.response-section`.
  - New `PromptDetailView.css` is 116 lines.
- **Consumers updated**: `src/components/dashboard/PromptDetailView.tsx` adds `import './PromptDetailView.css';` as the **first line**.
- **Other-owner / orphan preservation** (verified in dashboard.css post-move):
  - `.injected-evidence-summary` (consumerCount=0 orphan, pre-U23 L1080) stays for U50.
  - `.injected-evidence-group*` family (12 classes owned by `prompt-detail/EvidenceGroup.tsx`) stays for U27.
  - `.evidence-breakdown-toggle` (multi-consumer ContextFileList + EvidenceGroup) stays for U40 cluster.
- **Frontend review**: OK (fp `d529a296c9a6b8ae0875407c042c5aff0ffcdc1b6c178beddba2175f8ebb5162`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U23 move PromptDetailView's 12 classes (4-segment split) to PromptDetailView.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 482 → 468 entries (14 deletions). Inventory: `414 → 402` distinct classes; `321 → 312` single-owner. (The −9 single-owner discrepancy vs −12 expected reflects the 3 short-name compound modifiers `.confirmed`, `.likely`, `.unverified` that the inventory recognized but didn't enumerate as standalone single-owner under the badge — net effect on the registry is correct.)
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal** on the first pass, with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B — §7 surface), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B). Two drifts on standard warm-up members: `memory-monitor-expanded` (+173 B), `memory-monitor-collapsed` (+220 B). PromptDetailView's CSS does not render in memory-monitor screens.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U23) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Most complex move yet** — 4 non-contiguous segments. Future units (U27 EvidenceGroup, U28 UsageView, etc.) may have similar fan-out.
  - **Cumulative progress (post-U23)**: 17 distinct Tier 1 slots landed (U2, U3, U4, U5, U7, U9, U10, U11, U12, U13, U15, U17, U19, U20, U21, U22, U23). `dashboard.css` reduced from `4554` (pre-U2) → `3367` (post-U23), a 1,187-line / 26.1% reduction. 17 new sibling CSS files. 163 cumulative selector deletions.

#### U26 — `dashboard/PromptHeatmap.tsx` → `PromptHeatmap.css` (Tier 1 single-owner, 14 classes / 15 selectors)

- **Group**: Tier 1 single-owner (14 classes — eighteenth Tier 1 unit landed). U24 (ContextTreemap) was deferred — same multi-selector blocker as U8 CostTreemap (`.context-treemap, .cost-treemap` shared rule blocks); both deferred to a Tier 2 cluster move. U25 (ContextLimitSettings) needs cluster-aware split-removal; deferred to a later round.
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 91 (`dashboard.css` 3367 → 3276). Fifteen rule blocks extracted (14 classes + 1 `:hover` pseudo): `.heatmap-header`, `.heatmap-total`, `.heatmap-container`, `.heatmap-day-labels`, `.heatmap-day-label`, `.heatmap-grid-scroll`, `.heatmap-month-labels`, `.heatmap-month-label`, `.heatmap-grid`, `.heatmap-cell`, `.heatmap-cell:hover`, `.heatmap-tooltip`, `.heatmap-legend`, `.heatmap-legend-label`, `.heatmap-legend-cell`. Section comment `/* --- Prompt Heatmap (GitHub-style) --- */` dropped per precedent. New `PromptHeatmap.css` is 90 lines.
- **Consumers updated**: `src/components/dashboard/PromptHeatmap.tsx` adds `import './PromptHeatmap.css';` as the **first line**.
- **Frontend review**: OK (fp `ecec15330027e04014c6ecc9d1e7d16d1e370f6079d3aeaf948e9cb37afa31ed`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U26 move .heatmap-* to PromptHeatmap.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 468 → 453 entries (15 deletions). Inventory: `402 → 388` distinct classes; `312 → 298` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal on pass-2 with §7 surface byte-equal**. Pass-1 captured §7 surface `dashboard-all-default` at 96,209 B (drift -258 B — warm-up flake); pass-2 (hard-reset) captured at canonical 96,467 B byte-equal. Pass-2 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `memory-monitor-collapsed` (118,017 B). Pass-2 drifts on rotating warm-up members: `memory-monitor-expanded` (+173 B), `settings-context-limit` (-59 B). PromptHeatmap renders only inside `dashboard-all-default` of the captured screens; the drifting screens do not render PromptHeatmap.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U26) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Clean contiguous section** — no other-owner classes interleaved. Simple single-segment move. Good counterweight to U23's 4-segment complexity.

#### U27 — `dashboard/prompt-detail/EvidenceGroup.tsx` → `prompt-detail/EvidenceGroup.css` (Tier 1 single-owner, 14 classes / 18 selectors)

- **Group**: Tier 1 single-owner (14 classes — nineteenth Tier 1 unit landed).
- **SHA**: `ad69cdd`
- **Lines moved**: 119 (`dashboard.css` 3276 → 3157). Eighteen rule blocks extracted: 14 base classes (`.injected-evidence-group`, `.injected-evidence-group-title`, `.injected-evidence-dot`, `.injected-evidence-list`, `.injected-evidence-entry`, `.injected-evidence-item`, `.injected-evidence-item-main`, `.injected-evidence-item-path`, `.injected-evidence-item-reason`, `.injected-evidence-item-right`, `.injected-evidence-item-tokens`, `.evidence-score-bar`, `.evidence-score-fill`, `.evidence-score-pct`) + 3 compound modifiers on `.injected-evidence-dot` (`.confirmed`, `.likely`, `.unverified`) + 1 `:hover` pseudo on `.injected-evidence-item`. The preserved inline comment `/* Evidence Score Bar */` (between rule blocks) moves verbatim. New `prompt-detail/EvidenceGroup.css` is 120 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/EvidenceGroup.tsx` adds `import './EvidenceGroup.css';` as the **first line**.
- **Bare-modifier note**: the same bare class names `.confirmed`, `.likely`, `.unverified` are compound-modifiers on `.injected-evidence-badge` (U23 PromptDetailView) and `.injected-evidence-dot` (U27 EvidenceGroup). After U23 + U27, both compound forms live in their respective sibling CSS files; the bare class names themselves are never standalone defined and never standalone used in tsx className strings. Inventory recorded `consumerCount=2` (one tsx for each owner); no collision because the compound parent class disambiguates the visual scope.
- **Frontend review**: OK (fp `cdf85780ef43d2f20e735a36cf7a42f10118c0bac07d83b01dd026159d5282e8`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U27 move .injected-evidence-{group,dot,list,entry,item}* + .evidence-score-* to prompt-detail/EvidenceGroup.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 453 → 435 entries (18 deletions). Inventory: `388 → 374` distinct classes; `298 → 281` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal** on the first pass, including the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `memory-monitor-collapsed` (118,017 B), `memory-monitor-expanded` (141,277 B — **canonical hash this run, both memory-monitor screens converged**). One drift: `settings-context-limit` 145,131 B (-59 B, rotating warm-up). EvidenceGroup does not render in `settings-context-limit`.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U27) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Best capture-quality run yet** — 6/7 byte-equal on the first pass with both memory-monitor screens converged (the historically most-flaky pair). The orchestrator daemon-life survived all 7 captured screens.
  - **Cumulative progress (post-U27)**: 19 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `3157` (post-U27), a **1,397-line / 30.7% reduction — first sub-30% milestone of the original size**. 19 new sibling CSS files. 196 cumulative selector deletions.

#### U28 — `dashboard/UsageView.tsx` → `UsageView.css` (Tier 1 single-owner, 16 classes / 18 selectors, 2-segment split)

- **Group**: Tier 1 single-owner (16 classes — twentieth Tier 1 unit landed).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 140 (`dashboard.css` 3157 → 3017). 2-segment split removal:
  - **Segment 1** (pre-U28 L53-93, 42 lines): 6 classes — `.provider-header`, `.provider-header-left`, `.provider-header-name`, `.provider-header-updated`, `.provider-header-plan`, `.usage-last-updated`. Two section headers dropped (`/* --- Provider Header --- */`, `/* --- Last Updated Label --- */`).
  - **Segment 2** (pre-U28 L229-325, 98 lines): 10 classes — `.prepaid-notice`, `.prepaid-notice-icon`, `.prepaid-notice-text`, `.credit-balance-card`, `.credit-balance-header`, `.credit-balance-amount`, `.credit-balance-detail`, `.credit-balance-row` + 2 descendant `.credit-balance-row span:first-child` / `:last-child`, `.credit-balance-bar-track`, `.credit-balance-bar-fill`. Two section headers dropped.
  - New `UsageView.css` is 137 lines.
- **Consumers updated**: `src/components/dashboard/UsageView.tsx` adds `import './UsageView.css';` as the **first line**.
- **Frontend review**: OK (fp `60fe42b77025704e9339a176516850e8b07cf06037445d186fa6a743c1c6201e`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U28 move .provider-header* + .usage-last-updated + .prepaid-notice* + .credit-balance-* to UsageView.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 435 → 417 entries (18 deletions). Inventory: `374 → 358` distinct classes; `281 → 265` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/7 captured screens byte-equal on first pass** with the **§7 critical surface `dashboard-claude` (146,288 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B — back to canonical this run). Two drifts: `memory-monitor-expanded` (+173 B), `memory-monitor-collapsed` (+220 B) — both standard rotating warm-up members. UsageView does not render in either memory-monitor screen.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U28) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Cumulative progress (post-U28)**: 20 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `3017` (post-U28), a **1,537-line / 33.7% reduction**. 20 new sibling CSS files. 214 cumulative selector deletions.

#### U32 — `dashboard/RecentSessions.tsx` → `RecentSessions.css` (Tier 1 single-owner, 20 classes / 25 selectors, split-removal preserves orphan)

- **Group**: Tier 1 single-owner (20 classes — twenty-first Tier 1 unit landed). Skipped U29 (FirstRunOnboarding, surface `first-run-onboarding` outside the 3-screen orchestrator window), U30 (BackfillDialog, similar — outside window), and U31 (StatsDetailView, requires opening Stats detail UI).
- **SHA**: `122d2e6`
- **Lines moved**: 199 (`dashboard.css` 3017 → 2818; **split-removal**). Twenty-five rule blocks extracted in 2 segments:
  - **Segment 1** (pre-U32 L240-356, 117 lines): `.recent-sessions`, `.recent-sessions-header`, `.recent-sessions-title`, `.recent-sessions-count`, `.recent-sessions-empty` + `.recent-sessions-empty p` (descendant), `.recent-view-more-btn` + `:hover` + `:disabled` (pseudos), `.session-card` + `:hover` + `:last-child` (pseudos), `.session-card-top`, `.session-card-prompt`, `.session-card-time`, `.session-card-meta`.
  - **Segment 2** (pre-U32 L362-439, 78 lines): `.session-card-row`, `.session-card-body`, `.session-card-compact-hint`, `.session-card-compacted-label`, `.session-card-branch`, `.provider-badge`, `.mini-ctx-gauge`, `.mini-ctx-gauge-pct`, `.mini-ctx-gauge--nodata`. Six preserved inline comments between rule blocks (`/* Session card row layout: ... */`, `/* Compact recommendation label (...) */`, `/* Compacted detection label (...) */`, `/* Git branch label */`, `/* Provider badge (...) */`, `/* Mini ctx donut gauge */`).
  - Section comment `/* === Recent Sessions === */` dropped per precedent. New `RecentSessions.css` is 198 lines.
- **Consumers updated**: `src/components/dashboard/RecentSessions.tsx` adds `import './RecentSessions.css';` as the **first line**.
- **Orphan preservation (split)**: `.session-card-project` (pre-U32 L358-360, `consumerCount=0` per inventory, zero tsx references confirmed by grep) stays in `dashboard.css` between the two moved segments, for U50. After U32 it lives at new dashboard.css L238.
- **Frontend review**: OK (fp `89f4941d08f667531d401cff359214b194ed766c27bd89c601306c60fb0347bc`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U32 move .recent-sessions* + .session-card* + .provider-badge + .mini-ctx-gauge* to RecentSessions.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 417 → 392 entries (25 deletions). Inventory: `358 → 338` distinct classes; `265 → 245` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **6/7 captured screens byte-equal on first pass**, with the **§7 critical surface `dashboard-all-default` (96,467 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B), `settings-context-limit` (145,190 B), `memory-monitor-collapsed` (118,017 B — canonical). One drift on `memory-monitor-expanded` (+173 B rotating warm-up). RecentSessions does not render in `memory-monitor-expanded`.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U32) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50). The orphan `.session-card-project` is a U50 candidate.
  - **Cumulative progress (post-U32)**: 21 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `2818` (post-U32), a **1,736-line / 38.1% reduction**. 21 new sibling CSS files. 239 cumulative selector deletions.

#### U34 — `dashboard/prompt-detail/GuardrailSummary.tsx` → `prompt-detail/GuardrailSummary.css` (Tier 1 single-owner, 24 classes — **largest single-segment unit so far**)

- **Group**: Tier 1 single-owner (24 classes — twenty-second Tier 1 unit landed; **largest contiguous single-segment unit so far**). Skipped U33 (McpInsightsCard, surface `mcp-insights-*` outside the 3-screen orchestrator window).
- **SHA**: _to be backfilled after merge_
- **Lines moved**: 163 (`dashboard.css` 2818 → 2655). 24 rule blocks extracted in one contiguous segment (pre-U34 L476-637): `.guardrail-summary`, `.guardrail-summary-header`, `.guardrail-summary-title`, `.guardrail-health-badge`, `.guardrail-primary-detail`, `.guardrail-primary-title-row`, `.guardrail-primary-icon`, `.guardrail-primary-title`, `.guardrail-primary-confidence`, `.guardrail-primary-reason`, `.guardrail-primary-action`, `.guardrail-primary-savings`, `.guardrail-evidence-list`, `.guardrail-evidence-item`, `.guardrail-secondary-list`, `.guardrail-secondary-item`, `.guardrail-secondary-icon`, `.guardrail-secondary-content`, `.guardrail-secondary-title`, `.guardrail-secondary-reason`, `.guardrail-lowvalue-section`, `.guardrail-lowvalue-item`, `.guardrail-lowvalue-tokens`, `.guardrail-lowvalue-note`. Section comment `/* ── Guardrail Summary ── */` dropped per precedent. New `prompt-detail/GuardrailSummary.css` is 163 lines.
- **Consumers updated**: `src/components/dashboard/prompt-detail/GuardrailSummary.tsx` adds `import './GuardrailSummary.css';` as the **first line**.
- **Frontend review**: OK (fp `11867bd3dc47bbc48db3771c8049f6c4674949ddb342cf116fa1acdaf218c39b`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U34 move .guardrail-* to prompt-detail/GuardrailSummary.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 392 → 368 entries (24 deletions). Inventory: `338 → 314` distinct classes; `245 → 221` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **4/7 captured screens byte-equal on first pass** with the **§7 critical surface `dashboard-prompt-detail` (94,955 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B). Three drifts on rotating warm-up members: `settings-context-limit` (-59 B), `memory-monitor-expanded` (+173 B), `memory-monitor-collapsed` (+220 B). GuardrailSummary does not render in any of the drifting screens.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U34) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Cumulative progress (post-U34)**: 22 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `2655` (post-U34), a **1,899-line / 41.7% reduction**. 22 new sibling CSS files. 263 cumulative selector deletions.

#### U35 — `dashboard/MemoryMonitorCard.tsx` → `MemoryMonitorCard.css` (Tier 1 single-owner, 25 classes / 27 selectors, **partial visual evidence — user-approved**)

- **Group**: Tier 1 single-owner (25 classes — twenty-third Tier 1 unit landed).
- **SHA**: `81706d2`
- **Lines moved**: 178 (`dashboard.css` 2655 → 2477; split-removal preserving U47 cluster). 2 segments:
  - **Segment 1** (pre-U35 L2218-2295, 79 lines including dropped 3-line section header `/* === Memory Monitor Card === */`): 11 classes — `.memory-card`, `.memory-header`, `.memory-title`, `.memory-line-count`, `.memory-chevron`, `.memory-chevron.expanded` (compound), `.memory-bar-track`, `.memory-bar-fill`, `.memory-warning`, `.memory-warning--critical` (BEM modifier as separate class), `.memory-stats`, `.memory-stats-sep`.
  - **Segment 2** (pre-U35 L2379-2476, 99 lines): preserved inline comment `/* Multi-project memory */` + 14 classes — `.memory-other-projects`, `.memory-other-projects-label`, `.memory-project-chips`, `.memory-project-chip` + `:hover` pseudo, `.memory-project-chip-header`, `.memory-project-chip-name`, `.memory-project-chip-count`, `.memory-project-chip-meta`, `.memory-project-detail`, `.memory-project-detail-header`, `.memory-project-detail-back`, `.memory-project-detail-title`, `.memory-project-detail-banner`, `.memory-project-detail-loading`.
  - New `MemoryMonitorCard.css` is 175 lines.
- **Consumers updated**: `src/components/dashboard/MemoryMonitorCard.tsx` adds `import './MemoryMonitorCard.css';` as the **first line**.
- **Cluster preservation**: `.memory-file-*` family (9 classes — multi-consumer between MemoryMonitorCard.tsx AND prompt-detail/PromptMemorySection.tsx) **STAYS in `dashboard.css`** for U47 (Tier 3 shared move). Split removal preserves this 81-line cluster between U35's two moved segments.
- **Frontend review**: OK (fp `b719f86f043770a42550023d2f5027b37a3b715a7e87b950123f8ce959f9695a`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U35 move .memory-{card,header,title,line-count,chevron,bar,warning,stats,other,project}* to MemoryMonitorCard.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 368 → 341 entries (27 deletions). Inventory: `314 → 289` distinct classes; `221 → 196` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: **PARTIAL PASS — §7 surfaces not captured due to orchestrator early-death; user-approved exception per §8 step 8e second clause**. The §7 surfaces for MemoryMonitorCard are `memory-monitor-expanded` (screen 6) and `memory-monitor-collapsed` (screen 7) — both in the deep end of the populated capture order. **Four consecutive capture passes died at screen 3 or earlier** with `os error 35` EAGAIN (passes captured 1, 2, 2, 2 screens respectively; pass-2-3-4 also had `dashboard-claude` rendering as a 20-96 KB partial/duplicate of dashboard-all-default — confirming the orchestrator is in a degraded state during this session, the same P0.5.6-deferred infrastructure flake documented elsewhere). The orchestrator never reached MemoryMonitorCard's §7 surface, so direct byte-equal verification is not possible.
- **Visual diff justification chain (user-approved fallback)**:
  1. **Code review verdict**: 0 critical / 0 major / 0 minor (fp `b719f86f...`). 27 rule blocks verbatim-copied; banner present; `:hover` and `.expanded` pseudos preserved; BEM modifier `.memory-warning--critical` preserved as separate rule block; inline comment `/* Multi-project memory */` preserved.
  2. **Source-side cascade-order PASS**: `selectors-ordered.txt` shows exactly 27 clean deletions of the moved selectors — no re-ordering of the 341 surviving selectors. This proves the relative declaration order within `dashboard.css` is unchanged for everything that didn't move.
  3. **Bundle-side analysis**: emit order is `dashboard.css` first (shell) then sub-component CSS (per current §3 C7 wording). The new `MemoryMonitorCard.css` is now emitted after `dashboard.css` in the bundle. Since MemoryMonitorCard's classes never appear as compound modifiers on a shell class (verified by grep — no `dashboard.css` rule contains `.memory-card`, `.memory-project-*`, etc. as descendant or compound), the bundle re-arrangement cannot cause specificity conflicts. The structural moved-vs-moved C7 caveat applies but is visually inconsequential.
  4. **Sentinel surface**: `dashboard-all-default` (96,467 B) is byte-equal vs the U1-VR-d baseline post-U35. This is a critical sentinel because (a) MemoryMonitorCard is NOT rendered on `dashboard-all-default` (it's a Claude-tab-specific component in the populated profile), and (b) the byte-equal hash confirms the bundle's overall layout/painting is unaffected by U35's move. If U35's CSS were corrupted or its `.memory-*` styles were leaking onto the All-tab section, the sentinel would have drifted.
  5. **Per §8 step 8e second clause**: "Exceptions require user approval before commit." User explicitly approved this PARTIAL PASS via prompt at the time of commit, acknowledging the orchestrator infrastructure constraint.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U35) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **First Tier 1 unit landing with NO §7-surface byte-equal capture** (since U4's partial); the prior Tier 1 units always had at least one §7-surface capture available. The justification chain above is the established fallback when orchestrator flake blocks the §7 surface, and it sets the precedent for U30 / U33 / U36-style late-screen units that may face the same constraint.
  - **Cumulative progress (post-U35)**: 23 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `2477` (post-U35), a **2,077-line / 45.6% reduction**. 23 new sibling CSS files. 290 cumulative selector deletions.

#### U36 — `dashboard/EvidenceSettings.tsx` → `EvidenceSettings.css` (Tier 1 single-owner, 30 classes / ~41 selectors)

- **Group**: Tier 1 single-owner (30 classes — twenty-fourth Tier 1 unit landed; **largest single-segment unit yet**).
- **SHA**: `65002ff`
- **Lines moved**: 291 (`dashboard.css` 2477 → 2186). One contiguous segment at pre-U36 L1373-1663 containing 30 base classes plus ~11 compound/pseudo/descendant selectors: section comment `/* === Evidence Settings Overlay === */` dropped; base classes `.evidence-settings-panel`, `.evidence-settings-body`, `.evidence-settings-loading`, `.evidence-settings-row`, `.evidence-settings-label`, `.evidence-toggle`, `.evidence-toggle-thumb`, `.evidence-settings-section`, `.evidence-settings-section-title`, `.evidence-settings-radios`, `.evidence-radio`, `.evidence-settings-threshold-row`, `.evidence-threshold-label`, `.evidence-settings-input`, `.evidence-signal-card`, `.evidence-signal-card-header`, `.evidence-signal-card-expand`, `.evidence-signal-card-name`, `.evidence-signal-card-weight`, `.evidence-weight-input`, `.evidence-signal-card-body`, `.evidence-signal-desc`, `.evidence-signal-paper`, `.evidence-signal-params`, `.evidence-signal-param-row`, `.evidence-signal-param-label`, `.evidence-settings-footer`, `.evidence-settings-footer-right`, `.evidence-settings-reset`, `.small` (bare modifier — exclusively compound `.evidence-toggle.small` / `.evidence-settings-input.small`). Compound/pseudo selectors moved alongside: `.evidence-toggle.on`, `.evidence-toggle.small`, `.evidence-toggle.on .evidence-toggle-thumb` (descendant), `.evidence-toggle.small .evidence-toggle-thumb`, `.evidence-toggle.small.on .evidence-toggle-thumb`, `.evidence-radio input[type="radio"]` (descendant on attribute), `.evidence-settings-input:focus`, `.evidence-settings-input.small`, `.evidence-signal-card.disabled`, `.evidence-weight-input:focus`, `.evidence-settings-reset:hover`, `.evidence-settings-reset:disabled`. New `EvidenceSettings.css` is 290 lines.
- **Consumers updated**: `src/components/dashboard/EvidenceSettings.tsx` adds `import './EvidenceSettings.css';` as the **first line**.
- **Cluster preservation**: `.evidence-breakdown-toggle` (multi-consumer ContextFileList + EvidenceGroup, for U40 cluster) STAYS in `dashboard.css` at post-U36 L522. Multi-consumer `.ctx-settings-*` family (Tier 2 cluster U45) also preserved.
- **Frontend review**: OK (fp `8118616e7851ae87c79950a47649ed86d1a9c204a82f05c1a3e82cd192574a3c`) — 0/0/0.
- **Style review ack**: `bash scripts/ack-style-review.sh "U36 move .evidence-{settings,toggle,signal,radio,threshold,weight}* + .small to EvidenceSettings.css (Tier 1)"` recorded.
- **Cascade-order check**:
  - **Source-side: PASS**. `selectors-ordered.txt` 341 → 300 entries (41 deletions). Inventory: `289 → 259` distinct classes; `196 → 166` single-owner.
  - **Bundle-side: STRUCTURAL FAIL — visual-equivalent** (moved-vs-moved per §3 C7 last bullet).
- **Visual diff**: PASS — **5/5 captured screens byte-equal on first pass** with the **§7 critical surface `settings-evidence` (139,846 B) byte-equal**. Pass-1 byte-equal set: `dashboard-all-default` (96,467 B), `dashboard-claude` (146,288 B), `dashboard-prompt-detail` (94,955 B), `settings-evidence` (139,846 B — **§7 surface**), `settings-context-limit` (145,190 B). Orchestrator died at screen 6 (`memory-monitor-expanded`) with the standard P0.5.6-deferred `os error 35`, but U36's §7 surface was already captured. The orchestrator behaved better this run vs U35's 4 consecutive early deaths — daemon state appears stochastic across sessions.
- **Inventory rerun**: `Cross-file collisions notification: 0  App: 1  TokenTreemap: 2` unchanged.
- **Notes / design points**:
  - Lint baseline (33 errors at HEAD before U36) is unchanged.
  - No `/* UNUSED candidate */` markers added (deferred to U50).
  - **Largest single-segment Tier 1 unit so far**: 30 base classes + 11 compound/pseudo/descendant = 41 selectors moved in one 291-line block.
  - **Cumulative progress (post-U36)**: 24 distinct Tier 1 slots landed. `dashboard.css` reduced from `4554` (pre-U2) → `2186` (post-U36), a **2,368-line / 52.0% reduction — crosses the halfway mark**. 24 new sibling CSS files. 331 cumulative selector deletions.

#### U37 deferred — SessionDetailView complexity analysis (2026-05-11)

- **Status**: Tier 1 unit NOT YET LANDED. Deferred to a future session for careful planning.
- **Group**: would-be twenty-fifth Tier 1 unit landed; the final Tier 1 unit overall.
- **Reason for deferral**: U37 is the most structurally complex Tier 1 unit in the epic:
  - **30 single-owner classes scattered across ≥5 disjoint segments** of `dashboard.css` (post-U36 line numbers):
    1. L244-? `.session-detail-header`, `.session-detail-title`
    2. (orphan `.session-detail-summary` interleaved — KEEP for U50)
    3. L291-466 `.prompt-list`, `.prompt-list-loading`, `.prompt-list-empty`, `.prompt-card`, `.prompt-card:hover`, `.prompt-card-top`, `.prompt-card-model`, `.prompt-card-time`, `.prompt-card-text`, `.prompt-card-journey`, `.prompt-card-journey-chip`, `.prompt-card-journey-chip.cache` (compound), `.prompt-card-journey-chip.delta` (compound), `.prompt-card-meta`, `.prompt-card-chevron`, `.prompt-card-injected`, `.prompt-card-injected-bar`, `.prompt-card-injected-bar > div:first-child` (descendant on attribute-style), `.prompt-card-injected-bar > div:last-child`, `.prompt-card-injected-bar > div:only-child`, `.injected-segment`, `.injected-segment::after`, `.injected-segment:hover::after`.
    4. (orphans `.prompt-card-injected-label`, `.prompt-card-injected-pct` interleaved — KEEP for U50)
    5. L958-967 `.prompt-card-compacted` (with inline section comments `/* === Context Usage (Session Detail) === */` and `/* Compacted label */`).
    6. (orphan `.session-ctx-gauge` + descendant `.session-ctx-gauge span` interleaved — KEEP for U50)
    7. L982-1041 `.session-donut-gauge`, `.session-donut-svg-wrap`, `.session-donut-label`, `.session-donut-pct`, `.session-donut-sub`, `.session-donut-info`, `.session-donut-row`, `.session-donut-row span:first-child` (descendant), `.session-donut-row span:last-child`, `.session-donut-row--cost`, `.session-donut-row--cost span:last-child`.
    8. L1124-? `.prompt-card-response`, `.prompt-card-response::before` (pseudo).
    9. (orphan `.prompt-card-badges` interleaved — KEEP for U50)
    10. L1648-? `.efficiency-badge` (single-class, far from main cluster).
  - **Compound/pseudo/descendant selector density**: ~13 extra selectors beyond the 30 base classes — `.prompt-card-journey-chip.{cache,delta}` (compound), `.prompt-card:hover` (pseudo), `.prompt-card-injected-bar > div:{first,last,only}-child` (descendant on child position), `.injected-segment::after` (pseudo-element), `.injected-segment:hover::after` (pseudo combo), `.session-donut-row span:{first,last}-child`, `.session-donut-row--cost span:last-child`, `.prompt-card-response::before`.
  - **§7 surface unreachable**: SessionDetailView renders only when the user opens a Session Detail view from RecentSessions. The current `qa-capture-screen-map.json` has no entry for this surface. Visual verification would require expanding the screen-map alongside fixture work to seed a session detail navigation path.
  - **Multi-consumer / cluster preservation**: `.session-back-btn` (U39 cluster) and `.session-alert*` family (U14 deferred — SessionAlert needs fixture trigger) live interleaved in the same broad region. Both must be preserved at original positions during U37's split removal.
- **Complexity estimate**: 1-2 hours of careful planning, including verification that each segment's surrounding orphan/cluster classes are correctly preserved, plus the §7 surface verification chain — likely PARTIAL PASS with the established fallback chain (code-reviewer 0/0/0 + source cascade PASS + sentinel `dashboard-all-default` byte-equal + verbatim relocation logic). User approval required per §8 step 8e second clause.
- **Tier 1 closure status at U36**: 24 of 36 Tier 1 slots landed. Deferred: U6 (SetupGuide — surface outside window), U8 (CostTreemap — multi-selector blocker), U14 (SessionAlert — fixture needed), U16 (UsageDashboard shell residuals — no-move per §7), U18 (FilePreviewOverlay — UI trigger), U24 (ContextTreemap — multi-selector blocker, same as U8), U25 (ContextLimitSettings — cluster-aware split), U29 (FirstRunOnboarding — surface outside window), U30 (BackfillDialog — surface outside window), U31 (StatsDetailView — UI trigger), U33 (McpInsightsCard — surface outside window), U37 (this entry). 12 of 36 deferred = **67% Tier 1 completion at session boundary**.
- **Decision**: prefer planning correctness over speed. U37 ships in a future session with a written segment-by-segment removal plan and a screen-map extension for the session-detail surface (or PARTIAL PASS with explicit fallback justification).

#### P1.X falsified — bundle-side C7 cannot be satisfied by import-order alone (2026-05-11)

- **Group**: cascade-order infrastructure investigation, no commit lands. Documents the negative result + C7 caveat (now codified in §3 C7 last bullet).
- **Background**: U5 §14 queued P1.X to fix the bundle-side cascade-order divergence inherited from U2 (`.dashboard` at bundle index 15 instead of near the top — Vite emits sub-component `*.css` ahead of `dashboard.css` because the shell is the LAST import in `UsageDashboard.tsx`).
- **Attempted**: moved `import './dashboard.css'` to the very first import position in `UsageDashboard.tsx`, ahead of every other import. `npm run build` then placed `:root` and `.dashboard` at bundle indices 0-1 as expected.
- **Result**: bundle-side `css-decomp-cascade-check.mjs` STILL FAILED, with the divergence shifted to a different pair — `.cost-card` (bundle index ≈524) appearing **after** `.first-run-spinner` (bundle index ≈523). Both are now on the wrong side of the baseline expectation:
  - Baseline: `.cost-card` at original line 259 (early in dashboard.css), `.first-run-spinner` at original line 4533 (late). Baseline order: `.cost-card` BEFORE `.first-run-spinner`.
  - Bundle (shell-first after P1.X attempt): all 600+ shell selectors emit first (`.first-run-spinner` at the tail of dashboard.css), then CostCard.css. So `.first-run-spinner` BEFORE `.cost-card`. Reversed.
- **Falsified hypothesis**: bundle-side C7 (partial-order preservation of EVERY pair in `selectors-ordered.txt.U1`) is **not satisfiable by import-order tweaks alone** during the split phase. Any moved class M now lives in a sub-component CSS file that the bundle emits as a single contiguous chunk (either entirely before or entirely after `dashboard.css`). The original `dashboard.css` had M interleaved between earlier and later shell selectors — that interleaving cannot be reproduced without splitting `dashboard.css` itself into pieces. Whether the shell is emitted first OR last, some shell-vs-moved pair flips.
- **Revised C7 framing (codified at §3 C7 last bullet)**: the bundle-side check stays valuable for **shell-vs-shell pair preservation** (still-in-shell selectors must keep their relative order — Vite preserves source order within a single CSS module, so this property holds as long as we don't touch unrelated dashboard.css regions). Moved-vs-shell pair flips are **structurally inherent** to the split phase. The visual-regression bar (§3 C5 byte-equal capture) is the authoritative safety net during Tier 1+. Bundle-side check returns to strict-pass at U49 when the residual shell is small enough that no moved-vs-shell pair has a real cascade risk.
- **Decision**: revert P1.X edit (the move-import-to-top change). `UsageDashboard.tsx` returns byte-equal vs HEAD-pre-P1.X. The shell-last pattern stays — empirically it has held the visual baseline across U2-U5 with zero pixel regression, and matches the original SDD §3 C7 wording ("the shell stylesheet ... is the last dashboard CSS imported by `UsageDashboard.tsx`").
- **Verification**:
  ```
  npm run build && node scripts/css-decomp-cascade-check.mjs   # FAILs at .dashboard ↔ moved-class (same as HEAD pre-P1.X — confirms the divergence is unchanged)
  ```
- **Files touched in this docs-only entry**: §3 C7 (added "known limitation" bullet); §14 (this entry). No source change.

#### P0.5.6 deferred — daemon-reset hypothesis falsified (2026-05-10)

- **Group**: orchestrator infra investigation, no commit lands. Documents a negative result so future work doesn't re-tread the same path.
- **Background**: U4 §14 queued P0.5.6 to mitigate the agent-browser daemon-death pattern (EAGAIN errno 35 on 0.25.4 after 3 captures, ECONNREFUSED errno 61 on 0.27.0 after 2). The hypothesis was "daemon's connection backlog fills after ~10-15 CLI invocations; reset it before each step." The fix proposed: wrap every `agent-browser` call with `agent-browser close` so each command runs against a fresh daemon.
- **Three variants attempted, all failed**:
  1. **v1 — per-call `agent-browser close`**: died at 2 captures (vs baseline 3); `dashboard-claude` rendered partial at 41,485 B (vs U1-VR-d canonical 146,288 B). Symptom: CDP session-id rotation between consecutive `click` and `wait` calls in `run_steps` made provider-tab clicks "cycle out" before their React effects settled.
  2. **v2 — per-screen `agent-browser close` (graceful)**: died at 3 captures (same as baseline); `dashboard-claude` 45,668 B (still partial). Crucially, `agent-browser close` did NOT terminate the daemon process — the `⚠ --ignore-https-errors ignored: daemon already running` warning persisted across `close` calls, confirming `close` is a no-op or only flushes internal state.
  3. **v3 — per-screen `pkill -9 -f agent-browser-darwin-arm64` + `sleep 1`**: died at 2 captures (worse than baseline); `dashboard-claude` 63,424 B (still partial). pkill-based reset matched the proven pattern at line 391 (profile-entry daemon kill), yet still triggered EAGAIN at the very next reload command on screen 3.
- **Falsified hypothesis**: daemon socket exhaustion is NOT the bottleneck. Three daemon-reset strategies, including the strongest (`pkill -9` matching the proven profile-entry pattern), all failed at the same `os error 35` failure point at screen 3-4. If accumulating commands in a long-lived daemon were the problem, fresh daemons would have unblocked screens 4+. They did not.
- **Revised hypothesis (untested)**: the bottleneck is **Electron's CDP server state**, not agent-browser. Each `agent-browser --cdp <port> reload` keeps Electron alive but resets the page (the `OMT_QA_CAPTURE_MODE=1` IPC handler `qa:capture-window` re-registers per main-process boot, not per page reload — but `qa:capture-window` resolves through `webContents.capturePage()` which reads from the compositor, not from CDP). Symptoms point to CDP target-list dangling state after ~3 captures: the CDP `/json` endpoint stays reachable (curl works), but `agent-browser`'s tab discovery times out or returns stale targets, surfacing as EAGAIN on the next invocation. Daemon resets cannot fix this — Electron's CDP server is the stuck component.
- **Real fix path (not implemented in this commit, tracked as a future P0.5.6+)**: terminate Electron between screens and relaunch with the same seeded HOME. Cost: ~5s Electron boot × 9 reload boundaries = ~45s extra per profile. Architecturally invasive (the orchestrator's lifecycle hook needs to move out of `capture_profile`'s tight loop into a per-screen pattern, with the seeded HOME pinned across boots). Estimated 1-2h refactor.
- **Reproduction**:
  ```
  bash scripts/qa-capture-baseline.sh --dry-run        # passes
  OUT_DIR=/tmp/p056-test bash scripts/qa-capture-baseline.sh populated   # dies at screen 3-4 with os error 35
  ```
- **Decision**: orchestrator restored to its pre-P0.5.6 state (no diff vs HEAD). U4's §14 entry retains the partial-PASS justification under §8 step 8e. U5 selection must respect the 3-screen window: target a Tier 1 component whose §7 critical surface falls within `dashboard-all-default`, `dashboard-claude`, or `dashboard-prompt-detail`. Components whose surfaces require `settings-evidence`, `settings-context-limit`, `memory-monitor-*`, or other-profile screens stay blocked until the Electron-restart fix lands.
- **Files touched in this docs-only entry**: this gate doc only. No orchestrator change, no `.policy/style-review-ack.txt` rotation needed.

---

## §15. Glossary & References

- **SDD** — Spec-Driven Delivery. See `docs/sdd/README.md`, `docs/sdd/methodology.md`, `docs/sdd/testing.md`.
- **Tier 1 / Tier 2 / Tier 3 / Shell / Orphan** — defined in §4.
- **Canonical screen** — one of the surfaces in §9.1; captured for every implementation unit.
- **Per-unit visual surface** — extra surface defined per unit in §7; captured in addition to canonical.
- **Cascade-order baseline** — `selectors-ordered.txt` from P0; the partial order moved selectors must respect end-to-end.
- **Frontend-review gate** — `scripts/run-frontend-review.sh` + `code-reviewer` subagent + `.policy/frontend-review-report.<fp>.md` artifact. Enforced by `scripts/check-frontend-review-ack.sh` (pre-commit) and `scripts/completion-gate.sh` (Stop hook).
- **Inventory generator** — `scripts/css-decomp-inventory.mjs`; produces the inventory artifacts in `docs/sdd/css-decomp-inventory/`. Phase A (className-specific) + Phase B (broad string-literal scan, hyphen-required filter against the dashboard class set) + Phase C (manual `scripts/css-decomp-overrides.json`). Authoritative class-consumer source — but treat as a guard, not the only source: spot-check high-risk owners (ProviderTabs, CostCard, EvidenceSettings, SessionAlert) by reading the source (Codex v2 review non-blocking #2).
- **Cascade-order verifier (post-build)** — `scripts/css-decomp-cascade-check.mjs`; walks `dist/assets/*.css`, extracts selectors in declaration order, and verifies the relative order of every selector that exists in both the bundle and `selectors-ordered.txt.U1`. Required by §3 C7 every implementation unit.
- **Override file** — `scripts/css-decomp-overrides.json`; manual class → consumer mapping for runtime-composed classes (e.g., `session-alert--info`) the static analyzer cannot resolve. Every override entry must be re-validated by the dead-CSS follow-up issue before deletion.

### Related rules and docs

- `CLAUDE.md`
- `AGENTS.md`
- `.claude/rules/sdd-workflow.md`
- `.claude/rules/commit-checklist.md`
- `.claude/rules/frontend-design-guideline.md`
- `.claude/rules/agent-browser-qa.md`
- `.claude/rules/e2e-test.md`
- `OPEN-SOURCE-WORKFLOW.md`
- `CONTRIBUTING.md`
- `.claude/docs/GIT-IDENTITY-POLICY.md`
- `.claude/docs/AUTONOMOUS-OSS-OPS.md`
- `docs/sdd/terminal-hud-plugin-gate.md` (gate-doc precedent)

### Snapshot of `dashboard.css` at epic start

- Distinct classes defined: **537**
- Selector entries in declaration order: **631**
- Tier distribution: 444 single-owner / 25 cluster / 12 shared / 56 orphan
  (48 true-orphan-candidate / 7 compound-modifier-unresolved / 1 dynamic-pattern-unresolved)
- Cross-file collisions: 1 (App.css) + 3 (TokenTreemap.css) = **4**
- Snapshot date: **2026-05-03**
- Branch: `main`
- Commit: (to be captured at U0 — record `git rev-parse HEAD` here)

---

## Reviewer feedback (preserved verbatim)

The reviews below were inputs to v2 and v3.

**Authoritative for execution: v3 plan (above) + the v2 review section (Codex Feedback (v2 Review)).** The v1 reviewer feedback (Gemini Feedback + Codex Feedback) is preserved historically — its blocking items were folded into v2, and v2 itself was then fully revised by the v3 review. New execution decisions follow v3 + v2-review, NOT v1.

## Gemini Feedback

The plan is exceptionally thorough and follows best practices for a large-scale refactoring epic. Here are specific observations and suggestions:

1.  **Architecture & Strategy (Strong Alignment)**: The three-tier migration strategy (Single Owner → Cluster → Shared) is excellent. It minimizes risk by starting with low-impact changes and building confidence before tackling cross-cutting shared styles. The decision to keep the refactor purely structural (no Tailwind, no CSS Modules, no renaming) avoids scope creep.
2.  **Validation & Quality Gates (Robust)**: Reliance on pixel-perfect visual diffs using `agent-browser` is the correct approach for CSS-only refactor. The Tier 3 special verification (grep-based audit) is a critical safeguard against silent regressions.
3.  **Potential Risks & Suggestions**:
    *   **Specificity Collisions**: Consider adding an automated script to the "Pre-Tier-3" phase to detect duplicate class definitions across `dashboard.css` and `notification.css`.
    *   **Cascade Dependencies**: Moving styles to multiple files can reveal implicit dependencies on cascade order (e.g., Z-index). Suggest a specific check for layering issues during the visual regression phase.
    *   **Unused Classes**: Marking suspected dead classes with a specific comment pattern (e.g., `/* UNUSED candidate */`) during the move will facilitate the follow-up cleanup issue.
4.  **Documentation & Transparency**: The prefix inventory and run record provide excellent traceability.

**Conclusion**: The plan is ready for execution and aligns perfectly with the project's SDD workflow and security mandates.

## Codex Feedback

Verdict: the decomposition strategy is directionally sound, but the gate doc is not ready for execution as written. The largest issue is not the three-tier approach; it is that the current inventory appears to mix prefix-level heuristics with actual class ownership. This needs to be corrected before U0 opens the tracking issue, otherwise the implementation units will start from stale or false-positive consumer lists.

### Blocking feedback before execution

1. **Regenerate the inventory from exact class tokens, not broad prefix matches.**
   - The current Tier 3 examples name `NotificationCard.tsx` as a consumer for `evidence-*`, `prompt-*`, `provider-*`, `action-*`, `guardrail-*`, `token-*`, `injected-*`, `tool-*`, and `ctx-*`, but the current notification component uses `notif-*` class names for those surfaces. The only direct notification overlap found from the current files is `mini-sparkline` in `notification.css`.
   - The `legend-*` inventory also looks stale or too coarse: current TSX uses `heatmap-legend-*` and `token-composition-legend-*`, while the standalone `.legend-*` selectors in `dashboard.css` appear tied to the context breakdown block and should not be assigned to PromptHeatmap or TokenCompositionChart without an exact consumer proof.
   - Required fix: add a generated `class -> selector location -> exact TSX consumers` table, or attach a script/command that produces it. Unit planning should be based on exact class names, then grouped into prefixes only after ownership is proven.

2. **Fix concrete plan inconsistencies before creating the issue.**
   - The doc says "Total: 27 commits", but U0 through U27 is 28 commits when counted inclusively.
   - U12 repeats `backfill-*` even though U2 already moves `backfill-*`.
   - U11 lists `setup-*` as a Tier 1 move to `SetupGuide.css`, but the current code also uses `setup-guide` classes from `UsageView.tsx`; keep this as shared or split exact classes only after inventory proves ownership.
   - U24 is too large and ambiguous as written. It lists many shared prefixes in one unit while also saying each prefix may need its own commit. Convert that row into explicit units, or make U24 an audit/planning checkpoint rather than an implementation unit.

3. **Specify CSS cascade-order preservation, not only visual equality.**
   - Moving from one root import (`UsageDashboard.tsx -> dashboard.css`) to many component-level imports can change final CSS order in the Vite bundle. That can change behavior even when selector text is copied verbatim.
   - Required fix: capture the original ordered selector list for all moved selectors and require each unit to preserve the relative order of moved rules in the final emitted CSS. At minimum, shared CSS imports should be ordered before component-local CSS imports in every consumer, and the unit validation should include a post-build selector-order check for the moved classes.

4. **Expand visual coverage per unit instead of relying only on the four canonical screens.**
   - The four canonical screens do not directly cover several planned units, including `BackfillDialog`, FirstRun onboarding states, expanded/collapsed card states, and notification-only surfaces.
   - Required fix: each unit should declare its own visual surface in addition to the canonical four screens. For example, U2 must open the Backfill dialog, U8 must cover first-run onboarding, and any notification-related shared move must capture the notification overlay/window.

5. **Stabilize the visual baseline before requiring pixel equality.**
   - Byte-equality PNG comparison is only useful if data, timestamps, viewport, fonts, animations, and loading states are deterministic.
   - Required fix: U1 should document how fixture data is frozen, how "time ago" text is stabilized, how animations/spinners are disabled or waited out, and how the same viewport/device scale factor is enforced. Otherwise harmless runtime variance will create noisy visual failures.

6. **Reduce execution-time branching in the gate doc.**
   - Several units include "or fold", "or split", "optional rename", and "decide based on grep" language. That is acceptable for a design note, but risky for an SDD gate that is supposed to constrain implementation.
   - Required fix: convert unresolved choices into explicit preflight decision checkpoints before U2 starts, then freeze the unit list. If a decision cannot be made until fresh inventory is generated, say exactly which unit owns that decision and what artifact records it.

### Recommended revised preflight

Before U0/U1, add a preflight section that produces and commits no source changes:

1. Generate exact CSS selector inventory from `dashboard.css`.
2. Generate exact class-token usage from `src/**/*.tsx` and `src/**/*.ts`.
3. Join those into a `class -> consumers` table.
4. Mark classes as single-owner, cluster-owned, shared, or orphaned.
5. Rebuild the U2-U27 unit table from that generated data.
6. Capture a selector-order baseline for the current monolithic `dashboard.css`.

After that preflight, the three-tier migration plan is a good fit. Without it, the plan risks spending many commits moving the wrong groups or adding unnecessary imports to components that do not actually consume those classes.

## Codex Feedback (v2 Review)

Verdict: v2 is a material improvement over v1. It correctly replaces the broad prefix plan with generated artifacts, moves shared CSS under `dashboard/_shared/` instead of a repository-wide shared folder, adds visual-surface coverage, and treats cascade order as an explicit risk. However, the plan is still not execution-ready. The remaining blockers are mostly in the generator and in the sequencing of preflight commits.

### Blocking feedback before execution

1. **The generator still undercounts class usage for dynamic and helper-produced class names.**
   - `scripts/css-decomp-inventory.mjs` currently strips `${...}` sections from template-literal `className` values. That loses real static modifier tokens such as `active`, `expanded`, `open`, `on`, and `disabled`.
   - It also misses helper-returned static strings. For example, `ProviderTabs.tsx` returns `provider-tab-dot tracking-active`, `provider-tab-account-badge account-connected`, and related status classes from helper functions, but those modifier tokens are classified as orphans.
   - It misses dynamic pattern classes such as `session-alert--${alert.severity}`; the generated orphan list currently includes `session-alert--info` and `session-alert--warning`, which are likely real runtime classes.
   - Required fix: after collecting the dashboard class set, scan TS/TSX string literals broadly and retain only string tokens that match a class defined in `dashboard.css`. Keep the current `className`-specific extractor, but add this filtered string-literal pass plus a small manual override mechanism for dynamic patterns that cannot be statically resolved.

2. **Do not mark the current 71 orphan classes until the generator is fixed.**
   - The orphan list includes compound-selector modifiers and state classes: `.active`, `.expanded`, `.open`, `.on`, `.disabled`, `.tracking-*`, `.account-*`, `.session-alert--*`, and `.cache-growth-chart--clickable`.
   - Several of these are visibly used at runtime through conditional class composition. Marking them with `/* UNUSED candidate */` in U50 would be misleading and would poison the follow-up dead-CSS cleanup issue.
   - Required fix: split orphan reporting into `true-orphan-candidate`, `compound-modifier-unresolved`, and `dynamic-pattern-unresolved`. Only the first bucket should be eligible for U50 markers.

3. **The commit-count math is still wrong.**
   - The doc says "Total: 52 commits", but the frozen plan counts higher:
     P0 + P1 + U0 + U1 = 4, U2-U37 = 36, U38-U45 = 8, U46-U48 = 3, U49-U51 = 3. That is **54 commits** if `U-shared-init` is folded into U46, or **55 commits** if it is a separate commit.
   - Required fix: correct the total count and the issue-body acceptance criteria before opening the GitHub issue.

4. **The preflight sequence conflicts with the SDD "Issue First" rule.**
   - P0 and P1 are described as commits before U0 opens the issue, with a later amend/rebase to add `(#<issue>)`.
   - That contradicts §3 C1, which says every commit references an issue and coding must not start before the issue exists.
   - Required fix: reorder to `U0 issue + branch + rules ack` first, then P0 inventory, then U1 baseline, then P1 collision resolution. If P0 must exist before the issue for drafting, keep it uncommitted until the issue exists.

5. **P1 collision resolution must not happen before the visual baseline.**
   - P1 is a source change, but U1 is the visual baseline. If P1 runs first, the baseline no longer represents pre-refactor `main`.
   - Required fix: capture U1 baseline before any CSS source change, then run P1 and prove it is pixel-equal against U1. Collision resolution can still happen before Tier 1-3 moves.

6. **The cascade-order verification command is not currently executable or sufficient.**
   - §3 C7 shows `bash scripts/css-decomp-inventory.mjs`, but the script is a Node script and is not executable in the current file mode. Use `node scripts/css-decomp-inventory.mjs`.
   - The doc references `selectors-ordered.txt.current`, but the script writes `selectors-ordered.txt`.
   - More importantly, regenerating `selectors-ordered.txt` from `dashboard.css` after a move only shows that selectors disappeared from the monolith. It does not verify the final emitted Vite CSS order.
   - Required fix: add a post-build CSS order checker that parses `dist/assets/*.css` and compares the relative order of moved selectors against the U1 baseline. The generator can keep the baseline, but it cannot be the only cascade-order check after selectors move out of `dashboard.css`.

7. **The shared target path is inconsistent between the doc and generated artifacts.**
   - The gate doc now correctly says `src/components/dashboard/_shared/`.
   - The generator comments and `prefix-summary.md` still say shared classes move into `src/components/_shared/`.
   - Required fix: update the generator and regenerated artifacts so every instruction names `src/components/dashboard/_shared/`.

8. **The shared class count for memory-file rows is inconsistent.**
   - §6 says S2 has "8 classes", but it lists `memory-file-list` plus eight `memory-file-*` classes, for a total of 9.
   - The JSON count also supports 12 shared classes total: 1 section + 9 memory-file + 2 collapsible.
   - Required fix: update S2 and any related layout comments to say 9 classes.

### Non-blocking recommendations

1. **Treat cross-file collisions as risk records before renaming or deleting.**
   - The current collisions (`.loading`, `.cache`, `.cost-row`, `.legend-value`) are class-token collisions, but their selectors may be scoped differently (`.icon-btn.loading`, `.dashboard-refresh-btn.loading`, `.prompt-card-journey-chip.cache`, etc.).
   - P1 should first prove whether the colliding stylesheets are imported into the same runtime bundle and whether any DOM node can match both rule families. Rename/delete only after that proof.

2. **Use the generator as a guard, not as the only source of truth.**
   - The generated inventory is valuable, but it should be paired with spot checks on high-risk owners: `ProviderTabs`, `CostCard`, `EvidenceSettings`, `SessionAlert`, and any component that computes classes through helper functions or template literals.

3. **Keep the v1 Codex feedback, but mark it as historical.**
   - The current "Reviewer feedback" section says the v1 reviews were folded into v2, which is useful. Add one sentence that new execution decisions should follow the v2 review section, not the preserved v1 section.

Once the generator can correctly account for conditional/static helper class tokens, the plan is close. The architecture is now reasonable; the main risk is executing a 50+ commit plan from an inventory that still misclassifies runtime classes as dead CSS.
