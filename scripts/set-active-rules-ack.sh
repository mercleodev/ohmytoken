#!/usr/bin/env bash
set -euo pipefail

mode="staged"
task_id=""

for arg in "$@"; do
  case "$arg" in
    --mode=staged)
      mode="staged"
      ;;
    --mode=all)
      mode="all"
      ;;
    --task=*)
      task_id="${arg#--task=}"
      ;;
    *)
      if [[ -z "$task_id" ]]; then
        task_id="$arg"
      else
        echo "[rules-ack] FAIL: unknown argument '$arg'"
        echo "[rules-ack] Usage: $0 [task-id|--task=<id>] [--mode=staged|all]"
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$task_id" ]]; then
  task_id="manual-session"
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "[rules-ack] FAIL: not inside a git repository."
  exit 1
fi

ack_dir="${repo_root}/.policy"
ack_file="${ack_dir}/active-rules-ack.txt"

mkdir -p "$ack_dir"

required_rules="$("${repo_root}/scripts/check-applicable-rules.sh" --mode="${mode}" --print-required || true)"

{
  echo "# OhMyToken Active Rules Acknowledgement"
  echo "# task: ${task_id}"
  echo "# mode: ${mode}"
  echo "# updated_at_utc: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  if [[ -n "${required_rules}" ]]; then
    printf "%s\n" "${required_rules}"
  else
    echo "NO-RULES"
  fi
} > "$ack_file"

echo "[rules-ack] Updated: ${ack_file}"
if [[ -n "${required_rules}" ]]; then
  echo "[rules-ack] Rules:"
  printf "  - %s\n" ${required_rules}
else
  echo "[rules-ack] No matching rules for current ${mode} scope."
fi
