# OhMyToken

**Real-time AI agent token usage monitor** — intercepts Claude, Codex & Gemini API calls and visualizes cost, context window, and prompt patterns.

Built with Electron + React. Runs locally on macOS.

---

## What It Does

OhMyToken sits between your AI coding agent and the API provider. It captures every request and response via a local HTTP proxy, then gives you a live dashboard to understand where your tokens go.

### Key Features

- **Multi-provider support** — Claude, Codex, and Gemini in a single unified view
- **Real-time proxy interception** — captures API calls on `localhost:8780`, parses SSE streams
- **Token usage dashboard** — radial gauge, cost breakdown (today / 30d), credit balance tracking
- **Context window visualization** — see exactly how your context fills up turn by turn
- **Cache growth chart** — track cache-read vs cache-create tokens over time, with compaction markers
- **Cost treemap** — visual breakdown of cost by prompt/query
- **Prompt heatmap** — 365-day activity calendar showing usage patterns
- **Token composition** — pie chart of cache-read, cache-create, input, and output tokens
- **Session & prompt detail** — drill into any session, inspect tool calls, injected files, evidence scores
- **MCP insights** — tool call analysis with optimization suggestions
- **Session alerts** — warnings for cache explosion, low efficiency, long sessions
- **Guardrail assessment** — evidence-based scoring with signal breakdown
- **Workflow change recommendations** — detects repeated manual patterns and suggests automation
- **Backfill engine** — recover historical usage data from provider session logs

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

---

## Architecture

```
electron/          Electron main process
  proxy/           HTTP proxy — intercept, parse SSE, calculate cost
  db/              SQLite persistence layer
  providers/       Multi-provider usage fetchers (Claude, Codex, Gemini)
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
