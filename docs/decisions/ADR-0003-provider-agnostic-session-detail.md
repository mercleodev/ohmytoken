# ADR-0003: Provider-Agnostic Session Detail View

**Status:** Proposed
**Date:** 2026-03-03
**Author:** claude

---

## Context

When clicking a Codex prompt on the dashboard, the session detail page does
not render. Claude prompts work correctly (dashboard → session detail →
prompt detail). Codex shows nothing despite having 498 prompts and 33 sessions
in the DB.

This ADR covers: root cause analysis, current plugin architecture assessment,
and the implementation plan to make session detail provider-agnostic.

---

## Current Plugin Architecture Assessment

### Layer-by-Layer Status

| Layer | Abstraction | Gemini Addition Cost |
|---|---|---|
| **Backfill Engine** (`electron/backfill/`) | ✓ Fully plugin-based | 3 files: parser, plugin, registry entry |
| **DB** (`electron/db/`) | ✓ Fully agnostic | No changes needed |
| **IPC Handlers** (`electron/main.ts`) | ~ Mostly agnostic | Minor init/polling tweaks |
| **Usage Store** (`electron/usageStore.ts`) | ~ Partial | Add `fetchByProvider` branch |
| **Frontend Dashboard** (`src/components/dashboard/`) | ~ Partial | Mostly works, some Claude hardcodes |
| **Session Detail** (`SessionDetailView.tsx`) | ✗ Claude-only | **This ADR's scope** |
| **History Handlers** (`main.ts` L463-637) | ✗ Claude-only | ~400 lines of Claude JSONL parsing |

### Architecture Verdict

The core architecture IS a proper layered plugin system. Adding Gemini
requires only:

1. `electron/backfill/parsers/gemini.ts` — parser (new)
2. `electron/backfill/plugins/gemini.ts` — plugin (new)
3. `electron/backfill/plugins/registry.ts:12` — 1 line addition

Everything else (DB, IPC, dashboard tabs, provider badges, filtering) works
automatically. The **one broken layer** is SessionDetailView, which bypasses
the generic DB layer and goes directly through Claude's history.jsonl file.

---

## Root Cause — 5 Break Points

### B1 (Critical) — SessionDetailView loads from Claude-only history source

**`src/components/dashboard/SessionDetailView.tsx:107-109`**

```typescript
const allHistory = await window.api.getRecentHistory(500);
const sorted = allHistory
  .filter((e) => e.sessionId === sessionId);  // always [] for Codex
```

`getRecentHistory()` reads `~/.claude/history.jsonl` exclusively. Codex
sessions live in `~/.codex/sessions/` and never appear in Claude's history.

### B2 (Critical) — Empty entries skips prompt loading loop

**`SessionDetailView.tsx:122-149`**

```typescript
for (const entry of deduped) {  // deduped = [] for Codex → loop skipped
  const detail = await window.api.getHistoryPromptDetail(...);
}
// messages = [], hasScanData = false → blank page
```

### B3 (Secondary) — getHistoryPromptDetail JSONL fallback is Claude-only

**`electron/main.ts:598-637`**

Searches `~/.claude/projects/{dir}/{sessionId}.jsonl` only. Codex sessions
in `~/.codex/sessions/` are never searched.

### B4 (Secondary) — DB lookup rejects Codex due to system_tokens check

**`electron/main.ts:606-613`**

```typescript
if (dbMatch && dbMatch.context_estimate.total_tokens > 0
    && dbMatch.context_estimate.system_tokens > 0)  // Codex: always 0
```

Codex backfill sets `system_tokens = 0`. This condition silently skips valid
Codex DB records even when found.

### B5 (Minor) — Real-time listener is Claude-only

**`SessionDetailView.tsx:167-223`**

`onNewHistoryEntry` fires only for `~/.claude/history.jsonl` changes.

---

## Codex Data Structure in DB

| Field | Codex | Claude | Notes |
|---|---|---|---|
| `total_context_tokens` | >0 | >0 | Both populated |
| `input_tokens` | >0 | >0 | Both populated |
| `output_tokens` | >0 | >0 | Both populated |
| `cost_usd` | >0 | >0 | Both populated |
| `user_prompt` | ≤500 chars | Full text | Codex truncated |
| `model` | `o4-mini`/`o3` | `claude-*` | Both populated |
| `system_tokens` | **0** | >0 | Codex doesn't track |
| `messages_tokens` | **0** | >0 | Codex doesn't track |
| `assistant_response` | **null** | Text | Codex not captured |
| `cache_creation_input_tokens` | **0** | Variable | Codex: cacheWrite=0 |

---

## Implementation Plan

### Phase 1 — DB-First Loading Path (P0, Critical)

**File:** `src/components/dashboard/SessionDetailView.tsx`
**Goal:** When history entries are empty (non-Claude), use DB as primary source.

```typescript
// In load() function — add BEFORE existing history-based code:

// Step 1: DB-based loading (provider-agnostic, works for all)
const dbScans = await window.api.getPromptScans({
  session_id: sessionId,
  limit: 200,
});

if (dbScans.length > 0) {
  const items: MessageItem[] = dbScans.map((scan) => ({
    scan,
    usage: null,
  }));
  const displayItems = items.filter((m) => isDisplayablePrompt(m.scan));
  if (displayItems.length > 0) {
    setHasScanData(true);
    setMessages(displayItems);
    setLoading(false);
    return;  // Skip Claude history path
  }
}

// Step 2: Existing Claude history-based path (unchanged)
const allHistory = await window.api.getRecentHistory(500);
// ...
```

**Risk:** Low — Claude path completely unchanged. DB fallback only activates
when history entries are empty.

**Extensibility:** Gemini data in DB → automatically renders. No per-provider
code needed.

---

### Phase 2 — Fix system_tokens Check (P0, Trivial)

**File:** `electron/main.ts:608`

```diff
- dbMatch.context_estimate.total_tokens > 0 && dbMatch.context_estimate.system_tokens > 0
+ dbMatch.context_estimate.total_tokens > 0
```

Allows DB prompt detail lookup for Codex. No Claude regression
(Claude always has system_tokens > 0).

---

### Phase 3 — Real-Time Listener for Non-Claude Sessions (P1)

**File:** `src/components/dashboard/SessionDetailView.tsx`

```typescript
// Add alongside existing onNewHistoryEntry:
const cleanup2 = window.api.onNewPromptScan(({ scan }) => {
  if (scan.session_id !== sessionId) return;
  // Add/update message in list
});
```

Enables live updates for Codex/Gemini sessions.

---

### Phase 4 — PromptDetailView Codex Compatibility (P1)

**File:** `src/components/dashboard/PromptDetailView.tsx`

Verify and adapt:
- Token breakdown: hide sections when breakdown fields are 0
- `assistant_response`: hide response section when null
- Cost/model display: already works (both populated)

---

### Phase 5 — CacheGrowthChart Verification (P2)

**File:** `src/components/dashboard/CacheGrowthChart.tsx`

`getSessionTurnMetrics(sessionId)` — verify returns Codex data.
Chart is provider-agnostic but may show different patterns
(Codex has `cache_read_tokens` but no `cache_creation`).

---

## Priority & Effort

| Phase | Priority | Effort | Files Changed |
|---|---|---|---|
| 1. DB-first loading | P0 | Small | SessionDetailView.tsx |
| 2. system_tokens fix | P0 | Trivial (1 line) | main.ts |
| 3. Real-time listener | P1 | Small | SessionDetailView.tsx |
| 4. PromptDetail compat | P1 | Medium | PromptDetailView.tsx |
| 5. Chart verification | P2 | Small | CacheGrowthChart.tsx |

**Total: 3 files to change.** Claude behavior untouched.

---

## Testing Plan

1. Codex session detail: click Codex prompt → session detail renders
2. Codex prompt detail: click prompt in session → detail renders with
   available token info, empty sections hidden
3. Claude regression: verify Claude flow identical to current
4. All tab → Codex session: navigate correctly
5. Real-time: new Codex prompts appear in open session detail

---

## Decision

**Selected approach:** DB-first loading with Claude history fallback.

**Rationale:** The DB layer is already provider-agnostic. By using it as the
primary source for session detail, we get Codex (and future Gemini) support
with minimal code changes and zero Claude regression risk.

This aligns with the project's existing pattern: RecentSessions already uses
`buildPromptItemsFromScans` (DB-based) for non-Claude providers after the
commit 1856a9c fix.
