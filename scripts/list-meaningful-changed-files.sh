#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "[changed-files] FAIL: not inside a git repository." >&2
  exit 1
fi

cd "${repo_root}"

changed_files="$(git diff --name-only HEAD 2>/dev/null || true)"
staged_files="$(git diff --cached --name-only 2>/dev/null || true)"
untracked_files="$(git ls-files --others --exclude-standard 2>/dev/null || true)"

all_files="$(
  printf '%s\n%s\n%s\n' "${changed_files}" "${staged_files}" "${untracked_files}" \
    | awk 'NF' \
    | sort -u
)"

all_files="$(
  printf '%s\n' "${all_files}" \
    | grep -vE '^(e2e/screenshots/|playwright-report/|test-results/|scripts/(completion-gate|keyword-doc-router)\.sh$)' \
      || true
)"

if [[ "${1:-}" == "--fingerprint" ]]; then
  if [[ -z "${all_files}" ]]; then
    exit 0
  fi

  printf '%s\n' "${all_files}" | shasum -a 256 | awk '{print $1}'
  exit 0
fi

printf '%s\n' "${all_files}" | awk 'NF'
