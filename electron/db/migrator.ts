import * as fs from "fs";
import { homedir } from "os";
import * as path from "path";
import { getDatabase } from "./index";
import { insertPrompt, upsertDailyStats, upsertSession } from "./writer";
import type { PromptScan, UsageLogEntry } from "../proxy/types";
import type { InsertPromptData } from "./writer";

const SCAN_FILE = path.join(
  homedir(),
  ".claude",
  "context-state",
  "prompt-scans.jsonl",
);
const USAGE_FILE = path.join(
  homedir(),
  ".claude",
  "context-state",
  "api-usage.jsonl",
);

const readJsonlFile = <T>(filePath: string): T[] => {
  if (!fs.existsSync(filePath)) return [];
  try {
    return fs
      .readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
};

/**
 * Import existing JSONL data into the DB.
 * Runs once on first launch when DB is empty.
 * Non-blocking: failures are logged but don't prevent app startup.
 */
export const migrateJsonlToDb = (): { scans: number; usage: number } => {
  const db = getDatabase();
  const count = (
    db.prepare("SELECT COUNT(*) as cnt FROM prompts").get() as { cnt: number }
  ).cnt;
  if (count > 0) {
    return { scans: 0, usage: 0 };
  }

  const scans = readJsonlFile<PromptScan>(SCAN_FILE);
  const usageEntries = readJsonlFile<UsageLogEntry>(USAGE_FILE);

  // Index usage by request_id for fast lookup
  const usageMap = new Map<string, UsageLogEntry>();
  for (const u of usageEntries) {
    usageMap.set(u.request_id, u);
  }

  let importedScans = 0;
  let importedUsage = 0;

  const importAll = db.transaction(() => {
    for (const scan of scans) {
      const usage = usageMap.get(scan.request_id);
      const breakdown = scan.context_estimate.messages_tokens_breakdown;

      const data: InsertPromptData = {
        prompt: {
          request_id: scan.request_id,
          session_id: scan.session_id,
          timestamp: scan.timestamp,
          source: "proxy",
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
          tools_definition_tokens:
            scan.context_estimate.tools_definition_tokens,
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
          req_has_system: usage?.request.has_system ?? false,
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

      const id = insertPrompt(data);
      if (id !== null) {
        importedScans++;
        if (usage) importedUsage++;
      }
    }

    // Rebuild daily_stats and sessions from all imported data
    const dates = db
      .prepare("SELECT DISTINCT substr(timestamp, 1, 10) as d FROM prompts")
      .all() as Array<{ d: string }>;
    for (const { d } of dates) upsertDailyStats(d);

    const sessions = db
      .prepare("SELECT DISTINCT session_id FROM prompts")
      .all() as Array<{ session_id: string }>;
    for (const { session_id } of sessions) upsertSession(session_id);
  });

  try {
    importAll();
  } catch (err) {
    console.error("[db-migrator] Migration failed:", err);
  }

  return { scans: importedScans, usage: importedUsage };
};
