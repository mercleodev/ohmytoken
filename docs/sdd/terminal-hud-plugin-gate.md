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
  (vitest)** for P1-1~P1-5; **Mandatory full-stack Electron** for P1-6
  (integration). Claude only this phase; Codex/Gemini follow once the
  P1-1 ProviderEmitter contract is stable. See §8 for the §3-level
  unit decomposition.
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

## 7. Concept Verification Track — P1-mini + P6-mini

After Phase 0 landed (commits up to `2077451`) the user explicitly asked to
prove the end-to-end pipeline before committing to the full Phase 1 → Phase 6
sequence. The motivation is product-validation: confirm that an `oht
statusline` line *can* render inside Claude Code today, even if the data is
sparse, before investing in Phase 1's full emit-site wiring.

This adds two off-sequence units that pull a thin slice from Phase 1 and
Phase 6. They DO NOT replace the canonical phases — both will be rewritten
when their full phases run. The mini units exist purely to de-risk the
concept.

### 7.1 Rationale and non-goals

- **Goal**: a user with the OhMyToken Electron app running sees a single
  meaningful line in their Claude Code status line (e.g.
  `oht: connected · claude · sess-abcd1234`). A user without the app
  running sees `oht: OhMyToken not running`.
- **Not a goal**: real token / cost / latency numbers. Those land with
  Phase 1's emit sites and Phase 6's full formatter. P6-mini deliberately
  ships a one-line snapshot reader and nothing more.
- **Not a goal**: TUI. P2 is unaffected.
- **Not a goal**: provider auto-detection. P1-mini hardcodes
  `provider: 'claude'` because that's what the app is instrumented for
  today; revisiting belongs to §15 Q4 / Phase 1 entry.

### 7.2 Spec units

| Unit     | Scope (files)                                                                                                | Red test                                                                                | Gate                                                                                                                  | Commit message                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1-mini  | `electron/eventBus/sessionState.ts` + `electron/main.ts` (snapshot + heartbeat wiring)                       | `sessionState.spec.ts` — set/clear/snapshot/emit on state change, fresh-subscriber path | N/A (vitest covers helper; main.ts wiring is a deterministic call site)                                               | `feat(hud): P1-mini wire active-session snapshot + heartbeat (#301)`                      |
| P6-mini  | `packages/oht-cli/src/statusline.ts` + `packages/oht-cli/src/cli.ts` (statusline subcommand replaces stub)   | `statusline.spec.ts` — connected / not-running / timeout / unexpected-frame fallback    | **Manual** — user confirms the line renders in their Claude Code status line after restart (no automated agent-browser path because the host is Claude Code, not OhMyToken's renderer) | `feat(hud): P6-mini implement oht statusline ws snapshot reader (#301)` |

### 7.3 Rollback

Both units are independent commits, so `git revert <sha>` undoes them
without touching Phase 0. P1-mini's `setActiveSession` becomes the seed for
Phase 1's full emit-site wiring; P6-mini's `runStatusline` becomes the seed
for Phase 6. When those phases enter, the mini units are *replaced in place*
(not extended) and the corresponding §16 docs commit must call the
replacement out so reviewers can see the lineage.

### 7.4 Manual verification protocol (P6-mini gate)

After P6-mini commits land, the user runs:

1. `npm --workspace=@ohmytoken/oht-cli run build` (rebuild dist).
2. `oht statusline` from a terminal with the app NOT running →
   expect `oht: OhMyToken not running` and exit code 2.
3. `npm run electron:dev` in another terminal; wait for the Electron
   window. `oht statusline` again → expect
   `oht: connected · claude · <session-id>` and exit code 0.
4. Restart Claude Code; observe the same line in the Claude Code status
   line. Capture a screenshot under `docs/qa/runs/<YYYY-MM-DD>/p6-mini/`
   and post it on issue #301.

If step 2 or 3 fails, P6-mini must be reverted before any Phase 1 work
begins — the concept verification has not landed yet.

### 7.5 Run record — 2026-04-26 (resume checkpoint)

Branch: `feat/terminal-hud-plugin` (local, 11 commits, not pushed).

Verified end-to-end on 2026-04-26:

- Step 1 (CLI build): pass — `dist/bin.js` produced.
- Step 2 (no-app smoke): pass — `oht: OhMyToken not running`, exit 2.
- Step 3 (app-running): pass on second boot. The first `electron:dev`
  loaded a stale `dist-electron/main.js` produced before tsc had
  finished compiling P1-mini, so port 8781 stayed silent. Fix is a
  hard restart of `electron:dev` once the tsc watcher has emitted at
  least one "Found 0 errors" line. After restart:
  - `lsof -iTCP:8781 -sTCP:LISTEN` → `Electron … LISTEN`
  - `oht statusline` → `oht: connected · claude · ` (empty session id),
    exit 0.
- Step 4 (Claude Code status line eyeball): NOT yet performed — held
  until the cosmetic gap below is fixed so the line is meaningful.

Known cosmetic gap (does not invalidate the concept):

- `electron/main.ts` heartbeat uses
  `getLastActiveSessionId() ?? "unknown"`, but the watcher returns an
  empty string `""` (not `null`) when no session has been observed yet
  during early app startup. `??` only catches nullish, so the empty
  string flows through and the snapshot ships with
  `session_id: ""`. Slicing 12 chars of `""` yields `""`, which is why
  the status line ends with a trailing dot-space. Fix is a one-line
  guard (e.g., switch to `||` or treat empty as missing) in the
  P1-mini heartbeat path. Phase 1 proper will replace the heartbeat
  outright, so the fix can either land as a tiny follow-up commit or
  be absorbed when Phase 1 starts.

Resume plan (next session):

1. Reset chat context (`/clear`) so future work starts cold from this
   record instead of carrying the long verification thread.
2. Pick up "Path B" from the verification dialog: land the empty
   session-id guard, rebuild CLI + Electron, and eyeball the Claude
   Code status line. Capture the screenshot to
   `docs/qa/runs/2026-04-26/p6-mini/` and attach to issue #301.
3. Only after step 2 succeeds, decide between entering full Phase 1 or
   jumping to Phase 2 TUI. Until then, P1-mini and P6-mini stay in
   place per §7.3 rollback principles.

Tooling housekeeping done in this session:

- `~/.claude/settings.json` ← reverted (no project-wide blanket allow).
- `.claude/settings.local.json` ← `Bash(*)` → `Bash`; same fix applied
  to `Read`/`Edit`/`Write`/`Glob`/`Grep`/`WebFetch`. The `(*)` form
  was matching a literal asterisk, not wildcarding, which is why
  permission prompts kept firing despite the entries existing.

### 7.6 Outcome — 2026-04-26 (Path B closed)

- **Path B fix landed**: commit `292b73e` —
  `fix(hud): empty session_id falls through to "unknown" in P1-mini
  heartbeat (#301)`. One-line guard (`??` → `||`); empty strings now
  fall through to `"unknown"` instead of producing a trailing
  dot-space.
- **§7.4 Step 4 verified**: Claude Code status bar shows
  `oht: connected · claude · unknown` after restart. Capture archived
  at `docs/qa/runs/2026-04-26/p6-mini/claude-code-statusline.png`.
- **§7.5 Resume plan Step 3 decision**: enter full **Phase 1**;
  Phase 4 (L2 Summon Mode via `globalShortcut`) follows. Provider
  scope for Phase 1: **Claude only** (Codex/Gemini follow once P1-1
  ProviderEmitter is stable). Data depth: **session id + tokens +
  cost**. See §8 for the §3-level unit decomposition that satisfies
  the §6 entry rule.
- **Permission housekeeping (this session)**: created
  `~/Desktop/pjt/.claude/settings.json` allowing `Bash`/`Read`/`Edit`/
  `Write`/`Glob`/`Grep`/`WebSearch`/`WebFetch` so any new session
  rooted under `~/Desktop/pjt/` (including ohmytoken) inherits the
  allow-list automatically. Global `~/.claude/settings.json` left
  untouched.

## 8. Phase 1 — Spec Unit Decomposition

Phase 1 wires real provider data (session id, token, cost) into the
event-bus pipeline introduced in Phase 0. Provider scope is **Claude
only** for this phase per the 2026-04-26 decision (see §7.6); Codex
and Gemini follow once the P1-1 ProviderEmitter contract is stable.
Data depth is the full triple — session id + tokens + cost.

The unit table follows the §3 format. Lineage notes per §7.3 are
preserved: P1-2 supersedes the P1-mini heartbeat, P1-3 absorbs P1-4
(2026-04-27 — token + cost share the same `events.ts` variants;
see open-question resolution below), and P1-6 absorbs the
cosmetic-fix commit (`292b73e`) once the heartbeat block is removed
entirely.

| Unit | Scope (files) | Red test | Gate | Commit message |
| ---- | ------------- | -------- | ---- | -------------- |
| P1-1 | `electron/eventBus/providerEmitter.ts` + `__tests__/providerEmitter.spec.ts` | register/get/empty registry; provider-id round-trip; emit fan-out to subscribers | N/A (vitest) | `feat(hud): P1-1 introduce ProviderEmitter contract for multi-provider extension (#301)` |
| P1-2 | `electron/eventBus/providers/claude.ts` + `__tests__/claude.spec.ts`; `electron/main.ts` (heartbeat replaced by subscribe) | mock watcher fires session change → setActiveSession called with watcher payload, provider id `"claude"` | N/A (vitest covers helper; main.ts wiring is a deterministic call site) | `feat(hud): P1-2 emit Claude active session changes via ProviderEmitter (#301)` |
| P1-3 | `electron/eventBus/providers/claudeProxyEmit.ts` + `__tests__/providers/claudeProxyEmit.spec.ts`; emit at `electron/proxy/server.ts` `processSseEvents` (`message_delta` + `message_stop` branches — pinned 2026-04-27) | helper packages parsed token + cost values into canonical `proxy.sse.message_delta` / `proxy.sse.message_stop` HudEvent shapes and forwards to `client.emit()`; emit failures must not break SSE passthrough | N/A (vitest) | `feat(hud): P1-3 emit token usage + running cost per Claude proxy response (#301)` |
| ~~P1-4~~ | _Absorbed by P1-3 (2026-04-27)_ — `events.ts` already bundles `cumulative_cost_usd` / `final_cost_usd` into the `proxy.sse.message_delta` / `proxy.sse.message_stop` variants, so token and cost are emitted at the same site using existing `electron/proxy/costCalculator.ts`. No standalone unit. | — | — | — |
| P1-5 | `electron/eventBus/sessionState.ts` (`ActiveSession` adds `output_tokens_total` + `cost_usd_total`; new `accumulateActiveSessionTokens` helper; `setActiveSession` resets totals on `session_id` change) + `electron/eventBus/server.ts` (`SnapshotPayload.current_session` extended — optional / zero-default so `packages/oht-cli/src/statusline.ts:22-23` reader stays valid until P1-6) + `electron/proxy/server.ts` (`processSseEvents` calls accumulator next to `emitClaudeProxyMessageDelta` / `emitClaudeProxyMessageStop` — option A pinned 2026-04-27) + `__tests__/sessionState.spec.ts` (extends existing P1-mini suite) | accumulator emits N token events → snapshot reflects running totals (delta tokens cumulate, cost cumulates from per-request `cumulative_cost_usd` deltas); reset on `session_id` change; existing snapshot shape unchanged when totals=0 | N/A (vitest) | `feat(hud): P1-5 extend snapshot with running token + cost totals (#301)` |
| P1-6 | `electron/main.ts` (heartbeat block removed), `packages/oht-cli/src/statusline.ts` + `__tests__/statusline.spec.ts` | integration: boot Electron + mock proxy intercept → statusline includes session id + token total + cost | Mandatory full-stack Electron (§2) | `feat(hud): P1-6 replace P1-mini with full Claude emit pipeline + token/cost statusline (#301)` |

**Open question (resolved 2026-04-27)**: the proxy completion site
has been pinned to `electron/proxy/server.ts` `processSseEvents` —
specifically the `message_delta` and `message_stop` branches inside
the closure. The function is invoked by both the `proxyRes.on('data')`
stream path and the `proxyRes.on('end')` flush path, so a single
emit-site pair covers all completion modes. Token + cost are emitted
together because `events.ts` bundles them into one variant per event
(P1-4 absorbed — see lineage note above).

**Phase 1 exit**: P1-1, P1-2, P1-3, P1-5, P1-6 unit commits landed
(P1-4 absorbed into P1-3, see table); ProviderEmitter contract
documented; P1-mini superseded (`292b73e` absorbed by P1-6);
`oht statusline` renders
`oht: connected · claude · <session-id-12> · <tokens> · $<cost>`
against a real Claude session; full-stack Electron QA evidence under
`docs/qa/runs/<date>/p1-6/`.

### 8.1 Run record — 2026-04-27 (Phase 1, P1-1 → P1-3 + integration coverage)

| Unit | Commit | Files | Tests | Notes |
| ---- | ------ | ----- | ----- | ----- |
| docs (§4 Phase 1 expand + §7.6 close + §8 add) | `cc72fb4` | `docs/sdd/terminal-hud-plugin-gate.md` | — | §6 entry rule satisfied (docs-only commit precedes Phase 1 code) |
| P1-1 | `21a6122` | `electron/eventBus/providerEmitter.ts` + `__tests__/providerEmitter.spec.ts` | +10 vitest | ProviderEmitter contract; multi-provider extension foundation |
| P1-2 | `b0e0699` | `electron/eventBus/providers/claude.ts` + `__tests__/providers/claude.spec.ts`; `electron/main.ts` wiring | +8 vitest | P1-mini heartbeat replaced; `oht statusline` confirmed real session id `aa075cc4-3e1` against running Electron |
| docs (§8 P1-4 absorption) | `1e4921b` | `docs/sdd/terminal-hud-plugin-gate.md` | — | Resolved after `events.ts` review: token + cost bundle into the same `proxy.sse.message_delta` / `proxy.sse.message_stop` variants; P1-4 absorbed |
| P1-3 | `59dbf8e` | `electron/eventBus/providers/claudeProxyEmit.ts` + `__tests__/providers/claudeProxyEmit.spec.ts`; `electron/proxy/server.ts` (`processSseEvents` `message_delta` + `message_stop` branches) | +6 vitest | Helper packages canonical HudEvent variants; emit failures wrapped in try/catch so SSE passthrough is preserved |
| P1-3 sanity (test-only) | `59ab1e0` | `electron/proxy/__tests__/serverEmit.integration.spec.ts` | +2 vitest | Production proxy code drives a mock SSE upstream → emit helpers spied; covers delta monotonicity (30 → 20 = 50−30), `request_id` consistency across delta+stop, and non-/v1/messages no-op |

**Validation baseline (P1-3 close)**: typecheck PASS · lint clean on
changed files (pre-existing errors in `scripts/check-pr-*.mjs`,
`scripts/check-pr-policy.mjs`, `electron/tray.ts`,
`electron/watcher/statsCacheReader.ts`,
`src/components/dashboard/SessionDetailView.tsx`,
`electron/proxy/mockServer.ts` left untouched per
`commit-checklist.md`) · tests **316 passed | 3 skipped** (308 baseline
→ +8 net = 6 helper + 2 integration).

**Deferred to P1-6 full-stack gate (§2)**: emit-frame visibility on
the running Electron ws bus. The integration spec at `59ab1e0` covers
the same emit path through production proxy code, and Path B already
verified the bus fan-out via `session.provider.active`, so the
residual P1-3 runtime risk is bounded.

**Pinned for P1-5 first sub-step**:
- `electron/eventBus/sessionState.ts:15-19` — `ActiveSession` interface needs `output_tokens_total` + `cost_usd_total`
- `electron/eventBus/server.ts:7-11` — `SnapshotPayload.current_session` shape extension (loopback-coupled with `packages/oht-cli/src/statusline.ts:22-23`, but statusline upgrade is P1-6 scope; P1-5 keeps additions optional/zero-default so the existing reader stays valid)
- Accumulator wiring choice (open question for P1-5 first sub-step): same site as `emitClaudeProxyMessageDelta` in `electron/proxy/server.ts` (mirrors P1-3 pattern, tightly coupled) **vs.** a `proxy.sse.*` subscriber in `electron/main.ts` (clean separation). Decide before writing the red test.

**P1-5 entry decision (2026-04-27)**: option A pinned —
accumulator wiring lives at the same emit-site as
`emitClaudeProxyMessageDelta` / `emitClaudeProxyMessageStop` in
`electron/proxy/server.ts` `processSseEvents`. Rationale: per-request
`cumulative_cost_usd` is already computed there (the delta calculation
needs `prevCumulativeCost`, which only the proxy site holds), so a
ws-subscriber in `main.ts` would have to re-derive the same delta from
event payloads and add an extra hop. Coupling between proxy and
`sessionState` is acceptable because both are owned by the main
process; the alternative trades zero coupling reduction for double
work. Cost accumulation strategy: token deltas cumulate from
`delta_output_tokens`; cost cumulates from `cumulative_cost_usd` minus
the per-request running baseline (so live UX during a stream reflects
incremental cost, and the `message_stop` final value lands without
double-counting).
