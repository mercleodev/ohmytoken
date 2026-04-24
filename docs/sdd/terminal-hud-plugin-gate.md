# Terminal HUD Plugin — Per-Spec Test Gate (Issue #301)

This document is the **repo-authoritative gate contract** for the Terminal HUD
Plugin epic (Issue #301). The full design lives in the local-only brainstorm
note `idea/terminal-hud-plugin.md` (kept local per `.gitignore` policy); this
file exists so PR reviewers, Stop hooks, and other agents/sessions can enforce
the same workflow.

All commits and PRs under Issue #301 MUST comply with this document. When this
file and `.claude/rules/sdd-workflow.md` / `.claude/rules/agent-browser-qa.md`
disagree, the stricter rule applies.

---

## 1. Unit Gate — 5 Steps (every spec unit)

Every spec unit (one behavior change + its proving test) must pass the
following five steps in order. No step is optional.

1. **Red** — Write a failing test for the target behavior first. Extending an
   existing spec is fine; a new file is fine. Capture the failing output in
   the PR's `## Test Evidence` section.
2. **Implement** — Edit/create only the files the unit explicitly owns. Do not
   touch files owned by a different unit.
3. **Validate** — `npm run typecheck && npm run lint && npm run test` must all
   pass (see `.claude/rules/commit-checklist.md`).
4. **Gate (agent-browser)** — If §2 says the unit requires a gate, run
   agent-browser headed once and archive evidence under
   `docs/qa/runs/<YYYY-MM-DD>/<unit-id>/`. If not required, write
   `N/A — unit test sufficient` in the commit body.
5. **Commit** — One unit = one commit. Message format:
   `<type>(hud): <unit-id> <summary> (#301)`. Do not squash multiple units
   into one commit — rollback granularity depends on this.

## 2. Agent-browser Gate Applicability

- **N/A (vitest only)** — Units with no UI surface: event-bus server/client,
  Ink reducers/formatters tested in isolation, schema definitions, CLI
  scaffold, emit timing logic. Covers Phase 0 entirely, most of Phase 1,
  emit work in Phase 3, formatter work in Phase 5.
- **Mandatory — full-stack Electron** — Any unit that depends on real
  Electron IPC / windows / tray / notifications / `globalShortcut`. Run
  `bash scripts/qa-launch-electron.sh` then `agent-browser connect 9222`.
  Covers Phase 2 TUI↔main linkage, all of Phase 4, Phase 5 real notification
  path, Phase 6 UI parity.
- **Mandatory — renderer-only** — Renderer-only UI additions/changes. Run
  `bash scripts/qa-launch-renderer.sh` then
  `agent-browser open http://localhost:5173 --headed`. Limited to Phase 3
  settings UI.

Evidence format follows `.claude/rules/agent-browser-qa.md §4` verbatim
(screenshot + snapshot JSON + mode + build SHA).

## 3. Phase 0 — Spec Unit Decomposition

Phase 0 has no UI surface, so every unit is vitest-only. Each unit must stay
within the listed file scope.

| Unit  | Scope (files)                                                                                       | Red test                                                                     | Gate                | Commit message                                                       |
| ----- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------- |
| P0-1  | `electron/eventBus/events.ts`                                                                       | `events.spec.ts` — HudEvent union discriminator roundtrip                    | N/A                 | `feat(hud): P0-1 add HudEvent union types (#301)`                    |
| P0-2  | `electron/eventBus/server.ts` (+ `__tests__/server.spec.ts`)                                        | boot → subscribe → snapshot → close, loopback only, reject wrong token       | N/A (server vitest) | `feat(hud): P0-2 add loopback WebSocket event bus server (#301)`     |
| P0-3  | `electron/eventBus/client.ts`                                                                       | `client.spec.ts` — emit → server queue → subscriber receives                 | N/A                 | `feat(hud): P0-3 add event bus emit client (#301)`                   |
| P0-4  | `electron/main.ts` (app-ready hook only)                                                            | main hook test or dry-run smoke                                              | N/A (ready hook)    | `feat(hud): P0-4 boot event bus on app ready (#301)`                 |
| P0-5  | `electron/store.ts` (HudConfig added)                                                               | `store.spec.ts` — defaults/persist/reload                                    | N/A                 | `feat(hud): P0-5 add HudConfig with loopback defaults (#301)`        |
| P0-6  | root `package.json` workspaces + `packages/oht-cli/{package.json,tsconfig.json,src/bin.ts}`        | `bin.spec.ts` — `--version`/`--help` stdout shape                            | N/A (CLI stdout)    | `chore(cli): P0-6 scaffold packages/oht-cli workspace (#301)`        |

**Phase 0 exit**: all 6 unit commits landed + Draft PR opened from
`feat/terminal-hud-plugin` using the 11-section template
(`OPEN-SOURCE-WORKFLOW.md §6`).

## 4. Phase 1–6 Gate Summary

When entering each later Phase, expand that phase to the same level as §3
(file scope / red test / gate / commit message) in a docs-only commit before
writing code. Resolve the relevant open questions from the design note §15
and promote the decision to `docs/decisions/` when appropriate.

- **Phase 1** — Provider-neutral schema + emit wiring. Gate: **N/A
  (vitest)**. Verify with spies that Claude/Codex/Gemini paths emit the
  expected events.
- **Phase 2 (L1 Sidecar TUI)** — Ink components + reducer. Gate:
  **Mandatory full-stack Electron**. While the TUI runs, terminate the
  Electron main process and confirm the TUI shows `disconnected`, then
  recovers on reconnect. Evidence = agent-browser screenshot + terminal
  recording.
- **Phase 3 (HudConfig settings UI)** — Add a toggle / port / shortcut card
  to the renderer. Gate: **Mandatory renderer-only**. Screenshots for
  empty / loading / success / error states + post-save rerender.
- **Phase 4 (L2 Summon Mode)** — `globalShortcut` registration + hide/show
  on the existing BrowserWindow. Gate: **Mandatory full-stack**. Trigger
  the shortcut 5× to confirm the window toggles show/hide, closing hides
  instead of quitting, and the tray path still works.
- **Phase 5 (L3 Notification narrowing)** — Block all notifications outside
  the three approved categories. Gate: **Vitest (trigger logic) + manual or
  agent-browser evidence for real notification path**. Attach screenshots
  of the actual emitted notifications.
- **Phase 6 (L4 statusLine + Gemini watcher bonus)** — `oht statusline`
  binary + Gemini watcher. Gate: **Vitest (formatter/watcher) + manual
  Claude Code run or agent-browser UI parity**. Verify real output through
  Claude's official statusLine hook.

## 5. Rollback Principles

- Every unit is an independent commit, so `git revert <sha>` restores the
  previous state.
- Each Phase boundary is preserved as a Draft-PR merge commit so whole
  phases can be reverted atomically.
- `feat/terminal-hud-plugin` is the epic umbrella branch. Higher-risk phases
  (2, 4) may branch off as sub-branches such as
  `feat/terminal-hud-plugin/phase-2-tui` and merge back when green.
- The event bus must default to OFF (`HudConfig.enabled: false`) so a
  single config toggle can disable the plugin end-to-end if anything breaks
  in production.

## 6. Updating This Document

During implementation this doc will be updated as knowledge accrues. Follow
these rules:

1. Before entering a new Phase, expand its §4 entry to §3-level detail in a
   **docs-only commit**. No code commits start until that docs commit has
   landed.
2. Every implementation commit message must reference its unit id and
   `(#301)`.
3. When an open question from the design note §15 is resolved, promote the
   answer to an ADR under `docs/decisions/` and link it from the design
   note. Do not delete history — rewrite the §15 bullet as
   `RESOLVED → ADR-xxxx`.
