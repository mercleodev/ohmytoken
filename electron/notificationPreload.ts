/**
 * Preload script for the notification overlay window.
 * Exposes only the APIs needed by the notification UI.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  // Listen for new prompt scans
  onNewPromptScan: (
    callback: (data: { scan: unknown; usage: unknown }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { scan: unknown; usage: unknown },
    ) => callback(data);
    ipcRenderer.on("new-prompt-scan", handler);
    return () => {
      ipcRenderer.removeListener("new-prompt-scan", handler);
    };
  },

  // Fetch turn metrics for sparkline
  getSessionTurnMetrics: (sessionId: string) =>
    ipcRenderer.invoke("get-session-turn-metrics", sessionId),

  // Navigate to prompt detail (sends to main window via main process)
  navigateToPromptFromNotification: (scan: unknown, usage: unknown) => {
    ipcRenderer.send("notification-navigate-to-prompt", { scan, usage });
  },

  // Mouse enter/leave on card area → toggle click-through
  setMouseOnCard: (isOnCard: boolean) => {
    ipcRenderer.send("notification-mouse-on-card", isOnCard);
  },

  // Listen for backfill completions
  onBackfillComplete: (callback: (result: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, result: unknown) =>
      callback(result);
    ipcRenderer.on("backfill:complete", handler);
    return () => {
      ipcRenderer.removeListener("backfill:complete", handler);
    };
  },
});
