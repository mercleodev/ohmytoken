import { useState, useEffect, useCallback, useRef } from 'react';
import type { PromptScan, UsageLogEntry, TurnMetric } from '../../types/electron';
import type { PromptNotification, ActivityLine } from './types';
import { getSessionAlerts } from '../../utils/sessionAlerts';

const AUTO_DISMISS_MS = 120_000;
const MAX_VISIBLE = 5;
const MAX_ACTIVITY_LINES = 50;

type NavigateCallback = (scan: PromptScan, usage: UsageLogEntry | null) => void;

let activityCounter = 0;

export const useNotificationManager = (
  enabled: boolean,
  onNavigate: NavigateCallback,
) => {
  const [notifications, setNotifications] = useState<PromptNotification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Start auto-dismiss timer for a notification
  const startDismissTimer = useCallback((id: string) => {
    // Clear existing timer
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      timersRef.current.delete(id);
    }, AUTO_DISMISS_MS);

    timersRef.current.set(id, timer);
  }, []);

  // Dismiss a notification manually
  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Click a notification → navigate to prompt detail
  const handleClick = useCallback((id: string) => {
    const notif = notifications.find((n) => n.id === id);
    if (notif) {
      onNavigate(notif.scan, notif.usage);
      dismiss(id);
    }
  }, [notifications, onNavigate, dismiss]);

  // Add a new notification from scan data
  const addNotification = useCallback(async (
    scan: PromptScan,
    usage: UsageLogEntry | null,
  ) => {
    if (!enabled) return;

    // Skip scans older than 3 minutes — prevents stale DB data from creating ghost cards
    const scanAge = Date.now() - new Date(scan.timestamp).getTime();
    if (scanAge > 180_000) {
      const dbg = (window.api as any).debugLog ?? console.log;
      dbg('[NotifMgr] Skipping stale scan: age=' + (scanAge / 1000).toFixed(0) + 's');
      return;
    }

    // Fetch turn metrics for sparkline
    let turnMetrics: TurnMetric[] = [];
    try {
      turnMetrics = await window.api.getSessionTurnMetrics(scan.session_id);
    } catch {
      // Best-effort: sparkline won't show if metrics unavailable
    }

    // Compute session alerts
    const totalOutput = usage?.response.output_tokens ?? 0;
    const totalCacheRead = usage?.response.cache_read_input_tokens ?? 0;
    const totalAll =
      totalCacheRead +
      (usage?.response.cache_creation_input_tokens ?? 0) +
      (usage?.response.input_tokens ?? 0) +
      totalOutput;

    const alerts = getSessionAlerts({
      turnCount: scan.conversation_turns,
      totalOutput,
      totalCacheRead,
      totalAll,
    });

    const hasResponse = Boolean(scan.assistant_response?.trim());
    const hasOutput = (usage?.response.output_tokens ?? 0) > 0;
    const isCompleted = hasResponse || hasOutput;

    const notif: PromptNotification = {
      id: scan.request_id,
      scan,
      usage,
      status: isCompleted ? 'completed' : 'streaming',
      createdAt: Date.now(),
      completedAt: isCompleted ? Date.now() : null,
      turnMetrics,
      alerts,
      activityLog: [],
    };

    setNotifications((prev) => {
      // Preserve activity log and streaming status from existing card for same session
      const existing = prev.find((n) => n.scan.session_id === scan.session_id);
      if (existing) {
        notif.activityLog = existing.activityLog;

        // If the incoming scan is OLDER than the existing card's prompt,
        // preserve the current user_prompt and timestamp (don't regress to old prompt)
        const existingTs = new Date(existing.scan.timestamp).getTime();
        const incomingTs = new Date(scan.timestamp).getTime();
        if (incomingTs < existingTs && existing.scan.user_prompt) {
          notif.scan = {
            ...notif.scan,
            user_prompt: existing.scan.user_prompt,
            timestamp: existing.scan.timestamp,
          };
        }

        // Real scan data arrived from DB — mark as completed
        // (overrides streaming status since we now have the actual response data)
      }
      const filtered = prev.filter(
        (n) => n.id !== scan.request_id && n.scan.session_id !== scan.session_id,
      );
      return [notif, ...filtered].slice(0, MAX_VISIBLE);
    });

    // Start auto-dismiss if completed (and not kept streaming)
    if (isCompleted) {
      // Check actual status after potential override
      setNotifications((prev) => {
        const n = prev.find((x) => x.id === scan.request_id);
        if (n?.status === 'completed') {
          startDismissTimer(scan.request_id);
        }
        return prev;
      });
    }
  }, [enabled, startDismissTimer]);

  // Add a streaming (processing) notification when user sends a prompt
  const addStreamingNotification = useCallback((data: {
    sessionId: string;
    userPrompt: string;
    timestamp: string;
    model?: string;
    sessionStats?: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number };
  }) => {
    if (!enabled) return;

    const stats = data.sessionStats;
    const streamingId = `streaming-${data.sessionId}-${data.timestamp}`;
    const partialScan: PromptScan = {
      request_id: streamingId,
      session_id: data.sessionId,
      user_prompt: data.userPrompt,
      timestamp: data.timestamp,
      model: data.model ?? 'unknown',
      provider: 'claude',
      conversation_turns: stats?.turns ?? 0,
      user_prompt_tokens: 0,
      total_injected_tokens: 0,
      injected_files: [],
      tool_calls: [],
      tool_summary: {},
      agent_calls: [],
      context_estimate: { system_tokens: 0, messages_tokens: 0, tools_definition_tokens: 0, total_tokens: 0 },
      max_tokens: 0,
      user_messages_count: 0,
      assistant_messages_count: 0,
      tool_result_count: 0,
    };

    // Build a temporary usage object from session stats for immediate display
    const streamingUsage: UsageLogEntry | null = stats ? {
      request_id: streamingId,
      cost_usd: stats.costUsd,
      response: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: Math.round(stats.totalTokens * stats.cacheReadPct / 100),
        cache_creation_input_tokens: 0,
      },
    } as UsageLogEntry : null;

    const notif: PromptNotification = {
      id: streamingId,
      scan: partialScan,
      usage: streamingUsage,
      status: 'streaming',
      createdAt: Date.now(),
      completedAt: null,
      turnMetrics: [],
      alerts: [],
      activityLog: [],
    };

    // Async: fetch turn metrics for sparkline (best-effort, won't block card creation)
    window.api.getSessionTurnMetrics?.(data.sessionId)
      .then((metrics: TurnMetric[]) => {
        if (metrics.length > 0) {
          setNotifications((prev) =>
            prev.map((n) => n.id === streamingId ? { ...n, turnMetrics: metrics } : n),
          );
        }
      })
      .catch(() => {});

    setNotifications((prev) => {
      // Cancel auto-dismiss timers for existing cards in same session
      for (const n of prev) {
        if (n.scan.session_id === data.sessionId) {
          const timer = timersRef.current.get(n.id);
          if (timer) {
            clearTimeout(timer);
            timersRef.current.delete(n.id);
          }
        }
      }
      const filtered = prev.filter(
        (n) => n.scan.session_id !== data.sessionId,
      );
      return [notif, ...filtered].slice(0, MAX_VISIBLE);
    });
  }, [enabled]);

  // Mark streaming notifications as completed when AssistantTurn arrives
  // Start auto-dismiss timer — if a new tool_use activity arrives later,
  // appendActivity() will cancel the timer and revert to streaming.
  const completeStreaming = useCallback((data: { sessionId: string; model?: string }) => {
    setNotifications((prev) =>
      prev.map((n) => {
        if (n.status === 'streaming' && n.scan.session_id === data.sessionId) {
          return {
            ...n,
            status: 'completed' as const,
            completedAt: Date.now(),
            scan: { ...n.scan, model: data.model ?? n.scan.model },
          };
        }
        return n;
      }),
    );
    // Start auto-dismiss for newly completed notifications
    setNotifications((prev) => {
      for (const n of prev) {
        if (n.status === 'completed' && n.scan.session_id === data.sessionId && !timersRef.current.has(n.id)) {
          startDismissTimer(n.id);
        }
      }
      return prev;
    });
  }, [startDismissTimer]);

  // Append activity line to matching session's notification
  const appendActivity = useCallback((data: {
    sessionId: string;
    timestamp: string;
    kind: string;
    name: string;
    detail: string;
  }) => {
    const line: ActivityLine = {
      id: `act-${++activityCounter}`,
      kind: data.kind as ActivityLine['kind'],
      name: data.name,
      detail: data.detail,
      timestamp: data.timestamp,
    };

    setNotifications((prev) =>
      prev.map((n) => {
        if (n.scan.session_id === data.sessionId) {
          const log = [...n.activityLog, line].slice(-MAX_ACTIVITY_LINES);
          // If a tool_use activity arrives on a "completed" card, revert to streaming
          // — this handles premature completion from text-only assistant messages
          const shouldRestream =
            n.status === 'completed' && data.kind === 'tool_use';
          if (shouldRestream) {
            // Cancel any pending auto-dismiss timer
            const timer = timersRef.current.get(n.id);
            if (timer) {
              clearTimeout(timer);
              timersRef.current.delete(n.id);
            }
          }
          return {
            ...n,
            activityLog: log,
            ...(shouldRestream ? { status: 'streaming' as const, completedAt: null } : {}),
          };
        }
        return n;
      }),
    );
  }, []);

  // Listen to IPC events
  useEffect(() => {
    if (!enabled) return;

    const dbg = (window.api as any).debugLog ?? console.log;
    dbg('[NotifMgr] Registering IPC listeners, enabled: ' + enabled);

    // Streaming: user just sent a prompt (HumanTurn detected)
    const cleanupStreaming = window.api.onNewPromptStreaming?.((data) => {
      dbg('[NotifMgr] onNewPromptStreaming: ' + data.sessionId + ' ' + (data.userPrompt?.slice(0, 40) ?? ''));
      addStreamingNotification(data);
    });

    // Streaming complete: assistant response finished
    const cleanupComplete = window.api.onPromptStreamingComplete?.((data) => {
      dbg('[NotifMgr] onPromptStreamingComplete: ' + data.sessionId);
      completeStreaming(data);
    });

    // Completed: full scan data available (replaces streaming card with full data)
    const cleanupScan = window.api.onNewPromptScan((data: { scan: PromptScan; usage: UsageLogEntry }) => {
      dbg('[NotifMgr] onNewPromptScan: ' + (data.scan?.request_id ?? 'none') + ' injected=' + (data.scan?.injected_files?.length ?? 0));
      addNotification(data.scan, data.usage ?? null);
    });

    // Real-time activity feed (tool_use, text, thinking)
    const cleanupActivity = (window.api as any).onSessionActivity?.((data: any) => {
      appendActivity(data);
    });

    return () => {
      cleanupStreaming?.();
      cleanupComplete?.();
      cleanupScan?.();
      cleanupActivity?.();
    };
  }, [enabled, addNotification, addStreamingNotification, completeStreaming, appendActivity]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return {
    notifications,
    dismiss,
    handleClick,
  };
};
