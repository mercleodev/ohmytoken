#!/usr/bin/env bash
# P0.5 — U1-VR capture orchestrator (gate doc §7 P0.5).
#
# Per profile: seed HOME → launch headed Electron in background → connect
# agent-browser via CDP → drive each screen declared in
# scripts/qa-capture-screen-map.json → capture PNG + JSON sidecar →
# terminate Electron cleanly. Headless not supported (Inter font + macOS
# WebKit text rasterization differ between headed and headless; the
# baseline must reflect the actual user-facing render path).
#
# Usage:
#   scripts/qa-capture-baseline.sh --list                # enumerate screens
#   scripts/qa-capture-baseline.sh --dry-run             # validate map + script
#   scripts/qa-capture-baseline.sh --seed-only           # seed all 4 profiles
#   scripts/qa-capture-baseline.sh <profile>             # capture one profile
#   scripts/qa-capture-baseline.sh --all                 # 4 profiles in series
#   scripts/qa-capture-baseline.sh --renderer-only       # vite + 2 twins
#
# Environment overrides:
#   OUT_DIR           default: docs/qa/runs/<UTC date>/baseline
#   CDP_PORT          default: 9222 (must match qa-launch-electron.sh)
#   STARTUP_GRACE     default: 8 (seconds to wait for Electron CDP readiness)
#   TERMINATE_GRACE   default: 10 (seconds before SIGKILL)
#
# Better-sqlite3 ABI dance: the seeder runs under system Node (MODULE_VERSION
# 127 on Node 22) but Electron 28 embeds Node with MODULE_VERSION 119.
# Both `--all` and `<profile>` modes call `npm run ensure:node` before
# seeding and `npm run ensure:electron` before launching Electron. These
# are idempotent — they read config.gypi and only rebuild when needed.
#
# This script emits no PNGs unless invoked with a profile name. P0.5
# itself is reviewed via --dry-run; the actual baseline capture is
# U1-VR's responsibility.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCREEN_MAP="${REPO_ROOT}/scripts/qa-capture-screen-map.json"
SEEDER="${REPO_ROOT}/scripts/qa-seed-fixtures.mjs"
LAUNCH_ELECTRON="${REPO_ROOT}/scripts/qa-launch-electron.sh"
LAUNCH_RENDERER="${REPO_ROOT}/scripts/qa-launch-renderer.sh"

: "${CDP_PORT:=9222}"
: "${STARTUP_GRACE:=8}"
: "${TERMINATE_GRACE:=10}"
: "${OUT_DIR:=${REPO_ROOT}/docs/qa/runs/$(date -u +%Y-%m-%d)/baseline}"

# ---------------------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------------------

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[qa-capture] FATAL: required command '$cmd' not in PATH" >&2
    return 1
  fi
}

validate_map() {
  if [ ! -f "$SCREEN_MAP" ]; then
    echo "[qa-capture] FATAL: screen-map not found at $SCREEN_MAP" >&2
    return 1
  fi
  if ! jq empty "$SCREEN_MAP" 2>/dev/null; then
    echo "[qa-capture] FATAL: screen-map is not valid JSON" >&2
    return 1
  fi
  local missing
  missing=$(jq -r '
    .screens
    | map(select(
        (.name | not) or
        (.profile | not) or
        (.target | not) or
        (.waitFor | not) or
        (.steps | type != "array")
      ) | .name // "<unnamed>")
    | join(",")
  ' "$SCREEN_MAP")
  if [ -n "$missing" ]; then
    echo "[qa-capture] FATAL: screen-map entries missing required keys: $missing" >&2
    return 1
  fi
  return 0
}

print_screen_list() {
  echo "Screen-map: $SCREEN_MAP"
  echo "Total: $(jq '.screens | length' "$SCREEN_MAP") entries"
  echo ""
  jq -r '
    .screens
    | group_by(.profile)
    | map({profile: .[0].profile, names: map(.name)})
    | .[]
    | "[\(.profile)]\n  - \(.names | join("\n  - "))"
  ' "$SCREEN_MAP"
}

dry_run() {
  echo "[qa-capture] DRY-RUN: validating screen-map + script syntax"
  require_cmd jq
  require_cmd shasum
  validate_map
  if ! bash -n "${BASH_SOURCE[0]}"; then
    echo "[qa-capture] FATAL: bash -n syntax check failed on $0" >&2
    return 1
  fi
  local total
  total=$(jq '.screens | length' "$SCREEN_MAP")
  if [ "$total" -ne 15 ]; then
    echo "[qa-capture] FATAL: expected 15 screens (13 canonical + 2 renderer), got $total" >&2
    return 1
  fi
  local tbds
  tbds=$(jq -r '.screens | map(select(.tbd != null)) | length' "$SCREEN_MAP")
  echo "[qa-capture] DRY-RUN: $total screens declared, $tbds with TBD annotations"
  echo "[qa-capture] DRY-RUN: PASS"
  return 0
}

# ---------------------------------------------------------------------------
# Per-screen step execution
# ---------------------------------------------------------------------------

run_steps() {
  local screen_name="$1"
  local steps_json
  steps_json=$(jq -c --arg n "$screen_name" '.screens[] | select(.name == $n) | .steps' "$SCREEN_MAP")
  echo "$steps_json" | jq -c '.[]' | while IFS= read -r step; do
    local step_type
    step_type=$(echo "$step" | jq -r '.type')
    case "$step_type" in
      click)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        agent-browser click "$sel"
        ;;
      wait)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        agent-browser wait "$sel"
        ;;
      wait_ms)
        local ms
        ms=$(echo "$step" | jq -r '.ms')
        agent-browser wait "$ms"
        ;;
      eval)
        local script
        script=$(echo "$step" | jq -r '.script')
        agent-browser evaluate "$script"
        ;;
      scroll-to)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        agent-browser scrollintoview "$sel"
        ;;
      tab-switch)
        local pat
        pat=$(echo "$step" | jq -r '.urlPattern')
        agent-browser tab --url "$pat"
        ;;
      *)
        echo "[qa-capture] FATAL: unknown step type '$step_type' in screen $screen_name" >&2
        return 1
        ;;
    esac
  done
}

emit_sidecar() {
  local out_path="$1"
  local screen_name="$2"
  local profile="$3"
  local fixed_now
  fixed_now=$(jq -r '.fakeNow' "$SCREEN_MAP")
  local viewport_w viewport_h dpr
  viewport_w=$(jq -r '.viewport.width' "$SCREEN_MAP")
  viewport_h=$(jq -r '.viewport.height' "$SCREEN_MAP")
  dpr=$(jq -r '.viewport.dpr' "$SCREEN_MAP")
  local ab_version
  ab_version=$(agent-browser --version 2>/dev/null || echo "unknown")
  local electron_version
  electron_version=$(node -p "require('electron/package.json').version" 2>/dev/null || echo "unknown")
  jq -n \
    --arg profile "$profile" \
    --arg screen "$screen_name" \
    --arg fixedNow "$fixed_now" \
    --argjson width "$viewport_w" \
    --argjson height "$viewport_h" \
    --argjson dpr "$dpr" \
    --arg agentBrowserVersion "$ab_version" \
    --arg electronVersion "$electron_version" \
    '{
      profile: $profile,
      screen: $screen,
      fixedNow: $fixedNow,
      viewport: { width: $width, height: $height, dpr: $dpr },
      agentBrowserVersion: $agentBrowserVersion,
      electronVersion: $electronVersion,
      capturedAtFixed: "FIXED"
    }' > "$out_path"
}

# ---------------------------------------------------------------------------
# Per-profile lifecycle
# ---------------------------------------------------------------------------

wait_for_cdp() {
  local port="$1"
  local grace="$2"
  local i=0
  while [ "$i" -lt "$grace" ]; do
    if curl -s -o /dev/null "http://127.0.0.1:${port}/json/version"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "[qa-capture] FATAL: CDP port $port did not become ready within ${grace}s" >&2
  return 1
}

terminate_pid() {
  local pid="$1"
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  kill -TERM "$pid" 2>/dev/null || true
  local i=0
  while [ "$i" -lt "$TERMINATE_GRACE" ]; do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  kill -KILL "$pid" 2>/dev/null || true
}

seed_profile() {
  local profile="$1"
  local home_path="/tmp/omt-qa-css-decomp-home-${profile}"
  rm -rf "$home_path"
  node "$SEEDER" "$profile" --home "$home_path" >/dev/null
  echo "[qa-capture]   ✓ seeded $profile → $home_path"
}

# better-sqlite3 ABI dance: the seeder runs under system Node (MODULE_VERSION
# 127 on Node 22) but Electron 28 embeds Node with MODULE_VERSION 119. Trying
# to load a node-compiled binary into Electron raises ERR_DLOPEN_FAILED; the
# reverse fails too. `npm run ensure:electron` / `ensure:node` are idempotent
# (they read config.gypi and only rebuild when the runtime target changed),
# so calling them per phase is cheap when no switch is needed.
ensure_runtime() {
  local target="$1"
  if [ "$target" = "node" ]; then
    npm run ensure:node >/dev/null 2>&1
  elif [ "$target" = "electron" ]; then
    npm run ensure:electron >/dev/null 2>&1
  else
    echo "[qa-capture] FATAL: unknown ensure_runtime target '$target'" >&2
    return 1
  fi
}

capture_profile() {
  local profile="$1"
  local home_path="/tmp/omt-qa-css-decomp-home-${profile}"
  local profile_screens
  profile_screens=$(jq -r --arg p "$profile" '.screens | map(select(.profile == $p)) | length' "$SCREEN_MAP")
  if [ "$profile_screens" -eq 0 ]; then
    echo "[qa-capture] no screens declared for profile '$profile' — skipping"
    return 0
  fi
  if [ ! -d "$home_path" ]; then
    echo "[qa-capture] FATAL: profile '$profile' HOME not seeded ($home_path missing). Run --seed-only first or use --all." >&2
    return 1
  fi

  echo "[qa-capture] === profile: $profile ($profile_screens screens) ==="

  mkdir -p "$OUT_DIR/canonical"

  local launch_pid=""
  trap 'terminate_pid "$launch_pid"' EXIT
  HOME_OVERRIDE="$home_path" \
    OMT_QA_FAKE_NOW="$(jq -r '.fakeNow' "$SCREEN_MAP")" \
    OMT_QA_NO_ANIMATIONS=1 \
    REMOTE_DEBUG_PORT="$CDP_PORT" \
    bash "$LAUNCH_ELECTRON" >/tmp/omt-qa-electron-${profile}.log 2>&1 &
  launch_pid=$!

  wait_for_cdp "$CDP_PORT" "$STARTUP_GRACE"
  agent-browser connect "$CDP_PORT" --session "css-decomp-baseline-${profile}"

  jq -r --arg p "$profile" '.screens | map(select(.profile == $p)) | .[].name' "$SCREEN_MAP" \
  | while IFS= read -r screen_name; do
    local target
    target=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .target' "$SCREEN_MAP")
    if [ "$target" = "notification" ]; then
      echo "[qa-capture] $screen_name: target=notification — switching tab"
    fi
    local wait_for
    wait_for=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .waitFor' "$SCREEN_MAP")
    run_steps "$screen_name"
    agent-browser wait "$wait_for"
    local png_path="$OUT_DIR/canonical/${screen_name}.png"
    local sidecar_path="$OUT_DIR/canonical/${screen_name}.json"
    agent-browser screenshot "$png_path"
    emit_sidecar "$sidecar_path" "$screen_name" "$profile"
    echo "[qa-capture]   ✓ $screen_name → $png_path"
  done

  terminate_pid "$launch_pid"
  launch_pid=""
  trap - EXIT
}

capture_renderer_only() {
  echo "[qa-capture] === renderer-only twins ==="
  mkdir -p "$OUT_DIR/renderer"
  bash "$LAUNCH_RENDERER" >/tmp/omt-qa-renderer.log 2>&1 &
  local vite_pid=$!
  trap 'terminate_pid "$vite_pid"' EXIT
  sleep "$STARTUP_GRACE"
  local fake_now
  fake_now=$(jq -r '.fakeNow' "$SCREEN_MAP")
  local qa_url="http://localhost:5173/?qa-fake-now=${fake_now}&qa-no-animations=1"
  agent-browser open "$qa_url"
  jq -r '.screens | map(select(.profile == "renderer-only")) | .[].name' "$SCREEN_MAP" \
  | while IFS= read -r screen_name; do
    local wait_for
    wait_for=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .waitFor' "$SCREEN_MAP")
    run_steps "$screen_name"
    agent-browser wait "$wait_for"
    local png_path="$OUT_DIR/renderer/${screen_name}.png"
    local sidecar_path="$OUT_DIR/renderer/${screen_name}.json"
    agent-browser screenshot "$png_path"
    emit_sidecar "$sidecar_path" "$screen_name" "renderer-only"
    echo "[qa-capture]   ✓ $screen_name → $png_path"
  done
  terminate_pid "$vite_pid"
  vite_pid=""
  trap - EXIT
}

# ---------------------------------------------------------------------------
# Entry
# ---------------------------------------------------------------------------

mode="${1:-}"

case "$mode" in
  ""|-h|--help)
    awk 'NR==1 {next} /^#/ {print; next} {exit}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  --list)
    require_cmd jq
    validate_map
    print_screen_list
    ;;
  --dry-run)
    dry_run
    ;;
  --seed-only)
    require_cmd jq
    require_cmd node
    require_cmd npm
    validate_map
    echo "[qa-capture] === seed pass (better-sqlite3 → node ABI) ==="
    ensure_runtime node
    for p in populated first-run setup-guide backfill; do
      seed_profile "$p"
    done
    echo "[qa-capture] seed-only PASS — 4 profiles ready under /tmp/omt-qa-css-decomp-home-*"
    ;;
  --all)
    require_cmd jq
    require_cmd node
    require_cmd npm
    require_cmd agent-browser
    require_cmd curl
    validate_map
    echo "[qa-capture] === seed pass (better-sqlite3 → node ABI) ==="
    ensure_runtime node
    for p in populated first-run setup-guide backfill; do
      seed_profile "$p"
    done
    echo "[qa-capture] === capture pass (better-sqlite3 → electron ABI) ==="
    ensure_runtime electron
    for p in populated first-run setup-guide backfill; do
      capture_profile "$p"
    done
    capture_renderer_only
    ;;
  --renderer-only)
    require_cmd jq
    require_cmd agent-browser
    validate_map
    capture_renderer_only
    ;;
  populated|first-run|setup-guide|backfill)
    require_cmd jq
    require_cmd node
    require_cmd npm
    require_cmd agent-browser
    require_cmd curl
    validate_map
    echo "[qa-capture] === seed (node ABI) ==="
    ensure_runtime node
    seed_profile "$mode"
    echo "[qa-capture] === capture (electron ABI) ==="
    ensure_runtime electron
    capture_profile "$mode"
    ;;
  *)
    echo "[qa-capture] FATAL: unknown mode '$mode'" >&2
    echo "Valid modes: --list, --dry-run, --seed-only, --all, --renderer-only, populated, first-run, setup-guide, backfill" >&2
    exit 2
    ;;
esac
