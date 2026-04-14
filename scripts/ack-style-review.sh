#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "[style-review] FAIL: not inside a git repository."
  exit 1
fi

changed_files="$("${repo_root}/scripts/list-meaningful-changed-files.sh" || true)"
if [[ -z "${changed_files}" ]]; then
  echo "[style-review] FAIL: no meaningful changed files to acknowledge."
  exit 1
fi

style_items="$(printf '%s\n' "${changed_files}" | "${repo_root}/scripts/collect-style-review-items.sh" || true)"
if [[ -z "${style_items}" ]]; then
  echo "[style-review] PASS: no applicable style review items for the current change set."
  exit 0
fi

fingerprint="$("${repo_root}/scripts/list-meaningful-changed-files.sh" --fingerprint || true)"
ack_dir="${repo_root}/.policy"
ack_file="${ack_dir}/style-review-ack.txt"
note="${*:-manual-style-review-complete}"

mkdir -p "${ack_dir}"

{
  echo "# OhMyToken Style Review Acknowledgement"
  echo "# updated_at_utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "fingerprint=${fingerprint}"
  echo "source=docs/sdd/style-checklist.md"
  echo "note=${note}"
  echo ""
  printf '%s\n' "${changed_files}"
} > "${ack_file}"

echo "[style-review] Updated: ${ack_file}"
echo "[style-review] Fingerprint: ${fingerprint}"
echo "[style-review] Source: docs/sdd/style-checklist.md"
