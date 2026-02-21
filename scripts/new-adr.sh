#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <short-title-slug>"
  echo "Example: $0 proxy-architecture-decision"
  exit 1
fi

slug="$(echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')"
if [[ -z "${slug}" ]]; then
  echo "[adr] Invalid title slug."
  exit 1
fi

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
adr_dir="${root}/docs/decisions"
template="${adr_dir}/ADR-TEMPLATE.md"
today="$(date +%Y-%m-%d)"

mkdir -p "${adr_dir}"

max_id="$(
  find "${adr_dir}" -maxdepth 1 -type f -name "ADR-[0-9][0-9][0-9][0-9]-*.md" 2>/dev/null \
    | sed -E 's#.*ADR-([0-9]{4})-.*#\1#' \
    | sort -n \
    | tail -1
)"

if [[ -z "${max_id}" ]]; then
  next_id="0001"
else
  next_id="$(printf "%04d" $((10#${max_id} + 1)))"
fi

name="ADR-${next_id}-${slug}"
file="${adr_dir}/${name}.md"

if [[ -f "${template}" ]]; then
  awk -v title="# ${name}" -v date_line="Date: ${today}" '
    NR == 1 { print title; next }
    /^Date: / { print date_line; next }
    { print }
  ' "${template}" > "${file}"
else
  cat > "${file}" <<EOF
# ${name}

Status: proposed
Date: ${today}
Owners: <name>
Related Issue: #<id>
Related PR: #<id or draft>
Related QA Card: .claude/qa/<file or N/A>

## Context

## Decision

## Alternatives Considered

1. Alternative A - why not chosen
2. Alternative B - why not chosen

## Consequences

## Rollout Plan

## Validation

## Follow-up
EOF
fi

echo "[adr] Created: ${file}"
