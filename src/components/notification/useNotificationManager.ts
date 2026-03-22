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
    console.log('[NotifMgr] addNotification:', {
      requestId: scan.request_id,
      sessionId: scan.session_id,
      injectedCount: scan.injected_files?.length ?? 0,
      toolCallsCount: scan.tool_calls?.length ?? 0,
      turns: scan.conversation_turns,
      hasResponse: Boolean(scan.assistant_response),
      costUsd: usage?.cost_usd,
    });

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
        // If the existing card is still streaming, keep streaming status
        // — only completeStreaming() should transition to 'completed'
        if (existing.status === 'streaming') {
          notif.status = 'streaming';
          notif.completedAt = null;
        }
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
  }) => {
    if (!enabled) return;

    const streamingId = `streaming-${data.sessionId}-${data.timestamp}`;
    const partialScan: PromptScan = {
      request_id: streamingId,
      session_id: data.sessionId,
      user_prompt: data.userPrompt,
      timestamp: data.timestamp,
      model: data.model ?? 'unknown',
      provider: 'claude',
      conversation_turns: 0,
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

    const notif: PromptNotification = {
      id: streamingId,
      scan: partialScan,
      usage: null,
      status: 'streaming',
      createdAt: Date.now(),
      completedAt: null,
      turnMetrics: [],
      alerts: [],
      activityLog: [],
    };

    setNotifications((prev) => {
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

    // Streaming: user just sent a prompt (HumanTurn detected)
    const cleanupStreaming = window.api.onNewPromptStreaming?.((data) => {
      addStreamingNotification(data);
    });

    // Streaming complete: assistant response finished
    const cleanupComplete = window.api.onPromptStreamingComplete?.((data) => {
      completeStreaming(data);
    });

    // Completed: full scan data available (replaces streaming card with full data)
    const cleanupScan = window.api.onNewPromptScan((data: { scan: PromptScan; usage: UsageLogEntry }) => {
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
