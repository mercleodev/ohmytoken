import { useMemo, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { PromptNotification } from './types';
import { MiniSparkline } from './MiniSparkline';
import { getContextLimit } from '../scan/shared';
import type { InjectedFile, ToolCall, AgentCall } from '../../types/electron';

type Props = {
  notification: PromptNotification;
  onDismiss: (id: string) => void;
  onClick: (id: string) => void;
};

// ── Helpers ──

const formatTime = (ts: string): string => {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
};

const truncate = (s: string, max: number): string =>
  s.length > max ? s.slice(0, max) + '...' : s;

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
};

const PROVIDER_COLORS: Record<string, string> = {
  claude: '#D97706',
  codex: '#10B981',
  gemini: '#6366F1',
};

// Build activity feed items from scan data
type ActivityItem = { icon: string; text: string; category: 'injected' | 'action' | 'agent' };

const buildActivityItems = (
  files: InjectedFile[],
  tools: ToolCall[],
  agents: AgentCall[],
): ActivityItem[] => {
  const items: ActivityItem[] = [];

  for (const f of files) {
    const name = f.path.split('/').pop() ?? f.path;
    items.push({ icon: 'file', text: `Injected ${name}`, category: 'injected' });
  }
  for (const a of agents) {
    items.push({ icon: 'agent', text: `Agent: ${a.subagent_type}`, category: 'agent' });
  }
  for (const t of tools) {
    items.push({ icon: 'tool', text: t.name, category: 'action' });
  }

  return items;
};

// ── Activity Feed: cycles through items with blinking dot ──

const ACTIVITY_INTERVAL_MS = 1_800;

const useActivityCycler = (items: ActivityItem[], isStreaming: boolean) => {
  const [index, setIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (items.length === 0) return;

    // Start from 0 on new items
    setIndex(0);

    if (isStreaming) {
      // When streaming, cycle through items to simulate real-time
      intervalRef.current = setInterval(() => {
        setIndex((prev) => (prev + 1) % items.length);
      }, ACTIVITY_INTERVAL_MS);
    } else {
      // When completed, fast-cycle through all items then stop at last
      let current = 0;
      const fastInterval = setInterval(() => {
        current++;
        if (current >= items.length) {
          clearInterval(fastInterval);
          setIndex(items.length - 1);
          return;
        }
        setIndex(current);
      }, 300);
      intervalRef.current = fastInterval;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [items.length, isStreaming]);

  return items[index] ?? null;
};

// ── Component ──

export const NotificationCard = ({ notification, onDismiss, onClick }: Props) => {
  const { scan, usage, status, alerts, turnMetrics } = notification;
  const provider = scan.provider ?? 'claude';
  const providerColor = PROVIDER_COLORS[provider] ?? '#8e8e93';
  const isStreaming = status === 'streaming';

  // Token composition
  const cacheRead = usage?.response.cache_read_input_tokens ?? 0;
  const output = usage?.response.output_tokens ?? 0;
  const input = usage?.response.input_tokens ?? 0;
  const cacheCreate = usage?.response.cache_creation_input_tokens ?? 0;
  const totalTokens = cacheRead + cacheCreate + input + output;
  const cacheReadPct = totalTokens > 0 ? (cacheRead / totalTokens) * 100 : 0;
  const outputPct = totalTokens > 0 ? (output / totalTokens) * 100 : 0;

  // Context %
  const contextLimit = getContextLimit(scan.model);
  const contextUsed = scan.context_estimate?.total_tokens ?? 0;
  const contextPct = contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0;

  // Cost
  const cost = usage?.cost_usd ?? 0;

  // Sparkline: cache_read per turn
  const sparklineData = useMemo(() => {
    if (turnMetrics.length < 2) return [];
    return turnMetrics.map((t) => t.cache_read_tokens);
  }, [turnMetrics]);

  const sparklineColor = useMemo(() => {
    if (sparklineData.length < 2) return '#8e8e93';
    const last = sparklineData[sparklineData.length - 1];
    const prev = sparklineData[sparklineData.length - 2];
    if (last > prev * 1.5) return '#FF3B30';
    if (last > prev) return '#FF9500';
    return '#34C759';
  }, [sparklineData]);

  // Model short name
  const modelShort = scan.model
    ?.replace('claude-', '')
    .replace(/-202\d{5}/, '')
    ?? 'unknown';

  // Activity feed
  const activityItems = useMemo(
    () => buildActivityItems(scan.injected_files, scan.tool_calls, scan.agent_calls),
    [scan.injected_files, scan.tool_calls, scan.agent_calls],
  );
  const currentActivity = useActivityCycler(activityItems, isStreaming);

  // Top alert (simple one-liner)
  const topAlert = alerts.find((a) => a.severity === 'warning') ?? alerts[0] ?? null;

  return (
    <motion.div
      className="notif-card"
      layout
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.95 }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      onClick={() => onClick(notification.id)}
    >
      {/* ── Header ── */}
      <div className="notif-header">
        <div className="notif-provider-row">
          <span className="notif-provider-dot" style={{ background: providerColor }} />
          <span className="notif-provider-name">{provider}</span>
          <span className="notif-model">{modelShort}</span>
          <span className="notif-time">{formatTime(scan.timestamp)}</span>
        </div>
        <button
          className="notif-dismiss"
          onClick={(e) => { e.stopPropagation(); onDismiss(notification.id); }}
          aria-label="Dismiss notification"
        >
          &times;
        </button>
      </div>

      {/* ── Prompt preview ── */}
      <div className="notif-prompt-text">
        {truncate(scan.user_prompt || '(empty prompt)', 80)}
      </div>

      {/* ── Live Activity Feed (blinking dot + action text) ── */}
      {activityItems.length > 0 && (
        <div className="notif-activity">
          <span className={`notif-activity-dot ${isStreaming ? 'notif-activity-dot--live' : 'notif-activity-dot--done'}`} />
          <span className="notif-activity-text" key={currentActivity?.text}>
            {currentActivity?.text ?? ''}
          </span>
          <span className="notif-activity-count">
            {activityItems.length}
          </span>
        </div>
      )}

      {/* ── Token composition bar ── */}
      <div className="notif-token-bar-section">
        <div className="notif-token-bar">
          <div className="notif-token-bar-cache" style={{ width: `${cacheReadPct}%` }} />
          <div className="notif-token-bar-output" style={{ width: `${outputPct}%` }} />
        </div>
        <div className="notif-token-bar-labels">
          <span className="notif-label-cache">Cache {cacheReadPct.toFixed(0)}%</span>
          <span className="notif-label-output">Output {outputPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* ── Turn chart (sparkline) ── */}
      {sparklineData.length >= 2 && (
        <div className="notif-sparkline-section">
          <div className="notif-sparkline-header">
            <span className="notif-sparkline-title">
              Turn {scan.conversation_turns} · Cache Growth
            </span>
            <span className="notif-sparkline-total">{formatTokens(cacheRead)}</span>
          </div>
          <MiniSparkline data={sparklineData} color={sparklineColor} width={256} height={28} />
        </div>
      )}

      {/* ── Metrics row: context + cost + total tokens ── */}
      <div className="notif-metrics-row">
        <span className="notif-metric">
          <span className="notif-metric-label">Ctx</span>
          <span className={`notif-metric-value ${contextPct >= 80 ? 'notif-ctx-warn' : ''}`}>
            {contextPct.toFixed(0)}%
          </span>
        </span>
        <span className="notif-metric">
          <span className="notif-metric-label">Turn</span>
          <span className="notif-metric-value">{scan.conversation_turns}</span>
        </span>
        <span className="notif-metric">
          <span className="notif-metric-label">Cost</span>
          <span className="notif-metric-value">${cost.toFixed(3)}</span>
        </span>
        <span className="notif-metric">
          <span className="notif-metric-label">Total</span>
          <span className="notif-metric-value">{formatTokens(totalTokens)}</span>
        </span>
      </div>

      {/* ── Alert (simple one-liner) ── */}
      {topAlert && (
        <div className={`notif-alert notif-alert-${topAlert.severity}`}>
          {topAlert.severity === 'warning' ? '!' : 'i'} {topAlert.message}
        </div>
      )}

      {/* ── Streaming progress bar ── */}
      {isStreaming && (
        <div className="notif-progress-bar">
          <div className="notif-progress-bar-fill" />
        </div>
      )}
    </motion.div>
  );
};
