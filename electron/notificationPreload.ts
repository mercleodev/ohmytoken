/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Preload script for the notification overlay window.
 * Exposes only the APIs needed by the notification UI.
 */
import { contextBridge, ipcRenderer } from "electron";

// Debug: log to main process
const debugLog = (msg: string) => {
  ipcRenderer.send("notification-debug-log", msg);
};

contextBridge.exposeInMainWorld("api", {
  debugLog,
  // Listen for new prompt scans (completed)
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

  // Listen for streaming prompt (user just sent a message, processing...)
  onNewPromptStreaming: (
    callback: (data: {
      sessionId: string;
      userPrompt: string;
      timestamp: string;
      model?: string;
      provider?: string;
      sessionStats?: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number };
      injectedFiles?: Array<{ path: string; category: string; estimated_tokens: number }>;
      projectFolder?: string;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: any,
    ) => callback(data);
    ipcRenderer.on("new-prompt-streaming", handler);
    return () => {
      ipcRenderer.removeListener("new-prompt-streaming", handler);
    };
  },

  // Listen for streaming complete (assistant response finished)
  onPromptStreamingComplete: (
    callback: (data: { sessionId: string; timestamp: string; model?: string }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { sessionId: string; timestamp: string; model?: string },
    ) => callback(data);
    ipcRenderer.on("prompt-streaming-complete", handler);
    return () => {
      ipcRenderer.removeListener("prompt-streaming-complete", handler);
    };
  },

  // Fetch turn metrics for sparkline
  getSessionTurnMetrics: (sessionId: string) =>
    ipcRenderer.invoke("get-session-turn-metrics", sessionId),

  // Batch fetch for guardrail engine (turnMetrics + mcpAnalysis + harnessCandidates)
  getGuardrailContext: (sessionId: string) =>
    ipcRenderer.invoke("get-guardrail-context", sessionId),

  getHarnessCandidates: (query?: {
    sessionId?: string; provider?: string; period?: 'today' | '7d' | '30d'; limit?: number;
  }) => ipcRenderer.invoke('get-harness-candidates', query),

  // Navigate to prompt detail (sends to main window via main process)
  navigateToPromptFromNotification: (scan: unknown, usage: unknown) => {
    ipcRenderer.send("notification-navigate-to-prompt", { scan, usage });
  },

  // Mouse enter/leave on card area → toggle click-through
  setMouseOnCard: (isOnCard: boolean) => {
    ipcRenderer.send("notification-mouse-on-card", isOnCard);
  },

  // Show/hide notification window based on card visibility
  setNotificationVisible: (visible: boolean) => {
    ipcRenderer.send("notification-set-visible", visible);
  },

  // Listen for real-time session activity (tool_use, text, thinking)
  onSessionActivity: (
    callback: (data: {
      sessionId: string;
      timestamp: string;
      kind: string;
      name: string;
      detail: string;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        sessionId: string;
        timestamp: string;
        kind: string;
        name: string;
        detail: string;
      },
    ) => callback(data);
    ipcRenderer.on("session-activity", handler);
    return () => {
      ipcRenderer.removeListener("session-activity", handler);
    };
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

  // Listen for async evidence scoring completion (proxy path) so the
  // overlay can merge the report into an already-visible card.
  // See docs/idea/notification-evidence-all-unverified.md §5.1 G1-2.
  onEvidenceScored: (
    callback: (data: {
      requestId: string;
      report: import("./evidence/types").EvidenceReport;
    }) => void,
  ) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: {
        requestId: string;
        report: import("./evidence/types").EvidenceReport;
      },
    ) => callback(data);
    ipcRenderer.on("evidence-scored", handler);
    return () => {
      ipcRenderer.removeListener("evidence-scored", handler);
    };
  },
});
