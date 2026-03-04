/**
 * Dedup Cleanup Backfill
 *
 * One-time migration that removes duplicate Claude prompts from the DB.
 * Duplicates occur when the same prompt is imported by both historyImporter
 * (using user.uuid as request_id) and backfill parser (previously using
 * assistant.requestId as request_id).
 *
 * Strategy:
 * 1. Find (session_id, timestamp) groups with COUNT > 1 for claude provider
 * 2. Keep the entry with highest source priority (history > proxy > file-scan),
 *    breaking ties by tool_call count
 * 3. Delete inferior duplicates
 * 4. Rebuild daily_stats and sessions aggregates for affected dates/sessions
 *
 * Runs once on app startup. Uses app_metadata flag to prevent re-runs.
 */
import { getDatabase } from "../db/index";
import { getMetadata, setMetadata } from "../db/metadata";
import { upsertDailyStats, upsertSession } from "../db/writer";

const MIGRATION_KEY = "dedup_cleanup_done_v1";

export const isDedupCleanupDone = (): boolean => {
  return getMetadata(MIGRATION_KEY) === "true";
};

type DupGroup = {
  session_id: string;
  timestamp: string;
};

type DupRow = {
  id: number;
  request_id: string;
  source: string;
  tool_call_count: number;
};

const SOURCE_PRIORITY: Record<string, number> = {
  history: 3,
  proxy: 2,
  "file-scan": 1,
};

export const runDedupCleanup = (): { removed: number } => {
  if (isDedupCleanupDone()) {
    return { removed: 0 };
  }

  const db = getDatabase();
  let removed = 0;

  try {
    // Find all (session_id, timestamp) groups with duplicates for claude
    const dupGroups = db
      .prepare(
        `SELECT session_id, timestamp
         FROM prompts
         WHERE provider = 'claude'
         GROUP BY session_id, timestamp
         HAVING COUNT(*) > 1`,
      )
      .all() as DupGroup[];

    if (dupGroups.length === 0) {
      setMetadata(MIGRATION_KEY, "true");
      return { removed: 0 };
    }

    const affectedDates = new Set<string>();
    const affectedSessions = new Set<string>();

    const deleteStmt = db.prepare("DELETE FROM prompts WHERE id = @id");

    const cleanup = db.transaction(() => {
      for (const group of dupGroups) {
        // Get all entries in this group with their tool_call count
        const entries = db
          .prepare(
            `SELECT p.id, p.request_id, p.source,
                    (SELECT COUNT(*) FROM tool_calls tc WHERE tc.prompt_id = p.id) as tool_call_count
             FROM prompts p
             WHERE p.session_id = @session_id
               AND p.timestamp = @timestamp
               AND p.provider = 'claude'
             ORDER BY p.id`,
          )
          .all({
            session_id: group.session_id,
            timestamp: group.timestamp,
          }) as DupRow[];

        if (entries.length <= 1) continue;

        // Sort by priority: highest source priority first, then most tool_calls
        entries.sort((a, b) => {
          const aPri = SOURCE_PRIORITY[a.source] ?? 0;
          const bPri = SOURCE_PRIORITY[b.source] ?? 0;
          if (bPri !== aPri) return bPri - aPri;
          return b.tool_call_count - a.tool_call_count;
        });

        // Keep first (best), delete rest
        for (let i = 1; i < entries.length; i++) {
          deleteStmt.run({ id: entries[i].id });
          removed++;
        }

        affectedDates.add(group.timestamp.slice(0, 10));
        affectedSessions.add(group.session_id);
      }
    });

    cleanup();

    // Rebuild aggregates for affected dates/sessions
    if (removed > 0) {
      for (const date of affectedDates) {
        upsertDailyStats(date, "claude");
      }
      for (const sid of affectedSessions) {
        upsertSession(sid, "claude");
      }
    }

    setMetadata(MIGRATION_KEY, "true");
  } catch (err) {
    console.error("[Dedup Cleanup] Failed:", err);
  }

  return { removed };
};
