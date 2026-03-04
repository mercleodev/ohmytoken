/**
 * Codex Tool Backfill
 *
 * One-time migration that re-parses existing Codex session files to extract
 * individual tool_calls for prompts that were backfilled before tool call
 * extraction was added.
 *
 * Runs once on app startup. Uses app_metadata flag to prevent re-runs.
 */
import { getDatabase } from "../db/index";
import { getMetadata, setMetadata } from "../db/metadata";
import { findCodexSessionFiles } from "./codex-scanner";
import { parseCodexSessionFile } from "./parsers/codex";

const MIGRATION_KEY = "codex_tool_backfill_done";

/**
 * Check if the Codex tool backfill migration has already run.
 */
export const isCodexToolBackfillDone = (): boolean => {
  return getMetadata(MIGRATION_KEY) === "true";
};

/**
 * Re-parse all Codex session files and insert tool_calls for existing prompts
 * that are missing them.
 *
 * Strategy:
 * 1. Find all codex prompts that have 0 tool_calls (but have tool_summary)
 * 2. Scan all codex JSONL files and re-parse them
 * 3. Match by dedupKey (request_id) and insert tool_calls rows
 */
export const backfillCodexToolCalls = (): { updated: number; errors: number } => {
  if (isCodexToolBackfillDone()) {
    return { updated: 0, errors: 0 };
  }

  const db = getDatabase();
  let updated = 0;
  let errors = 0;

  try {
    // Find codex prompts that have tool_summary but no tool_calls rows
    const promptsToFix = db
      .prepare(
        `SELECT p.id, p.request_id
         FROM prompts p
         WHERE p.provider = 'codex'
           AND p.tool_summary IS NOT NULL
           AND p.tool_summary != '{}'
           AND NOT EXISTS (
             SELECT 1 FROM tool_calls tc WHERE tc.prompt_id = p.id
           )`,
      )
      .all() as Array<{ id: number; request_id: string }>;

    if (promptsToFix.length === 0) {
      setMetadata(MIGRATION_KEY, "true");
      return { updated: 0, errors: 0 };
    }

    // Build a lookup: dedupKey → promptId
    const dedupToPromptId = new Map<string, number>();
    for (const row of promptsToFix) {
      dedupToPromptId.set(row.request_id, row.id);
    }

    // Scan all codex session files (no mtime filter — scan everything)
    const files = findCodexSessionFiles(null);

    const insertToolCall = db.prepare(
      `INSERT INTO tool_calls (prompt_id, call_index, name, input_summary, timestamp)
       VALUES (@prompt_id, @call_index, @name, @input_summary, @timestamp)`,
    );

    const tx = db.transaction(() => {
      for (const file of files) {
        try {
          const messages = parseCodexSessionFile(
            file.filePath,
            file.sessionId,
            file.projectDir,
          );

          for (const msg of messages) {
            const promptId = dedupToPromptId.get(msg.dedupKey);
            if (promptId === undefined) continue;
            if (!msg.toolCalls || msg.toolCalls.length === 0) continue;

            for (const tc of msg.toolCalls) {
              insertToolCall.run({
                prompt_id: promptId,
                call_index: tc.call_index,
                name: tc.name,
                input_summary: tc.input_summary ?? null,
                timestamp: tc.timestamp ?? null,
              });
            }

            updated++;
            dedupToPromptId.delete(msg.dedupKey);
          }
        } catch {
          errors++;
        }
      }
    });

    tx();
    setMetadata(MIGRATION_KEY, "true");
  } catch (err) {
    console.error("[Codex Tool Backfill] Failed:", err);
    errors++;
  }

  return { updated, errors };
};
