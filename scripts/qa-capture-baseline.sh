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
#   INCLUDE_TBD       default: 0. Set to 1 to attempt screens that carry a
#                     `tbd:` annotation in qa-capture-screen-map.json.
#                     Default skips them so a baseline run only captures
#                     fully-validated screens.
#
# Better-sqlite3 ABI dance: the seeder runs under system Node (MODULE_VERSION
# 127 on Node 22) but Electron 28 embeds Node with MODULE_VERSION 119.
# Both `--all` and `<profile>` modes call `npm run ensure:node` before
# seeding and `npm run ensure:electron` before launching Electron. These
# are idempotent — they read config.gypi and only rebuild when needed.
#
# Capture method (P0.5.2): Electron is launched with OMT_QA_CAPTURE_MODE=1.
# Side effects:
#   - notification BrowserWindow not created → CDP has only the main page,
#     so agent-browser tab routing edge-cases are eliminated.
#   - `qa:capture-window` IPC handler registers in the main process. The
#     orchestrator emits screenshots via `agent-browser eval
#     "window.api.qaCaptureWindow('<path>').then(r=>JSON.stringify(r))"`,
#     which routes through Electron's native webContents.capturePage().
#     This bypasses agent-browser's CDP `Page.captureScreenshot` path,
#     which times out under macOS paint-pause when the headed window is
#     not foreground. Captures are byte-equal across runs (verified at
#     P0.5.2 smoke test: 3 identical hashes for the same DOM state).
#
# Notification-overlay screen: skipped under capture mode (the notif
# window does not exist). Re-enabling the notification baseline requires
# a separate launch without OMT_QA_CAPTURE_MODE; tracked as a U1-VR-side
# follow-up in the screen-map's `tbd:` annotations.
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
: "${INCLUDE_TBD:=0}"

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
  local mode="${2:-cdp}" # "cdp" for headed Electron attach; "daemon" for renderer-only
  local ab_prefix=()
  if [ "$mode" = "cdp" ]; then
    ab_prefix=(--cdp "$CDP_PORT")
  fi
  local steps_json
  steps_json=$(jq -c --arg n "$screen_name" '.screens[] | select(.name == $n) | .steps' "$SCREEN_MAP")
  echo "$steps_json" | jq -c '.[]' | while IFS= read -r step; do
    local step_type
    step_type=$(echo "$step" | jq -r '.type')
    case "$step_type" in
      click)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        # Native DOM click via eval — agent-browser's CDP `click` does
        # not trigger React onClick handlers (CDP dispatchMouseEvent
        # bypasses React's synthetic event system). U1-VR-b smoke
        # confirmed: `click @e6` against a React button reports "✓ Done"
        # but state never updates; `el.click()` works.
        agent-browser "${ab_prefix[@]}" eval "document.querySelector('$sel').click()"
        ;;
      wait)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        agent-browser "${ab_prefix[@]}" wait "$sel"
        ;;
      wait_ms)
        local ms
        ms=$(echo "$step" | jq -r '.ms')
        agent-browser "${ab_prefix[@]}" wait "$ms"
        ;;
      eval)
        local script
        script=$(echo "$step" | jq -r '.script')
        agent-browser "${ab_prefix[@]}" eval "$script"
        ;;
      scroll-to)
        local sel
        sel=$(echo "$step" | jq -r '.selector')
        agent-browser "${ab_prefix[@]}" scrollintoview "$sel"
        ;;
      tab-switch)
        echo "[qa-capture] WARN: tab-switch step ignored in OMT_QA_CAPTURE_MODE (notif window not created)" >&2
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
  local png_path="$4"
  local fixed_now
  fixed_now=$(jq -r '.fakeNow' "$SCREEN_MAP")
  local target_w target_h target_dpr
  target_w=$(jq -r '.viewport.width' "$SCREEN_MAP")
  target_h=$(jq -r '.viewport.height' "$SCREEN_MAP")
  target_dpr=$(jq -r '.viewport.dpr' "$SCREEN_MAP")
  # Actual captured dimensions from PNG file (independent of declared
  # target viewport; the OhMyToken main BrowserWindow is hardcoded to
  # 400x640, so actualPx differs from targetViewport until U1-VR-b
  # decides whether to resize the window in capture mode).
  local actual_w actual_h
  if [ -f "$png_path" ]; then
    local dims
    dims=$(file "$png_path" 2>/dev/null | grep -oE '[0-9]+ x [0-9]+' | head -1)
    actual_w=$(echo "$dims" | awk '{print $1}')
    actual_h=$(echo "$dims" | awk '{print $3}')
  fi
  : "${actual_w:=0}"
  : "${actual_h:=0}"
  local ab_version
  ab_version=$(agent-browser --version 2>/dev/null || echo "unknown")
  local electron_version
  electron_version=$(node -p "require('electron/package.json').version" 2>/dev/null || echo "unknown")
  jq -n \
    --arg profile "$profile" \
    --arg screen "$screen_name" \
    --arg fixedNow "$fixed_now" \
    --argjson tw "$target_w" \
    --argjson th "$target_h" \
    --argjson tdpr "$target_dpr" \
    --argjson aw "$actual_w" \
    --argjson ah "$actual_h" \
    --arg agentBrowserVersion "$ab_version" \
    --arg electronVersion "$electron_version" \
    '{
      profile: $profile,
      screen: $screen,
      fixedNow: $fixedNow,
      targetViewport: { width: $tw, height: $th, dpr: $tdpr },
      actualPx: { width: $aw, height: $ah },
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

  # Boot-time root selector per profile. After the post-screen reload we
  # need to wait for the application shell to mount, which differs:
  #   populated/backfill → .dashboard (UsageDashboard renders at boot;
  #     BackfillDialog is a modal overlay on top, not a replacement)
  #   first-run/setup-guide → .first-run-screen (App.tsx mounts
  #     FirstRunOnboarding when getFirstRunStatus.isFirstRun is true)
  # Without this, first-run runs hang on `wait .dashboard` until timeout.
  local boot_selector
  case "$profile" in
    populated|backfill) boot_selector=".dashboard" ;;
    first-run|setup-guide) boot_selector=".first-run-screen" ;;
    *) boot_selector=".dashboard" ;;
  esac

  mkdir -p "$OUT_DIR/canonical"

  # Defensive: kill any stale OhMyToken Electron from a prior run that
  # bound to $CDP_PORT. Prior orchestrator failures can leave processes
  # alive whose terminate_pid trap didn't fire (e.g., subshell pipe-loop
  # exit modes); fresh launches then race for the port and capturing
  # commands attach to whichever instance binds first — usually the
  # stale one with leftover React state. This makes capture deterministic
  # by guaranteeing a single instance.
  ps -e -o pid,command \
    | awk -v r="$REPO_ROOT" '$0 ~ "Electron.app/Contents/MacOS/Electron \\. --remote-debugging-port=" && index($0, r) {print $1}' \
    | xargs -I{} kill -KILL {} 2>/dev/null || true
  # Kill any agent-browser daemon left over from a prior run. Stale
  # daemons cache CDP session IDs that no longer map to a live target,
  # producing "Session with given id not found" or EAGAIN on the next
  # CLI call. Fresh daemon per profile is the simplest correct path.
  pkill -9 -f "agent-browser-darwin-arm64" 2>/dev/null || true
  sleep 1

  local launch_pid=""
  trap 'terminate_pid "$launch_pid"' EXIT
  NODE_ENV=test \
    OMT_QA_CAPTURE_MODE=1 \
    HOME_OVERRIDE="$home_path" \
    OMT_QA_FAKE_NOW="$(jq -r '.fakeNow' "$SCREEN_MAP")" \
    OMT_QA_NO_ANIMATIONS=1 \
    REMOTE_DEBUG_PORT="$CDP_PORT" \
    bash "$LAUNCH_ELECTRON" >/tmp/omt-qa-electron-${profile}.log 2>&1 &
  launch_pid=$!

  wait_for_cdp "$CDP_PORT" "$STARTUP_GRACE"

  # Bring the OhMyToken main page to OS-level foreground via CDP HTTP
  # /json/activate. Without this, macOS paint-pauses the Electron
  # window's compositor and framer-motion's requestAnimationFrame-based
  # animations stall mid-progress (overlay opacity stuck at ~0.02
  # instead of 1). This makes the capture deterministic regardless of
  # which window happens to have focus when the orchestrator runs.
  local main_target
  main_target=$(curl -s "http://127.0.0.1:${CDP_PORT}/json" | jq -r '.[] | select(.url | endswith("/index.html")) | .id' | head -1)
  if [ -n "$main_target" ]; then
    curl -s -X POST "http://127.0.0.1:${CDP_PORT}/json/activate/${main_target}" >/dev/null
  fi

  local first_screen=1
  while IFS= read -r screen_name; do
    local target tbd
    target=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .target' "$SCREEN_MAP")
    tbd=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .tbd // ""' "$SCREEN_MAP")
    if [ -n "$tbd" ] && [ "$INCLUDE_TBD" != "1" ]; then
      echo "[qa-capture] $screen_name: SKIP (tbd: ${tbd:0:80}…). Re-run with INCLUDE_TBD=1 to attempt."
      continue
    fi
    if [ "$target" = "notification" ]; then
      echo "[qa-capture] $screen_name: target=notification — SKIP (notif window not created in OMT_QA_CAPTURE_MODE; see screen-map tbd)"
      continue
    fi
    local wait_for
    wait_for=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .waitFor' "$SCREEN_MAP")
    # Reload between screens to reset React state. The first screen
    # boots clean from Electron launch, so we only reload for the 2nd+
    # screens of the profile. Reload after fresh boot triggers an
    # agent-browser daemon CDP-session-id rotation that produces
    # "Session with given id not found" on the next call.
    # Without this, the `settings-context-limit` capture's open popup
    # bleeds into subsequent captures (since AnimatePresence keeps
    # the modal mounted until React unmounts it). Reload also clears
    # any leftover scroll position, hover state, focus ring, etc.
    if [ "$first_screen" -eq 1 ]; then
      first_screen=0
    else
      agent-browser --cdp "$CDP_PORT" reload >/dev/null
      # Brief settle: the agent-browser daemon occasionally returns EAGAIN
      # ("Resource temporarily unavailable") if the next command issues
      # immediately after reload.
      sleep 1
      agent-browser --cdp "$CDP_PORT" wait "$boot_selector"
    fi
    run_steps "$screen_name" cdp
    agent-browser --cdp "$CDP_PORT" wait "$wait_for"
    # Re-activate before each capture: framer-motion uses rAF and
    # macOS paint-pauses non-foreground windows, so animations stall
    # mid-progress unless the window is OS-level foreground. The
    # initial activate after launch can be lost if any other app
    # steals focus mid-run. Re-activating per capture is cheap and
    # keeps animations completing naturally (no inline-style hacks).
    if [ -n "$main_target" ]; then
      curl -s -X POST "http://127.0.0.1:${CDP_PORT}/json/activate/${main_target}" >/dev/null
    fi
    # Brief settle window: framer-motion fades typically finish in
    # ~150-300ms; 500ms is conservative without slowing the run much.
    agent-browser --cdp "$CDP_PORT" wait 500
    local png_path="$OUT_DIR/canonical/${screen_name}.png"
    local sidecar_path="$OUT_DIR/canonical/${screen_name}.json"
    # IPC capture (P0.5.2): bypass agent-browser CDP screenshot which
    # times out under macOS paint-pause; route via Electron's native
    # webContents.capturePage() exposed by qa:capture-window IPC.
    # The handler refuses paths outside /tmp, /private/tmp, /var/folders
    # for safety, so write to /tmp first then mv to OUT_DIR.
    local tmp_png="/tmp/omt-qa-capture-${profile}-${screen_name}.png"
    agent-browser --cdp "$CDP_PORT" eval "window.api.qaCaptureWindow('$tmp_png').then(r => JSON.stringify(r))" >/dev/null
    if [ ! -f "$tmp_png" ]; then
      echo "[qa-capture] FATAL: capture failed for $screen_name (file not written: $tmp_png)" >&2
      terminate_pid "$launch_pid"
      return 1
    fi
    mv "$tmp_png" "$png_path"
    emit_sidecar "$sidecar_path" "$screen_name" "$profile" "$png_path"
    echo "[qa-capture]   ✓ $screen_name → $png_path ($(wc -c < "$png_path" | tr -d ' ') bytes)"
  done < <(jq -r --arg p "$profile" '.screens | map(select(.profile == $p)) | .[].name' "$SCREEN_MAP")

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
    local tbd
    tbd=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .tbd // ""' "$SCREEN_MAP")
    if [ -n "$tbd" ] && [ "$INCLUDE_TBD" != "1" ]; then
      echo "[qa-capture] $screen_name: SKIP (tbd: ${tbd:0:80}…). Re-run with INCLUDE_TBD=1 to attempt."
      continue
    fi
    local wait_for
    wait_for=$(jq -r --arg n "$screen_name" '.screens[] | select(.name == $n) | .waitFor' "$SCREEN_MAP")
    run_steps "$screen_name" daemon
    agent-browser wait "$wait_for"
    local png_path="$OUT_DIR/renderer/${screen_name}.png"
    local sidecar_path="$OUT_DIR/renderer/${screen_name}.json"
    agent-browser screenshot "$png_path"
    emit_sidecar "$sidecar_path" "$screen_name" "renderer-only" "$png_path"
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
