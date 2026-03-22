import { useMemo, useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { PromptNotification, ActivityLine } from './types';
import { MiniSparkline } from './MiniSparkline';
import { getContextLimit } from '../scan/shared';

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

// Tool icons
const TOOL_ICONS: Record<string, string> = {
  Read: '📖',
  Write: '✏️',
  Edit: '✏️',
  Grep: '🔍',
  Glob: '📂',
  Bash: '⚡',
  Agent: '🤖',
  WebSearch: '🌐',
  WebFetch: '🌐',
  thinking: '💭',
  response: '💬',
};

// Category icons for injected files
const CATEGORY_ICONS: Record<string, string> = {
  global: '🌍',
  project: '📋',
  rules: '📏',
  memory: '🧠',
  skill: '⚡',
};

// ── 1. Injected Files Section ──

const InjectedSection = ({ files }: {
  files: Array<{ path: string; category: string; estimated_tokens: number }>;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [files.length]);

  const totalTokens = files.reduce((sum, f) => sum + f.estimated_tokens, 0);

  return (
    <div className="notif-section">
      <div className="notif-section-header">
        <span className="notif-section-icon">📎</span>
        <span className="notif-section-title">Injected</span>
        <span className="notif-section-badge">{files.length}</span>
        {totalTokens > 0 && (
          <span className="notif-section-tokens">{formatTokens(totalTokens)} tok</span>
        )}
      </div>
      <div className="notif-injected-scroll" ref={scrollRef}>
        {files.length === 0 ? (
          <div className="notif-section-empty">No injected files</div>
        ) : (
          files.map((f, i) => {
            const fileName = f.path.split('/').pop() ?? f.path;
            return (
              <div key={`${f.path}-${i}`} className="notif-injected-item">
                <span className="notif-injected-icon">{CATEGORY_ICONS[f.category] ?? '📄'}</span>
                <span className="notif-injected-name" title={f.path}>{truncate(fileName, 28)}</span>
                <span className="notif-injected-tokens">{formatTokens(f.estimated_tokens)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ── 2. Actions Timeline Section ──

const ActionsTimeline = ({ lines, isStreaming }: {
  lines: ActivityLine[];
  isStreaming: boolean;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines.length]);

  // Filter to tool_use actions only
  const actions = lines.filter((l) => l.kind === 'tool_use');

  return (
    <div className="notif-section">
      <div className="notif-section-header">
        <span className={`notif-section-dot ${isStreaming ? 'notif-section-dot--live' : 'notif-section-dot--done'}`} />
        <span className="notif-section-title">Actions</span>
        <span className="notif-section-badge">{actions.length}</span>
      </div>
      <div className="notif-actions-scroll" ref={scrollRef}>
        <div className="notif-actions-timeline">
          {actions.length === 0 ? (
            <div className="notif-section-empty">
              {isStreaming ? 'Waiting for actions...' : 'No actions'}
            </div>
          ) : (
            actions.map((action, i) => {
              const isLast = i === actions.length - 1;
              return (
                <div key={action.id} className={`notif-action-node ${isLast && isStreaming ? 'notif-action-node--active' : ''}`}>
                  <div className="notif-action-track">
                    <span className="notif-action-dot" />
                    {(i < actions.length - 1 || isStreaming) && (
                      <span className="notif-action-line" />
                    )}
                  </div>
                  <div className="notif-action-content">
                    <span className="notif-action-icon">
                      {TOOL_ICONS[action.name] ?? '·'}
                    </span>
                    <span className="notif-action-name">{action.name}</span>
                    {action.detail && (
                      <span className="notif-action-detail">
                        {truncate(action.detail, 30)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

// ── 3. Response Section (collapsible) ──

const ResponseSection = ({ text, isStreaming }: { text?: string; isStreaming: boolean }) => {
  const [expanded, setExpanded] = useState(false);

  const hasText = Boolean(text?.trim());
  const previewLength = 120;
  const needsExpand = hasText && text!.length > previewLength;
  const displayText = hasText
    ? (expanded ? text! : truncate(text!, previewLength))
    : null;

  return (
    <div className="notif-section">
      <div
        className={`notif-section-header ${needsExpand ? 'notif-section-header--clickable' : ''}`}
        onClick={(e) => { if (needsExpand) { e.stopPropagation(); setExpanded(!expanded); } }}
      >
        <span className="notif-section-icon">💬</span>
        <span className="notif-section-title">Response</span>
        {needsExpand && (
          <span className="notif-expand-toggle">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      <div className={`notif-response-body ${expanded ? 'notif-response-body--expanded' : ''}`}>
        {displayText ?? (
          <span className="notif-section-empty">
            {isStreaming ? 'Waiting for response...' : 'No response'}
          </span>
        )}
      </div>
    </div>
  );
};

// ── Context Growth Sparkline ──

const CtxSparkline = ({ turnMetrics, model }: { turnMetrics: PromptNotification['turnMetrics']; model: string }) => {
  const contextLimit = getContextLimit(model);

  const sparkData = useMemo(() => {
    if (turnMetrics.length < 2) return null;
    const data = turnMetrics.map((t) => t.total_context_tokens);
    const prev = turnMetrics[turnMetrics.length - 2];
    const curr = turnMetrics[turnMetrics.length - 1];
    const prevPct = contextLimit > 0 ? (prev.total_context_tokens / contextLimit) * 100 : 0;
    const currPct = contextLimit > 0 ? (curr.total_context_tokens / contextLimit) * 100 : 0;
    const delta = currPct - prevPct;
    const color = delta > 10 ? '#FF3B30' : delta > 3 ? '#FF9500' : '#30D158';
    return { data, prevPct, currPct, delta, color };
  }, [turnMetrics, contextLimit]);

  if (!sparkData) return null;

  return (
    <div className="notif-sparkline-section">
      <div className="notif-sparkline-header">
        <span className="notif-sparkline-title">
          Context · Turn {turnMetrics.length}
        </span>
        <span className="notif-sparkline-compare">
          <span className="notif-ctx-prev">{sparkData.prevPct.toFixed(0)}%</span>
          <span className="notif-sparkline-arrow">→</span>
          <span className={`notif-ctx-curr ${sparkData.currPct >= 80 ? 'notif-ctx-warn' : ''}`}>
            {sparkData.currPct.toFixed(0)}%
          </span>
          {sparkData.delta > 0 && (
            <span className="notif-ctx-delta">+{sparkData.delta.toFixed(0)}</span>
          )}
        </span>
      </div>
      <MiniSparkline
        data={sparkData.data}
        color={sparkData.color}
        fillColor={`${sparkData.color}15`}
        width={272}
        height={28}
        highlightLastTwo
      />
    </div>
  );
};

// ── Main Component ──

export const NotificationCard = ({ notification, onDismiss, onClick }: Props) => {
  const { scan, usage, status, alerts, turnMetrics, activityLog } = notification;
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

  // Cost
  const cost = usage?.cost_usd ?? 0;

  // Model short name
  const modelShort = scan.model
    ?.replace('claude-', '')
    .replace(/-202\d{5}/, '')
    ?? 'unknown';

  // Top alert
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

      {/* ── 1. Injected Files (always visible) ── */}
      <InjectedSection files={scan.injected_files ?? []} />

      {/* ── 2. Actions Timeline (always visible) ── */}
      <ActionsTimeline lines={activityLog} isStreaming={isStreaming} />

      {/* ── 3. Response (always visible) ── */}
      <ResponseSection text={scan.assistant_response} isStreaming={isStreaming} />

      {/* ── Context Growth Sparkline (always visible) ── */}
      <CtxSparkline turnMetrics={turnMetrics} model={scan.model} />

      {/* ── Metrics Row (always visible) ── */}
      <div className="notif-metrics-row">
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

      {/* ── Token composition bar (always visible) ── */}
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

      {/* ── Alert (always visible if exists) ── */}
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
