import { useState, useEffect, useCallback, useRef } from 'react';
import type { PromptScan, UsageLogEntry, TurnMetric } from '../../types/electron';
import type { PromptNotification, ActivityLine } from './types';
import type { GuardrailAssessment } from '../../guardrails/types';
import { getSessionAlerts } from '../../utils/sessionAlerts';
import { buildContext } from '../../guardrails/buildContext';
import { evaluate } from '../../guardrails/engine';
import { MVP_RULES } from '../../guardrails/rules';
import { FEATURE_FLAGS } from '../../config/featureFlags';

const AUTO_DISMISS_MS = 120_000;
const MAX_VISIBLE = 5;
const MAX_ACTIVITY_LINES = 50;
const COMPLETE_DEBOUNCE_MS = 3_000;

type NavigateCallback = (scan: PromptScan, usage: UsageLogEntry | null) => void;

let activityCounter = 0;

export const useNotificationManager = (
  enabled: boolean,
  onNavigate: NavigateCallback,
) => {
  const [notifications, setNotifications] = useState<PromptNotification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const completeDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const dbg = (window.api as any).debugLog ?? console.log;
      dbg('[NotifMgr] Skipping stale scan: age=' + (scanAge / 1000).toFixed(0) + 's');
      return;
    }

    // Fetch turn metrics + MCP analysis in one batch IPC call
    let turnMetrics: TurnMetric[] = [];
    let guardrailAssessment: GuardrailAssessment | undefined;
    try {
      const batch = await window.api.getGuardrailContext(scan.session_id);
      turnMetrics = batch.turnMetrics;

      // Compute guardrail assessment (only when feature flag is enabled)
      if (FEATURE_FLAGS.GUARDRAILS) {
        const ctx = buildContext(scan, usage, batch.turnMetrics, batch.mcpAnalysis);
        guardrailAssessment = evaluate(ctx, MVP_RULES);
      }
    } catch {
      // Best-effort: sparkline and guardrails won't show if batch IPC fails
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
      guardrailAssessment,
    };

    setNotifications((prev) => {
      // Preserve activity log and streaming status from existing card for same session
      const existing = prev.find((n) => n.scan.session_id === scan.session_id);
      if (existing) {
        notif.activityLog = existing.activityLog;
        // Preserve project folder from streaming card
        if (!notif.projectFolder && existing.projectFolder) {
          notif.projectFolder = existing.projectFolder;
        }

        // Preserve injected_files from streaming card if enriched scan has none
        // (DB may not have injected_files for old imports; streaming card reads from disk)
        if (
          (!notif.scan.injected_files || notif.scan.injected_files.length === 0) &&
          existing.scan.injected_files && existing.scan.injected_files.length > 0
        ) {
          notif.scan = {
            ...notif.scan,
            injected_files: existing.scan.injected_files,
          };
        }

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
    provider?: string;
    sessionStats?: { turns: number; costUsd: number; totalTokens: number; cacheReadPct: number };
    injectedFiles?: Array<{ path: string; category: string; estimated_tokens: number }>;
    projectFolder?: string;
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
      provider: data.provider ?? 'claude',
      conversation_turns: stats?.turns ?? 0,
      user_prompt_tokens: 0,
      total_injected_tokens: 0,
      injected_files: (data.injectedFiles ?? []) as PromptScan['injected_files'],
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
      projectFolder: data.projectFolder,
    };

    // Async: fetch turn metrics + guardrail assessment (best-effort, won't block card creation)
    window.api.getGuardrailContext(data.sessionId)
      .then((batch) => {
        if (batch.turnMetrics.length > 0) {
          const assessment = FEATURE_FLAGS.GUARDRAILS
            ? evaluate(buildContext(partialScan, streamingUsage, batch.turnMetrics, batch.mcpAnalysis), MVP_RULES)
            : undefined;
          setNotifications((prev) =>
            prev.map((n) => n.id === streamingId
              ? { ...n, turnMetrics: batch.turnMetrics, guardrailAssessment: assessment }
              : n),
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

  // Mark streaming notifications as completed when AssistantTurn arrives.
  // Uses a debounce: waits COMPLETE_DEBOUNCE_MS before marking as completed.
  // If a new tool_use activity arrives during the debounce window, the completion
  // is cancelled — this prevents premature "Done" when Claude sends a text message
  // followed by tool calls in separate assistant turns.
  const completeStreaming = useCallback((data: { sessionId: string; model?: string }) => {
    // Update model immediately (non-destructive)
    setNotifications((prev) =>
      prev.map((n) => {
        if (n.scan.session_id === data.sessionId) {
          return { ...n, scan: { ...n.scan, model: data.model ?? n.scan.model } };
        }
        return n;
      }),
    );

    // Cancel any existing debounce for this session
    const existingDebounce = completeDebounceRef.current.get(data.sessionId);
    if (existingDebounce) clearTimeout(existingDebounce);

    // Schedule completion after debounce
    const debounceTimer = setTimeout(() => {
      completeDebounceRef.current.delete(data.sessionId);
      setNotifications((prev) =>
        prev.map((n) => {
          if (n.status === 'streaming' && n.scan.session_id === data.sessionId) {
            const hasContent = n.activityLog.length > 0 || Boolean(n.scan.assistant_response?.trim());
            return {
              ...n,
              status: hasContent ? 'completed' as const : 'streaming' as const,
              completedAt: hasContent ? Date.now() : null,
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
    }, COMPLETE_DEBOUNCE_MS);

    completeDebounceRef.current.set(data.sessionId, debounceTimer);
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
          // Cancel pending completion debounce if tool_use arrives
          if (data.kind === 'tool_use') {
            const pendingComplete = completeDebounceRef.current.get(data.sessionId);
            if (pendingComplete) {
              clearTimeout(pendingComplete);
              completeDebounceRef.current.delete(data.sessionId);
            }
          }
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      completeDebounceRef.current.forEach((timer) => clearTimeout(timer));
      completeDebounceRef.current.clear();
    };
  }, []);

  return {
    notifications,
    dismiss,
    handleClick,
  };
};
