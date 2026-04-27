#!/usr/bin/env bash
# check-frontend-review-ack.sh — pre-commit gate that enforces a
# code-reviewer agent run against frontend-design-guideline.md.
#
# Called by .githooks/pre-commit. Blocks the commit unless a verdict-OK
# report exists at .policy/frontend-review-report.<fingerprint>.md
# matching the current change set.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "[frontend-review] FAIL: not inside a git repository."
  exit 1
fi

fingerprint="$("${repo_root}/scripts/list-meaningful-changed-files.sh" --fingerprint || true)"
if [[ -z "${fingerprint}" ]]; then
  echo "[frontend-review] PASS: no meaningful changed files."
  exit 0
fi

changed_files="$("${repo_root}/scripts/list-meaningful-changed-files.sh" || true)"
if ! printf '%s\n' "${changed_files}" | grep -qE '\.(ts|tsx|js|jsx|css|mjs|cjs)$'; then
  echo "[frontend-review] PASS: change set has no code files."
  exit 0
fi

report_file="${repo_root}/.policy/frontend-review-report.${fingerprint}.md"

if [[ ! -f "${report_file}" ]]; then
  echo "[frontend-review] FAIL: missing report at ${report_file}"
  echo "[frontend-review] Run: bash scripts/run-frontend-review.sh"
  echo "[frontend-review] Then invoke the code-reviewer agent and save the findings to that path."
  exit 1
fi

verdict="$(grep -m1 '^## Verdict:' "${report_file}" 2>/dev/null | sed 's/^## Verdict:[[:space:]]*//' || true)"
case "${verdict}" in
  OK|"OK with fixes")
    echo "[frontend-review] PASS: ${report_file} (verdict: ${verdict})"
    exit 0
    ;;
  BLOCK)
    echo "[frontend-review] FAIL: report verdict is BLOCK — resolve critical findings."
    echo "[frontend-review] Report: ${report_file}"
    exit 1
    ;;
  *)
    echo "[frontend-review] FAIL: report missing or unrecognized verdict."
    echo "[frontend-review] Expected '## Verdict: OK' or 'OK with fixes' or 'BLOCK'."
    echo "[frontend-review] Report: ${report_file}"
    exit 1
    ;;
esac
