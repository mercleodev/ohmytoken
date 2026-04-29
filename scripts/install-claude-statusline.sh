#!/usr/bin/env bash
# install-claude-statusline.sh — wire `oht statusline` into Claude Code.
#
# Usage:
#   scripts/install-claude-statusline.sh install      # add statusLine
#   scripts/install-claude-statusline.sh uninstall    # remove statusLine
#   scripts/install-claude-statusline.sh check        # print current value
#
# Design: preserve every other field in ~/.claude/settings.json. Back up
# before every mutation so the user can roll back with a single copy. The
# script is safe to run multiple times (idempotent).
#
# Rationale: writing the settings.json by hand (or by copy-pasting a
# multi-line command) is fragile — zsh line-continuation errors leave the
# file partially edited. This script is the supported path.

set -euo pipefail

SETTINGS_FILE="${HOME}/.claude/settings.json"
STATUS_COMMAND="${OHT_STATUSLINE_COMMAND:-oht statusline}"

usage() {
  cat <<'EOF'
Usage: scripts/install-claude-statusline.sh <install|uninstall|check>

Environment:
  OHT_STATUSLINE_COMMAND   Override the command string (default: "oht statusline")
EOF
}

require_jq() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "[install-claude-statusline] jq is required but not found in PATH." >&2
    echo "  brew install jq       # macOS" >&2
    echo "  apt install -y jq     # Debian/Ubuntu" >&2
    exit 127
  fi
}

ensure_settings_file() {
  mkdir -p "$(dirname "${SETTINGS_FILE}")"
  # Treat an empty file the same as a missing file so jq does not trip on it.
  if [[ ! -s "${SETTINGS_FILE}" ]]; then
    echo '{}' > "${SETTINGS_FILE}"
  fi
  # Validate the existing JSON shape before we touch it.
  if ! jq empty "${SETTINGS_FILE}" >/dev/null 2>&1; then
    echo "[install-claude-statusline] ${SETTINGS_FILE} is not valid JSON." >&2
    echo "  Fix the file manually or remove it, then rerun this script." >&2
    exit 1
  fi
}

backup_settings() {
  local ts
  ts="$(date +%Y%m%d-%H%M%S)"
  local dest="${SETTINGS_FILE}.bak.${ts}"
  cp "${SETTINGS_FILE}" "${dest}"
  echo "[install-claude-statusline] backup: ${dest}"
}

cmd_install() {
  require_jq
  ensure_settings_file

  local current
  current="$(jq -r '.statusLine.command // empty' "${SETTINGS_FILE}")"
  if [[ "${current}" == "${STATUS_COMMAND}" ]]; then
    echo "[install-claude-statusline] already set → ${current}. No change."
    return 0
  fi

  backup_settings
  local tmp
  tmp="$(mktemp "${SETTINGS_FILE}.tmp.XXXXXX")"
  jq --arg cmd "${STATUS_COMMAND}" \
    '.statusLine = {type: "command", command: $cmd}' \
    "${SETTINGS_FILE}" > "${tmp}"
  mv "${tmp}" "${SETTINGS_FILE}"

  echo "[install-claude-statusline] installed."
  echo "  statusLine.command = $(jq -r '.statusLine.command' "${SETTINGS_FILE}")"
  echo "  Restart Claude Code to pick up the new status line."
}

cmd_uninstall() {
  require_jq
  if [[ ! -s "${SETTINGS_FILE}" ]]; then
    echo "[install-claude-statusline] nothing to uninstall — ${SETTINGS_FILE} is empty or missing."
    return 0
  fi
  if ! jq empty "${SETTINGS_FILE}" >/dev/null 2>&1; then
    echo "[install-claude-statusline] ${SETTINGS_FILE} is not valid JSON." >&2
    exit 1
  fi
  local has
  has="$(jq 'has("statusLine")' "${SETTINGS_FILE}")"
  if [[ "${has}" != "true" ]]; then
    echo "[install-claude-statusline] statusLine field already absent. No change."
    return 0
  fi

  backup_settings
  local tmp
  tmp="$(mktemp "${SETTINGS_FILE}.tmp.XXXXXX")"
  jq 'del(.statusLine)' "${SETTINGS_FILE}" > "${tmp}"
  mv "${tmp}" "${SETTINGS_FILE}"
  echo "[install-claude-statusline] uninstalled. Restart Claude Code."
}

cmd_check() {
  if [[ ! -s "${SETTINGS_FILE}" ]]; then
    echo "[install-claude-statusline] ${SETTINGS_FILE} is empty or missing — statusLine is NOT set."
    return 0
  fi
  require_jq
  if ! jq empty "${SETTINGS_FILE}" >/dev/null 2>&1; then
    echo "[install-claude-statusline] ${SETTINGS_FILE} is not valid JSON." >&2
    exit 1
  fi
  local current
  current="$(jq -r '.statusLine.command // empty' "${SETTINGS_FILE}")"
  if [[ -z "${current}" ]]; then
    echo "[install-claude-statusline] statusLine is NOT set."
  else
    echo "[install-claude-statusline] statusLine.command = ${current}"
  fi
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  check)     cmd_check ;;
  -h|--help|help|"") usage ;;
  *)
    echo "[install-claude-statusline] unknown command: $1" >&2
    usage
    exit 2
    ;;
esac
