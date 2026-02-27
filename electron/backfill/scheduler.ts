/**
 * Gap-Fill Scheduler
 *
 * Periodically runs runGapFill() to capture Claude session files
 * before they are auto-deleted. Uses setTimeout chain to prevent
 * overlapping runs (runGapFill is synchronous).
 */
import { BrowserWindow } from "electron";
import { runGapFill } from "./index";

const GAP_FILL_INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setTimeout> | null = null;
let getWindow: (() => BrowserWindow | null) | null = null;

const tick = (): void => {
  try {
    const result = runGapFill();
    if (result.insertedMessages > 0) {
      console.log(
        `[Backfill] Periodic gap-fill: ${result.insertedMessages} new prompts (${result.durationMs}ms)`,
      );
      const win = getWindow?.();
      if (win && !win.isDestroyed()) {
        win.webContents.send("backfill:complete", result);
      }
    }
  } catch (err) {
    console.error("[Backfill] Periodic gap-fill error:", err);
  }
  timer = setTimeout(tick, GAP_FILL_INTERVAL_MS);
};

export const startGapFillScheduler = (
  getMainWindow: () => BrowserWindow | null,
): void => {
  if (timer) return;
  getWindow = getMainWindow;
  timer = setTimeout(tick, GAP_FILL_INTERVAL_MS);
  console.log(
    `[Backfill] Periodic scanner started (interval: ${GAP_FILL_INTERVAL_MS / 1000}s)`,
  );
};

export const stopGapFillScheduler = (): void => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  getWindow = null;
};
