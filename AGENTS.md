# OhMyToken Workspace Rules

## Language Policy (Mandatory)

- Use English only in all work artifacts.
- Commit messages must be high-quality, consistent, and fully in English.
- Do not include Korean in code comments, docs, PR descriptions, or reports.
- User-facing assistant replies, explanations, and task reports may be in Korean
  when the user explicitly requests Korean.

## Repository Identity Lock (Mandatory)

- This workspace must use repository-local git identity only:
- values are loaded from `.git-identity.local` (git-ignored).
- run `bash scripts/setup-git-identity-lock.sh` and `bash scripts/verify-git-identity-lock.sh`.
- Do not use global git identity or non-origin push targets in this workspace.

## Product Context (Mandatory)

- OhMyToken is a real-time AI agent token usage monitor.
- It intercepts API calls via a local proxy, parses SSE streams, and visualizes context window usage.
- Prioritize accurate token counting, real-time monitoring, and clear cost breakdowns.

## Markdown Policy (Claude + Codex)

- All markdown files are agent-neutral and must be used by both Claude and Codex.
- Do not treat `.claude/*.md` as Claude-only guidance.
- Use `.claude/docs/MD-SOURCE-OF-TRUTH.md` as the shared markdown policy.

## Ambiguous Direction Protocol (Mandatory)

- Claude is the primary implementation agent.
- If direction is ambiguous, create a private QA card first:
- `bash scripts/new-qa-card.sh <short-topic-slug>`
- Request Codex input and record it in `## Codex Answer`.
- Finalize with `## Final Decision (Claude)`.
- If architecture/protocol is affected, promote to ADR with:
- `bash scripts/new-adr.sh <short-title-slug>`

## Autonomous Continuation (Mandatory)

- Default execution scope is session/batch, not per-command and not per-single-issue.
- If explicit batch issue ids are provided, follow that batch.
- If explicit batch issue ids are not provided, infer an implicit batch from the active queue (current issue + next prioritized issues).
- Do not ask "continue to next issue?" while still inside the in-scope batch.
- Ask for reconfirmation only when:
- scope expansion outside the in-scope batch
- security-sensitive or architecture-risk direction changes
- merge-to-main or release actions
- history rewrite actions (`force-push`, shared-history rebase)
- Stop immediately only when user explicitly requests stop/pause.

## Quality Gate

- For all changes, include typecheck, lint, and targeted tests.
- In final report, state which guideline file was used and which constraints were applied.
- For all changes, update relevant docs/checklists immediately when behavior/spec/workflow changes (no deferred doc-only cleanup phase).
- Pre-commit content guard applies to all staged text files, not only Markdown.
