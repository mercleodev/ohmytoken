# OhMyToken - Open Source Workflow

This document defines the default contribution workflow to keep project operations at a mature public OSS standard.
Use it together with `.claude/docs/AUTONOMOUS-OSS-OPS.md` for executable command-level operations.

---

## 0) Source of Truth and Enforcement

Policy precedence:

1. `CONTRIBUTING.md` for merge policy and contribution rules
2. `OPEN-SOURCE-WORKFLOW.md` for workflow and CI mapping
3. `policy/RULES-CATALOG.txt` for path-to-rule applicability

Enforcement note:

1. If CI workflows are missing or incomplete, gates are manual and can drift.
2. Manual evidence must be attached to PR until CI gates are active.
3. Runtime agent prompts are advisory; only pipeline gates are enforceable.
4. Use `policy/RULES-CATALOG.txt` with local acknowledgement gates for pre-PR enforcement.

---

## 1) Contribution Flow

1. Open or select an issue.
2. Confirm scope, acceptance criteria, and labels.
3. Run reuse-first scan against `checktoken` baseline implementation (`~/prj/checktoken/`) and classify target areas (`reuse` / `adapt` / `rewrite`).
4. Run `bash scripts/set-active-rules-ack.sh <task-id>`.
5. Create a branch from `main`.
6. Implement in small, reviewable commits.
7. Open a Draft PR early.
8. Add tests and docs updates in the same PR.
9. Request review after CI passes.
10. Merge with a clean history policy.

Execution authorization model (default):

1. Approve execution once per session/batch.
2. If explicit issue ids are provided, treat them as the approved batch scope.
3. If explicit issue ids are not provided, infer an implicit batch from the active queue.
4. Inside that in-scope batch, commit/push/Draft-PR updates and issue-to-issue transitions run autonomously.
5. Do not prompt "continue to next issue?" while still in the in-scope batch.
6. Reconfirmation is required only for out-of-batch scope expansion, security/architecture risk changes, merge-to-main or release actions, and history rewrite actions.
7. Stop immediately only when the user explicitly requests stop/pause.

---

## 2) Issue-First Rule

Every non-trivial code change should be linked to an issue.

Minimum issue quality:

1. Reproduction or user problem statement
2. Expected behavior
3. Acceptance criteria
4. Scope boundaries

---

## 2-1) Reuse-First Migration Gate (Mandatory)

Prevent rewrite-first drift by enforcing explicit reuse planning.

Before implementation:

1. Identify existing `checktoken` modules (`~/prj/checktoken/`) covering the target behavior.
2. Decide for each area: `reuse`, `adapt`, or `rewrite`.
3. If code is carried over from `checktoken`, refactor it to OhMyToken contracts/rules before merge (no raw copy acceptance).
4. Record the decision in a private note under `.claude/worklog/`.
5. For every `rewrite`, add one technical reason and one risk note.

Before PR review request:

1. Add a `## Reuse Plan` section in the PR body.
2. Include a decision matrix mapping `checktoken` source paths to OhMyToken target paths.
3. Include parity validation evidence (tests or scenario list).
4. If behavior intentionally changes, mark it explicitly in scope and risk sections.

Merge rule:

1. PRs missing `Reuse Plan`, checktoken-to-OhMyToken mapping, or rewrite justification are not merge-ready.

---

## 3) Repository Identity Lock (Mandatory)

This repository is locked to a repository-local identity profile.

Required local identity:

1. values are defined only in `.git-identity.local` (git-ignored)
2. no personal identity values should be hardcoded in tracked files

Required origin remote:

1. must match `GIT_IDENTITY_REMOTE` from `.git-identity.local`

Mandatory setup and verification:

1. `bash scripts/setup-git-identity-lock.sh`
2. `bash scripts/verify-git-identity-lock.sh`
3. Keep `core.hooksPath=.githooks` enabled
4. Keep content guard enabled for all staged text files via `pre-commit`
5. Keep markdown allowlist policy enabled via `.public-docs-allowlist`

---

## 3-1) Applicable Rules Gate (Mandatory)

This gate prevents "read-but-not-applied" behavior.

1. Rule catalog: `policy/RULES-CATALOG.txt`
2. Local acknowledgement file (git-ignored): `.policy/active-rules-ack.txt`
3. Setup/refresh command: `bash scripts/set-active-rules-ack.sh <task-id>`
4. Enforcement command (hooked): `bash scripts/check-applicable-rules.sh --mode=staged`

---

## 4) Branch Naming

Use predictable branch names:

1. `feat/<topic>`
2. `fix/<topic>`
3. `docs/<topic>`
4. `chore/<topic>`
5. `spike/<topic>` for uncertain experiments

---

## 5) Commit Standards

Use high-signal, English-only commit messages.

Format:

```text
type(scope): concise imperative summary
```

Examples:

```text
feat(proxy): add SSE stream parser for Claude API
fix(analyzer): correct token counting for Korean text
docs(workflow): add release checklist
```

Commit timing rules:

1. Commit after each validated logical unit (code + tests/docs for that unit).
2. Commit before context switching or ending a work block.
3. Create a checkpoint commit before high-risk refactors.
4. If no clean unit is finished within 60 minutes, create a small checkpoint commit.

---

## 6) Pull Request Standards

Use a structured PR body with these required headings:

1. `## Summary`
2. `## Linked Issue`
3. `## Reuse Plan`
4. `## Applicable Rules`
5. `## Validation`
6. `## Test Evidence`
7. `## Docs`
8. `## Risk and Rollback`

---

## 7) Testing and Regression

Minimum test strategy per meaningful change:

1. Unit/Component tests for local logic
2. Integration tests for proxy and data flow
3. E2E scenario tests for real user flow

Failure record policy:

1. Create private QA cards for meaningful test failures.
2. Archive resolved QA cards by default after fix validation.
3. Delete only empty/duplicate/no-value artifacts.

---

## 8) Architecture Change Protocol

For architecture and security changes:

1. Write a short design note before implementation.
2. Document tradeoffs and alternatives.
3. Use private QA cards (`.claude/qa/`) when direction is unclear.
4. Promote finalized decisions to ADR (`docs/decisions/ADR-xxxx-*.md`).

Do not merge architecture-impacting changes without written rationale.

---

## 9) Merge and Release

Merge policy:

1. Prefer squash merge for feature branches.
2. Ensure CI and required review checks are green.
3. Keep `main` releasable.

Release policy:

1. Follow semantic versioning.
2. Publish concise release notes.
3. Mark breaking changes explicitly.

---

## 10) Maintainer Cadence (Mature OSS Style)

1. Start from issue acceptance criteria, not ad-hoc coding.
2. Keep branches short-lived and focused.
3. Land incremental value quickly through small, test-backed PRs.
4. Keep history clean with squash merge and clear release notes.
5. Treat docs/specs as first-class deliverables, not post-work cleanup.

---

## 11) Required CI Gate Pattern

Before merge, require the standard gate set:

1. `policy-gate` passes (PR body applicable-rules references validated)
2. `content-guard` passes (content leak and markdown allowlist checks)
3. `ci` passes (`typecheck`, `lint`, and `test`)

Branch protection setup:

1. Add `policy-gate`, `content-guard`, and `ci` as required checks on `main`.
2. Require pull requests before merge.
3. Disable direct push and force push on `main`.
4. Keep squash merge enabled.

---

## 12) History Hygiene

1. Never rewrite `main` history.
2. Keep feature branch history readable; squash on merge for clean public history.
3. Force-push only on your own branch when required by rebase/squash cleanup.

---

## 13) Autonomous Maintainer Operations

Maintainers/agents may autonomously:

1. Create issues for non-trivial scoped tasks.
2. Open and maintain Draft PRs.
3. Post English progress and plan-change comments on PRs.
4. Merge PRs with squash when all merge gates are green.

Mandatory guardrails:

1. Follow `.claude/docs/AUTONOMOUS-OSS-OPS.md` end-to-end flow.
2. Never bypass required CI/review policy.
3. Escalate blocking/security-sensitive changes before merge.
