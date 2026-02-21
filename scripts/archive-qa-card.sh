#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <qa-card-path-or-filename>"
  echo "Example: $0 Q-2026-02-21-001-proxy-architecture.md"
  exit 1
fi

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
qa_dir="${root}/.claude/qa"
input="$1"

if [[ -f "${input}" ]]; then
  src="${input}"
elif [[ -f "${qa_dir}/${input}" ]]; then
  src="${qa_dir}/${input}"
else
  echo "[qa-archive] Card not found: ${input}"
  exit 1
fi

name="$(basename "${src}")"
if [[ "${name}" == "README.md" || "${name}" == "TEMPLATE-QUESTION.md" ]]; then
  echo "[qa-archive] Refusing to archive template/readme file: ${name}"
  exit 1
fi

month_dir="$(date +%Y-%m)"
archive_dir="${qa_dir}/archive/${month_dir}"
mkdir -p "${archive_dir}"

tmp="$(mktemp)"
today="$(date +%Y-%m-%d)"

if rg -q "^Status:" "${src}" 2>/dev/null; then
  awk -v today="${today}" '
    BEGIN { archived_at_seen = 0 }
    /^Status:/ { print "Status: archived"; next }
    /^Archived At:/ { print "Archived At: " today; archived_at_seen = 1; next }
    { print }
    END {
      if (archived_at_seen == 0) {
        print ""
        print "Archived At: " today
      }
    }
  ' "${src}" > "${tmp}"
else
  {
    echo "Status: archived"
    echo "Archived At: ${today}"
    echo ""
    cat "${src}"
  } > "${tmp}"
fi

mv "${tmp}" "${src}"

dest="${archive_dir}/${name}"
if [[ -e "${dest}" ]]; then
  stem="${name%.md}"
  dest="${archive_dir}/${stem}-$(date +%H%M%S).md"
fi

mv "${src}" "${dest}"
echo "[qa-archive] Archived: ${dest}"
