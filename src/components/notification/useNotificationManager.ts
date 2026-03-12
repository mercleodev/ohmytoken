import { useState, useEffect, useCallback, useRef } from 'react';
import type { PromptScan, UsageLogEntry, TurnMetric } from '../../types/electron';
import type { PromptNotification } from './types';
import { getSessionAlerts } from '../../utils/sessionAlerts';

const AUTO_DISMISS_MS = 60_000;
const MAX_VISIBLE = 5;

type NavigateCallback = (scan: PromptScan, usage: UsageLogEntry | null) => void;

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
    };

    setNotifications((prev) => {
      // Replace if same request_id (update from streaming → completed)
      const filtered = prev.filter((n) => n.id !== scan.request_id);
      // Keep only MAX_VISIBLE
      const next = [notif, ...filtered].slice(0, MAX_VISIBLE);
      return next;
    });

    // Start auto-dismiss if completed
    if (isCompleted) {
      startDismissTimer(scan.request_id);
    }
  }, [enabled, startDismissTimer]);

  // Listen to IPC events
  useEffect(() => {
    if (!enabled) return;

    const cleanup = window.api.onNewPromptScan((data: { scan: PromptScan; usage: UsageLogEntry }) => {
      addNotification(data.scan, data.usage ?? null);
    });

    return cleanup;
  }, [enabled, addNotification]);

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
