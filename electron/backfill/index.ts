/**
 * Backfill Engine
 *
 * Orchestrates the full backfill pipeline:
 * scanner → parser → dedup → writer
 *
 * Multi-provider: iterates all registered plugins via getAllPlugins().
 * Each provider maintains its own scan timestamp for gap-fill.
 *
 * Two modes:
 * - runFullScan: scans all files from all providers, used for onboarding
 * - runGapFill: scans only files changed since last scan per provider
 */
import { ipcMain, BrowserWindow } from "electron";
import { getAllPlugins, getPlugin } from "./plugins/registry";
import {
  loadExistingRequestIds,
  loadProviderRequestIds,
  filterDuplicates,
} from "./dedup";
import { batchInsertMessages } from "./writer";
import {
  getLastScanTimestamp,
  setLastScanTimestamp,
  getProviderScanTimestamp,
  setProviderScanTimestamp,
  isBackfillCompleted,
  setBackfillCompleted,
} from "../db/metadata";
import type {
  BackfillClient,
  BackfillProgress,
  BackfillResult,
  BackfillMessage,
  ScanFileEntry,
} from "./types";
import type { ProviderPlugin } from "./plugins/types";

/** Scan entry tagged with the plugin that produced it */
type TaggedScanEntry = ScanFileEntry & { plugin: ProviderPlugin };

let runningAbortController: AbortController | null = null;

/**
 * Collect files from all registered plugins.
 * Each file is tagged with the plugin that discovered it.
 */
const scanAllPlugins = (
  lastScanTimestampMs: number | null,
): TaggedScanEntry[] => {
  const plugins = getAllPlugins();
  const entries: TaggedScanEntry[] = [];

  for (const plugin of plugins) {
    // Per-provider timestamp; fall back to global for backward compat
    const providerTs =
      lastScanTimestampMs === null
        ? null
        : (getProviderScanTimestamp(plugin.id) ?? lastScanTimestampMs);

    const files = plugin.scan(providerTs);
    for (const f of files) {
      entries.push({ ...f, plugin });
    }
  }

  // Sort all entries by mtime ascending (oldest first)
  entries.sort((a, b) => a.mtimeMs - b.mtimeMs);
  return entries;
};

/**
 * Run a full scan of all provider session files.
 * Sends progress events to the renderer.
 */
export const runFullScan = (
  getMainWindow: () => BrowserWindow | null,
): Promise<BackfillResult> => {
  return new Promise((resolve) => {
    const start = Date.now();
    const abort = new AbortController();
    runningAbortController = abort;

    const progress: BackfillProgress = {
      phase: "scanning",
      totalFiles: 0,
      processedFiles: 0,
      discoveredMessages: 0,
      insertedMessages: 0,
      skippedDuplicates: 0,
      errors: 0,
    };

    const sendProgress = () => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("backfill:progress", { ...progress });
      }
    };

    try {
      // Phase 1: Scan all providers
      const files = scanAllPlugins(null);
      progress.totalFiles = files.length;
      progress.phase = "parsing";
      sendProgress();

      if (files.length === 0) {
        progress.phase = "done";
        sendProgress();
        runningAbortController = null;
        resolve(buildResult(progress, start));
        return;
      }

      // Phase 2: Parse + Dedup + Write in batches
      const existingIds = loadExistingRequestIds();
      const maxMtimeByProvider = new Map<string, number>();
      let earliest = "";
      let latest = "";
      let totalCost = 0;

      const BATCH_SIZE = 50;
      let batch: BackfillMessage[] = [];

      for (const file of files) {
        if (abort.signal.aborted) break;

        const messages = file.plugin.parse(file);

        const { unique, duplicateCount } = filterDuplicates(
          messages,
          existingIds,
        );

        progress.discoveredMessages += messages.length;
        progress.skippedDuplicates += duplicateCount;

        batch.push(...unique);

        // Flush batch when large enough
        if (batch.length >= BATCH_SIZE) {
          progress.phase = "writing";
          const { inserted, errors } = batchInsertMessages(batch);
          progress.insertedMessages += inserted;
          progress.errors += errors;
          batch = [];
        }

        // Track date range and cost
        for (const msg of unique) {
          if (!earliest || msg.timestamp < earliest) earliest = msg.timestamp;
          if (!latest || msg.timestamp > latest) latest = msg.timestamp;
          totalCost += msg.costUsd;
        }

        // Track max mtime per provider
        const prevMax = maxMtimeByProvider.get(file.plugin.id) ?? 0;
        if (file.mtimeMs > prevMax) {
          maxMtimeByProvider.set(file.plugin.id, file.mtimeMs);
        }

        progress.processedFiles++;

        // Send progress every 10 files
        if (progress.processedFiles % 10 === 0) {
          sendProgress();
        }
      }

      // Flush remaining batch
      if (batch.length > 0) {
        progress.phase = "writing";
        const { inserted, errors } = batchInsertMessages(batch);
        progress.insertedMessages += inserted;
        progress.errors += errors;
      }

      // Update per-provider scan timestamps
      let globalMaxMtime = 0;
      for (const [providerId, mtime] of maxMtimeByProvider) {
        setProviderScanTimestamp(providerId, mtime);
        if (mtime > globalMaxMtime) globalMaxMtime = mtime;
      }
      // Keep global timestamp in sync for backward compat
      if (globalMaxMtime > 0) {
        setLastScanTimestamp(globalMaxMtime);
      }
      setBackfillCompleted(true);

      progress.phase = "done";
      sendProgress();

      const result = buildResult(progress, start);
      result.totalCostUsd = totalCost;
      result.dateRange =
        earliest && latest ? { earliest, latest } : null;

      // Send complete event
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("backfill:complete", result);
      }

      runningAbortController = null;
      resolve(result);
    } catch (err) {
      console.error("[Backfill] Full scan error:", err);
      progress.phase = "done";
      runningAbortController = null;
      resolve(buildResult(progress, start));
    }
  });
};

/**
 * Run a gap-fill scan (only files changed since last scan per provider).
 * Silent — no progress events, runs on startup and periodically.
 */
export const runGapFill = (): BackfillResult => {
  const start = Date.now();
  const globalLastTs = getLastScanTimestamp();

  // If never scanned, skip (wait for onboarding dialog)
  if (globalLastTs === null) {
    return {
      totalFiles: 0,
      processedFiles: 0,
      insertedMessages: 0,
      skippedDuplicates: 0,
      errors: 0,
      totalCostUsd: 0,
      dateRange: null,
      durationMs: Date.now() - start,
    };
  }

  // Scan all providers using per-provider timestamps
  const plugins = getAllPlugins();
  const allFiles: TaggedScanEntry[] = [];

  for (const plugin of plugins) {
    // Use per-provider timestamp if available; otherwise null to scan all files
    // (do NOT fall back to globalLastTs — it may be ahead of a provider that was never scanned)
    const providerTs = getProviderScanTimestamp(plugin.id) ?? null;
    const files = plugin.scan(providerTs);
    for (const f of files) {
      allFiles.push({ ...f, plugin });
    }
  }

  if (allFiles.length === 0) {
    return {
      totalFiles: 0,
      processedFiles: 0,
      insertedMessages: 0,
      skippedDuplicates: 0,
      errors: 0,
      totalCostUsd: 0,
      dateRange: null,
      durationMs: Date.now() - start,
    };
  }

  const existingIds = loadExistingRequestIds();
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  const maxMtimeByProvider = new Map<string, number>();
  const allMessages: BackfillMessage[] = [];

  for (const file of allFiles) {
    const messages = file.plugin.parse(file);

    const { unique, duplicateCount } = filterDuplicates(messages, existingIds);
    skipped += duplicateCount;
    allMessages.push(...unique);

    const prevMax = maxMtimeByProvider.get(file.plugin.id) ?? 0;
    if (file.mtimeMs > prevMax) {
      maxMtimeByProvider.set(file.plugin.id, file.mtimeMs);
    }
  }

  if (allMessages.length > 0) {
    const result = batchInsertMessages(allMessages);
    inserted = result.inserted;
    errors = result.errors;
  }

  // Update per-provider timestamps
  let globalMaxMtime = globalLastTs;
  for (const [providerId, mtime] of maxMtimeByProvider) {
    const currentProviderTs =
      getProviderScanTimestamp(providerId) ?? globalLastTs;
    if (mtime > currentProviderTs) {
      setProviderScanTimestamp(providerId, mtime);
    }
    if (mtime > globalMaxMtime) globalMaxMtime = mtime;
  }
  if (globalMaxMtime > globalLastTs) {
    setLastScanTimestamp(globalMaxMtime);
  }

  return {
    totalFiles: allFiles.length,
    processedFiles: allFiles.length,
    insertedMessages: inserted,
    skippedDuplicates: skipped,
    errors,
    totalCostUsd: allMessages.reduce((s, m) => s + m.costUsd, 0),
    dateRange: null,
    durationMs: Date.now() - start,
  };
};

/**
 * Run a provider-scoped gap-fill (only one provider).
 * Much faster than runGapFill() because it skips other providers
 * and loads a smaller dedup set.
 */
export const runProviderGapFill = (providerId: string): BackfillResult => {
  const start = Date.now();
  const emptyResult: BackfillResult = {
    totalFiles: 0,
    processedFiles: 0,
    insertedMessages: 0,
    skippedDuplicates: 0,
    errors: 0,
    totalCostUsd: 0,
    dateRange: null,
    durationMs: Date.now() - start,
  };

  const globalLastTs = getLastScanTimestamp();
  if (globalLastTs === null) return emptyResult;

  const plugin = getPlugin(providerId as BackfillClient);
  if (!plugin) return emptyResult;

  const providerTs = getProviderScanTimestamp(plugin.id) ?? null;
  const files = plugin.scan(providerTs);
  if (files.length === 0) return emptyResult;

  const existingIds = loadProviderRequestIds(providerId);
  let inserted = 0;
  let skipped = 0;
  let errors = 0;
  let maxMtime = 0;
  const allMessages: BackfillMessage[] = [];

  for (const file of files) {
    const messages = plugin.parse(file);
    const { unique, duplicateCount } = filterDuplicates(messages, existingIds);
    skipped += duplicateCount;
    allMessages.push(...unique);

    if (file.mtimeMs > maxMtime) maxMtime = file.mtimeMs;
  }

  if (allMessages.length > 0) {
    const result = batchInsertMessages(allMessages);
    inserted = result.inserted;
    errors = result.errors;
  }

  // Update provider timestamp
  if (maxMtime > 0) {
    const currentProviderTs = getProviderScanTimestamp(plugin.id) ?? 0;
    if (maxMtime > currentProviderTs) {
      setProviderScanTimestamp(plugin.id, maxMtime);
    }
    const currentGlobalTs = globalLastTs;
    if (maxMtime > currentGlobalTs) {
      setLastScanTimestamp(maxMtime);
    }
  }

  return {
    totalFiles: files.length,
    processedFiles: files.length,
    insertedMessages: inserted,
    skippedDuplicates: skipped,
    errors,
    totalCostUsd: allMessages.reduce((s, m) => s + m.costUsd, 0),
    dateRange: null,
    durationMs: Date.now() - start,
  };
};

/**
 * Cancel a running full scan.
 */
export const cancelBackfill = (): void => {
  if (runningAbortController) {
    runningAbortController.abort();
    runningAbortController = null;
  }
};

/**
 * Count total session files across all providers.
 */
const countAllSessionFiles = (): number => {
  return getAllPlugins().reduce((sum, plugin) => sum + plugin.count(), 0);
};

/**
 * Register IPC handlers for backfill.
 */
export const registerBackfillIPC = (
  getMainWindow: () => BrowserWindow | null,
): void => {
  ipcMain.handle("backfill:start", async () => {
    return runFullScan(getMainWindow);
  });

  ipcMain.handle("backfill:cancel", () => {
    cancelBackfill();
    return { success: true };
  });

  ipcMain.handle("backfill:count", () => {
    return countAllSessionFiles();
  });

  ipcMain.handle("backfill:status", () => {
    return {
      completed: isBackfillCompleted(),
      lastScanTimestamp: getLastScanTimestamp(),
    };
  });
};

// --- Helpers ---

const buildResult = (
  progress: BackfillProgress,
  startMs: number,
): BackfillResult => ({
  totalFiles: progress.totalFiles,
  processedFiles: progress.processedFiles,
  insertedMessages: progress.insertedMessages,
  skippedDuplicates: progress.skippedDuplicates,
  errors: progress.errors,
  totalCostUsd: 0,
  dateRange: null,
  durationMs: Date.now() - startMs,
});
