# Spec-Driven Delivery for OhMyToken

This directory defines a repository-aligned workflow for turning an issue or problem statement into a validated change.
It is intentionally compatible with `CONTRIBUTING.md`, `OPEN-SOURCE-WORKFLOW.md`, `.claude/rules/e2e-test.md`, and the existing completion-gate checklist flow.

## What This Does

Use this workflow when work starts from an issue, a bug report, or a high-level request and you want a disciplined path from requirements to verification.

Core idea:

1. Clarify the behavior before coding.
2. Choose the smallest test layer that can prove the behavior.
3. Implement in validated increments.
4. Keep issue, PR, tests, and docs in sync.

## What This Does Not Replace

This workflow does not override repository rules.

Always follow:

1. `CONTRIBUTING.md` for language, commit, testing, and reuse-first rules.
2. `OPEN-SOURCE-WORKFLOW.md` for branch naming, Draft PR timing, and PR structure.
3. `.claude/rules/e2e-test.md` for headless/headed Playwright expectations.
4. `.claude/docs/checklists/*.md` and `scripts/completion-gate.sh` for automated and manual completion checks.

## Fast Path

1. Start from a GitHub issue or create an equivalent problem statement.
2. Run `bash scripts/set-active-rules-ack.sh <task-id>`.
3. Capture or refine the spec:
   `Problem`, `Expected Outcome`, `Acceptance Criteria`, `Failure Modes`, `Constraints`, `Non-goals`.
4. Inspect the codebase and decide whether the change is `reuse`, `adapt`, or `rewrite`.
5. Choose the smallest proving test layer:
   Vitest for logic and data handling, Playwright for cross-process or user-visible flows.
6. Split work into small validated units and open or update a Draft PR early.
7. Implement one logical unit, then run required validation.
8. Record status, risks, and next steps in the issue or PR before pausing.

## Minimum Spec Template

```md
## Problem
- What is broken, missing, or unclear?

## Expected Outcome
- What should be true after this change?

## Acceptance Criteria
- Concrete behavior check 1
- Concrete behavior check 2
- Concrete behavior check 3

## Failure Modes
- If X fails, the system should do Y
- If Z is unavailable, the system should do W

## Constraints
- Existing boundary, dependency, or performance limit
- Existing module or pattern that must be reused

## Non-goals
- Explicitly out-of-scope work
```

If an issue already contains this information, do not rewrite it just for ceremony.
Use the existing source of truth and fill only what is missing.

## Required Validation Baseline

For code-touch work, the default validation baseline is:

```bash
npm run typecheck
npm run lint
npm run test
```

Add Playwright when the change affects:

1. Electron main-to-renderer flow
2. Proxy intercept to DB to UI roundtrip
3. User-visible dashboard or settings behavior
4. Regression coverage required by `.claude/rules/e2e-test.md`

## Recommended Reading Order

1. [methodology.md](./methodology.md)
2. [issue-workflow.md](./issue-workflow.md)
3. [testing.md](./testing.md)
4. [style-checklist.md](./style-checklist.md)

## Summary

Use this workflow to tighten requirements and validation, not to create a second process system.
When it conflicts with repository policy, repository policy wins.
