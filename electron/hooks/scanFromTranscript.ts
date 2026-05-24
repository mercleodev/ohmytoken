import fs from "node:fs";
import os from "node:os";
import { countTokens } from "../analyzer/tokenCounter";
import type { InjectedFile, PromptScan } from "../proxy/types";
import { collectDotClaudeFiles } from "./dotClaudeScanner";
import { readLatestTurn } from "./transcriptReader";
import type { TranscriptUsage } from "./transcriptReader";

export type ScanFromTranscriptParams = {
  transcriptPath: string;
  globalClaudeMdPath?: string;
  /**
   * Override for the user's home directory. Defaults to `os.homedir()`.
   * Tests inject a tmp dir so disk-scan fixtures stay hermetic.
   */
  homeDir?: string;
};

export type ScanFromTranscriptResult = {
  scan: PromptScan;
  usage: TranscriptUsage;
};

const classifyNestedMemoryType = (t: string): InjectedFile["category"] => {
  switch (t) {
    case "Project":
      return "project";
    case "User":
      return "global";
    default:
      return "project";
  }
};

const readGlobalClaudeMd = (
  pathOrUndefined: string | undefined,
): InjectedFile | null => {
  if (!pathOrUndefined) return null;
  let content: string;
  try {
    content = fs.readFileSync(pathOrUndefined, "utf-8");
  } catch {
    return null;
  }
  return {
    path: pathOrUndefined,
    category: "global",
    estimated_tokens: countTokens(content),
  };
};

export const scanFromTranscript = (
  params: ScanFromTranscriptParams,
): ScanFromTranscriptResult | null => {
  const turn = readLatestTurn(params.transcriptPath);
  if (!turn) return null;

  const injectedFiles: InjectedFile[] = [];
  const seenPaths = new Set<string>();
  const push = (entry: InjectedFile): void => {
    if (seenPaths.has(entry.path)) return;
    seenPaths.add(entry.path);
    injectedFiles.push(entry);
  };

  // Transcript-confirmed entries (nested_memories + explicit global CLAUDE.md path):
  // these are the only files we can prove the LLM saw this turn, so they alone
  // feed `total_injected_tokens` — the dashboard's user-facing budget number.
  let totalInjectedTokens = 0;
  const pushConfirmed = (entry: InjectedFile): void => {
    if (seenPaths.has(entry.path)) return;
    totalInjectedTokens += entry.estimated_tokens;
    push(entry);
  };

  for (const m of turn.nested_memories) {
    pushConfirmed({
      path: m.path,
      category: classifyNestedMemoryType(m.type),
      estimated_tokens: countTokens(m.content),
    });
  }

  const globalEntry = readGlobalClaudeMd(params.globalClaudeMdPath);
  if (globalEntry) pushConfirmed(globalEntry);

  // Disk-scan candidates (issue #363): CC 2.x does not persist the
  // <system-reminder> rule injections to the local JSONL, so we reconstruct
  // the candidate pool from `<cwd>/.claude/{rules,memory,skills}` and the
  // user's home equivalent. These entries appear in `injected_files` so the
  // evidence engine can bind ack tokens to them, but they are deliberately
  // excluded from `total_injected_tokens` — we cannot prove every disk file
  // was actually injected by CC for this specific turn.
  const homeDir = params.homeDir ?? os.homedir();
  for (const entry of collectDotClaudeFiles(turn.cwd)) push(entry);
  for (const entry of collectDotClaudeFiles(homeDir)) push(entry);

  const userPromptTokens = countTokens(turn.user_message_text);
  const assistantTokens = countTokens(turn.assistant_message_text);
  const messagesTokens = userPromptTokens + assistantTokens;

  const requestId = turn.request_id ?? `hook-${turn.assistant_uuid}`;

  const scan: PromptScan = {
    request_id: requestId,
    session_id: turn.session_id ?? "unknown",
    timestamp: turn.assistant_timestamp || new Date().toISOString(),

    user_prompt: turn.user_message_text,
    user_prompt_tokens: userPromptTokens,
    assistant_response: turn.assistant_message_text || undefined,

    injected_files: injectedFiles,
    total_injected_tokens: totalInjectedTokens,

    tool_calls: [],
    tool_summary: {},

    agent_calls: [],

    context_estimate: {
      system_tokens: 0,
      messages_tokens: messagesTokens,
      messages_tokens_breakdown: {
        user_text_tokens: userPromptTokens,
        assistant_tokens: assistantTokens,
        tool_result_tokens: 0,
      },
      tools_definition_tokens: 0,
      total_tokens: messagesTokens,
    },

    model: turn.model,
    max_tokens: 0,
    conversation_turns: 1,
    user_messages_count: 1,
    assistant_messages_count: 1,
    tool_result_count: 0,

    git_branch: turn.git_branch,
    project_path: turn.cwd,
  };

  return { scan, usage: turn.usage };
};
