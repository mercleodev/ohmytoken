#!/usr/bin/env bash
# agent-discuss.sh — Orchestrator for Claude ↔ Codex multi-turn discussion
#
# Usage:
#   bash scripts/agent-discuss.sh <mode> <topic> [file]
#
# Modes:
#   review    — Codex writes, Claude reviews, Codex rebuts, Claude finalizes
#   discuss   — Claude proposes, Codex critiques, Claude revises
#   audit     — Claude audits code/plan, Codex defends, Claude concludes
#
# Examples:
#   bash scripts/agent-discuss.sh review "workflow change MVP plan review" plans/workflow-change-mvp-completion.md
#   bash scripts/agent-discuss.sh discuss "notification architecture direction"
#   bash scripts/agent-discuss.sh audit "prompt detail enrichment logic" src/components/dashboard/prompt-detail/usePromptDetail.ts

set -euo pipefail

# ── Config ──
MAX_TURNS=3
DISCUSSION_DIR=".claude/discussions"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)

# ── Args ──
MODE="${1:-}"
TOPIC="${2:-}"
INPUT_FILE="${3:-}"

if [[ -z "$MODE" || -z "$TOPIC" ]]; then
  echo "Usage: bash scripts/agent-discuss.sh <mode> <topic> [file]"
  echo ""
  echo "Modes: review, discuss, audit"
  echo ""
  echo "Examples:"
  echo "  bash scripts/agent-discuss.sh review \"plan review\" plans/some-plan.md"
  echo "  bash scripts/agent-discuss.sh discuss \"architecture discussion\""
  echo "  bash scripts/agent-discuss.sh audit \"code review\" src/some/file.ts"
  exit 1
fi

# ── Setup ──
SLUG=$(echo "$TOPIC" | tr ' ' '-' | sed 's/[^a-zA-Z0-9-]//g' | head -c 40)
SESSION_DIR="$DISCUSSION_DIR/$TIMESTAMP-$SLUG"
mkdir -p "$SESSION_DIR"

echo "╔══════════════════════════════════════════════╗"
echo "║  Agent Discussion: $MODE"
echo "║  Topic: $TOPIC"
echo "║  Output: $SESSION_DIR/"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Read input file content if provided
FILE_CONTEXT=""
if [[ -n "$INPUT_FILE" && -f "$INPUT_FILE" ]]; then
  FILE_CONTEXT=$(cat "$INPUT_FILE")
  echo "[*] Input file loaded: $INPUT_FILE ($(wc -l < "$INPUT_FILE") lines)"
  echo ""
fi

# ── System prompts per agent ──
CLAUDE_SYSTEM="You are reviewing work for the OhMyToken project (Electron + React token monitor).
Be direct, data-driven, and practical. Point out real issues, not theoretical ones.
Respond in Korean. Keep under 500 words."

CODEX_SYSTEM="You are contributing to the OhMyToken project (Electron + React token monitor).
Be concrete, defend your decisions with reasoning, and accept valid criticism.
Respond in Korean. Keep under 500 words."

# ── Turn execution helpers ──
run_claude() {
  local prompt="$1"
  local output="$2"
  local tmpfile
  tmpfile=$(mktemp /tmp/agent-discuss-claude.XXXXXX)
  echo "$prompt" > "$tmpfile"
  echo "[Claude] Thinking..."
  claude -p --no-session-persistence < "$tmpfile" > "$output" 2>/dev/null
  rm -f "$tmpfile"
  local lines
  lines=$(wc -l < "$output" | tr -d ' ')
  echo "[Claude] Done → $(basename "$output") ($lines lines)"
}

run_codex() {
  local prompt="$1"
  local output="$2"
  local tmpfile
  tmpfile=$(mktemp /tmp/agent-discuss-codex.XXXXXX)
  echo "$prompt" > "$tmpfile"
  echo "[Codex]  Thinking..."
  codex exec "$(cat "$tmpfile")" -o "$output" --full-auto 2>/dev/null
  rm -f "$tmpfile"
  local lines
  lines=$(wc -l < "$output" | tr -d ' ')
  echo "[Codex]  Done → $(basename "$output") ($lines lines)"
}

# ── Mode: review (Codex wrote something, Claude reviews) ──
run_review() {
  # Turn 1: Claude reviews
  local t1_prompt="$CLAUDE_SYSTEM

Please review the following document/plan.
Topic: $TOPIC

--- Document content ---
$FILE_CONTEXT
---

Provide concrete feedback based on actual codebase and data:
1. What works well
2. Concerns (with supporting evidence)
3. What is missing
4. Final verdict: proceed / revise / hold"

  run_claude "$t1_prompt" "$SESSION_DIR/01-claude-review.md"

  # Turn 2: Codex responds to review
  local claude_review=$(cat "$SESSION_DIR/01-claude-review.md")
  local t2_prompt="$CODEX_SYSTEM

Your plan has received the following review.
Topic: $TOPIC

--- Original plan ---
$FILE_CONTEXT
---

--- Review feedback ---
$claude_review
---

Respond to the review:
1. Accepted feedback and revision plan
2. Points to rebut (with evidence)
3. Revised plan summary"

  run_codex "$t2_prompt" "$SESSION_DIR/02-codex-response.md"

  # Turn 3: Claude final synthesis
  local codex_response=$(cat "$SESSION_DIR/02-codex-response.md")
  local t3_prompt="$CLAUDE_SYSTEM

Please write the final summary of the plan review discussion.
Topic: $TOPIC

--- Original plan ---
$FILE_CONTEXT
---

--- Claude review ---
$claude_review
---

--- Codex response ---
$codex_response
---

Final summary:
1. Points of agreement
2. Open issues remaining
3. Recommended next actions (be specific)"

  run_claude "$t3_prompt" "$SESSION_DIR/03-claude-final.md"
}

# ── Mode: discuss (Claude proposes, Codex critiques) ──
run_discuss() {
  local context=""
  if [[ -n "$FILE_CONTEXT" ]]; then
    context="

--- Reference file ---
$FILE_CONTEXT
---"
  fi

  # Turn 1: Claude proposes
  local t1_prompt="$CLAUDE_SYSTEM

Please write a proposal on the following topic.
Topic: $TOPIC
$context

Include concrete implementation direction, trade-offs, and recommendations."

  run_claude "$t1_prompt" "$SESSION_DIR/01-claude-proposal.md"

  # Turn 2: Codex critiques
  local claude_proposal=$(cat "$SESSION_DIR/01-claude-proposal.md")
  local t2_prompt="$CODEX_SYSTEM

Please provide a critical review of the following proposal.
Topic: $TOPIC
$context

--- Proposal ---
$claude_proposal
---

1. Points of agreement
2. Problems or gaps
3. Alternative or supplementary suggestions"

  run_codex "$t2_prompt" "$SESSION_DIR/02-codex-critique.md"

  # Turn 3: Claude revises
  local codex_critique=$(cat "$SESSION_DIR/02-codex-critique.md")
  local t3_prompt="$CLAUDE_SYSTEM

Please write a revised final proposal reflecting the discussion.
Topic: $TOPIC

--- Original proposal ---
$claude_proposal
---

--- Codex critique ---
$codex_critique
---

Write the revised final proposal. Separate agreed points from open issues."

  run_claude "$t3_prompt" "$SESSION_DIR/03-claude-revised.md"
}

# ── Mode: audit (Claude audits, Codex defends) ──
run_audit() {
  local context=""
  if [[ -n "$FILE_CONTEXT" ]]; then
    context="

--- Target code/document ---
$FILE_CONTEXT
---"
  fi

  # Turn 1: Claude audits
  local t1_prompt="$CLAUDE_SYSTEM

Please audit the following code/design.
Topic: $TOPIC
$context

Check for:
1. Bugs or edge cases
2. Performance issues
3. Design concerns
4. Missing tests/validation
5. Classify by severity (critical/warning/info)"

  run_claude "$t1_prompt" "$SESSION_DIR/01-claude-audit.md"

  # Turn 2: Codex defends/accepts
  local claude_audit=$(cat "$SESSION_DIR/01-claude-audit.md")
  local t2_prompt="$CODEX_SYSTEM

Please respond to the following audit findings.
Topic: $TOPIC
$context

--- Audit findings ---
$claude_audit
---

For each finding:
1. Accept → describe fix plan
2. Rebut → provide evidence
3. Defer → explain reason"

  run_codex "$t2_prompt" "$SESSION_DIR/02-codex-defense.md"

  # Turn 3: Claude concludes
  local codex_defense=$(cat "$SESSION_DIR/02-codex-defense.md")
  local t3_prompt="$CLAUDE_SYSTEM

Please write the final conclusion of the audit discussion.
Topic: $TOPIC

--- Audit findings ---
$claude_audit
---

--- Defense/acceptance ---
$codex_defense
---

Final conclusion:
1. Items requiring immediate fix
2. Accepted defenses
3. Items requiring further investigation
4. Overall verdict: PASS / CONDITIONAL / FAIL"

  run_claude "$t3_prompt" "$SESSION_DIR/03-claude-conclusion.md"
}

# ── Execute ──
case "$MODE" in
  review)  run_review ;;
  discuss) run_discuss ;;
  audit)   run_audit ;;
  *)
    echo "Unknown mode: $MODE (use: review, discuss, audit)"
    exit 1
    ;;
esac

# ── Summary ──
echo ""
echo "════════════════════════════════════════════════"
echo "  Discussion complete ($MAX_TURNS turns)"
echo "  Results: $SESSION_DIR/"
echo ""
ls -1 "$SESSION_DIR/"
echo "════════════════════════════════════════════════"
