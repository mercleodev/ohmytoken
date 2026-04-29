#!/usr/bin/env bash
# run-frontend-review.sh — print instructions for the in-session code-reviewer
# agent run that satisfies the toss-fundamentals + OhMyToken Addendum gate.
#
# This script does NOT call the agent itself (agents are Claude-session
# tools, not shell-callable). It prints what the agent must be invoked with
# and where to save its findings, so the pre-commit hook
# (check-frontend-review-ack.sh) and Stop hook (completion-gate.sh) can
# verify the report exists before allowing a commit.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "${repo_root}" ]]; then
  echo "[frontend-review] FAIL: not inside a git repository."
  exit 1
fi

fingerprint="$("${repo_root}/scripts/list-meaningful-changed-files.sh" --fingerprint || true)"
if [[ -z "${fingerprint}" ]]; then
  echo "[frontend-review] PASS: no meaningful changed files."
  exit 0
fi

changed_files="$("${repo_root}/scripts/list-meaningful-changed-files.sh" || true)"
if ! printf '%s\n' "${changed_files}" | grep -qE '\.(ts|tsx|js|jsx|css|mjs|cjs)$'; then
  echo "[frontend-review] PASS: change set has no code files (no toss-guideline scope)."
  exit 0
fi

report_file="${repo_root}/.policy/frontend-review-report.${fingerprint}.md"

if [[ -f "${report_file}" ]]; then
  verdict="$(grep -m1 '^## Verdict:' "${report_file}" 2>/dev/null | sed 's/^## Verdict:[[:space:]]*//' || true)"
  case "${verdict}" in
    OK|"OK with fixes")
      echo "[frontend-review] PASS: ${report_file} (verdict: ${verdict})"
      exit 0
      ;;
    BLOCK)
      echo "[frontend-review] FAIL: report verdict is BLOCK."
      echo "[frontend-review] Resolve critical findings in: ${report_file}"
      exit 1
      ;;
    *)
      echo "[frontend-review] FAIL: report exists but verdict is missing or unrecognized."
      echo "[frontend-review] Expected '## Verdict: OK' or '## Verdict: OK with fixes' or '## Verdict: BLOCK'."
      echo "[frontend-review] Report: ${report_file}"
      exit 1
      ;;
  esac
fi

style_items="$(printf '%s\n' "${changed_files}" | "${repo_root}/scripts/collect-style-review-items.sh" || true)"

cat <<EOF
[frontend-review] FAIL: missing report at .policy/frontend-review-report.${fingerprint}.md

Required action (run inside this Claude session — this gate cannot pass
without an explicit code-reviewer agent run):

1. Invoke the \`code-reviewer\` subagent with:
   - Rule reference: .claude/rules/frontend-design-guideline.md
     (Toss fundamentals + OhMyToken Addendum)
   - Severity classification: critical / major / minor
   - Scope: the changed files listed below

2. Save the agent's findings to:
   .policy/frontend-review-report.${fingerprint}.md

   Required header format (the pre-commit hook parses these lines):
       # Frontend Review Report
       ## Fingerprint: ${fingerprint}
       ## Changed Files (count): <N>
       ## Findings: <critical>/<major>/<minor>
       ## Verdict: OK | OK with fixes | BLOCK

   Verdict rules:
       - OK             — zero critical, zero major
       - OK with fixes  — zero critical, majors documented for follow-up
       - BLOCK          — at least one unresolved critical (commit blocked)

3. Critical findings must be either fixed in a new commit (then re-run
   this script — the fingerprint will change and a fresh report is
   required), or escalated to the user before proceeding.

4. Re-run: bash scripts/run-frontend-review.sh

---
Changed files in this fingerprint:
${changed_files}

---
Applicable review item IDs (from collect-style-review-items.sh):
${style_items:-(none — generic toss-guideline principles still apply)}
EOF

exit 1
