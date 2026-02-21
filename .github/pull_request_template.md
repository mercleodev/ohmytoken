## Summary

Describe what changed and why.

## Linked Issue

Closes #
<!-- Keep issue closure in PR body. Commit subjects should stay clean (no trailing #id). -->

## Reuse Plan

- [ ] `checktoken` baseline modules for this scope were scanned first (or `N/A (no migration)`)
- [ ] Each target area is classified as Reuse, Adapt, or Rewrite
- [ ] Every Rewrite item has explicit technical justification (or `N/A` when no rewrite)
- [ ] Imported `checktoken` code is refactored to OhMyToken rules/contracts before merge
- [ ] Behavior parity validation is listed (tests or scenario evidence)

Baseline Source:
- checktoken module(s): <path list or `N/A (no migration)`>

Decision Matrix:
| Target Area | Decision (Reuse/Adapt/Rewrite) | checktoken Source | OhMyToken Target | Justification/Risk |
| --- | --- | --- | --- | --- |
| <example> | <reuse/adapt/rewrite> | <path or N/A> | <path> | <reason or N/A> |

Parity Evidence:
- <tests/scenarios/logs>

## Applicable Rules

- [ ] CONTRIBUTING.md §1-1 (reuse-first migration)
- [ ] CONTRIBUTING.md §7 (testing policy) + §8 (PR checklist)
- [ ] .claude/docs/test.md §7 (PR/CI gates)
- [ ] OPEN-SOURCE-WORKFLOW.md §2-1 (reuse-first migration gate)
- [ ] OPEN-SOURCE-WORKFLOW.md §11 (required CI gate pattern)
- [ ] .claude/rules/e2e-test.md §1 (headless loop + headed final) or `N/A` with reason

## Scope

- [ ] This PR has one primary purpose.
- [ ] Unrelated refactors are excluded.

## Execution Authorization

- [ ] Work stayed within delegated issue/session scope, or reconfirmation was obtained for out-of-scope/high-risk actions.

## Validation

- [ ] Unit/Component tests added or updated
- [ ] Contract/Integration tests added or updated when applicable
- [ ] E2E validation completed when applicable
- [ ] Typecheck and lint passed

## Test Evidence

Provide key outputs or a short result summary.

## Docs

- [ ] Documentation updated for behavior or architecture changes
- [ ] No repository-facing Korean text was introduced

## Risk and Rollback

List potential risks and rollback steps.
