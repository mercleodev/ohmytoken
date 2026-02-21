#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=".git-identity.local"
EXPECTED_HOOKS=".githooks"

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[identity-lock] FAIL: not inside a git repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
config_path="${repo_root}/${CONFIG_FILE}"

if [[ ! -f "${config_path}" ]]; then
  echo "[identity-lock] FAIL: missing ${CONFIG_FILE}"
  exit 1
fi

# shellcheck source=/dev/null
source "${config_path}"

EXPECTED_NAME="${GIT_IDENTITY_NAME:-}"
EXPECTED_EMAIL="${GIT_IDENTITY_EMAIL:-}"
EXPECTED_REMOTE="${GIT_IDENTITY_REMOTE:-}"

if [[ -z "${EXPECTED_NAME}" || -z "${EXPECTED_EMAIL}" || -z "${EXPECTED_REMOTE}" ]]; then
  echo "[identity-lock] FAIL: invalid ${CONFIG_FILE} (empty required keys)"
  exit 1
fi

actual_name="$(git config --local user.name || true)"
actual_email="$(git config --local user.email || true)"
actual_hooks="$(git config --local core.hooksPath || true)"
actual_remote="$(git remote get-url origin 2>/dev/null || true)"

fail=0

if [[ "${actual_name}" != "${EXPECTED_NAME}" ]]; then
  echo "[identity-lock] FAIL user.name: expected '${EXPECTED_NAME}', got '${actual_name:-<unset>}'"
  fail=1
fi

if [[ "${actual_email}" != "${EXPECTED_EMAIL}" ]]; then
  echo "[identity-lock] FAIL user.email: expected '${EXPECTED_EMAIL}', got '${actual_email:-<unset>}'"
  fail=1
fi

if [[ "${actual_hooks}" != "${EXPECTED_HOOKS}" ]]; then
  echo "[identity-lock] FAIL core.hooksPath: expected '${EXPECTED_HOOKS}', got '${actual_hooks:-<unset>}'"
  fail=1
fi

if [[ "${actual_remote}" != "${EXPECTED_REMOTE}" ]]; then
  echo "[identity-lock] FAIL origin: expected '${EXPECTED_REMOTE}', got '${actual_remote:-<unset>}'"
  fail=1
fi

if [[ "${fail}" -ne 0 ]]; then
  exit 1
fi

echo "[identity-lock] PASS"
echo "  user.name  = ${actual_name}"
echo "  user.email = ${actual_email}"
echo "  hooksPath  = ${actual_hooks}"
echo "  origin     = ${actual_remote}"
