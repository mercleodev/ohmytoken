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

### U1-VR — Visual regression baseline (NO source change to dashboard.css)

**Why**: Goal G5 + Codex v2 #5. Pixel ground truth captured BEFORE any Tier 1 commit so byte-equal regression has a reference. Split out of U1 in v3.1 because the fixture seeder + stabilization knobs were not in the codebase at U1 land time. P0.3 (`596f927`) lands the runtime stabilization (`OMT_QA_FAKE_NOW` + `OMT_QA_NO_ANIMATIONS` + `__qaConfig` preload bridge + `src/qa/stabilization.ts` + `scripts/qa-launch-renderer.sh`). U1-VR's prerequisite is a deterministic fixture seeder (`scripts/qa-seed-fixtures.sh` or equivalent — TBD) that populates `~/.claude/history.jsonl`, the SQLite DB, and any provider-config files so the dashboard renders the same populated data on every run.

U1-VR MUST land before any Tier 1 commit. P1 (collision reconciliation) can run before U1-VR because P1's diff target is dashboard.css source — not pixel — and P1 itself emits no class moves. The Tier 1+ commits are the ones that need a pixel reference.

**Steps**:
1. **Build the fixture seeder** (if not already present): `scripts/qa-seed-fixtures.sh` — populates `$HOME/.claude/history.jsonl`, the SQLite DB, and `~/.codex/sessions/` so the dashboard renders the canonical populated states. Outputs deterministic fixture artifacts under `docs/qa/runs/<date>/baseline/fixtures/` for audit.
2. **Stabilize fixtures and runtime**:
   - `HOME=/tmp/omt-qa-css-decomp-home` (override `qa-launch-electron.sh` default via `HOME_OVERRIDE`); run the seeder against this HOME.
   - `OMT_QA_FAKE_NOW=2026-05-05T12:00:00Z` and `OMT_QA_NO_ANIMATIONS=1` (already wired through `electron/preload.ts` → `__qaConfig` → `src/qa/stabilization.ts` after P0.3).
   - Force viewport 1440 × 900, DPR 2 via `agent-browser open --viewport 1440x900 --dpr 2`.
   - Wait for `[data-loaded="true"]` (or equivalent) before each screenshot.
   - Inter font: relies on the project's existing `<link rel="stylesheet">` to Google Fonts. Verify Inter loaded via `agent-browser eval "[...document.fonts].some(f => f.family === 'Inter' && f.status === 'loaded')"` before screenshotting.
3. Build: `npm run build:electron`.
4. Launch full-stack Electron: `OMT_QA_FAKE_NOW=... OMT_QA_NO_ANIMATIONS=1 HOME_OVERRIDE=/tmp/omt-qa-css-decomp-home bash scripts/qa-launch-electron.sh`.
5. Connect: `agent-browser connect 9222 --session css-decomp-baseline`.
6. Capture the **canonical screens** under `docs/qa/runs/<date>/baseline/canonical/` — same 13 PNG + JSON pairs as the original U1 spec:
   - `dashboard-all-default`, `dashboard-claude`, `dashboard-prompt-detail`, `settings-evidence`, `settings-context-limit`, `backfill-dialog`, `first-run-onboarding`, `notification-overlay` (cross-cut guard), `setup-guide`, `mcp-insights-expanded` + `mcp-insights-collapsed`, `memory-monitor-expanded` + `memory-monitor-collapsed`.
7. Renderer-only twins via `bash scripts/qa-launch-renderer.sh` (using the canonical QA URL printed by the launcher): `renderer-dashboard.png`, `renderer-settings.png`. Fast-path checks for Tier 1 units that don't need real-IPC data.
8. Commit:
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
| U5 | `dashboard/CostTreemap.tsx` | `CostTreemap.css` | 5 | `dashboard-all-default.png` |
| U6 | `dashboard/SetupGuide.tsx` | `SetupGuide.css` | 5 | `setup-guide.png` |
| U7 | `dashboard/CacheGrowthChart.tsx` | `CacheGrowthChart.css` | 6 | `dashboard-all-default.png` |
| U8 | `dashboard/AccountInsightsCard.tsx` | `AccountInsightsCard.css` | 6 | `dashboard-claude.png` |
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
   - Capture canonical screens (§9.1)
   - Capture this unit's declared visual surface (from §7 unit row)
   - Diff each against U1 baseline; expect pixel-equal
   - Acceptance: 0 pixels different. Any non-zero diff → root-cause and fix
     before commit, OR document exception in §14 with user approval

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
| R9 | Visual diff persistently fails on stabilization-related noise (font hinting, timezone) | Medium | Medium | §9.4 stabilization SOP; if still noisy, expand the wait-selector list and re-baseline once |
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
