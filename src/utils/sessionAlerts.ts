export type SessionAlert = {
  id: string;
  type: 'cache_explosion' | 'low_efficiency' | 'long_session';
  severity: 'info' | 'warning';
  message: string;
  tip: string;
};

type SessionAlertInput = {
  turnCount: number;
  totalOutput: number;
  totalCacheRead: number;
  totalAll: number;
};

const LONG_SESSION_INFO_THRESHOLD = 20;
const LONG_SESSION_WARNING_THRESHOLD = 40;
const CACHE_READ_WARNING_RATIO = 0.95;
const LOW_OUTPUT_INFO_RATIO = 0.01;

export const getSessionAlerts = (input: SessionAlertInput): SessionAlert[] => {
  const alerts: SessionAlert[] = [];

  // Long session warnings
  if (input.turnCount >= LONG_SESSION_WARNING_THRESHOLD) {
    alerts.push({
      id: 'long-session-warning',
      type: 'long_session',
      severity: 'warning',
      message: `${input.turnCount} turns — Cache Read is growing rapidly`,
      tip: 'Split into smaller sessions: 10 sessions x 5 turns uses 10x less Cache Read than 1 session x 50 turns.',
    });
  } else if (input.turnCount >= LONG_SESSION_INFO_THRESHOLD) {
    alerts.push({
      id: 'long-session-info',
      type: 'long_session',
      severity: 'info',
      message: `${input.turnCount} turns — session is getting long`,
      tip: 'Use /clear to reset the session after completing a task to reduce Cache Read.',
    });
  }

  if (input.totalAll <= 0) return alerts;

  // Cache explosion warning
  const cacheReadRatio = input.totalCacheRead / input.totalAll;
  if (cacheReadRatio >= CACHE_READ_WARNING_RATIO) {
    alerts.push({
      id: 'cache-explosion',
      type: 'cache_explosion',
      severity: 'warning',
      message: `${(cacheReadRatio * 100).toFixed(1)}% of tokens are Cache Read`,
      tip: 'Use /compact to compress the conversation while keeping context.',
    });
  }

  // Low output efficiency
  const outputRatio = input.totalOutput / input.totalAll;
  if (outputRatio < LOW_OUTPUT_INFO_RATIO) {
    alerts.push({
      id: 'low-efficiency',
      type: 'low_efficiency',
      severity: 'info',
      message: `Output is only ${(outputRatio * 100).toFixed(2)}% of total tokens`,
      tip: 'Most tokens are re-reading previous context. Shorter sessions produce more output per token.',
    });
  }

  return alerts;
};
