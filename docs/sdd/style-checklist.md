# Manual Style Checklist for Spec-Driven Delivery

Use this checklist as a human or agent review layer after the automated gates.
It complements `eslint`, `typecheck`, `vitest`, Playwright, and `.claude/docs/checklists/*.md`.

## Scope

Apply this checklist to changed files that need manual review, especially:

1. `*.ts`
2. `*.tsx`
3. Public markdown changed as part of the task

## Checklist

### Type Safety

| ID | Check |
| --- | --- |
| TS-01 | No new `any` is introduced in touched lines unless it is a narrow bridge with an explicit reason |
| TS-02 | Type-only imports are used where the codebase and toolchain support them |
| TS-03 | IPC or preload surface changes are reflected in `src/types/electron.d.ts` when applicable |
| TS-04 | Type assertions are minimal and replaced with narrowing where reasonable |

### Architecture and Boundaries

| ID | Check |
| --- | --- |
| AR-01 | Electron main-process code does not depend on renderer-only modules |
| AR-02 | IPC changes follow the repository order: types -> main -> preload -> renderer |
| AR-03 | Proxy, DB, and provider changes preserve existing transport-agnostic and provider-aware boundaries |
| AR-04 | Reuse/adapt/rewrite decisions are explicit for migration or parity work |

### Naming and File Placement

| ID | Check |
| --- | --- |
| NM-01 | New files follow the local naming convention of the touched directory |
| NM-02 | Existing files are not renamed only for stylistic normalization in unrelated work |
| NM-03 | Tests are placed using the repository's current patterns (`__tests__`, `*.spec.ts`, `e2e/`) |

### Imports and Dependencies

| ID | Check |
| --- | --- |
| IM-01 | No new dependency is introduced without an explicit technical reason |
| IM-02 | Imports do not cross boundaries in a way that couples unrelated layers |
| IM-03 | Sensitive modules, tokens, or credentials are not exposed through logs or convenience imports |

### Reliability and UX

| ID | Check |
| --- | --- |
| UX-01 | Async UI changes handle loading, error, and empty states when relevant |
| UX-02 | Event listeners, intervals, and subscriptions are cleaned up correctly |
| UX-03 | Error handling matches the defined failure modes instead of silently swallowing errors |

### Documentation and Workflow

| ID | Check |
| --- | --- |
| DOC-01 | Behavior or contract changes are reflected in tests and docs |
| DOC-02 | Public markdown additions or renames are reflected in `.public-docs-allowlist` |
| DOC-03 | Issue/PR text stays in English and matches actual implementation state |

## Result Format

Use a structured pass/fail report:

```text
path/to/file.ts
  PASS TS-01: no new any in touched lines
  PASS AR-02: IPC update order preserved
  FAIL UX-03: failure mode missing for DB write error
```

## Review Rule

If one or more checklist items fail:

1. Fix the issue or document why the checklist item is not applicable.
2. Re-run the relevant automated validation.
3. Re-check the manual checklist items affected by the fix.
