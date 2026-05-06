#!/usr/bin/env bash
# Renderer-only launcher for agent-browser headed QA against the React UI
# alone (mock `window.api` from `src/main.tsx` substitutes for IPC).
# `.claude/rules/agent-browser-qa.md` § 2.1 references this script as the
# canonical launch path for pure UI QA.
#
# Use this mode for:
#   - layout / styling / empty / loading / error states
#   - Tier 1 CSS-decomposition byte-equal regression where mock data suffices
#
# For tests that need real IPC / proxy / DB / watchers, use
# `scripts/qa-launch-electron.sh` instead.
#
# Stabilization knobs are passed as URL query parameters because Vite has
# no preload bridge in renderer-only mode. The canonical URL is:
#
#   http://localhost:5173/?qa-fake-now=2026-05-05T12:00:00Z&qa-no-animations=1
#
# `src/qa/stabilization.ts` reads these on first paint, monkey-patches
# `Date` (so "time ago" labels freeze), and injects a `<style>` block
# that disables animations and transitions globally.
#
# Font determinism: the project ships Inter via `<link rel="stylesheet">`
# in `index.html`. If the QA host machine cannot reach Google Fonts or
# Inter is otherwise missing, glyph rendering will diverge from the U1
# baseline. Verify Inter is installed locally OR run on a machine with
# stable internet.
#
# Stop with ctrl-c.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

: "${VITE_PORT:=5173}"

echo "[qa-launch-renderer] port=$VITE_PORT"
echo "[qa-launch-renderer] open URL (with QA stabilization):"
echo "  http://localhost:$VITE_PORT/?qa-fake-now=2026-05-05T12:00:00Z&qa-no-animations=1"
echo "[qa-launch-renderer] stop with ctrl-c"

# --strictPort fails fast if 5173 is already taken (e.g. by a stray
# `npm run electron:dev`). Surfaces the conflict instead of silently
# advancing to a higher port and breaking the agent-browser URL.
exec npx vite --port "$VITE_PORT" --strictPort
