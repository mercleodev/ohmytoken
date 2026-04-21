# OhMyToken

**Track AI coding agents locally — no account connection required.**

A privacy-first usage monitor for Claude, Codex, and Gemini. OhMyToken starts tracking the moment you run a CLI session. No login, no OAuth, no cloud sync. Connect a provider account later if you want plan quotas and reset timing on top.

Built with Electron + React. Runs locally on macOS.

---

## Why OhMyToken

- **Start tracking in one step** — watches your provider's local session logs. No account hookup to see cost, context, and prompt history.
- **Local-only** — every byte stays on your machine. SQLite on disk, no telemetry, no remote sync.
- **One dashboard for all three providers** — Claude, Codex, and Gemini side by side.
- **Account insights are optional** — connect a provider account anytime to add plan quotas, weekly windows, and credit balance on top of runtime tracking.

---

## What It Does

OhMyToken pulls usage from up to three data sources and merges them into a single local dashboard:

1. **Session file watchers (primary, no account needed)** — tails `~/.claude/` and `~/.codex/sessions/` as you use the CLIs. Gemini is covered by the proxy layer today; a dedicated session watcher is planned.
2. **Local HTTP proxy (`localhost:8780`)** — intercepts API traffic across all three providers for real-time token capture and cost computation.
3. **Provider account APIs (optional)** — when connected, pulls plan type, usage windows, reset timing, and credit balance.

Everything lands in a local SQLite DB. The dashboard reads from the DB.

---

## Key Features

### Always-on (runtime tracking, no account needed)

- Multi-provider unified view — Claude, Codex, Gemini
- Cost breakdown — today / last 30 days, USD
- Context window per turn — see how it fills up
- Cache growth chart — cache-read vs cache-create, with compaction markers
- Token composition — cache-read, cache-create, input, output pie
- Prompt heatmap — 365-day activity calendar
- Cost treemap — visual breakdown by prompt
- Session & prompt detail — drill into tool calls, injected files, evidence scores
- MCP insights — tool call analysis
- Session alerts — cache explosion, low efficiency, long session warnings
- Guardrail assessment — evidence-based scoring
- Backfill engine — recover historical usage from session logs

### Optional (when a provider account is connected)

- Radial usage gauges — session / weekly / model quota with reset timing
- Credit balance — API prepaid balance (granted / used / expiry)
- Plan identity — Pro / Max / Team / Free / API

---

## Quick Start

```bash
# Prerequisites: Node.js 22, macOS
nvm use 22
npm install

# Development
npm run electron:dev

# Production build (DMG)
npm run build
```

**First launch:** OhMyToken shows an onboarding screen with a CLI card per provider. Pick one, run a normal session in that CLI, and your first tracked activity appears automatically. No account connection required. Connect accounts later from **Settings → Connections** if you want plan quotas and credit balance.

---

## How Tracking Evolves

Tracking state: `not_enabled → waiting_for_activity → active`. Account state: `not_connected → connected` (or `expired` / `access_denied` / `unavailable`). The dashboard adapts — no account snapshot shows runtime-only cards; a connected snapshot adds gauges and credit balance on top.

---

## Architecture

```
electron/          Electron main process
  proxy/           HTTP proxy — intercept, parse SSE, calculate cost
  db/              SQLite persistence layer
  providers/       Multi-provider session watchers & account fetchers (Claude, Codex, Gemini)
  watcher/         Generic session-file watcher (wired per-provider via watchConfig)
  backfill/        Historical recovery plugins (Claude, Codex)
src/               React frontend — usage dashboard & visualizations
assets/            Tray icons and sprites
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop | Electron 28 |
| Frontend | React 18, TypeScript, Tailwind CSS |
| Charts | Recharts |
| Animations | Framer Motion |
| Database | better-sqlite3 |
| Tokenizer | js-tiktoken |
| Runtime | Node.js 22 |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for commit conventions, quality gates, and PR requirements.

## License

[Apache License 2.0](./LICENSE)
