/**
 * Draft artifact generator for workflow change recommendations.
 *
 * Produces deterministic first-draft content based on HarnessCandidate data.
 * The drafts are scaffolds intended for user review and editing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ArtifactKind = 'script' | 'command' | 'checklist' | 'context_profile' | 'markdown_brief';

type PreviewWorkflowDraftResult = {
  artifactKind: ArtifactKind;
  title: string;
  suggestedPath: string;
  content: string;
};

type CandidateInput = {
  toolName: string;
  inputSummary: string;
  candidateKind: string;
  repeatCount: number;
  promptCount: number;
  sessionCount: number;
  totalCostUsd: number;
  provider: string;
  sampleRequestIds?: string[];
};

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^mcp__/, '')
    .replace(/__/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// ---------------------------------------------------------------------------
// Template generators
// ---------------------------------------------------------------------------

function generateScript(candidate: CandidateInput): PreviewWorkflowDraftResult {
  const slug = toSlug(candidate.toolName);
  const inputPreview = candidate.inputSummary.slice(0, 200);

  const content = `#!/usr/bin/env bash
set -euo pipefail

# Auto-generated from OhMyToken workflow change detection.
# Tool: ${candidate.toolName}
# Detected: ${candidate.repeatCount} repetitions across ${candidate.sessionCount} session(s)
#
# Review and customize before use.

# --- Parameters ---
# TODO: Replace hardcoded values with script arguments
TARGET="\${1:?Usage: $0 <target>}"

# --- Main ---
# Original repeated operation:
# ${inputPreview.split('\n').join('\n# ')}

echo "Running ${slug} on ${"$"}TARGET ..."

# TODO: Implement the extracted operation here

echo "Done."
`;

  return {
    artifactKind: 'script',
    title: `Reusable Script: ${candidate.toolName}`,
    suggestedPath: `scripts/${slug}.sh`,
    content,
  };
}

function generateCommand(candidate: CandidateInput): PreviewWorkflowDraftResult {
  const slug = toSlug(candidate.toolName);
  const inputPreview = candidate.inputSummary.slice(0, 300);

  const content = `# ${slug}

## Goal

Perform the "${candidate.toolName}" operation that was repeated ${candidate.repeatCount} times.

## Scope

$ARGUMENTS

## Required Focus Areas

- ${inputPreview.split('\n').slice(0, 3).join('\n- ') || 'Review the repeated operation pattern'}

## Response Format

- Execute the operation on the specified target
- Report what was changed or found
- Flag any issues encountered
`;

  return {
    artifactKind: 'command',
    title: `Reusable Command: ${candidate.toolName}`,
    suggestedPath: `.claude/commands/${slug}.md`,
    content,
  };
}

function generateChecklist(candidate: CandidateInput): PreviewWorkflowDraftResult {
  const slug = toSlug(candidate.toolName);
  const inputPreview = candidate.inputSummary.slice(0, 300);

  const content = `# ${slug} Checklist

## Goal

Complete the "${candidate.toolName}" review procedure that was repeated ${candidate.repeatCount} times across ${candidate.sessionCount} session(s).

## Steps

1. [ ] Identify the target scope
2. [ ] Run the primary check: ${inputPreview.split('\n')[0] || candidate.toolName}
3. [ ] Review results for expected patterns
4. [ ] Document findings
5. [ ] Confirm completion

## Expected Output

- Summary of findings
- List of issues (if any)
- Confirmation that all checks passed
`;

  return {
    artifactKind: 'checklist',
    title: `Reusable Checklist: ${candidate.toolName}`,
    suggestedPath: `.claude/checklists/${slug}.md`,
    content,
  };
}

function generateContextProfile(candidate: CandidateInput): PreviewWorkflowDraftResult {
  const slug = toSlug(candidate.toolName);

  const content = `# ${slug} Context Profile

## Stable Inputs

- Tool: ${candidate.toolName}
- Provider: ${candidate.provider || 'all'}
- Detected repetitions: ${candidate.repeatCount}

## Intended Use Cases

- Load this profile when working on tasks that involve "${candidate.toolName}"
- Reduces repeated context injection by pre-loading stable references

## Exclusions

- Do not auto-include task-specific files
- Do not include temporary or generated artifacts
`;

  return {
    artifactKind: 'context_profile',
    title: `Context Profile: ${candidate.toolName}`,
    suggestedPath: `.claude/rules/profiles/${slug}.md`,
    content,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateWorkflowDraft(candidate: CandidateInput): PreviewWorkflowDraftResult {
  switch (candidate.candidateKind) {
    case 'script':
      return generateScript(candidate);
    case 'cdp':
      // CDP uses markdown brief as the default v1 artifact
      return {
        ...generateScript(candidate),
        artifactKind: 'markdown_brief',
        title: `Browser Automation: ${candidate.toolName}`,
        suggestedPath: `automation/${toSlug(candidate.toolName)}.md`,
        content: `# Browser Automation: ${candidate.toolName}

## Pattern Detected

This browser interaction repeated ${candidate.repeatCount} times across ${candidate.sessionCount} session(s).

## Observed Flow

Tool: ${candidate.toolName}
Input pattern: ${candidate.inputSummary.slice(0, 300)}

## Recommended Automation

1. Extract the browser navigation sequence
2. Parameterize variable targets (URLs, selectors)
3. Create a Playwright script or automation spec

## Cost Impact

- Estimated cost of repeated calls: $${candidate.totalCostUsd.toFixed(4)}
- Prompts affected: ${candidate.promptCount}
`,
      };
    case 'prompt_template':
      return generateCommand(candidate);
    case 'checklist':
      return generateChecklist(candidate);
    default:
      return generateScript(candidate);
  }
}

export function generateContextProfileDraft(candidate: CandidateInput): PreviewWorkflowDraftResult {
  return generateContextProfile(candidate);
}

export type { PreviewWorkflowDraftResult, CandidateInput, ArtifactKind };
