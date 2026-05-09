#!/usr/bin/env bash
# Full-stack Electron launcher for agent-browser headed QA.
# `.claude/rules/agent-browser-qa.md` § 2.2 references this script as the
# canonical launch path for IPC / proxy / DB / tray / watcher tests.
#
# Behaviour:
#   - Compiles electron source (`tsc -p tsconfig.electron.json`) so dev-mode
#     hot reload is not required for a single QA pass.
#   - Routes the proxy upstream to a caller-supplied `PROXY_UPSTREAM` (e.g.
#     a local mock SSE upstream from `electron/proxy/mockServer.ts`) so
#     headed runs do not depend on real Anthropic creds.
#   - Pins HOME to `/tmp/omt-qa-home` so the run never touches the real
#     `~/.claude` or `~/.codex` (per agent-browser-qa.md § 2.2).
#   - Adds `--remote-debugging-port=9222` so `agent-browser connect 9222`
#     attaches in a second terminal.
#
# Visual-regression stabilization (set ONLY for byte-equal QA passes;
# leave unset for normal dev/QA so end-user behaviour is unchanged):
#   - OMT_QA_FAKE_NOW=<ISO timestamp>  e.g. 2026-05-05T12:00:00Z
#       Freezes `Date.now()` and `new Date()` (no-arg form) in the
#       renderer. Required for the U1 baseline + every Tier 1-3
#       byte-equal diff so "time ago" labels do not drift between runs.
#   - OMT_QA_NO_ANIMATIONS=1
#       Injects a `<style>` block in the renderer that zeros animation
#       and transition durations. Required for byte-equal screenshots.
#   Both vars are read in `electron/preload.ts` and forwarded to the
#   renderer via `contextBridge.exposeInMainWorld('__qaConfig', ...)`.
#   `src/qa/stabilization.ts` applies the patches before React mounts.
#
# Usage:
#   scripts/qa-launch-electron.sh                          # real upstream
#   PROXY_UPSTREAM=127.0.0.1:9999 scripts/qa-launch-electron.sh
#   OMT_QA_FAKE_NOW=2026-05-05T12:00:00Z \
#     OMT_QA_NO_ANIMATIONS=1 \
#     scripts/qa-launch-electron.sh                        # baseline mode
#
# Stop with ctrl-c (or `pkill -f 'electron .'` from another shell).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# QA HOME isolates ~/.claude, ~/.codex, app caches.
export HOME="${HOME_OVERRIDE:-/tmp/omt-qa-home}"
mkdir -p "$HOME"

# Sensible defaults; callers may override either env.
: "${PROXY_UPSTREAM:=api.anthropic.com}"
: "${REMOTE_DEBUG_PORT:=9222}"

export PROXY_UPSTREAM
export ELECTRON_ENABLE_LOGGING=1
# Force the main window to start visible so agent-browser CDP captures
# render correctly (gate doc §8.1, P1-6 headed run). main.ts honours
# OMT_QA_SHOW=1 — otherwise the tray-app default hides the window.
: "${OMT_QA_SHOW:=1}"
export OMT_QA_SHOW

echo "[qa-launch] HOME=$HOME"
echo "[qa-launch] PROXY_UPSTREAM=$PROXY_UPSTREAM"
echo "[qa-launch] CDP port=$REMOTE_DEBUG_PORT"

# Compile electron sources (skip if dist-electron is already fresh; tsc
# is idempotent enough for QA so we always run it).
npm run build:electron >/dev/null

exec npx electron . --remote-debugging-port="$REMOTE_DEBUG_PORT"
