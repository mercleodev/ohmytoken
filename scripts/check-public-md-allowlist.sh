#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[md-allowlist] FAIL: not inside a git repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
allowlist_file="${repo_root}/.public-docs-allowlist"

if [[ ! -f "${allowlist_file}" ]]; then
  echo "[md-allowlist] FAIL: missing .public-docs-allowlist"
  exit 1
fi

allowed=()
while IFS= read -r line; do
  line="${line%%#*}"
  line="$(echo "${line}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
  [[ -n "${line}" ]] && allowed+=("${line}")
done < "${allowlist_file}"

mapfile_output="$(git ls-files '*.md' || true)"
tracked_md=()
while IFS= read -r file; do
  [[ -n "${file}" ]] && tracked_md+=("${file}")
done <<< "${mapfile_output}"

fail=0

for file in "${tracked_md[@]}"; do
  is_allowed=0
  for item in "${allowed[@]}"; do
    if [[ "${file}" == "${item}" ]]; then
      is_allowed=1
      break
    fi
  done
  if [[ "${is_allowed}" -eq 0 ]]; then
    echo "[md-allowlist] FAIL: tracked markdown is not allowlisted: ${file}"
    fail=1
  fi
done

for item in "${allowed[@]}"; do
  if [[ ! -f "${repo_root}/${item}" ]]; then
    echo "[md-allowlist] FAIL: allowlisted markdown file not found: ${item}"
    fail=1
  fi
done

if [[ "${fail}" -ne 0 ]]; then
  echo "[md-allowlist] Allowed markdown list:"
  printf '  - %s\n' "${allowed[@]}"
  exit 1
fi

echo "[md-allowlist] PASS"
