#!/usr/bin/env bash
set -euo pipefail

mode="staged"
for arg in "$@"; do
  case "$arg" in
    --mode=staged|--staged)
      mode="staged"
      ;;
    --mode=all|--all)
      mode="all"
      ;;
    *)
      echo "[content-guard] FAIL: unknown option '${arg}'"
      echo "[content-guard] Usage: $0 [--mode=staged|--mode=all]"
      exit 1
      ;;
  esac
done

if ! command -v rg >/dev/null 2>&1; then
  echo "[content-guard] FAIL: ripgrep (rg) is required."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[content-guard] FAIL: not inside a git repository."
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "${repo_root}"

staged_files=()
while IFS= read -r file; do
  [[ -n "${file}" ]] && staged_files+=("${file}")
done < <(
  if [[ "${mode}" == "all" ]]; then
    git ls-files
  else
    git diff --cached --name-only --diff-filter=ACMR
  fi
)

if [[ ${#staged_files[@]} -eq 0 ]]; then
  exit 0
fi

allowlist_file="${repo_root}/.public-docs-allowlist"
allowed_md_files=()
if [[ -f "${allowlist_file}" ]]; then
  while IFS= read -r line; do
    line="${line%%#*}"
    line="$(echo "${line}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [[ -n "${line}" ]] && allowed_md_files+=("${line}")
  done < "${allowlist_file}"
fi

identity_file="${repo_root}/.git-identity.local"
private_tokens=()
if [[ -f "${identity_file}" ]]; then
  # shellcheck source=/dev/null
  source "${identity_file}"
  [[ -n "${GIT_IDENTITY_NAME:-}" ]] && private_tokens+=("${GIT_IDENTITY_NAME}")
  [[ -n "${GIT_IDENTITY_EMAIL:-}" ]] && private_tokens+=("${GIT_IDENTITY_EMAIL}")
  [[ -n "${GIT_IDENTITY_REMOTE:-}" ]] && private_tokens+=("${GIT_IDENTITY_REMOTE}")
fi

tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT

fail=0

print_hit() {
  local file="$1"
  local rule="$2"
  echo "[content-guard] ${rule} in ${file}"
  sed -n '1,3p' "${tmp}" | sed 's/^/  line /'
}

is_internal_doc() {
  local f="$1"
  [[ "${f}" == .claude/* ]] || [[ "${f}" == docs/decisions/* ]] || [[ "${f}" == policy/* ]]
}

for file in "${staged_files[@]}"; do
  skip_self_pattern_checks=0
  if [[ "${file}" == "scripts/check-content-guard.sh" ]]; then
    skip_self_pattern_checks=1
  fi

  if is_internal_doc "${file}"; then
    continue
  fi

  if [[ "${file}" == *.md ]]; then
    md_allowed=0
    for allowed in "${allowed_md_files[@]}"; do
      if [[ "${file}" == "${allowed}" ]]; then
        md_allowed=1
        break
      fi
    done
    if [[ "${md_allowed}" -eq 0 ]]; then
      echo "[content-guard] Markdown file is not in public allowlist: ${file}"
      echo "[content-guard] Allowed markdown files are defined in .public-docs-allowlist"
      fail=1
      continue
    fi
  fi

  if [[ "${mode}" == "all" ]]; then
    if [[ ! -f "${file}" ]]; then
      continue
    fi
    if ! git grep -Iq . -- "${file}" && [[ -s "${file}" ]]; then
      continue
    fi
    added_lines="$(cat "${file}")"
  else
    numstat_line="$(git diff --cached --numstat -- "${file}" | tail -n 1 || true)"
    if echo "${numstat_line}" | rg -q '^-\\s+-\\s+'; then
      continue
    fi

    added_lines="$(git diff --cached --no-color --unified=0 -- "${file}" | awk '
      /^\+\+\+ / { next }
      /^@@ / { next }
      /^\+/ { print substr($0, 2) }
    ')"
  fi

  if [[ -z "${added_lines}" ]]; then
    continue
  fi

  if [[ "${skip_self_pattern_checks}" -eq 0 ]]; then
    if echo "${added_lines}" | rg -n '[\u{AC00}-\u{D7A3}\u{3131}-\u{318E}\u{314F}-\u{3163}]' >"${tmp}"; then
      print_hit "${file}" "Hangul text is not allowed in repository-facing content"
      fail=1
    fi

    if echo "${added_lines}" | rg -n '/(Users|home)/' >"${tmp}"; then
      print_hit "${file}" "Local filesystem path detected"
      fail=1
    fi

  fi

  for token in "${private_tokens[@]}"; do
    if [[ "${#token}" -lt 3 ]]; then
      continue
    fi
    if echo "${added_lines}" | rg -n --fixed-strings -- "${token}" >"${tmp}"; then
      print_hit "${file}" "Private identity token detected"
      fail=1
      break
    fi
  done
done

if [[ "${fail}" -ne 0 ]]; then
  echo "[content-guard] Commit blocked."
  echo "[content-guard] Remove private or non-policy content from staged changes."
  exit 1
fi

exit 0
