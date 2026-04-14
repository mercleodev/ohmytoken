#!/usr/bin/env bash
set -euo pipefail

files=()

if [[ "$#" -gt 0 ]]; then
  files=("$@")
else
  while IFS= read -r path; do
    if [[ -n "${path}" ]]; then
      files+=("${path}")
    fi
  done
fi

if [[ "${#files[@]}" -eq 0 ]]; then
  exit 0
fi

items=""

add_item() {
  local item="$1"
  if printf '%s\n' "${items}" | grep -qxF "${item}"; then
    return
  fi

  items="${items}${item}
"
}

has_typescript=0
has_frontend=0
has_ipc=0
has_electron=0
has_boundary=0
has_runtime_change=0
has_public_markdown=0

for path in "${files[@]}"; do
  case "${path}" in
    *.ts|*.tsx)
      has_typescript=1
      has_runtime_change=1
      ;;
  esac

  case "${path}" in
    *.tsx|*.css|src/components/*|src/hooks/*)
      has_frontend=1
      ;;
  esac

  case "${path}" in
    electron/*)
      has_electron=1
      ;;
  esac

  case "${path}" in
    electron/preload.ts|*ipc*|src/types/electron.d.ts)
      has_ipc=1
      ;;
  esac

  case "${path}" in
    electron/proxy/*|electron/db/*|electron/backfill/*|electron/evidence/*)
      has_boundary=1
      ;;
  esac

  case "${path}" in
    README.md|CONTRIBUTING.md|OPEN-SOURCE-WORKFLOW.md|SECURITY.md|docs/*.md|.github/*.md)
      has_public_markdown=1
      ;;
  esac
done

if [[ "${has_typescript}" -eq 1 ]]; then
  add_item "TS-01: No new \`any\` is introduced in touched lines unless it is a narrow bridge with an explicit reason"
  add_item "TS-02: Type-only imports are used where the codebase and toolchain support them"
  add_item "TS-04: Type assertions are minimal and replaced with narrowing where reasonable"
  add_item "NM-01: New files follow the local naming convention of the touched directory"
  add_item "NM-02: Existing files are not renamed only for stylistic normalization in unrelated work"
  add_item "IM-01: No new dependency is introduced without an explicit technical reason"
  add_item "IM-02: Imports do not cross boundaries in a way that couples unrelated layers"
  add_item "IM-03: Sensitive modules, tokens, or credentials are not exposed through logs or convenience imports"
  add_item "UX-03: Error handling matches the defined failure modes instead of silently swallowing errors"
  add_item "AR-04: Reuse/adapt/rewrite decisions are explicit for migration or parity work"
fi

if [[ "${has_frontend}" -eq 1 ]]; then
  add_item "UX-01: Async UI changes handle loading, error, and empty states when relevant"
  add_item "UX-02: Event listeners, intervals, and subscriptions are cleaned up correctly"
fi

if [[ "${has_electron}" -eq 1 ]]; then
  add_item "AR-01: Electron main-process code does not depend on renderer-only modules"
fi

if [[ "${has_ipc}" -eq 1 ]]; then
  add_item "TS-03: IPC or preload surface changes are reflected in \`src/types/electron.d.ts\` when applicable"
  add_item "AR-02: IPC changes follow the repository order: types -> main -> preload -> renderer"
fi

if [[ "${has_boundary}" -eq 1 ]]; then
  add_item "AR-03: Proxy, DB, and provider changes preserve existing transport-agnostic and provider-aware boundaries"
fi

if [[ "${has_runtime_change}" -eq 1 ]]; then
  add_item "DOC-01: Behavior or contract changes are reflected in tests and docs"
  add_item "DOC-03: Issue and PR text stays in English and matches actual implementation state"
fi

if [[ "${has_public_markdown}" -eq 1 ]]; then
  add_item "DOC-02: Public markdown additions or renames are reflected in \`.public-docs-allowlist\`"
  add_item "DOC-03: Issue and PR text stays in English and matches actual implementation state"
fi

printf '%s' "${items}" | awk 'NF'
