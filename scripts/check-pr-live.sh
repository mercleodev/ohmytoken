#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <pr-number>"
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "[pr-policy] FAIL: GitHub CLI (gh) is required."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[pr-policy] FAIL: node is required."
  exit 1
fi

pr_number="$1"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "${repo_root}"

pr_body="$(gh pr view "${pr_number}" --json body -q .body)"
if [[ -z "${pr_body}" ]]; then
  echo "[pr-policy] FAIL: PR body is empty."
  exit 1
fi

printf "%s" "${pr_body}" | node scripts/check-pr-policy.mjs --stdin
echo "[pr-policy] PASS: PR #${pr_number}"
