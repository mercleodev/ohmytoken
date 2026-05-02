/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, no-control-regex */
import { app, BrowserWindow, ipcMain, globalShortcut } from "electron";
import * as path from "path";
import * as fs from "fs";
import { homedir } from "os";
import { TrayManager } from "./tray";
import { Store } from "./store";
import { ProviderConfig, AppSettings } from "./types";
import { usageStore } from "./usageStore";
import { countTokens } from "./analyzer/tokenCounter";
import { parseLogFile } from "./analyzer/logParser";
import {
  startProxyServer,
  stopProxyServer,
  getSessionId,
} from "./proxy/server";
import {
  startHistoryWatcher,
  readRecentHistory,
  getLastActiveSessionId,
} from "./watcher/historyWatcher";
import { readTodayStats } from "./watcher/statsCacheReader";
import { initDatabase, closeDatabase } from "./db/index";
import { onProxyScanComplete } from "./db/proxyAdapter";
import { onHistoryPromptParsed } from "./db/historyAdapter";
import { migrateJsonlToDb } from "./db/migrator";
import * as dbReader from "./db/reader";
import { calculateCost } from "./utils/costCalculator";
import {
  importHistorySessions,
  importSinglePrompt,
  readInjectedFiles,
} from "./importer/historyImporter";
import { EvidenceEngine } from "./evidence/engine";
import { makeEmitScoredScan } from "./evidence/emitScoredScan";
import type { EmitScoredScan } from "./evidence/emitScoredScan";
import { buildProxyOptions } from "./proxy/buildProxyOptions";
import { generateWorkflowDraft } from "./draftGenerator";
import { exportWorkflowDraft } from "./draftExporter";
import { getMemoryStatusForProvider } from "./memory/providerMemory";
import { mergeConfig } from "./evidence/config";
import { parseSystemFieldWithContent } from "./proxy/systemParser";
import { insertEvidenceReport, recordWorkflowAction } from "./db/writer";
import {
  bootEventBus,
  shutdownEventBus,
  DEFAULT_EVENT_BUS_PORT,
} from "./eventBus/boot";
import { isHudEnabled } from "./eventBus/config";
import type { EventBusServer } from "./eventBus/server";
import { getActiveSnapshot } from "./eventBus/sessionState";
import {
  registerProviderEmitter,
  startAllProviderEmitters,
} from "./eventBus/providerEmitter";
import {
  claudeProviderEmitter,
  handleClaudeHistoryEntry,
} from "./eventBus/providers/claude";
import type { EvidenceEngineConfig } from "./evidence/types";
import { readFileContentsFromDisk } from "./utils/readFileContents";
import { validateEvidenceConfig } from "./evidence/validateConfig";
import { runGapFill, registerBackfillIPC } from "./backfill/index";
import { backfillCodexToolCalls } from "./backfill/codex-tool-backfill";
import { clampNegativeTokens } from "./backfill/clamp-negative-tokens-backfill";
import { runDedupCleanup } from "./backfill/dedup-cleanup-backfill";
import { startGapFillScheduler, stopGapFillScheduler } from "./backfill/scheduler";
import { startProviderSessionWatcher } from "./watcher/providerSessionWatcher";
import { startSessionFileWatcher } from "./watcher/sessionFileWatcher";
import { startCodexSessionFileWatcher } from "./watcher/codexSessionFileWatcher";
import { markProviderWatcherFired } from "./providers/usage/trackingActivity";
import {
  startTokenFileWatcher,
  type TokenFileWatcherHandle,
} from "./providers/usage/tokenFileWatcher";
import {
  isAccountInsightsEnabled,
  getOptedInProviders,
  setAccountInsightsEnabled,
} from "./providers/usage/accountInsightsSettings";
import { resolveProviderUsageRequest } from "./providers/usage/providerUsageGating";
import {
  setAccountInsightsRuntimeError,
  clearAccountInsightsRuntimeError,
  getAccountInsightsRuntimeError,
} from "./providers/usage/accountInsightsRuntimeState";
import { getProviderTokenStatus } from "./providers/usage/credentialReader";
import type { UsageProviderType, AccountInsightsState } from "./providers/usage/types";


// Prevent EPIPE: avoid crash when console.log is called after stdout/stderr pipe is closed
process.stdout?.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") throw err;
});
process.stderr?.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code !== "EPIPE") throw err;
});

let mainWindow: BrowserWindow | null = null;
let notificationWindow: BrowserWindow | null = null;
let trayManager: TrayManager | null = null;
let store: Store | null = null;
let currentShortcut: string | null = null;
let isQuitting = false;
let evidenceEngine: EvidenceEngine | null = null;
let eventBusServer: EventBusServer | null = null;
let sessionFileWatcherCleanup: (() => void) | null = null;
let switchSessionFileWatcher: ((sessionId: string) => void) | null = null;
let tokenWatcherHandle: TokenFileWatcherHandle | null = null;

const currentSettings = (): AppSettings | undefined =>
  store?.get("settings") as AppSettings | undefined;

// injected files cache: file-based persistent storage
const INJECTED_CACHE_PATH = path.join(
  homedir(),
  ".claude",
  "context-state",
  "injected-cache.json",
);

type InjectedCacheEntry = {
  files: Array<{ path: string; category: string; estimated_tokens: number }>;
  total: number;
};
let injectedCacheData: Record<string, InjectedCacheEntry> = {};

const loadInjectedCache = () => {
  try {
    if (fs.existsSync(INJECTED_CACHE_PATH)) {
      injectedCacheData = JSON.parse(
        fs.readFileSync(INJECTED_CACHE_PATH, "utf-8"),
      );
    }
  } catch {
    injectedCacheData = {};
  }
};

const saveInjectedCache = () => {
  try {
    const dir = path.dirname(INJECTED_CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      INJECTED_CACHE_PATH,
      JSON.stringify(injectedCacheData),
      "utf-8",
    );
  } catch {
    /* skip */
  }
};

loadInjectedCache();

const isDev = !app.isPackaged;
const isTest = process.env.NODE_ENV === "test";

const DEFAULT_SHORTCUT = "CommandOrControl+Shift+T";

const DEFAULT_PROXY_PORT = 8780;

// QA hook (gate doc §8.1, P1-6 headed run): when `OMT_QA_SHOW=1` the
// main window starts visible so agent-browser CDP screenshots aren't
// frame-paused by macOS hiding the window. Has no effect in normal
// tray-app flow because the env var is unset for end users.
const isQaShow = process.env.OMT_QA_SHOW === "1";

const createWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 640,
    resizable: false,
    show: isTest || isQaShow,
    frame: isTest || isQaShow,
    transparent: false,
    skipTaskbar: !isTest && !isQaShow,
    backgroundColor: "#ffffff", // white background
    roundedCorners: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  if (isDev && !isTest) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else if (isTest) {
    // Test mode: load built files, no DevTools
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  // Safety net: renderer main.tsx sets body.dark synchronously,
  // but this serves as a backup in case of timing issues
  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow?.webContents.executeJavaScript(
      `document.body.classList.add('dark', 'electron');`,
    );
  });

  mainWindow.on("close", (event) => {
    // Allow normal close in test mode or when quitting
    if (!isTest && !isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
};

const NOTIFICATION_WIDTH = 346;
const NOTIFICATION_MARGIN = 12;

/** Find the target display based on saved settings (0/undefined = auto: largest external) */
const getNotificationDisplay = (): Electron.Display => {
  const { screen } = require("electron");
  const allDisplays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const savedId = (store?.get("settings") as AppSettings | undefined)?.notificationDisplayId;
  if (savedId) {
    const found = allDisplays.find((d: Electron.Display) => d.id === savedId);
    if (found) return found;
  }
  // Auto: largest external display, fallback to primary
  const externalDisplays = allDisplays.filter((d: Electron.Display) => d.id !== primaryDisplay.id);
  return externalDisplays.length > 0
    ? externalDisplays.reduce((biggest: Electron.Display, d: Electron.Display) =>
        (d.bounds.width * d.bounds.height) > (biggest.bounds.width * biggest.bounds.height) ? d : biggest
      )
    : primaryDisplay;
};

/** Reposition notification window to the top-right of the target display */
const repositionNotificationWindow = (): void => {
  if (!notificationWindow || notificationWindow.isDestroyed()) return;
  const targetDisplay = getNotificationDisplay();
  const { x, y, width, height } = targetDisplay.workArea;
  const newX = x + width - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN;
  const newY = y + NOTIFICATION_MARGIN;
  const newHeight = height - NOTIFICATION_MARGIN * 2;
  console.log(`[NotificationWindow] Target: id=${targetDisplay.id} (${targetDisplay.bounds.width}x${targetDisplay.bounds.height}) → position (${newX}, ${newY}) height=${newHeight}`);
  notificationWindow.setPosition(newX, newY);
  notificationWindow.setSize(NOTIFICATION_WIDTH, newHeight);
};

const createNotificationWindow = (): void => {
  const targetDisplay = getNotificationDisplay();
  const { x: displayX, width: screenWidth, height: screenHeight, y: displayY } = targetDisplay.workArea;
  const notificationHeight = screenHeight - NOTIFICATION_MARGIN * 2;

  notificationWindow = new BrowserWindow({
    width: NOTIFICATION_WIDTH,
    height: notificationHeight,
    x: displayX + screenWidth - NOTIFICATION_WIDTH - NOTIFICATION_MARGIN,
    y: displayY + NOTIFICATION_MARGIN,
    resizable: false,
    movable: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "notificationPreload.js"),
    },
  });

  // Default: ignore all mouse events (click-through entire window)
  notificationWindow.setIgnoreMouseEvents(true, { forward: true });

  if (isDev && !isTest) {
    notificationWindow.loadURL("http://localhost:5173/notification.html");
  } else {
    notificationWindow.loadFile(
      path.join(__dirname, "../dist/notification.html"),
    );
  }

  // Start hidden — will be shown via IPC when notification cards appear
  notificationWindow.webContents.on("did-finish-load", () => {
    console.log("[NotificationWindow] Renderer loaded successfully");
  });

  notificationWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error(`[NotificationWindow] Failed to load: ${errorCode} ${errorDescription}`);
  });

  // Log any console messages from the notification renderer
  notificationWindow.webContents.on("console-message", (_event, level, message) => {
    const prefix = ["[notif:log]", "[notif:warn]", "[notif:err]"][level] ?? "[notif]";
    console.log(`${prefix} ${message}`);
  });

  notificationWindow.on("closed", () => {
    notificationWindow = null;
  });
};

// Send new-prompt-scan to notification window
const sendToNotificationWindow = (channel: string, data: unknown): void => {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    console.log(`[NotificationWindow] Sending IPC: ${channel}`);
    notificationWindow.webContents.send(channel, data);
  } else {
    console.warn(`[NotificationWindow] Cannot send ${channel}: window is ${notificationWindow ? 'destroyed' : 'null'}`);
  }
};

const sendToMainWindow = (channel: string, data: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
};

// Batch session-activity events to prevent flooding the notification window
// with per-token IPC calls during streaming. tool_use flushes immediately;
// text/thinking events are coalesced over ACTIVITY_FLUSH_MS.
const ACTIVITY_FLUSH_MS = 150;
type ActivityEvent = { sessionId: string; timestamp: string; kind: string; name: string; detail: string };
const activityBuffer: ActivityEvent[] = [];
let activityFlushTimer: ReturnType<typeof setTimeout> | null = null;

const flushActivityBuffer = (): void => {
  if (activityBuffer.length > 0) {
    const batch = activityBuffer.splice(0);
    sendToNotificationWindow("session-activity-batch", batch);
  }
  activityFlushTimer = null;
};

const queueActivity = (activity: ActivityEvent): void => {
  activityBuffer.push(activity);
  if (activity.kind === "tool_use") {
    // Tool calls are user-visible actions — flush immediately
    if (activityFlushTimer) { clearTimeout(activityFlushTimer); activityFlushTimer = null; }
    flushActivityBuffer();
    return;
  }
  if (!activityFlushTimer) {
    activityFlushTimer = setTimeout(flushActivityBuffer, ACTIVITY_FLUSH_MS);
  }
};

/**
 * Load → score-if-no-existing → persist → emit. Centralized so the three
 * watcher paths (Claude session, Codex session, history importer) do not
 * each re-implement the emit-with-anti-downgrade dance.
 * See docs/idea/notification-evidence-all-unverified.md §5.1 G1-3.
 */

const emitScoredScan: EmitScoredScan = (requestId, reason) => {
  const helper = makeEmitScoredScan({
    reader: {
      getPromptDetail: dbReader.getPromptDetail,
      getEvidenceReport: dbReader.getEvidenceReport,
      getPromptIdByRequestId: dbReader.getPromptIdByRequestId,
      getSessionFileScores: dbReader.getSessionFileScores,
    },
    writer: { insertEvidenceReport },
    engine: evidenceEngine,
    readFileContents: readFileContentsFromDisk,
    sendToMain: sendToMainWindow,
    sendToNotification: sendToNotificationWindow,
  });
  helper(requestId, reason);
};

// Debug log from notification renderer
ipcMain.on("notification-debug-log", (_event, msg: string) => {
  console.log(`[notif:debug] ${msg}`);
});

// Toggle click-through on notification window when mouse enters/leaves card
ipcMain.on("notification-mouse-on-card", (_event, isOnCard: boolean) => {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    notificationWindow.setIgnoreMouseEvents(!isOnCard, { forward: true });
  }
});

// Show/hide notification window based on card visibility
ipcMain.on("notification-set-visible", (_event, visible: boolean) => {
  if (notificationWindow && !notificationWindow.isDestroyed()) {
    if (visible) {
      repositionNotificationWindow();
      notificationWindow.showInactive();
    } else {
      notificationWindow.hide();
      // Reset click-through state
      notificationWindow.setIgnoreMouseEvents(true, { forward: true });
    }
  }
});

// Handle notification click → navigate main window to prompt detail
ipcMain.on(
  "notification-navigate-to-prompt",
  (_event, data: { scan: unknown; usage: unknown }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // Suppress blur-hide so the window stays visible after notification click
      trayManager?.suppressBlurHideOnce();
      mainWindow.webContents.send("notification-navigate-to-prompt", data);
      mainWindow.show();
      mainWindow.focus();
    }
  },
);

const registerShortcut = (shortcut: string): boolean => {
  // Unregister existing shortcut
  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut);
  }

  if (!shortcut) return false;

  try {
    const success = globalShortcut.register(shortcut, () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          // Show window relative to tray position
          trayManager?.showWindowFromShortcut();
        }
      }
    });

    if (success) {
      currentShortcut = shortcut;
      console.log(`Shortcut registered: ${shortcut}`);
    } else {
      console.error(`Failed to register shortcut: ${shortcut}`);
    }

    return success;
  } catch (error) {
    console.error(`Error registering shortcut: ${error}`);
    return false;
  }
};

// NOTE: Do not modify the global ~/.claude/settings.json.
// To use the proxy, apply project-local settings or environment variables individually.
// ANTHROPIC_BASE_URL=http://localhost:8780 claude

const initApp = async (): Promise<void> => {
  // Initialize SQLite DB (creates tables if needed)
  try {
    initDatabase();
    const migrated = migrateJsonlToDb();
    if (migrated.scans > 0) {
      console.log(
        `[DB] Migrated ${migrated.scans} scans, ${migrated.usage} usage entries from JSONL`,
      );
    }
    // Batch import history sessions (first-run only, skips if data exists)
    const historyResult = importHistorySessions();
    if (historyResult.imported > 0) {
      console.log(
        `[DB] Imported ${historyResult.imported} history prompts (${historyResult.durationMs}ms)`,
      );
    }
    // Gap-fill: import recently changed files since last scan (silent, <500ms)
    const gapResult = runGapFill();
    if (gapResult.insertedMessages > 0) {
      console.log(
        `[Backfill] Gap-fill: ${gapResult.insertedMessages} new prompts (${gapResult.durationMs}ms)`,
      );
    }
    // One-time: backfill tool_calls for existing Codex prompts
    const toolBackfill = backfillCodexToolCalls();
    if (toolBackfill.updated > 0) {
      console.log(
        `[Backfill] Codex tool backfill: ${toolBackfill.updated} prompts updated`,
      );
    }
    // One-time: clamp legacy negative token values to 0
    const clampResult = clampNegativeTokens();
    if (clampResult.updated > 0) {
      console.log(
        `[Backfill] Clamp negative tokens: ${clampResult.updated} rows fixed`,
      );
    }
    // One-time: remove duplicate Claude prompts (history vs file-scan)
    const dedupResult = runDedupCleanup();
    if (dedupResult.removed > 0) {
      console.log(
        `[Backfill] Dedup cleanup: removed ${dedupResult.removed} duplicate entries`,
      );
    }
  } catch (err) {
    console.error("[DB] Failed to initialize:", err);
  }

  store = new Store();

  // Boot the HUD event bus (loopback WebSocket) so later subsystems
  // (proxy, watcher, providers) can emit without caring about lifecycle.
  // HudConfig-driven settings arrive in P0-5; for now we route boot
  // through `isHudEnabled()` which is **off by default during the
  // v1.0.0 stabilization period** — the HUD only boots when
  // `OMT_HUD_ENABLED=1` is set explicitly. Dashboard / tray / shortcut
  // / notifications / watchers all remain functional regardless.
  // Failure to bind must not abort app startup — the bus is an optional
  // overlay.
  try {
    eventBusServer = await bootEventBus({
      port: DEFAULT_EVENT_BUS_PORT,
      enabled: isHudEnabled(),
      getSnapshot: getActiveSnapshot,
    });
    if (eventBusServer) {
      registerProviderEmitter(claudeProviderEmitter);
      await startAllProviderEmitters();
    }
  } catch (err) {
    console.error("[eventBus] boot failed:", err);
    eventBusServer = null;
  }

  // Initialize Evidence Scoring Engine
  const savedEvidenceConfig = store.get('evidenceConfig');
  evidenceEngine = new EvidenceEngine(savedEvidenceConfig ?? undefined);
  console.log('[Evidence] Engine initialized, fusion:', evidenceEngine.getConfig().fusion_method);

  createWindow();
  createNotificationWindow();

  trayManager = new TrayManager(mainWindow!, store);
  trayManager.init();

  // usageStore onChange -> update tray + renderer simultaneously
  usageStore.onChange((provider, snapshot) => {
    if (provider === "claude") {
      trayManager?.onSnapshotChanged(provider, snapshot);
    }
    mainWindow?.webContents.send("provider-usage-updated", {
      provider,
      snapshot,
    });
  });

  // Register saved shortcut or default shortcut
  const settings = store.get("settings");
  const shortcut = settings?.shortcut || DEFAULT_SHORTCUT;
  registerShortcut(shortcut);

  setupIPC();
  registerBackfillIPC(() => mainWindow);
  startGapFillScheduler(() => mainWindow);

  // Phase 3 — polling iterates only opted-in providers; boot refresh gates on
  // Claude opt-in so users get a tracking-only surface by default and no
  // eager Keychain prompts.
  const refreshInterval = settings?.refreshInterval || 5;
  usageStore.startPolling(refreshInterval, () =>
    getOptedInProviders(currentSettings()),
  );
  if (isAccountInsightsEnabled(currentSettings(), "claude")) {
    usageStore.refresh("claude");
  }

  // Start token file watcher. The Keychain poll stays off until Claude is opted in.
  try {
    tokenWatcherHandle = startTokenFileWatcher({
      getMainWindow: () => mainWindow,
      onTokenChanged: (provider) => {
        if (isAccountInsightsEnabled(currentSettings(), provider)) {
          usageStore.refresh(provider);
        }
      },
      isClaudeInsightsEnabled: () =>
        isAccountInsightsEnabled(currentSettings(), "claude"),
    });
  } catch (err) {
    console.error("[TokenWatcher] Failed to start:", err);
  }

  // Start session file watcher (real-time HumanTurn/AssistantTurn detection)
  try {
    const sessionWatcher = startSessionFileWatcher({
      onTurn: (event) => {
        markProviderWatcherFired("claude");
        if (event.type === "human") {
          // Fetch session stats from DB for instant display on streaming card
          let sessionStats: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number } | undefined;
          try {
            const scans = dbReader.getSessionPrompts(event.sessionId);
            let totalCost = 0, totalTokens = 0, totalCacheRead = 0;
            for (const s of scans) {
              const detail = dbReader.getPromptDetail(s.request_id);
              if (detail?.usage) {
                totalCost += detail.usage.cost_usd ?? 0;
                const r = detail.usage.response;
                totalTokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0);
                totalCacheRead += r.cache_read_input_tokens ?? 0;
              }
            }
            sessionStats = {
              turns: scans.length,
              costUsd: totalCost,
              totalTokens,
              cacheReadPct: totalTokens > 0 ? (totalCacheRead / totalTokens) * 100 : 0,
            };
          } catch (e) {
            console.error("[SessionFileWatcher] Failed to fetch session stats:", e);
          }

          // Read injected files from disk + extract project folder name
          let injectedFiles: Array<{ path: string; category: string; estimated_tokens: number }> = [];
          let projectFolder: string | undefined;
          try {
            const projectsDir = path.join(homedir(), ".claude", "projects");
            const dirs = fs.readdirSync(projectsDir).filter((f: string) => {
              try { return fs.statSync(path.join(projectsDir, f)).isDirectory(); } catch { return false; }
            });
            for (const dir of dirs) {
              if (fs.existsSync(path.join(projectsDir, dir, `${event.sessionId}.jsonl`))) {
                const naivePath = dir.replace(/^-/, "/").replace(/-/g, "/");
                injectedFiles = readInjectedFiles(naivePath);

                // Decode project folder name: naive decode breaks hyphenated folder names
                // (e.g. "tving-insight" becomes "tving/insight"). Check filesystem to resolve.
                if (fs.existsSync(naivePath)) {
                  projectFolder = path.basename(naivePath);
                } else {
                  const parts = naivePath.split("/").filter(Boolean);
                  for (let i = parts.length - 2; i >= 0; i--) {
                    const prefix = "/" + parts.slice(0, i).join("/");
                    const suffix = parts.slice(i).join("-");
                    if (fs.existsSync(prefix + "/" + suffix)) {
                      projectFolder = suffix;
                      break;
                    }
                  }
                  if (!projectFolder) {
                    projectFolder = parts[parts.length - 1];
                  }
                }
                break;
              }
            }
          } catch (e) {
            console.error("[SessionFileWatcher] Failed to read injected files:", e);
          }

          // Resolve model: HumanTurn doesn't carry model, so fall back to last known from DB
          let resolvedModel = event.model;
          if (!resolvedModel) {
            try {
              const scans = dbReader.getSessionPrompts(event.sessionId);
              if (scans.length > 0) {
                const lastScan = scans[scans.length - 1];
                resolvedModel = lastScan.model;
              }
            } catch { /* ignore */ }
          }

          const streamingData = {
            sessionId: event.sessionId,
            userPrompt: event.userPrompt ?? "",
            timestamp: event.timestamp,
            model: resolvedModel,
            provider: "claude",
            sessionStats,
            injectedFiles,
            projectFolder,
          };
          sendToNotificationWindow("new-prompt-streaming", streamingData);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("new-prompt-streaming", streamingData);
          }
          console.log(`[SessionFileWatcher] HumanTurn → streaming sent (turns=${sessionStats?.turns}, cost=$${sessionStats?.costUsd?.toFixed(3)})`);
        } else if (event.type === "assistant") {
          // Response complete → dismiss streaming state
          const completeData = {
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            model: event.model,
          };
          sendToNotificationWindow("prompt-streaming-complete", completeData);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("prompt-streaming-complete", completeData);
          }
          console.log(`[SessionFileWatcher] AssistantTurn detected → streaming complete`);

          // Import the current prompt from session file and send enriched scan
          // History watcher only fires on history.jsonl change (session close),
          // so we must import here for real-time notification data.
          setTimeout(() => {
            try {
              const eventTs = typeof event.timestamp === 'number' ? event.timestamp : new Date(event.timestamp).getTime();
              const importedId = importSinglePrompt(event.sessionId, eventTs);
              if (importedId) {
                emitScoredScan(importedId, "session");
              } else {
                // Fallback: emit the latest scan for the session
                const scans = dbReader.getSessionPrompts(event.sessionId);
                if (scans.length > 0) {
                  const latest = scans[scans.length - 1];
                  emitScoredScan(latest.request_id, "session");
                }
              }
            } catch (e) {
              console.error("[SessionFileWatcher] Failed to import prompt for notification:", e);
            }
          }, 1500);
        }
      },
      onActivity: (activity) => {
        queueActivity(activity);
      },
    });
    sessionFileWatcherCleanup = sessionWatcher.cleanup;
    switchSessionFileWatcher = sessionWatcher.switchSession;

    // Initialize with current active session if available
    const initialSessionId = getLastActiveSessionId();
    if (initialSessionId) {
      sessionWatcher.switchSession(initialSessionId);
    }
  } catch (err) {
    console.error("[SessionFileWatcher] Failed to start:", err);
  }

  // Start history.jsonl watcher (passive session monitoring)
  try {
    startHistoryWatcher({
      onNewEntry: (entry) => {
        markProviderWatcherFired("claude");
        handleClaudeHistoryEntry(entry);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("new-history-entry", entry);
        }

        // Switch session file watcher to track the active session
        if (switchSessionFileWatcher) {
          switchSessionFileWatcher(entry.sessionId);
        }

        // Real-time DB import: parse session file and insert latest prompt
        try {
          const insertedRequestId = importSinglePrompt(entry.sessionId, entry.timestamp);
          if (insertedRequestId) {
            emitScoredScan(insertedRequestId, "history");
          }
          // No fallback: don't send stale/previous prompt data
        } catch (e) {
          console.error("[DB] history real-time import error:", e);
        }
      },
    });
  } catch (err) {
    console.error("[HistoryWatcher] Failed to start:", err);
  }

  // Start provider session watcher (real-time detection for non-Claude providers)
  try {
    startProviderSessionWatcher(() => mainWindow);
  } catch (err) {
    console.error("[SessionWatcher] Failed to start:", err);
  }

  // Start Codex session file watcher (real-time notification for Codex prompts)
  try {
    startCodexSessionFileWatcher({
      onTurn: (event) => {
        markProviderWatcherFired("codex");
        if (event.type === "human") {
          // Fetch session stats from DB (same pattern as Claude watcher)
          let sessionStats: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number } | undefined;
          try {
            const scans = dbReader.getSessionPrompts(event.sessionId);
            let totalCost = 0, totalTokens = 0, totalCacheRead = 0;
            for (const s of scans) {
              const detail = dbReader.getPromptDetail(s.request_id);
              if (detail?.usage) {
                totalCost += detail.usage.cost_usd ?? 0;
                const r = detail.usage.response;
                totalTokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_input_tokens ?? 0) + (r.cache_creation_input_tokens ?? 0);
                totalCacheRead += r.cache_read_input_tokens ?? 0;
              }
            }
            sessionStats = {
              turns: scans.length,
              costUsd: totalCost,
              totalTokens,
              cacheReadPct: totalTokens > 0 ? (totalCacheRead / totalTokens) * 100 : 0,
            };
          } catch (e) {
            console.error("[CodexSessionWatcher] Failed to fetch session stats:", e);
          }

          const streamingData = {
            sessionId: event.sessionId,
            userPrompt: event.userPrompt ?? "",
            timestamp: event.timestamp,
            model: event.model,
            provider: "codex",
            sessionStats,
            injectedFiles: [] as Array<{ path: string; category: string; estimated_tokens: number }>,
            projectFolder: event.projectFolder,
          };
          sendToNotificationWindow("new-prompt-streaming", streamingData);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("new-prompt-streaming", streamingData);
          }
          console.log(`[CodexSessionWatcher] HumanTurn → streaming sent (model=${event.model}, folder=${event.projectFolder})`);
        } else if (event.type === "assistant") {
          const completeData = {
            sessionId: event.sessionId,
            timestamp: event.timestamp,
            model: event.model,
          };
          sendToNotificationWindow("prompt-streaming-complete", completeData);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("prompt-streaming-complete", completeData);
          }
          console.log("[CodexSessionWatcher] AssistantTurn → streaming complete");

          // After delay, import prompt to DB and send enriched scan
          setTimeout(() => {
            try {
              const eventTs = typeof event.timestamp === "number"
                ? event.timestamp
                : new Date(event.timestamp).getTime();
              importSinglePrompt(event.sessionId, eventTs);

              const scans = dbReader.getSessionPrompts(event.sessionId);
              if (scans.length > 0) {
                const latest = scans[scans.length - 1];
                emitScoredScan(latest.request_id, "codex");
              }
            } catch (e) {
              console.error("[CodexSessionWatcher] Failed to import prompt for notification:", e);
            }
          }, 1500);
        }
      },
      onActivity: (activity) => {
        queueActivity(activity);
      },
    });
  } catch (err) {
    console.error("[CodexSessionWatcher] Failed to start:", err);
  }

  // Auto-start proxy server (saved port or default 8780)
  const proxyPort = settings?.proxyPort || DEFAULT_PROXY_PORT;
  const proxyUpstream = process.env.PROXY_UPSTREAM || "api.anthropic.com";
  try {
    startProxyServer(
      buildProxyOptions({
        port: proxyPort,
        upstream: proxyUpstream,
        resolveSessionId: () => getLastActiveSessionId(),
        sendToMain: sendToMainWindow,
        sendToNotification: sendToNotificationWindow,
        onProxyScanComplete,
        parseSystemContents: (body: string) => {
          try {
            const parsed = JSON.parse(body);
            if (parsed.system) {
              return parseSystemFieldWithContent(parsed.system).contents;
            }
          } catch {
            /* ignore parse errors */
          }
          return {};
        },
        getPreviousScores: (sessionId: string) => {
          try {
            return dbReader.getSessionFileScores(sessionId);
          } catch {
            return {};
          }
        },
        evidenceEngine,
        persistEvidence: (requestId, report) => {
          const promptId = dbReader.getPromptIdByRequestId(requestId);
          if (promptId !== null) {
            insertEvidenceReport(promptId, report);
          }
        },
      }),
    );
    console.log(`Proxy server auto-started on :${proxyPort}`);
  } catch (err) {
    console.error("Failed to auto-start proxy:", err);
  }
};

const setupIPC = (): void => {
  if (!store || !trayManager) return;

  // Dark mode feature removed

  // Save config
  ipcMain.handle(
    "save-config",
    async (_event, config: { providers: ProviderConfig[] }) => {
      store!.set("providers", config.providers || []);
      trayManager!.refreshProviders();
      return { success: true };
    },
  );

  // Load config
  ipcMain.handle("get-config", async () => {
    return {
      providers: store!.get("providers") || [],
      settings: store!.get("settings") || null,
    };
  });

  // Save app settings
  ipcMain.handle("save-settings", async (_event, settings: AppSettings) => {
    const prevSettings = store!.get("settings") as AppSettings | undefined;
    store!.set("settings", settings);
    trayManager!.updateSettings(settings);

    // Re-register shortcut
    if (settings.shortcut) {
      registerShortcut(settings.shortcut);
    }

    // Restart polling if interval changed (keeps opt-in-aware provider getter).
    const prevRefresh = prevSettings?.refreshInterval || 5;
    const newRefresh = settings.refreshInterval || 5;
    if (prevRefresh !== newRefresh) {
      usageStore.startPolling(newRefresh, () =>
        getOptedInProviders(store!.get("settings") as AppSettings | undefined),
      );
    }

    // Detect proxy port change -> restart
    const prevPort = prevSettings?.proxyPort || DEFAULT_PROXY_PORT;
    const newPort = settings.proxyPort || DEFAULT_PROXY_PORT;
    if (prevPort !== newPort) {
      try {
        await stopProxyServer();
        startProxyServer(
          buildProxyOptions({
            port: newPort,
            upstream: process.env.PROXY_UPSTREAM || "api.anthropic.com",
            resolveSessionId: () => getLastActiveSessionId(),
            sendToMain: sendToMainWindow,
            sendToNotification: sendToNotificationWindow,
            onProxyScanComplete,
            parseSystemContents: (body: string) => {
              try {
                const parsed = JSON.parse(body);
                if (parsed.system) {
                  return parseSystemFieldWithContent(parsed.system).contents;
                }
              } catch {
                /* ignore parse errors */
              }
              return {};
            },
            getPreviousScores: (sessionId: string) => {
              try {
                return dbReader.getSessionFileScores(sessionId);
              } catch {
                return {};
              }
            },
            evidenceEngine,
            persistEvidence: (requestId, report) => {
              const promptId = dbReader.getPromptIdByRequestId(requestId);
              if (promptId !== null) {
                insertEvidenceReport(promptId, report);
              }
            },
          }),
        );
        console.log(`Proxy restarted on :${newPort} (evidence hooks restored)`);
      } catch (err) {
        console.error("Failed to restart proxy:", err);
      }
    }

    return { success: true };
  });

  // Get connected displays for notification placement settings
  ipcMain.handle("get-displays", async () => {
    const { screen } = require("electron");
    const allDisplays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return allDisplays.map((d: Electron.Display) => ({
      id: d.id,
      label: d.id === primary.id
        ? `Built-in Display (${d.bounds.width}×${d.bounds.height})`
        : `External Display (${d.bounds.width}×${d.bounds.height})`,
      width: d.bounds.width,
      height: d.bounds.height,
      isPrimary: d.id === primary.id,
    }));
  });

  // Add provider
  ipcMain.handle("add-provider", async (_event, provider: ProviderConfig) => {
    const providers = store!.get("providers") || [];
    providers.push(provider);
    store!.set("providers", providers);
    trayManager!.refreshProviders();
    return { success: true };
  });

  // Remove provider
  ipcMain.handle("remove-provider", async (_event, providerId: string) => {
    const providers = store!.get("providers") || [];
    const filtered = providers.filter(
      (p: ProviderConfig) => p.id !== providerId,
    );
    store!.set("providers", filtered);
    trayManager!.refreshProviders();
    return { success: true };
  });

  // Manual refresh
  ipcMain.handle("refresh-usage", async () => {
    await usageStore.refresh("claude");
    return { success: true };
  });

  // Get current usage data
  ipcMain.handle("get-usage-data", async () => {
    return trayManager!.getCurrentUsageData();
  });

  // Start proxy server
  // --- History (passive session monitoring) ---

  ipcMain.handle("get-recent-history", async (_event, limit?: number) => {
    try {
      const entries = readRecentHistory(limit ?? 50);

      // Enrich top entries: DB first, then JSONL fallback for unmatched
      const toEnrich = entries.slice(0, 20);
      for (const entry of toEnrich) {
        try {
          const dbMatch = dbReader.findPromptByTimestamp(
            entry.sessionId,
            entry.timestamp,
          );
          if (dbMatch && dbMatch.context_estimate.total_tokens > 0) {
            entry.totalContextTokens = dbMatch.context_estimate.total_tokens;
            entry.model = dbMatch.model;
            continue;
          }
        } catch {
          /* DB lookup failed, fall through to JSONL */
        }
      }

      // JSONL fallback: enrich entries that DB didn't match
      const needsJsonlEnrich = toEnrich.filter((e) => !e.totalContextTokens);
      if (needsJsonlEnrich.length > 0) {
        const projectsDir = path.join(homedir(), ".claude", "projects");
        if (fs.existsSync(projectsDir)) {
          const bySession = new Map<string, typeof needsJsonlEnrich>();
          for (const e of needsJsonlEnrich) {
            const arr = bySession.get(e.sessionId) ?? [];
            arr.push(e);
            bySession.set(e.sessionId, arr);
          }

          let projectDirs: string[] | null = null;
          for (const [sid, sessionEntries] of bySession) {
            try {
              if (!projectDirs) {
                projectDirs = fs.readdirSync(projectsDir).filter((f) => {
                  try {
                    return fs.statSync(path.join(projectsDir, f)).isDirectory();
                  } catch {
                    return false;
                  }
                });
              }
              let logFile: string | null = null;
              for (const dir of projectDirs) {
                const candidate = path.join(projectsDir, dir, `${sid}.jsonl`);
                if (fs.existsSync(candidate)) {
                  logFile = candidate;
                  break;
                }
              }
              if (!logFile) continue;

              const content = fs.readFileSync(logFile, "utf-8");
              const lines = content.trim().split("\n");
              type UsageInfo = {
                ts: number;
                model: string;
                input: number;
                cacheRead: number;
                cacheCreation: number;
              };
              const usages: UsageInfo[] = [];
              for (
                let i = lines.length - 1;
                i >= 0 && usages.length < 50;
                i--
              ) {
                try {
                  const raw = JSON.parse(lines[i]);
                  if (raw.type === "assistant" && raw.message?.usage) {
                    const u = raw.message.usage;
                    usages.push({
                      ts: new Date(raw.timestamp).getTime(),
                      model: raw.message.model || "unknown",
                      input: u.input_tokens || 0,
                      cacheRead: u.cache_read_input_tokens || 0,
                      cacheCreation: u.cache_creation_input_tokens || 0,
                    });
                  }
                } catch {
                  /* skip */
                }
              }

              for (const entry of sessionEntries) {
                let bestDelta = Infinity;
                let bestUsage: UsageInfo | undefined;
                for (const u of usages) {
                  const delta = u.ts - entry.timestamp;
                  if (
                    delta >= -2000 &&
                    delta < 60000 &&
                    Math.abs(delta) < bestDelta
                  ) {
                    bestDelta = Math.abs(delta);
                    bestUsage = u;
                  }
                }
                if (bestUsage) {
                  entry.totalContextTokens =
                    bestUsage.input +
                    bestUsage.cacheRead +
                    bestUsage.cacheCreation;
                  entry.model = bestUsage.model;
                }
              }
            } catch {
              /* skip session */
            }
          }
        }
      }

      return entries;
    } catch (error) {
      console.error("get-recent-history error:", error);
      return [];
    }
  });

  ipcMain.handle("get-daily-stats", async (_event, provider?: string) => {
    try {
      const dbResult = dbReader.getDailyStats(undefined, provider);
      if (dbResult.length > 0) return dbResult;
      return readTodayStats();
    } catch (error) {
      console.error("get-daily-stats error:", error);
      return null;
    }
  });

  // History-based prompt detail analysis (DB primary, JSONL fallback)
  ipcMain.handle(
    "get-history-prompt-detail",
    async (_event, sessionId: string, timestamp: number) => {
      try {
        // DB primary: check if we already have this prompt (with complete data)
        try {
          const dbMatch = dbReader.findPromptByTimestamp(sessionId, timestamp);
          if (
            dbMatch &&
            dbMatch.context_estimate.total_tokens > 0
          ) {
            const dbDetail = dbReader.getPromptDetail(dbMatch.request_id);
            if (dbDetail) return dbDetail;
          }
        } catch {
          /* DB lookup failed, fall through to JSONL */
        }

        // JSONL fallback (existing 450-line logic)
        const projectsDir = path.join(homedir(), ".claude", "projects");
        if (!fs.existsSync(projectsDir)) return null;

        // Find sessionId.jsonl across all projects
        const projectDirs = fs
          .readdirSync(projectsDir)
          .filter((f) => fs.statSync(path.join(projectsDir, f)).isDirectory());

        let logFilePath: string | null = null;
        let projectDirName = "";
        for (const dir of projectDirs) {
          const candidate = path.join(projectsDir, dir, `${sessionId}.jsonl`);
          if (fs.existsSync(candidate)) {
            logFilePath = candidate;
            projectDirName = dir;
            break;
          }
        }
        if (!logFilePath) return null;

        // Restore project path from dash-delimited directory name
        const projectPath = projectDirName
          .replace(/^-/, "/")
          .replace(/-/g, "/");

        const messages = await parseLogFile(logFilePath);
        if (messages.length === 0) return null;

        // Find the user message closest to the timestamp (ms)
        const userMessages = messages.filter(
          (m) => m.role === "user" && m.content,
        );
        let bestIdx = -1;
        let bestDiff = Infinity;
        for (let i = 0; i < userMessages.length; i++) {
          const msgTime = new Date(userMessages[i].timestamp).getTime();
          const diff = Math.abs(msgTime - timestamp);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        if (bestIdx === -1) return null;

        const userMsg = userMessages[bestIdx];
        const userMsgGlobalIdx = messages.indexOf(userMsg);

        // Find the first assistant response after this user message
        let assistantMsg = null;
        for (let i = userMsgGlobalIdx + 1; i < messages.length; i++) {
          if (messages[i].role === "assistant" && messages[i].usage) {
            assistantMsg = messages[i];
            break;
          }
        }

        // Extract tools from all assistant messages between this user message and the next
        // Re-read JSONL raw entries to parse tool_use blocks
        const rawLines = fs
          .readFileSync(logFilePath, "utf-8")
          .trim()
          .split("\n");
        const rawEntries: any[] = [];
        for (const line of rawLines) {
          try {
            rawEntries.push(JSON.parse(line));
          } catch {
            /* skip */
          }
        }

        // Match: find original position by userMsg.uuid or timestamp
        let rawUserIdx = userMsg.uuid
          ? rawEntries.findIndex((e) => e.uuid === userMsg.uuid)
          : -1;
        // Fallback to timestamp-based matching if uuid match fails
        if (rawUserIdx === -1) {
          const targetTime = new Date(userMsg.timestamp).getTime();
          let bestDiff2 = Infinity;
          for (let i = 0; i < rawEntries.length; i++) {
            const e = rawEntries[i];
            if (e.type !== "user" || !e.message?.content) continue;
            const eTime = new Date(e.timestamp).getTime();
            const diff2 = Math.abs(eTime - targetTime);
            if (diff2 < bestDiff2) {
              bestDiff2 = diff2;
              rawUserIdx = i;
            }
          }
        }

        // Index of the next user message (for range bounding)
        let nextUserRawIdx = rawEntries.length;
        if (rawUserIdx < 0) rawUserIdx = -1; // safety
        for (let i = rawUserIdx + 1; i < rawEntries.length; i++) {
          if (rawEntries[i].type === "user" && rawEntries[i].message?.content) {
            const content = rawEntries[i].message.content;
            // Skip user messages that only contain tool_result
            if (
              typeof content === "string" ||
              (Array.isArray(content) &&
                content.some((c: any) => c.type === "text"))
            ) {
              nextUserRawIdx = i;
              break;
            }
          }
        }

        // Extract tool_use (from assistant messages in this turn)
        const toolCalls: Array<{
          index: number;
          name: string;
          input_summary: string;
          timestamp?: string;
        }> = [];
        const toolSummary: Record<string, number> = {};
        const agentCalls: Array<{
          index: number;
          subagent_type: string;
          description: string;
        }> = [];
        let toolResultCount = 0;
        let toolIdx = 0;

        if (rawUserIdx >= 0) {
          for (let i = rawUserIdx + 1; i < nextUserRawIdx; i++) {
            const entry = rawEntries[i];
            if (
              entry.type === "assistant" &&
              entry.message?.content &&
              Array.isArray(entry.message.content)
            ) {
              for (const block of entry.message.content) {
                if (block.type === "tool_use") {
                  const name = block.name || "Unknown";
                  const inputObj =
                    typeof block.input === "object" ? block.input : undefined;
                  let inputStr = "";
                  if (inputObj) {
                    const summaryFields = [
                      "file_path",
                      "pattern",
                      "command",
                      "query",
                      "prompt",
                      "url",
                      "selector",
                      "description",
                    ];
                    for (const field of summaryFields) {
                      if (
                        inputObj[field] &&
                        typeof inputObj[field] === "string"
                      ) {
                        inputStr = String(inputObj[field]).slice(0, 500);
                        break;
                      }
                    }
                    if (!inputStr)
                      inputStr = JSON.stringify(inputObj).slice(0, 500);
                  } else if (typeof block.input === "string") {
                    inputStr = block.input.slice(0, 500);
                  }
                  toolCalls.push({
                    index: toolIdx++,
                    name,
                    input_summary: inputStr,
                    timestamp: entry.timestamp,
                  });
                  toolSummary[name] = (toolSummary[name] || 0) + 1;

                  // Task tool → agent call
                  if (name === "Task" && block.input) {
                    agentCalls.push({
                      index: agentCalls.length,
                      subagent_type: block.input.subagent_type || "unknown",
                      description: block.input.description || "",
                    });
                  }
                }
              }
            }
            // Count tool_result entries and their tokens
            if (
              entry.type === "user" &&
              entry.message?.content &&
              Array.isArray(entry.message.content)
            ) {
              for (const block of entry.message.content) {
                if (block.type === "tool_result") {
                  toolResultCount++;
                  // block.content counted via response usage tokens
                }
              }
            }
          }
        }

        // Count user_text / assistant / tool_result tokens across entire conversation
        let userTextTokensAll = 0;
        let assistantTokensAll = 0;
        let toolResultTokensAll = 0;
        for (let i = 0; i < nextUserRawIdx; i++) {
          const re = rawEntries[i];
          if (re.type === "user" && re.message?.content) {
            const c = re.message.content;
            if (typeof c === "string") {
              userTextTokensAll += countTokens(c);
            } else if (Array.isArray(c)) {
              for (const blk of c) {
                if (blk.type === "tool_result") {
                  toolResultTokensAll += countTokens(
                    typeof blk.content === "string"
                      ? blk.content
                      : JSON.stringify(blk.content || ""),
                  );
                } else if (blk.type === "text") {
                  userTextTokensAll += countTokens(String(blk.text || ""));
                }
              }
            }
          } else if (re.type === "assistant" && re.message?.content) {
            const c = re.message.content;
            if (typeof c === "string") {
              assistantTokensAll += countTokens(c);
            } else if (Array.isArray(c)) {
              let txt = "";
              for (const blk of c) {
                if (blk.type === "text") txt += blk.text || "";
              }
              assistantTokensAll += countTokens(txt);
            }
          }
        }

        // Determine injected files: DB scan -> cache -> disk fallback
        const userMsgTime = new Date(userMsg.timestamp).getTime();
        const proxyScan = dbReader.findPromptByTimestamp(sessionId, userMsgTime);
        const cacheKey = `${sessionId}:${timestamp}`;

        let injectedFiles: Array<{
          path: string;
          category: string;
          estimated_tokens: number;
        }>;
        let totalInjectedTokens: number;

        if (proxyScan) {
          // Priority 1: proxy scan (exact values at request time)
          injectedFiles = proxyScan.injected_files;
          totalInjectedTokens = proxyScan.total_injected_tokens;
        } else if (injectedCacheData[cacheKey]) {
          // Priority 2: file cache (persists across restarts)
          injectedFiles = injectedCacheData[cacheKey].files;
          totalInjectedTokens = injectedCacheData[cacheKey].total;
        } else {
          // Priority 3: read from current disk -> save to cache
          injectedFiles = [];
          totalInjectedTokens = 0;

          const addInjectedFile = (fp: string, category: string) => {
            try {
              if (fs.existsSync(fp)) {
                const content = fs.readFileSync(fp, "utf-8");
                const tokens = countTokens(content);
                injectedFiles.push({
                  path: fp,
                  category,
                  estimated_tokens: tokens,
                });
                totalInjectedTokens += tokens;
              }
            } catch {
              /* skip */
            }
          };

          addInjectedFile(
            path.join(homedir(), ".claude", "CLAUDE.md"),
            "global",
          );

          const globalRulesDir = path.join(homedir(), ".claude", "rules");
          if (fs.existsSync(globalRulesDir)) {
            try {
              for (const rf of fs
                .readdirSync(globalRulesDir)
                .filter((f) => f.endsWith(".md"))) {
                addInjectedFile(path.join(globalRulesDir, rf), "rules");
              }
            } catch {
              /* skip */
            }
          }

          if (projectPath && fs.existsSync(projectPath)) {
            addInjectedFile(path.join(projectPath, "CLAUDE.md"), "project");

            const projRulesDir = path.join(projectPath, ".claude", "rules");
            if (fs.existsSync(projRulesDir)) {
              try {
                for (const rf of fs
                  .readdirSync(projRulesDir)
                  .filter((f) => f.endsWith(".md"))) {
                  addInjectedFile(path.join(projRulesDir, rf), "rules");
                }
              } catch {
                /* skip */
              }
            }

            const projMemoryDir = path.join(projectPath, ".claude", "memory");
            if (fs.existsSync(projMemoryDir)) {
              try {
                for (const mf of fs
                  .readdirSync(projMemoryDir)
                  .filter((f) => f.endsWith(".md"))) {
                  addInjectedFile(path.join(projMemoryDir, mf), "memory");
                }
              } catch {
                /* skip */
              }
            }
          }

          const userMemoryFile = path.join(
            homedir(),
            ".claude",
            "projects",
            projectDirName,
            "memory",
            "MEMORY.md",
          );
          addInjectedFile(userMemoryFile, "memory");

          // Persist to file cache
          injectedCacheData[cacheKey] = {
            files: injectedFiles,
            total: totalInjectedTokens,
          };
          saveInjectedCache();
        }

        // Count conversation turns
        let userCount = 0;
        let assistantCount = 0;
        for (let i = 0; i <= userMsgGlobalIdx; i++) {
          if (messages[i].role === "user") userCount++;
          if (messages[i].role === "assistant") assistantCount++;
        }

        const cleanContent = (userMsg.content || "")
          .replace(/\x1b\[[0-9;]*m/g, "")
          .replace(/\[[\d;]*m/g, "")
          .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
          .replace(/<task-notification>[\s\S]*?<\/task-notification>/g, "")
          .replace(/<[^>]+>/g, "")
          .trim();

        const model = assistantMsg?.model || "unknown";
        const usage = assistantMsg?.usage;
        const inputTokens = usage?.inputTokens ?? 0;
        const outputTokens = usage?.outputTokens ?? 0;
        const cacheRead = usage?.cacheReadTokens ?? 0;
        const cacheCreation = usage?.cacheCreationTokens ?? 0;
        // Total context = new input + cached read + cache creation
        const totalContextTokens = inputTokens + cacheRead + cacheCreation;

        // Extract assistant response text for preview
        let assistantResponseText = "";
        if (assistantMsg && assistantMsg.content) {
          const ac = assistantMsg.content;
          if (typeof ac === "string") {
            assistantResponseText = ac;
          } else if (Array.isArray(ac)) {
            assistantResponseText = (ac as any[])
              .filter(
                (b: any) => b.type === "text" && typeof b.text === "string",
              )
              .map((b: any) => b.text)
              .join("\n")
              .trim();
          }
        }

        // Construct PromptScan
        const scan = {
          request_id: userMsg.uuid || `history-${sessionId}-${timestamp}`,
          session_id: sessionId,
          timestamp: userMsg.timestamp,
          user_prompt: cleanContent.slice(0, 500),
          user_prompt_tokens: countTokens(cleanContent),
          assistant_response: assistantResponseText
            ? assistantResponseText.slice(0, 500)
            : undefined,
          injected_files: injectedFiles,
          total_injected_tokens: totalInjectedTokens,
          tool_calls: proxyScan?.tool_calls ?? toolCalls,
          tool_summary: proxyScan?.tool_summary ?? toolSummary,
          agent_calls: proxyScan?.agent_calls ?? agentCalls,
          context_estimate: proxyScan
            ? proxyScan.context_estimate
            : (() => {
                const msgTokens =
                  totalContextTokens > totalInjectedTokens
                    ? totalContextTokens - totalInjectedTokens
                    : totalContextTokens;
                const directTotal =
                  userTextTokensAll + assistantTokensAll + toolResultTokensAll;
                let bdResult:
                  | {
                      user_text_tokens: number;
                      assistant_tokens: number;
                      tool_result_tokens: number;
                    }
                  | undefined;
                if (directTotal > 0) {
                  const scale = msgTokens / directTotal;
                  bdResult = {
                    user_text_tokens: Math.round(userTextTokensAll * scale),
                    assistant_tokens: Math.round(assistantTokensAll * scale),
                    tool_result_tokens: Math.round(toolResultTokensAll * scale),
                  };
                }
                return {
                  system_tokens: totalInjectedTokens,
                  messages_tokens: msgTokens,
                  messages_tokens_breakdown: bdResult,
                  tools_definition_tokens: 0,
                  total_tokens: totalContextTokens,
                };
              })(),
          model,
          max_tokens: 16000,
          conversation_turns: userCount,
          user_messages_count: userCount,
          assistant_messages_count: assistantCount,
          tool_result_count: toolResultCount,
        };

        // Construct UsageLogEntry
        const usageEntry = assistantMsg
          ? {
              timestamp: assistantMsg.timestamp,
              request_id: scan.request_id,
              session_id: sessionId,
              model,
              request: {
                messages_count: userCount + assistantCount,
                tools_count: 0,
                has_system: true,
                max_tokens: 16000,
              },
              response: {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                cache_creation_input_tokens: cacheCreation,
                cache_read_input_tokens: cacheRead,
              },
              cost_usd: calculateCost(
                model,
                inputTokens,
                outputTokens,
                cacheRead,
                cacheCreation,
              ),
              duration_ms: 0,
            }
          : null;

        // Opportunistic DB upsert: replace incomplete batch data with full detail
        try {
          const db = require("./db/index").getDatabase();
          // Delete incomplete batch-imported row (system_tokens=0) so full data can be inserted
          db.prepare(
            "DELETE FROM prompts WHERE request_id = @rid AND source = 'history' AND system_tokens = 0",
          ).run({ rid: scan.request_id });
          onHistoryPromptParsed(scan as any, usageEntry);
        } catch {
          /* ignore — duplicate or DB error */
        }

        return { scan, usage: usageEntry };
      } catch (error) {
        console.error("get-history-prompt-detail error:", error);
        return null;
      }
    },
  );

  // --- CT Scan IPC ---

  // Get current session ID
  ipcMain.handle("get-current-session-id", async () => {
    return getSessionId();
  });

  // Get scan list by session
  ipcMain.handle("get-session-scans", async (_event, sessionId: string) => {
    try {
      return dbReader.getSessionPrompts(sessionId);
    } catch (error) {
      console.error("get-session-scans error:", error);
      return [];
    }
  });

  // Get scan list
  ipcMain.handle(
    "get-prompt-scans",
    async (
      _event,
      options?: {
        limit?: number;
        offset?: number;
        session_id?: string;
        provider?: string;
      },
    ) => {
      try {
        const results = dbReader.getPrompts(options);
        const providers = new Map<string, number>();
        for (const r of results) {
          providers.set(r.provider ?? 'unknown', (providers.get(r.provider ?? 'unknown') ?? 0) + 1);
        }
        console.log(`[IPC] get-prompt-scans provider=${options?.provider ?? 'ALL'} → ${results.length} results`, Object.fromEntries(providers));
        return results;
      } catch (error) {
        console.error("get-prompt-scans error:", error);
        return [];
      }
    },
  );

  // Scan detail + usage join
  ipcMain.handle(
    "get-prompt-scan-detail",
    async (_event, requestId: string) => {
      try {
        return dbReader.getPromptDetail(requestId) ?? null;
      } catch (error) {
        console.error("get-prompt-scan-detail error:", error);
        return null;
      }
    },
  );

  // Read file content (for previewing injected .md files)
  ipcMain.handle("read-file-content", async (_event, filePath: string) => {
    try {
      // Expand ~ to home directory
      const resolved = path.resolve(
        filePath.startsWith("~")
          ? path.join(homedir(), filePath.slice(1))
          : filePath,
      );

      // Security: only allow safe text file extensions
      const ALLOWED_EXTENSIONS = new Set([
        ".md",
        ".txt",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".json",
        ".yaml",
        ".yml",
        ".toml",
        ".cfg",
        ".conf",
        ".ini",
        ".css",
        ".html",
        ".xml",
        ".csv",
        ".log",
        ".sh",
      ]);
      const ext = path.extname(resolved).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) {
        return { content: "", error: `File type not allowed: ${ext}` };
      }

      // Security: block sensitive paths
      const BLOCKED_PATTERNS = [
        "/.ssh/",
        "/.gnupg/",
        "/.aws/",
        "/credentials",
        "/.env",
        "/secret",
        "/private_key",
        "/id_rsa",
        "/id_ed25519",
        "/.npmrc",
        "/.pypirc",
      ];
      const lowerResolved = resolved.toLowerCase();
      const blocked = BLOCKED_PATTERNS.some((p) => lowerResolved.includes(p));
      if (blocked) {
        return { content: "", error: "Access to sensitive file denied" };
      }

      if (!fs.existsSync(resolved)) {
        return { content: "", error: `File not found: ${resolved}` };
      }

      const stat = fs.statSync(resolved);
      // Reject files larger than 1MB
      if (stat.size > 1024 * 1024) {
        return { content: "", error: "File too large (>1MB)" };
      }

      const content = fs.readFileSync(resolved, "utf-8");
      return { content };
    } catch (error) {
      return { content: "", error: String(error) };
    }
  });

  // Aggregate statistics (DB query — replaced 120-line JSONL scan)
  ipcMain.handle("get-scan-stats", async (_event, provider?: string, days?: number) => {
    try {
      return dbReader.getScanStats(provider, days);
    } catch (error) {
      console.error("get-scan-stats error:", error);
      return null;
    }
  });

  // Prompt heatmap (GitHub-style activity graph, last 365 days)
  ipcMain.handle("get-prompt-heatmap", async (_event, provider?: string) => {
    try {
      return dbReader.getPromptHeatmap(provider);
    } catch (error) {
      console.error("get-prompt-heatmap error:", error);
      return [];
    }
  });

  // === Token Output Productivity IPC ===

  ipcMain.handle("get-token-composition", async (_event, period: string, provider?: string) => {
    try {
      const validPeriods = ['today', '7d', '30d'] as const;
      type ValidPeriod = typeof validPeriods[number];
      if (!validPeriods.includes(period as ValidPeriod)) {
        return { cache_read: 0, cache_create: 0, input: 0, output: 0, total: 0 };
      }
      return dbReader.getTokenComposition(period as ValidPeriod, provider);
    } catch (error) {
      console.error("get-token-composition error:", error);
      return { cache_read: 0, cache_create: 0, input: 0, output: 0, total: 0 };
    }
  });

  ipcMain.handle("get-output-productivity", async (_event, provider?: string) => {
    try {
      return dbReader.getOutputProductivity(provider);
    } catch (error) {
      console.error("get-output-productivity error:", error);
      return {
        todayOutputTokens: 0, todayTotalTokens: 0, todayOutputRatio: 0,
        todayCostUSD: 0, last7DaysOutputTokens: 0, last7DaysTotalTokens: 0,
        last7DaysOutputRatio: 0,
      };
    }
  });

  ipcMain.handle("get-session-turn-metrics", async (_event, sessionId: string) => {
    try {
      return dbReader.getSessionTurnMetrics(sessionId);
    } catch (error) {
      console.error("get-session-turn-metrics error:", error);
      return [];
    }
  });

  ipcMain.handle("get-cost-summary", async (_event, provider?: string) => {
    try {
      return dbReader.getProviderCostSummary(provider);
    } catch (error) {
      console.error("get-cost-summary error:", error);
      return { todayCostUSD: 0, todayTokens: 0, last30DaysCostUSD: 0, last30DaysTokens: 0 };
    }
  });

  // === Usage Dashboard IPC (real API connection) ===

  ipcMain.handle("get-provider-usage", async (_event, provider: string) => {
    try {
      return await resolveProviderUsageRequest(
        currentSettings(),
        provider as UsageProviderType,
        {
          getCached: () => usageStore.getSnapshot(provider as UsageProviderType),
          refresh: () => usageStore.refresh(provider as UsageProviderType),
        },
      );
    } catch (err) {
      console.error(`[Usage] Failed to fetch ${provider}:`, err);
      return null;
    }
  });

  ipcMain.handle("get-all-provider-connection-status", async () => {
    try {
      const {
        buildAllProviderConnectionStatuses,
      } = require("./providers/usage/credentialReader");
      const { hasProviderWatcherFired } = require("./providers/usage/trackingActivity");
      const settings = currentSettings();
      return buildAllProviderConnectionStatuses(
        (provider: string) => {
          const snapshot = dbReader.getProviderTrackingSnapshot(provider);
          return {
            promptCount: snapshot.promptCount,
            lastTrackedAt: snapshot.lastTrackedAt,
            watcherFired: hasProviderWatcherFired(provider),
          };
        },
        (provider: UsageProviderType) => ({
          optedIn: isAccountInsightsEnabled(settings, provider),
          runtimeError: getAccountInsightsRuntimeError(provider),
        }),
      );
    } catch (err) {
      console.error("[Usage] Failed to get provider connection statuses:", err);
      return [];
    }
  });

  ipcMain.handle("get-first-run-status", async () => {
    try {
      const { computeFirstRunStatus } = require("./providers/usage/firstRunDetector");
      return computeFirstRunStatus({
        getTotalPromptCount: () => dbReader.getPromptCount(),
      });
    } catch (err) {
      console.error("[FirstRun] Failed to compute status:", err);
      return { isFirstRun: false, sessionRootsPresent: true, totalPromptCount: 0 };
    }
  });

  ipcMain.handle(
    "refresh-provider-usage",
    async (_event, provider?: string) => {
      console.log(`[Usage] Refresh requested for: ${provider ?? "all"}`);
      // Phase 3 — user-initiated refresh still respects opt-in so clicking
      // refresh on a tracking-only tab never probes credentials silently.
      if (provider) {
        if (!isAccountInsightsEnabled(currentSettings(), provider as UsageProviderType)) {
          return null;
        }
        return await usageStore.refresh(provider as any);
      }
      if (isAccountInsightsEnabled(currentSettings(), "claude")) {
        await usageStore.refresh("claude");
      }
    },
  );

  // === Phase 3 — Account Insights opt-in IPC ===

  const isValidProvider = (value: unknown): value is UsageProviderType =>
    value === "claude" || value === "codex" || value === "gemini";

  const runAccountInsightsRefresh = async (
    provider: UsageProviderType,
    force: boolean,
  ): Promise<{ success: boolean; state: AccountInsightsState; message?: string }> => {
    clearAccountInsightsRuntimeError(provider);
    try {
      const cached = force ? null : usageStore.getSnapshot(provider);
      const snapshot = cached ?? (await usageStore.refresh(provider));
      if (snapshot) {
        return { success: true, state: "connected" };
      }
      const tokenStatus = getProviderTokenStatus(provider);
      if (tokenStatus.tokenExpired) {
        return { success: false, state: "expired" };
      }
      if (!tokenStatus.hasToken) {
        // Opted in but no local credential — user has pointed the app here
        // but hasn't completed provider-side login yet.
        return { success: true, state: "not_connected" };
      }
      setAccountInsightsRuntimeError(provider, "unavailable");
      return { success: false, state: "unavailable" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const looksDenied = /keychain|denied|permission/i.test(msg);
      const state: "access_denied" | "unavailable" = looksDenied
        ? "access_denied"
        : "unavailable";
      setAccountInsightsRuntimeError(provider, state);
      return { success: false, state, message: msg };
    }
  };

  ipcMain.handle("account-insights:connect", async (_event, provider: unknown) => {
    if (!isValidProvider(provider)) {
      return { success: false, state: "not_connected", message: "invalid provider" };
    }
    const settings = (store!.get("settings") ?? {}) as AppSettings;
    settings.accountInsights = setAccountInsightsEnabled(settings, provider, true);
    store!.set("settings", settings);
    if (provider === "claude") {
      tokenWatcherHandle?.startKeychainPoll();
    }
    return await runAccountInsightsRefresh(provider, false);
  });

  ipcMain.handle("account-insights:disconnect", async (_event, provider: unknown) => {
    if (!isValidProvider(provider)) {
      return { success: false, state: "not_connected", message: "invalid provider" };
    }
    const settings = (store!.get("settings") ?? {}) as AppSettings;
    settings.accountInsights = setAccountInsightsEnabled(settings, provider, false);
    store!.set("settings", settings);
    clearAccountInsightsRuntimeError(provider);
    usageStore.clearSnapshot(provider);
    if (provider === "claude") {
      tokenWatcherHandle?.stopKeychainPoll();
    }
    return { success: true, state: "not_connected" };
  });

  ipcMain.handle("account-insights:reconnect", async (_event, provider: unknown) => {
    if (!isValidProvider(provider)) {
      return { success: false, state: "not_connected", message: "invalid provider" };
    }
    const settings = (store!.get("settings") ?? {}) as AppSettings;
    settings.accountInsights = setAccountInsightsEnabled(settings, provider, true);
    store!.set("settings", settings);
    if (provider === "claude") {
      tokenWatcherHandle?.startKeychainPoll();
    }
    return await runAccountInsightsRefresh(provider, true);
  });

  // === MCP Insights IPC ===

  ipcMain.handle("get-mcp-insights", async (_event, period: string, provider?: string) => {
    try {
      const validPeriods = ['today', '7d', '30d'] as const;
      type ValidPeriod = typeof validPeriods[number];
      if (!validPeriods.includes(period as ValidPeriod)) {
        return { totalMcpCalls: 0, totalToolCalls: 0, mcpCallRatio: 0, totalToolResultTokens: 0, mcpToolStats: [], redundantCallCount: 0 };
      }
      return dbReader.getMcpInsights(period as ValidPeriod, provider);
    } catch (error) {
      console.error("get-mcp-insights error:", error);
      return { totalMcpCalls: 0, totalToolCalls: 0, mcpCallRatio: 0, totalToolResultTokens: 0, mcpToolStats: [], redundantCallCount: 0 };
    }
  });

  ipcMain.handle("get-session-mcp-analysis", async (_event, sessionId: string) => {
    try {
      return dbReader.getSessionMcpAnalysis(sessionId);
    } catch (error) {
      console.error("get-session-mcp-analysis error:", error);
      return { totalToolCalls: 0, mcpCalls: 0, toolResultTokens: 0, toolBreakdown: {}, redundantPatterns: [] };
    }
  });

  // === Guardrail Engine IPC ===

  ipcMain.handle("get-guardrail-context", async (_event, sessionId: string) => {
    try {
      const [turnMetrics, mcpAnalysis, harnessCandidates] = await Promise.all([
        dbReader.getSessionTurnMetrics(sessionId),
        dbReader.getSessionMcpAnalysis(sessionId),
        Promise.resolve(dbReader.getHarnessCandidates({ sessionId, limit: 5 })),
      ]);
      return { turnMetrics, mcpAnalysis, harnessCandidates };
    } catch (error) {
      console.error("get-guardrail-context error:", error);
      return {
        turnMetrics: [],
        mcpAnalysis: { totalToolCalls: 0, mcpCalls: 0, toolResultTokens: 0, toolBreakdown: {}, redundantPatterns: [] },
        harnessCandidates: [],
      };
    }
  });

  ipcMain.handle("get-harness-candidates", async (_event, query?: {
    sessionId?: string; provider?: string; period?: 'today' | '7d' | '30d'; limit?: number;
  }) => {
    try {
      return dbReader.getHarnessCandidates(query ?? {});
    } catch (error) {
      console.error("get-harness-candidates error:", error);
      return [];
    }
  });

  // Memory monitor: read provider-specific memory files for a prompt's project
  ipcMain.handle(
    "get-memory-status",
    async (_event, projectPath?: string, provider?: string) => {
      try {
        return getMemoryStatusForProvider({ provider, projectPath });
      } catch (error) {
        console.error("get-memory-status error:", error);
        return null;
      }
    },
  );

  ipcMain.handle("get-all-projects-memory-summary", async () => {
    try {
      const projectsDir = path.join(homedir(), ".claude", "projects");
      if (!fs.existsSync(projectsDir)) return { projects: [] };

      const cwd = process.cwd();
      const currentEncoded = cwd.replace(/\//g, "-");

      const dirs = fs.readdirSync(projectsDir).filter((d: string) => {
        if (d.includes("--claude-worktrees-")) return false;
        const full = path.join(projectsDir, d);
        return fs.statSync(full).isDirectory();
      });

      const projects = dirs.map((encodedDir: string) => {
        const memoryDir = path.join(projectsDir, encodedDir, "memory");
        const decoded = encodedDir.replace(/^-/, "/").replace(/-/g, "/");
        const projectName = decoded.split("/").filter(Boolean).pop() || encodedDir;

        if (!fs.existsSync(memoryDir)) {
          return {
            projectPath: decoded,
            projectName,
            encodedDir,
            indexLineCount: 0,
            indexMaxLines: 200,
            fileCount: 0,
            totalLines: 0,
            types: {},
            isCurrentProject: encodedDir === currentEncoded,
          };
        }

        const indexPath = path.join(memoryDir, "MEMORY.md");
        const indexContent = fs.existsSync(indexPath)
          ? fs.readFileSync(indexPath, "utf-8")
          : "";
        const indexLineCount = indexContent.split("\n").length;

        const mdFiles = fs.readdirSync(memoryDir)
          .filter((f: string) => f.endsWith(".md") && f !== "MEMORY.md");

        const types: Record<string, number> = {};
        let totalLines = indexLineCount;

        for (const f of mdFiles) {
          const filePath = path.join(memoryDir, f);
          const content = fs.readFileSync(filePath, "utf-8");
          const lines = content.split("\n");
          totalLines += lines.length;

          let type = "unknown";
          if (lines[0] === "---") {
            const endIdx = lines.indexOf("---", 1);
            if (endIdx > 0) {
              const typeMatch = lines.slice(1, endIdx).join("\n").match(/^type:\s*(.+)$/m);
              if (typeMatch) type = typeMatch[1].trim();
            }
          }
          types[type] = (types[type] || 0) + 1;
        }

        return {
          projectPath: decoded,
          projectName,
          encodedDir,
          indexLineCount,
          indexMaxLines: 200,
          fileCount: mdFiles.length,
          totalLines,
          types,
          isCurrentProject: encodedDir === currentEncoded,
        };
      });

      return { projects };
    } catch (error) {
      console.error("get-all-projects-memory-summary error:", error);
      return { projects: [] };
    }
  });

  ipcMain.handle("preview-workflow-draft", async (_event, candidate: {
    toolName: string; inputSummary: string; candidateKind: string;
    repeatCount: number; promptCount: number; sessionCount: number;
    totalCostUsd: number; provider: string; sampleRequestIds?: string[];
  }) => {
    try {
      return generateWorkflowDraft(candidate);
    } catch (error) {
      console.error("preview-workflow-draft error:", error);
      return null;
    }
  });

  ipcMain.handle("export-workflow-draft", async (_event, options: {
    suggestedPath: string; content: string; projectPath: string; overwrite?: boolean;
  }) => {
    try {
      return exportWorkflowDraft(options);
    } catch (error) {
      console.error("export-workflow-draft error:", error);
      return { success: false, exportedPath: options.suggestedPath, overwritten: false, error: String(error) };
    }
  });

  ipcMain.handle("record-workflow-action", async (_event, input: {
    candidateId: string; requestId?: string; sessionId?: string; projectPath?: string;
    actionType: 'previewed' | 'exported' | 'dismissed' | 'marked_adopted';
    artifactKind?: string; artifactPath?: string;
  }) => {
    try {
      const id = recordWorkflowAction(input);
      return { success: true, id };
    } catch (error) {
      console.error("record-workflow-action error:", error);
      return { success: false, error: String(error) };
    }
  });

  // === Evidence Scoring IPC ===

  ipcMain.handle("get-evidence-report", async (_event, requestId: string) => {
    try {
      return dbReader.getEvidenceReport(requestId);
    } catch (err) {
      console.error("[Evidence] get-evidence-report error:", err);
      return null;
    }
  });

  ipcMain.handle("get-evidence-config", async () => {
    if (!evidenceEngine) return mergeConfig();
    return evidenceEngine.getConfig();
  });

  ipcMain.handle(
    "update-evidence-config",
    async (_event, config: Partial<EvidenceEngineConfig>) => {
      const validation = validateEvidenceConfig(config);
      if (!validation.ok) {
        return { success: false, error: validation.error };
      }
      try {
        if (evidenceEngine) {
          evidenceEngine.updateConfig(config);
        }
        if (store) {
          store.set("evidenceConfig", evidenceEngine?.getConfig() ?? mergeConfig(config));
        }
        return { success: true };
      } catch (err) {
        console.error("[Evidence] update-evidence-config error:", err);
        return { success: false };
      }
    },
  );

  ipcMain.handle("rescore-evidence", async (_event, requestId: string) => {
    try {
      if (!evidenceEngine) return null;
      const detail = dbReader.getPromptDetail(requestId);
      if (!detail) return null;

      const { scan } = detail;
      const previousScores = dbReader.getSessionFileScores(scan.session_id);

      // Try to get file contents from a dummy body (not available for re-score)
      const report = evidenceEngine.score(scan, { previousScores });
      scan.evidence_report = report;

      return report;
    } catch (err) {
      console.error("[Evidence] rescore-evidence error:", err);
      return null;
    }
  });
};

app.whenReady().then(initApp);

app.on("window-all-closed", () => {
  // Do not quit — this is a macOS tray app
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    createNotificationWindow();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  try {
    closeDatabase();
  } catch {
    /* ignore */
  }
  try {
    stopProxyServer();
  } catch {
    /* ignore */
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  if (mainWindow) {
    mainWindow.close();
  }
  usageStore.stopPolling();
  stopGapFillScheduler();
  if (sessionFileWatcherCleanup) sessionFileWatcherCleanup();
  trayManager?.cleanup();
  stopProxyServer().catch((err) => console.error("Proxy cleanup error:", err));
  shutdownEventBus(eventBusServer).catch((err) =>
    console.error("[eventBus] shutdown error:", err),
  );
  eventBusServer = null;
});
