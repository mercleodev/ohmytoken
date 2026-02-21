#!/usr/bin/env bash
set -euo pipefail

mode="staged"
print_required=0
no_ack=0

for arg in "$@"; do
  case "$arg" in
    --mode=staged)
      mode="staged"
      ;;
    --mode=all)
      mode="all"
      ;;
    --print-required)
      print_required=1
      ;;
    --no-ack)
      no_ack=1
      ;;
    *)
      echo "[rules-check] FAIL: unknown option '$arg'"
      echo "[rules-check] Usage: $0 [--mode=staged|all] [--print-required] [--no-ack]"
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[rules-check] FAIL: not inside a git repository."
  exit 1
fi

catalog_file="${repo_root}/policy/RULES-CATALOG.txt"
ack_file="${repo_root}/.policy/active-rules-ack.txt"

if [[ ! -f "$catalog_file" ]]; then
  echo "[rules-check] FAIL: missing policy catalog: ${catalog_file}"
  exit 1
fi

changed_files=()
if [[ "$mode" == "staged" ]]; then
  while IFS= read -r file; do
    [[ -n "$file" ]] && changed_files+=("$file")
  done < <(git diff --cached --name-only --diff-filter=ACMR)
else
  while IFS= read -r file; do
    [[ -n "$file" ]] && changed_files+=("$file")
  done < <(git ls-files)
fi

if [[ ${#changed_files[@]} -eq 0 ]]; then
  exit 0
fi

contains_item() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    [[ "$item" == "$needle" ]] && return 0
  done
  return 1
}

lookup_rule_refs() {
  local rule="$1"
  while IFS='|' read -r rule_id _patterns refs; do
    [[ -z "$rule_id" || "$rule_id" =~ ^# ]] && continue
    if [[ "$rule_id" == "$rule" ]]; then
      echo "$refs"
      return 0
    fi
  done < "$catalog_file"
  return 1
}

required_rules=()
for file in "${changed_files[@]}"; do
  while IFS='|' read -r rule_id patterns _refs; do
    [[ -z "$rule_id" || "$rule_id" =~ ^# ]] && continue
    IFS=',' read -r -a pattern_arr <<< "$patterns"
    matched=0
    for pattern in "${pattern_arr[@]}"; do
      if [[ "$file" == $pattern ]]; then
        matched=1
        break
      fi
    done
    if [[ $matched -eq 1 ]] && ! contains_item "$rule_id" "${required_rules[@]-}"; then
      required_rules+=("$rule_id")
    fi
  done < "$catalog_file"
done

if [[ ${#required_rules[@]} -eq 0 ]]; then
  exit 0
fi

if [[ $print_required -eq 1 ]]; then
  printf "%s\n" "${required_rules[@]}"
  exit 0
fi

if [[ $no_ack -eq 1 ]]; then
  echo "[rules-check] INFO: required rules (${mode}): ${required_rules[*]}"
  exit 0
fi

if [[ ! -f "$ack_file" ]]; then
  echo "[rules-check] FAIL: missing ${ack_file}"
  echo "[rules-check] Create/update it before commit:"
  echo "  bash scripts/set-active-rules-ack.sh <task-id>"
  echo "[rules-check] Required rules now: ${required_rules[*]}"
  exit 1
fi

ack_rules=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%"${line##*[![:space:]]}"}"
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  ack_rules+=("$line")
done < "$ack_file"

missing_rules=()
for rule in "${required_rules[@]}"; do
  if ! contains_item "$rule" "${ack_rules[@]-}"; then
    missing_rules+=("$rule")
  fi
done

if [[ ${#missing_rules[@]} -gt 0 ]]; then
  echo "[rules-check] FAIL: active rules acknowledgement is stale."
  echo "[rules-check] Missing acknowledgements:"
  for rule in "${missing_rules[@]}"; do
    refs="$(lookup_rule_refs "$rule" || true)"
    echo "  - ${rule}: ${refs}"
  done
  echo "[rules-check] Refresh acknowledgement:"
  echo "  bash scripts/set-active-rules-ack.sh <task-id>"
  exit 1
fi

echo "[rules-check] PASS: required rules acknowledged (${required_rules[*]})"
