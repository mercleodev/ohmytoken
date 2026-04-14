#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "[style-review] FAIL: not inside a git repository."
  exit 1
fi

changed_files="$("${repo_root}/scripts/list-meaningful-changed-files.sh" || true)"
if [[ -z "${changed_files}" ]]; then
  echo "[style-review] PASS: no meaningful changed files."
  exit 0
fi

style_items="$(printf '%s\n' "${changed_files}" | "${repo_root}/scripts/collect-style-review-items.sh" || true)"
if [[ -z "${style_items}" ]]; then
  echo "[style-review] PASS: no applicable style review items for the current change set."
  exit 0
fi

fingerprint="$("${repo_root}/scripts/list-meaningful-changed-files.sh" --fingerprint || true)"
ack_file="${repo_root}/.policy/style-review-ack.txt"
ack_fingerprint=""

if [[ -f "${ack_file}" ]]; then
  ack_fingerprint="$(sed -n 's/^fingerprint=//p' "${ack_file}" | tail -n 1)"
fi

if [[ -n "${fingerprint}" && "${ack_fingerprint}" == "${fingerprint}" ]]; then
  echo "[style-review] PASS: acknowledgement matches the current change set."
  exit 0
fi

echo "[style-review] FAIL: manual style review acknowledgement is missing or stale."
echo "[style-review] Source: docs/sdd/style-checklist.md"
echo "[style-review] Required review items:"

while IFS= read -r item; do
  if [[ -n "${item}" ]]; then
    echo "  - ${item}"
  fi
done <<< "${style_items}"

echo "[style-review] After reviewing, run: bash scripts/ack-style-review.sh \"<note>\""
exit 1
