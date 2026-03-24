# Issue-Centered Workflow

Use this workflow when implementation starts from a GitHub issue or a task that should be represented as one.

## Scope

This document explains how to keep the issue, branch, validation, and PR in sync without conflicting with repository policy.

It complements:

1. `CONTRIBUTING.md`
2. `OPEN-SOURCE-WORKFLOW.md`
3. [methodology.md](./methodology.md)

## Start Conditions

Before writing code:

1. Read the issue title and body.
2. Check whether the issue already defines acceptance criteria, failure modes, and non-goals.
3. Run `bash scripts/set-active-rules-ack.sh <task-id>`.
4. Confirm whether the work is a feature, fix, docs change, chore, or spike.

## When the Issue Is Too Thin

If the issue is only a title or a one-line request, do not treat it as a full spec.
Clarify the missing details first.

Recommended issue sections:

```md
## Problem
## Expected Outcome
## Acceptance Criteria
## Failure Modes
## Constraints
## Non-goals
```

If editing the issue body is not the right place, put the clarification in the Draft PR description or an issue comment.
Keep repository-facing updates in English.

## Branching

Follow the repository branch standard from `OPEN-SOURCE-WORKFLOW.md`.
Do not introduce a second branch naming convention for this workflow.

Recommended start:

```bash
git fetch origin main
git checkout -b feat/<topic> origin/main
```

Use:

1. `feat/<topic>` for features
2. `fix/<topic>` for bug fixes
3. `docs/<topic>` for documentation work
4. `chore/<topic>` for maintenance work
5. `spike/<topic>` for uncertain experiments

## Planning Against the Issue

Translate the issue into concrete work units before implementation begins.

For each unit, define:

1. Goal
2. Files or modules likely to change
3. Proving tests
4. Risks or unanswered questions

If the issue requires architectural or ambiguous direction, open a QA card or ADR according to the repository workflow.

## Draft PR Timing

Open a Draft PR early, as required by repository policy.
Do not wait until the final commit.

The Draft PR should include:

1. `## Linked Issue` with `Closes #<number>` when appropriate
2. Current scope and non-goals
3. Validation status
4. Risks and rollback notes

## Commit and Issue Linking

Keep commit subjects clean and repository-compliant.

Use:

1. Commit subject: `type(scope): summary`
2. Commit footer or body: `Refs #<issue-id>`
3. PR body: `Closes #<issue-id>`

Avoid putting `#<issue-id>` directly into the commit subject if that conflicts with the repository's commit style.

## Progress Updates

Update the issue or Draft PR when these happen:

1. The spec changed
2. A risk or blocker was discovered
3. The validation strategy changed
4. A handoff is needed

Good progress updates are short and factual:

```md
Progress update:
- Completed:
- In progress:
- Validation run:
- Blockers or open questions:
```

## End of Session Handoff

If work pauses, leave a recoverable state.

Recommended handoff:

```md
## Handoff
- Completed:
- Remaining:
- Validation completed:
- Known blockers:
- Next recommended step:
```

## Common Mistakes

Avoid these issue-driven workflow failures:

1. Starting implementation from a title only
2. Defining branch or commit conventions that conflict with repository policy
3. Waiting too long to open the Draft PR
4. Leaving issue and PR state behind the actual implementation state
