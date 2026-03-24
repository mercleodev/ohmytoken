# Contributing to OhMyToken

Thanks for contributing.

OhMyToken is a real-time AI agent token usage monitor.
It intercepts Claude/Codex/Gemini API calls via a local proxy, parses SSE streams, and visualizes context window usage.

Project entry references:

1. `.claude/docs/START-HERE.md`
2. `.claude/docs/AUTONOMOUS-OSS-OPS.md`
3. `.claude/docs/GIT-IDENTITY-POLICY.md`
4. `policy/RULES-CATALOG.txt`
5. `docs/sdd/README.md`

---

## 1) Ground Rules

1. Keep changes small and focused.
2. Avoid unrelated refactors in the same PR.
3. Prefer clear, test-backed changes over fast unverified edits.
4. Use English only across all contribution artifacts.
5. Reuse existing stable modules by default; rewrite only with explicit architecture/design justification.

## 1-1) Reuse-First Migration Workflow (Mandatory)

For migration or parity work, do not start from blank implementation by default.

1. Scan `checktoken` baseline implementation (`~/prj/checktoken/`) for target behavior before coding.
2. Classify each target area as one of: `reuse`, `adapt`, `rewrite`.
3. `rewrite` is allowed only with explicit technical reason:
   architecture boundary mismatch, security risk, untestable coupling, obsolete dependency, or proven performance bottleneck.
4. If code is brought from `checktoken`, preserve behavior but refactor implementation to current OhMyToken rules and contracts before merge.
5. Direct copy-paste without rule-aligned refactor is not merge-ready.
6. Keep behavior parity as the default goal unless issue scope explicitly changes behavior.
7. Record reuse/adapt/rewrite decisions in a private worklog note under `.claude/worklog/`.
8. Reflect the same decisions in PR `## Reuse Plan`.

---

## 2) Language and Writing Policy (Mandatory)

1. Write commit messages in English only.
2. Write PR titles, descriptions, review comments, and issue updates in English only.
3. Write code comments and documentation in English only.
4. Do not include Korean text in repository-facing content.
5. When editing existing non-English content, convert touched sections to English.
6. This policy applies to all repository-facing file types (code, scripts, configs, docs).
7. Public markdown files are allowlist-based: only files listed in `.public-docs-allowlist` can be committed.

---

## 3) Repository Identity Lock (Mandatory)

This repository must never use global git identity for commits/pushes.

Required local identity:

1. values must come from `.git-identity.local` (git-ignored)
2. do not hardcode personal identity values in tracked files

Required origin remote:

1. must match `GIT_IDENTITY_REMOTE` in `.git-identity.local`

Mandatory setup:

1. `bash scripts/setup-git-identity-lock.sh`
2. `bash scripts/verify-git-identity-lock.sh`

Enforcement:

1. `pre-commit` blocks wrong local identity
2. `pre-push` blocks wrong remote target
3. `pre-commit` content guard blocks Korean/private/local-path leaks in staged text files
4. `pre-commit` blocks markdown files not listed in `.public-docs-allowlist`
5. Do not bypass hooks in normal operations

---

## 4) Applicable Rules Acknowledgement (Mandatory)

This repository enforces rule acknowledgement before commits.

Required flow:

1. Start each issue/task by running:
   `bash scripts/set-active-rules-ack.sh <task-id>`
2. Keep `.policy/active-rules-ack.txt` updated when scope or changed paths expand.
3. `pre-commit` runs `scripts/check-applicable-rules.sh --mode=staged`.
4. Commits are blocked when required rule IDs are not acknowledged.

Rule source:

1. `policy/RULES-CATALOG.txt` defines rule IDs, path patterns, and required doc references.
2. Acknowledgement is path-driven and provider-agnostic.

Agent compatibility statement:

1. This enforcement applies equally to Claude Code, Codex, Gemini CLI, and manual shell workflows.
2. "I read the docs" is not accepted as evidence without passing hook/CI gates.

Failure recovery when blocked:

1. If commit is blocked by missing ack file: run `bash scripts/set-active-rules-ack.sh <task-id>`.
2. If commit is blocked by stale ack rules: rerun the same command after staging new paths.
3. If rule mapping seems wrong: update `policy/RULES-CATALOG.txt` in the same PR with rationale.

---

## 5) Branch and Commit Strategy

Use branch-first workflow from the start.

1. Create a feature branch for each task: `feature/<topic>`.
2. If direction is uncertain, use `spike/<topic>` for experiments.
3. Commit in logical units, not one giant final commit.
4. Open Draft PR early for feedback.
5. Merge with squash once scope is stable.

Execution authorization model (default):

1. Approval is delegated per session/batch, not per command.
2. If explicit issue ids are provided, treat them as the batch scope.
3. If explicit issue ids are not provided, infer an implicit batch from the active queue.
4. Move across in-scope consecutive issues without asking "continue to next issue?".
5. Reconfirm only for out-of-batch scope expansion, security-sensitive or architecture-impacting direction changes, merge-to-`main` or release tagging, and history rewrite.
6. Stop immediately only when the user explicitly requests stop/pause.

Recommended commit format:

```text
type(scope): summary
```

Examples:

```text
feat(proxy): add SSE stream parser for Claude API
fix(analyzer): correct token counting for Korean text
docs(contributing): clarify release test gate
```

Commit quality requirements:

1. Use imperative mood in the summary line.
2. Keep the first line concise and specific.
3. Explain why in the body for non-trivial changes.
4. Avoid vague messages like `update`, `fix`, or `misc`.
5. Keep commits atomic (single purpose, easy to revert).
6. Include tests/docs in the same logical unit when behavior or contracts change.
7. Prefer small-to-medium commits; split if reviewability drops.

---

## 6) Architecture Constraints (Must Keep)

1. Proxy server must remain transport-agnostic (support multiple AI providers).
2. Token counting logic must be separated from proxy handling.
3. Database schema changes must include migration scripts.
4. IPC channel changes must follow the defined modification order: types -> main -> preload -> components.

If a change breaks any rule above, redesign before merge.

---

## 7) Testing Policy

All PRs should include tests appropriate to change scope.

Gate baseline by change type:

1. Docs-only PR: allow test skip, but content guard and markdown allowlist checks must pass.
2. Code-touch PR: `lint` and `typecheck` are mandatory.
3. Behavior or contract change PR: add/update tests and run relevant suites.

---

## 8) Pull Request Checklist

Before requesting review, verify all items:

1. Scope is focused and linked to issue/task context.
2. PR body includes `Applicable Rules` with checked doc+section references.
3. Tests were added or updated for changed behavior.
4. Docs were updated when architecture/spec behavior changed.
5. Reuse/adapt/rewrite decisions are documented, and each rewrite has explicit technical justification.
6. checktoken-to-OhMyToken mapping evidence is present, and imported code is refactored to current project rules/contracts.
7. Run local PR policy validation before review:
   `bash scripts/check-pr-live.sh <pr-number>`

Required status checks on `main`:

1. `policy-gate`
2. `content-guard`
3. `ci`

---

## 9) Security and Responsible Disclosure

1. Do not commit secrets, tokens, or private keys.
2. Report security issues privately to maintainers first.

---

## 10) Communication

1. Prefer concrete issue reports with reproduction steps.
2. If behavior is intentionally changed, document why.
3. Keep review discussion technical and test-based.
4. PR comments from maintainers/agents must be in English and action-oriented.

---

## 11) Open Source Operating Standard

This repository follows a mature OSS workflow similar to high-quality public projects.

1. Start with an issue before code changes.
2. Use a Draft PR early for visibility.
3. Keep PR scope narrow and linked to one primary goal.
4. Require tests and docs updates for behavior changes.
5. Merge only when CI and review criteria are fully green.

Reference documents and templates:

1. `OPEN-SOURCE-WORKFLOW.md`
2. `.github/pull_request_template.md`
3. `.github/ISSUE_TEMPLATE/bug_report.md`
4. `.github/ISSUE_TEMPLATE/feature_request.md`
5. `.claude/docs/AUTONOMOUS-OSS-OPS.md`

---

## 12) Decision Records and Design Changes

For non-trivial changes (architecture, protocol, security):

1. Write a short design note before implementation.
2. Record tradeoffs and rejected alternatives.
3. If direction is ambiguous, create a private QA card in `.claude/qa/` first.
4. Promote finalized architectural decisions to `docs/decisions/ADR-xxxx-*.md`.

Do not merge architecture-impacting changes without written rationale.

---

## 13) Merge and Release Discipline

1. Use squash merge for most feature PRs.
2. Keep release notes clear and user-facing.
3. Follow semantic versioning rules for tags.
4. Document breaking changes explicitly.

---

## 14) Real-Time Working Loop (Mandatory)

Apply this loop while actively implementing changes.

1. Link work to an issue before coding (`what`, `why`, `non-goals`).
2. Open Draft PR early and keep its checklist current during implementation.
3. After each validated logical unit, commit immediately.
4. When behavior/spec changes, update docs in the same commit or the next immediate commit.
5. Push branch checkpoints regularly (at least before long pauses or context switches).
6. If direction changes, add a short "plan change" note in the Draft PR before continuing.
