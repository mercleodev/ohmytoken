/**
 * Backfill Engine
 *
 * Orchestrates the full backfill pipeline:
 * scanner → parser → dedup → writer
 *
 * Two modes:
 * - runFullScan: scans all files, used for onboarding
 * - runGapFill: scans only files changed since last scan, used on startup
 */
import { ipcMain, BrowserWindow } from "electron";
import { findClaudeSessionFiles, countSessionFiles } from "./scanner";
import { parseSessionFile } from "./parsers/index";
import { loadExistingRequestIds, filterDuplicates } from "./dedup";
import { batchInsertMessages } from "./writer";
import {
  getLastScanTimestamp,
  setLastScanTimestamp,
  isBackfillCompleted,
  setBackfillCompleted,
} from "../db/metadata";
import type { BackfillProgress, BackfillResult, BackfillMessage } from "./types";

let runningAbortController: AbortController | null = null;

/**
 * Run a full scan of all Claude session files.
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
      // Phase 1: Scan
      const files = findClaudeSessionFiles(null);
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
      let maxMtime = 0;
      let earliest = "";
      let latest = "";
      let totalCost = 0;

      const BATCH_SIZE = 50;
      let batch: BackfillMessage[] = [];

      for (const file of files) {
        if (abort.signal.aborted) break;

        const messages = parseSessionFile(
          file.filePath,
          file.sessionId,
          file.projectDir,
        );

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

        if (file.mtimeMs > maxMtime) maxMtime = file.mtimeMs;
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

      // Update metadata
      if (maxMtime > 0) {
        setLastScanTimestamp(maxMtime);
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
 * Run a gap-fill scan (only files changed since last scan).
 * Silent — no progress events, runs on startup.
 */
export const runGapFill = (): BackfillResult => {
  const start = Date.now();
  const lastTs = getLastScanTimestamp();

  // If never scanned, skip (wait for onboarding dialog)
  if (lastTs === null) {
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

  const files = findClaudeSessionFiles(lastTs);
  if (files.length === 0) {
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
  let maxMtime = lastTs;
  const allMessages: BackfillMessage[] = [];

  for (const file of files) {
    const messages = parseSessionFile(
      file.filePath,
      file.sessionId,
      file.projectDir,
    );

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

  if (maxMtime > lastTs) {
    setLastScanTimestamp(maxMtime);
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
    return countSessionFiles();
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
