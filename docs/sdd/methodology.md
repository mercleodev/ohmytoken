# Spec-Driven Delivery Methodology

This document expands the quick start into a repeatable workflow for issue-driven implementation.
It is intentionally agent-neutral and should be used together with repository policy documents, not instead of them.

## Principles

1. Define the behavior before changing code.
2. Make failure modes explicit before implementation.
3. Reuse existing patterns by default.
4. Choose the smallest test layer that can prove the change.
5. Validate every logical unit before treating it as complete.

## Inputs Required Before Coding

For non-trivial work, capture these inputs in the issue body, Draft PR, or working notes:

1. Problem
2. Expected outcome
3. Acceptance criteria
4. Failure modes
5. Constraints
6. Non-goals

If any of those are unclear, ask before implementing behavior that would be difficult to undo.

## Phase 1: Capture the Spec

Start from the issue, bug report, or user request.
The goal of this phase is not to generate a perfect document.
The goal is to remove ambiguity that would otherwise produce the wrong change.

### Questions to Resolve

Ask focused questions when the source material does not answer:

1. What user-visible or system-visible behavior must change?
2. What should happen when the happy path fails?
3. What boundaries must remain intact?
4. What is explicitly out of scope?

### Spec-Ready Criteria

The spec is ready when all of these are true:

1. At least one concrete acceptance criterion exists.
2. At least one meaningful failure mode is defined.
3. Existing architectural constraints are named.
4. Non-goals prevent accidental scope expansion.

### Suggested Spec Format

```md
## Problem
- Current behavior or gap

## Expected Outcome
- Desired end state

## Acceptance Criteria
- Observable check 1
- Observable check 2

## Failure Modes
- Failure case 1 -> expected fallback or error behavior
- Failure case 2 -> expected fallback or recovery behavior

## Constraints
- Existing module, boundary, dependency, or performance rule

## Non-goals
- Out-of-scope behavior
```

## Phase 2: Align With the Repository

Before planning implementation, inspect the relevant modules and repository rules.

### Required Alignment Checks

1. Identify whether the work is `reuse`, `adapt`, or `rewrite`.
2. Confirm the touched area's current naming and folder conventions.
3. Check whether the change crosses Electron main, preload, IPC, DB, proxy, or renderer boundaries.
4. Check which docs or tests must be updated with the change.

### Reuse-First Rule

For migration or parity work, default to the reuse-first process from `CONTRIBUTING.md`:

1. Reuse stable behavior when possible.
2. Adapt existing modules before inventing new structure.
3. Rewrite only with explicit technical justification.

## Phase 3: Plan the Validated Units

Break the work into small units that can be validated independently.
Avoid large plans that only become testable at the very end.

### Good Unit Characteristics

1. One primary behavior change
2. Clear touched files
3. Clear proving tests
4. Small rollback surface

### Planning Template

```md
## Plan

### Unit 1
- Goal:
- Touched files:
- Validation:
- Risk:

### Unit 2
- Goal:
- Touched files:
- Validation:
- Risk:

## Open Questions
- None
```

### When to Ask More Questions

Stop and clarify if any of these appear during planning or implementation:

1. The spec does not define expected behavior.
2. The change requires a new dependency or new architectural pattern.
3. Existing modules suggest two plausible but different implementations.
4. There is a UX, data-loss, or security tradeoff that is not already decided.

## Phase 4: Choose the Smallest Proving Test Layer

Do not force everything into Playwright.
Pick the cheapest layer that can prove the requirement.

| Change type | Primary proving layer | Notes |
| --- | --- | --- |
| Pure function, parser, calculator, utility | Vitest unit test | Add a failing test first when behavior changes |
| DB access, adapter, schema behavior | Vitest integration-style test | Keep isolation tight and deterministic |
| IPC contract, Electron main/preload integration | Vitest plus targeted E2E when needed | Follow the `types -> main -> preload -> renderer` order |
| Proxy intercept to DB to UI roundtrip | Playwright Electron E2E | Follow `.claude/rules/e2e-test.md` |
| User-visible dashboard/settings flow | Playwright Electron E2E | Keep selectors stable and intentional |

## Phase 5: Implement in Validated Increments

For each unit:

1. Add or update the proving test first when behavior changes.
2. Implement the smallest code change that satisfies the unit.
3. Run the validation required for that unit.
4. Update docs when contracts or behavior changed.
5. Commit only after the unit is validated.

### Commit Guidance

Follow repository commit rules:

1. Use `type(scope): summary`.
2. Keep issue links in the commit body or footer, for example `Refs #123`.
3. Use `Closes #123` in the PR body, not in the commit subject.

## Phase 6: Validate Before Declaring Completion

### Default Code-Touch Baseline

```bash
npm run typecheck
npm run lint
npm run test
```

### Add Playwright When Applicable

Add Playwright validation when the change touches:

1. Cross-process user flows
2. Proxy roundtrips
3. Real-time renderer updates
4. Settings persistence
5. Behavior explicitly covered by `.claude/rules/e2e-test.md`

### Completion Review

Use these together:

1. `scripts/completion-gate.sh`
2. `.claude/docs/checklists/*.md`
3. [style-checklist.md](./style-checklist.md)

## Phase 7: Record the State Before You Pause

If work pauses mid-stream, leave a recoverable state in the issue, PR, or handoff note.

Recommended handoff format:

```md
## Handoff
- Completed:
- Remaining:
- Validation already run:
- Known risks or blockers:
- Next recommended step:
```

## Anti-Patterns

Avoid these common failures:

1. Treating the issue title as a complete spec
2. Inventing a second branch or commit convention that conflicts with repository policy
3. Requiring E2E for changes that are fully provable at unit level
4. Rewriting stable modules without reuse-first analysis
5. Declaring completion without aligning tests, docs, and issue/PR state
