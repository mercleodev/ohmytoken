/**
 * Backfill Dedup
 *
 * Loads existing request_ids from the DB and filters out
 * BackfillMessages that are already present.
 */
import { getDatabase } from "../db/index";
import type { BackfillMessage } from "./types";

/**
 * Load all existing request_ids from the prompts table into a Set.
 */
export const loadExistingRequestIds = (): Set<string> => {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT request_id FROM prompts")
    .all() as Array<{ request_id: string }>;

  const ids = new Set<string>();
  for (const r of rows) ids.add(r.request_id);
  return ids;
};

/**
 * Load request_ids for a specific provider only (much smaller set).
 * Used by provider-scoped gap-fill for faster dedup.
 */
export const loadProviderRequestIds = (provider: string): Set<string> => {
  const db = getDatabase();
  const rows = db
    .prepare("SELECT request_id FROM prompts WHERE provider = ?")
    .all(provider) as Array<{ request_id: string }>;

  const ids = new Set<string>();
  for (const r of rows) ids.add(r.request_id);
  return ids;
};

/**
 * Filter out messages whose dedupKey already exists in the DB.
 * Returns only new (non-duplicate) messages.
 */
export const filterDuplicates = (
  messages: BackfillMessage[],
  existingIds: Set<string>,
): { unique: BackfillMessage[]; duplicateCount: number } => {
  const unique: BackfillMessage[] = [];
  let duplicateCount = 0;

  for (const msg of messages) {
    if (existingIds.has(msg.dedupKey)) {
      duplicateCount++;
    } else {
      unique.push(msg);
      // Mark as seen to prevent intra-batch duplicates
      existingIds.add(msg.dedupKey);
    }
  }

  return { unique, duplicateCount };
};
