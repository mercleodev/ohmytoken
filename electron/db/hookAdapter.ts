import type { PromptScan, UsageLogEntry } from "../proxy/types";
import { insertPrompt } from "./writer";
import type { InsertPromptData } from "./writer";

/**
 * Mirrors `proxyAdapter.onProxyScanComplete` for scans that arrive via the
 * Stop-hook capture path (issue #343, captured 2026-05-10). Same insert
 * shape; only the `source` discriminator changes so the dashboard can tell
 * the two transports apart and the proxy-vs-hook dedup precedence works.
 */
export const onHookScanComplete = (
  scan: PromptScan,
  usage: UsageLogEntry,
): number | null => {
  const breakdown = scan.context_estimate.messages_tokens_breakdown;

  const data: InsertPromptData = {
    prompt: {
      request_id: scan.request_id,
      session_id: scan.session_id,
      timestamp: scan.timestamp,
      source: "hook",
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
      input_tokens: usage.response.input_tokens,
      output_tokens: usage.response.output_tokens,
      cache_creation_input_tokens: usage.response.cache_creation_input_tokens,
      cache_read_input_tokens: usage.response.cache_read_input_tokens,
      cost_usd: usage.cost_usd,
      duration_ms: usage.duration_ms,
      req_messages_count: usage.request.messages_count,
      req_tools_count: usage.request.tools_count,
      req_has_system: usage.request.has_system,
      git_branch: scan.git_branch,
      project_path: scan.project_path,
    },
    injected_files: scan.injected_files.map((f) => ({
      path: f.path,
      category: f.category,
      estimated_tokens: f.estimated_tokens,
    })),
    tool_calls: [],
    agent_calls: [],
  };

  return insertPrompt(data);
};
