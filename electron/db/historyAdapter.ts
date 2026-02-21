import type { PromptScan, UsageLogEntry } from "../proxy/types";
import { getDatabase } from "./index";
import { insertPrompt } from "./writer";
import type { InsertPromptData } from "./writer";

/**
 * Insert a history-derived prompt into the DB.
 * Returns the new prompt ID, or null if the request_id already exists
 * (proxy data takes priority — UNIQUE constraint on request_id).
 */
export const onHistoryPromptParsed = (
  scan: PromptScan,
  usage: UsageLogEntry | null,
): number | null => {
  // Skip if proxy already has this data (check by request_id)
  const db = getDatabase();
  const existing = db
    .prepare("SELECT id FROM prompts WHERE request_id = @rid")
    .get({ rid: scan.request_id });
  if (existing) return null;

  const breakdown = scan.context_estimate.messages_tokens_breakdown;

  const data: InsertPromptData = {
    prompt: {
      request_id: scan.request_id,
      session_id: scan.session_id,
      timestamp: scan.timestamp,
      source: "history",
      user_prompt: scan.user_prompt,
      user_prompt_tokens: scan.user_prompt_tokens,
      assistant_response: scan.assistant_response,
      model: scan.model,
      max_tokens: scan.max_tokens,
      conversation_turns: scan.conversation_turns,
      user_messages_count: scan.user_messages_count,
      assistant_messages_count: scan.assistant_messages_count,
      tool_result_count: scan.tool_result_count,
      system_tokens: scan.context_estimate.system_tokens,
      messages_tokens: scan.context_estimate.messages_tokens,
      user_text_tokens: breakdown?.user_text_tokens ?? 0,
      assistant_tokens: breakdown?.assistant_tokens ?? 0,
      tool_result_tokens: breakdown?.tool_result_tokens ?? 0,
      tools_definition_tokens: scan.context_estimate.tools_definition_tokens,
      total_context_tokens: scan.context_estimate.total_tokens,
      total_injected_tokens: scan.total_injected_tokens,
      tool_summary: scan.tool_summary,
      input_tokens: usage?.response.input_tokens ?? 0,
      output_tokens: usage?.response.output_tokens ?? 0,
      cache_creation_input_tokens:
        usage?.response.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage?.response.cache_read_input_tokens ?? 0,
      cost_usd: usage?.cost_usd ?? 0,
      duration_ms: usage?.duration_ms ?? 0,
      req_messages_count: usage?.request.messages_count ?? 0,
      req_tools_count: usage?.request.tools_count ?? 0,
      req_has_system: usage?.request.has_system ?? true,
    },
    injected_files: scan.injected_files.map((f) => ({
      path: f.path,
      category: f.category,
      estimated_tokens: f.estimated_tokens,
    })),
    tool_calls: scan.tool_calls.map((t) => ({
      call_index: t.index,
      name: t.name,
      input_summary: t.input_summary,
      timestamp: t.timestamp,
    })),
    agent_calls: scan.agent_calls.map((a) => ({
      call_index: a.index,
      subagent_type: a.subagent_type,
      description: a.description,
    })),
  };

  return insertPrompt(data);
};
