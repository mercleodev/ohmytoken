# Spec-Driven Testing Guide

This guide explains how to turn a spec into verification that matches the current OhMyToken repository setup.

It is aligned with:

1. `package.json` scripts
2. `playwright.config.ts`
3. `.claude/rules/e2e-test.md`
4. `.claude/docs/checklists/*.md`

## Core Rule

When behavior changes, add or update the proving test before considering the implementation complete.
Pick the smallest layer that can prove the requirement with confidence.

## Choose the Right Test Layer

| Change type | Primary tool | Why |
| --- | --- | --- |
| Utility, parser, calculator, formatter | Vitest | Fast, deterministic, local |
| DB writer/reader behavior, adapters, schema logic | Vitest | Easier to isolate than full E2E |
| React hook or component logic | Vitest | Tight feedback loop |
| IPC boundary or preload contract | Vitest plus targeted E2E if needed | Validate contract first, full flow only when required |
| Proxy intercept to DB to UI roundtrip | Playwright Electron E2E | Proves multi-layer behavior |
| User-visible dashboard/settings behavior | Playwright Electron E2E | Confirms actual app behavior |

## Current Repository Commands

Default baseline:

```bash
npm run typecheck
npm run lint
npm run test
```

Electron Playwright:

```bash
npm run test:e2e
npm run test:e2e:headed
```

Targeted Playwright iteration:

```bash
npx playwright test e2e/electron.spec.ts
```

Do not invent a parallel `tests/e2e/` layout for this repository unless the project structure is intentionally changed first.

## Current Test Layout

Existing patterns in this repository include:

```txt
e2e/
  electron.spec.ts
electron/
  backfill/__tests__/
  db/__tests__/
  evidence/__tests__/
src/
  utils/__tests__/
  components/dashboard/__tests__/
```

Follow the nearest existing pattern in the touched area.

## Red-First Rule

For behavior or contract changes:

1. Add a failing test first when practical.
2. Confirm the failure represents the intended gap.
3. Implement the fix.
4. Re-run the proving test and the required baseline.

If a failing test cannot be written first, explain why in the PR or handoff notes and add the regression coverage immediately after the fix.

## Playwright Rules for OhMyToken

When Playwright is required, follow the existing repository rule:

1. Use headless Playwright for fast debug loops.
2. Run one headed validation before declaring completion.
3. Report headless and headed outcomes separately.

Those requirements come from `.claude/rules/e2e-test.md` and are not replaced by this document.

## Electron and Cross-Process Flows

Use Playwright when the change must prove one of these:

1. Electron app launch and renderer readiness
2. Proxy intercept to DB write to UI roundtrip
3. Real-time updates from main process to renderer
4. Settings persistence across restart
5. Multi-provider behavior visible in the UI

For proxy or data-flow changes, also follow the roundtrip expectation in `.claude/rules/e2e-test.md`.

## Selector Guidance

Use stable selectors.
`data-testid` is appropriate when semantic selectors are not stable enough for the flow you need to validate.

Good:

```ts
await page.getByTestId("provider-filter");
```

Acceptable when semantics are strong:

```ts
await page.getByRole("button", { name: "Save" });
```

Avoid brittle selectors:

```ts
await page.locator(".some-presentational-class");
```

## Spec-to-Test Mapping

A good test plan covers:

1. Each primary acceptance criterion
2. The most meaningful failure or recovery behavior
3. At least one regression guard for the changed path

Example:

```md
Acceptance:
- Proxy intercept writes usage data for provider X
- Dashboard displays the new usage entry

Failure mode:
- Missing usage payload does not crash the pipeline

Tests:
- Vitest parser test for payload extraction
- Vitest DB writer test for stored values
- Playwright roundtrip test for intercept -> DB -> UI
```

## Completion Checklist

Before closing the work, confirm:

1. The proving tests match the actual spec
2. `npm run typecheck`, `npm run lint`, and `npm run test` were run for code-touch work
3. Playwright was run when the change touched cross-process or user-visible behavior
4. Headless and headed Playwright outcomes are reported separately when applicable
5. New tests follow the repository's existing layout and naming patterns
