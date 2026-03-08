/**
 * Clamp Negative Tokens Backfill
 *
 * One-time migration that fixes legacy negative token values in the prompts
 * table. Before commit 3a3a77e, the Codex parser did not clamp negative deltas
 * during context compaction, resulting in negative input/output/cache token
 * values stored in the DB.
 *
 * This migration sets any negative token column to 0, except
 * total_context_tokens which is intentionally left untouched (used by
 * compaction detection logic).
 *
 * Runs once on app startup. Uses app_metadata flag to prevent re-runs.
 */
import { getDatabase } from "../db/index";
import { getMetadata, setMetadata } from "../db/metadata";

const MIGRATION_KEY = "clamp_negative_tokens_done";

export const isClampNegativeTokensDone = (): boolean => {
  return getMetadata(MIGRATION_KEY) === "true";
};

export const clampNegativeTokens = (): { updated: number } => {
  if (isClampNegativeTokensDone()) {
    return { updated: 0 };
  }

  const db = getDatabase();
  let updated = 0;

  try {
    const result = db
      .prepare(
        `UPDATE prompts
         SET input_tokens = MAX(0, input_tokens),
             output_tokens = MAX(0, output_tokens),
             cache_read_input_tokens = MAX(0, cache_read_input_tokens),
             cache_creation_input_tokens = MAX(0, cache_creation_input_tokens)
         WHERE input_tokens < 0
            OR output_tokens < 0
            OR cache_read_input_tokens < 0
            OR cache_creation_input_tokens < 0`,
      )
      .run();

    updated = result.changes;
    setMetadata(MIGRATION_KEY, "true");
  } catch (err) {
    console.error("[Clamp Negative Tokens] Failed:", err);
  }

  return { updated };
};
