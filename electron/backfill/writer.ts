/**
 * Backfill Writer
 *
 * Converts BackfillMessages to DB rows and batch-inserts them.
 * After batch insert, rebuilds aggregate tables for touched dates/sessions.
 */
import { getDatabase } from "../db/index";
import { insertPrompt, upsertDailyStats, upsertSession } from "../db/writer";
import type { BackfillMessage } from "./types";

/**
 * Batch insert BackfillMessages into the prompts table.
 * Uses skipAggregates=true for individual inserts, then
 * rebuilds aggregates once at the end for efficiency.
 *
 * Returns count of actually inserted rows.
 */
export const batchInsertMessages = (
  messages: BackfillMessage[],
): { inserted: number; errors: number } => {
  const db = getDatabase();
  let inserted = 0;
  let errors = 0;

  const touchedDates = new Set<string>();
  const touchedSessions = new Set<string>();

  const batchTx = db.transaction(() => {
    for (const msg of messages) {
      try {
        const id = insertPrompt(
          {
            prompt: {
              request_id: msg.dedupKey,
              session_id: msg.sessionId,
              timestamp: msg.timestamp,
              source: "file-scan",
              user_prompt: msg.userPrompt,
              user_prompt_tokens: 0,
              model: msg.modelId,
              max_tokens: 0,
              input_tokens: msg.tokens.input,
              output_tokens: msg.tokens.output,
              cache_creation_input_tokens: msg.tokens.cacheWrite,
              cache_read_input_tokens: msg.tokens.cacheRead,
              cost_usd: msg.costUsd,
              total_context_tokens:
                msg.tokens.input + msg.tokens.cacheRead + msg.tokens.cacheWrite,
              tool_summary: msg.toolSummary,
            },
          },
          { skipAggregates: true },
        );

        if (id !== null) {
          inserted++;
          const dateStr = msg.timestamp.slice(0, 10);
          touchedDates.add(dateStr);
          touchedSessions.add(msg.sessionId);
        }
      } catch {
        errors++;
      }
    }

    // Rebuild aggregates for all touched dates/sessions
    for (const d of touchedDates) upsertDailyStats(d);
    for (const s of touchedSessions) upsertSession(s);
  });

  try {
    batchTx();
  } catch (err) {
    console.error("[Backfill Writer] batch transaction failed:", err);
  }

  return { inserted, errors };
};
