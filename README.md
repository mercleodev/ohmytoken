# OhMyToken

OhMyToken is a real-time AI agent token usage monitor and prompt CT scan tool.

It intercepts Claude/Codex/Gemini API calls via a local proxy, parses SSE streams, and visualizes context window usage, injected files, tool calls, and cost breakdowns.

---

## Start

1. Read `.claude/docs/START-HERE.md`
2. Follow contribution and testing gates before merge

---

## Core Documents

1. `CONTRIBUTING.md`
2. `OPEN-SOURCE-WORKFLOW.md`
3. `.claude/docs/AUTONOMOUS-OSS-OPS.md`
4. `.claude/docs/GIT-IDENTITY-POLICY.md`
5. `.claude/qa/README.md` (private)
6. `docs/decisions/README.md` (public ADRs)
7. `policy/RULES-CATALOG.txt`

## Policy Precedence

Use this precedence when policies overlap:

1. `CONTRIBUTING.md` is the merge policy of record.
2. `OPEN-SOURCE-WORKFLOW.md` defines execution flow and CI gate mapping.

If there is a conflict, follow the highest document in this list.

Runtime note:

1. `CLAUDE.md`, `AGENTS.md`, or provider-specific prompts are advisory instructions only.
2. Enforcement is done by repository pipeline gates (hooks + CI + PR policy checks), not by agent claims.

## Top-Level Enforcement Pipeline

This pipeline is provider-agnostic and agent-agnostic (`claude`, `codex`, `gemini`, or manual).

1. Task start: run `bash scripts/set-active-rules-ack.sh <task-id>`.
2. Local commit gate: `pre-commit` runs identity/content checks plus applicable-rules acknowledgement validation.
3. PR gate: `policy-gate` workflow requires `Applicable Rules` section with checked doc/section references.
4. CI gate: `ci` workflow requires content guard, markdown allowlist, typecheck, lint, and test.
5. Merge rule: branch protection must require `policy-gate`, `content-guard`, and `ci` before merge.

## Operator Setup Checklist

Run once per clone:

1. `bash scripts/setup-git-identity-lock.sh`
2. `bash scripts/verify-git-identity-lock.sh`
3. `git config core.hooksPath .githooks`

Run once per task/issue:

1. `bash scripts/set-active-rules-ack.sh <task-id>`
2. Start implementation only after the ack file is generated.

GitHub repository settings (mandatory):

1. Enable branch protection on `main`.
2. Require pull request before merge.
3. Require status checks: `policy-gate`, `content-guard`, `ci`.
4. Disable force push on `main`.

---

## Principles

1. Real-time token monitoring with proxy-based interception
2. Multi-provider support (Claude, Codex, Gemini)
3. English-only repository-facing artifacts
4. Regression-safe shipping discipline
5. Reuse-first migration from validated legacy behavior; rewrite only with explicit technical justification
6. Repository-local git identity lock is mandatory
7. Public markdown publishing is allowlist-based (`.public-docs-allowlist`)

---

## License

[Apache License 2.0](./LICENSE)
