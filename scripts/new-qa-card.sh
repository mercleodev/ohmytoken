#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <short-topic-slug>"
  echo "Example: $0 proxy-architecture"
  exit 1
fi

slug="$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "${slug}" ]]; then
  echo "[qa] Invalid topic slug."
  exit 1
fi

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
qa_dir="${root}/.claude/qa"
template="${qa_dir}/TEMPLATE-QUESTION.md"
today="$(date +%Y-%m-%d)"
current_branch="$(git symbolic-ref --short HEAD 2>/dev/null || true)"
if [[ -z "${current_branch}" ]]; then
  current_branch="<branch-name>"
fi

mkdir -p "${qa_dir}"

max_seq="$(
  find "${qa_dir}" -maxdepth 1 -type f -name "Q-${today}-*-*.md" 2>/dev/null \
    | sed -E 's#.*Q-[0-9]{4}-[0-9]{2}-[0-9]{2}-([0-9]{3})-.*#\1#' \
    | sort -n \
    | tail -1
)"

if [[ -z "${max_seq}" ]]; then
  next_seq="001"
else
  next_seq="$(printf "%03d" $((10#${max_seq} + 1)))"
fi

id="Q-${today}-${next_seq}-${slug}"
file="${qa_dir}/${id}.md"

if [[ -f "${template}" ]]; then
  awk -v title="# ${id}" -v deadline="Deadline: ${today}" -v branch_line="Branch: ${current_branch}" '
    NR == 1 { print title; next }
    /^Branch: / { print branch_line; next }
    /^Deadline: / { print deadline; next }
    { print }
  ' "${template}" > "${file}"
else
  cat > "${file}" <<EOF
# ${id}

Status: open
Owner: claude
Branch: <branch-name>
Commit: <short-sha-or-none>
Deadline: ${today}

## Context

## Options

1. Option A
2. Option B

## Constraints

## Question to Codex

## Codex Answer

## Final Decision (Claude)

## Promotion

ADR created: <docs/decisions/ADR-xxxx-short-title.md or N/A>
EOF
fi

echo "[qa] Created: ${file}"
