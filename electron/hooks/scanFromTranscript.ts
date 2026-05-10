import fs from "node:fs";
import { countTokens } from "../analyzer/tokenCounter";
import type { InjectedFile, PromptScan } from "../proxy/types";
import { readLatestTurn } from "./transcriptReader";
import type { TranscriptUsage } from "./transcriptReader";

export type ScanFromTranscriptParams = {
  transcriptPath: string;
  globalClaudeMdPath?: string;
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

  for (const m of turn.nested_memories) {
    injectedFiles.push({
      path: m.path,
      category: classifyNestedMemoryType(m.type),
      estimated_tokens: countTokens(m.content),
    });
  }

  const globalEntry = readGlobalClaudeMd(params.globalClaudeMdPath);
  if (globalEntry && !injectedFiles.some((f) => f.path === globalEntry.path)) {
    injectedFiles.push(globalEntry);
  }

  const totalInjectedTokens = injectedFiles.reduce(
    (sum, f) => sum + f.estimated_tokens,
    0,
  );

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
