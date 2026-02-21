#!/usr/bin/env bash
set -euo pipefail

REQUIRED_MAJOR="22"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

check_pin_file() {
  local file="$1"
  if [[ ! -f "${file}" ]]; then
    echo "[node-lock] FAIL: missing $(basename "${file}")"
    return 1
  fi
  local value
  value="$(tr -d '[:space:]' < "${file}")"
  if [[ "${value}" != "${REQUIRED_MAJOR}" ]]; then
    echo "[node-lock] FAIL: $(basename "${file}") is '${value}', expected '${REQUIRED_MAJOR}'"
    return 1
  fi
  return 0
}

fail=0

check_pin_file "${REPO_ROOT}/.nvmrc" || fail=1
check_pin_file "${REPO_ROOT}/.node-version" || fail=1

if ! command -v node >/dev/null 2>&1; then
  echo "[node-lock] FAIL: node is not installed."
  echo "[node-lock] Use Node ${REQUIRED_MAJOR} for this repository."
  exit 1
fi

node_version="$(node -v 2>/dev/null || true)"
node_major="$(echo "${node_version}" | sed -E 's/^v([0-9]+).*/\1/')"
if [[ -z "${node_major}" || "${node_major}" != "${REQUIRED_MAJOR}" ]]; then
  echo "[node-lock] FAIL: current node version is '${node_version}', expected major '${REQUIRED_MAJOR}'."
  echo "[node-lock] Run:"
  echo "  nvm install ${REQUIRED_MAJOR}"
  echo "  nvm use ${REQUIRED_MAJOR}"
  exit 1
fi

if [[ "${fail}" -ne 0 ]]; then
  exit 1
fi

echo "[node-lock] PASS: node ${node_version}"
