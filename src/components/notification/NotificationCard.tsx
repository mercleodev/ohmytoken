import { useMemo, useRef, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { PromptNotification, ActivityLine } from './types';
import type { HarnessCandidate, HarnessCandidateKind } from '../../types/electron';
import type { PromptScan } from '../../types';
import type { EvidenceStatus } from '../dashboard/prompt-detail/types';
import { MiniSparkline } from './MiniSparkline';
import { getContextLimit } from '../scan/shared';
import { buildInjectedEvidence } from '../dashboard/prompt-detail/evidence';
import { EVIDENCE_STATUS_COLORS } from '../dashboard/prompt-detail/constants';
import { resolveEvidenceView, PENDING_WINDOW_MS } from './pendingEvidence';
import {
  getSeverityColor,
  getSeverityIcon,
  formatSavings,
  getVisibleRecommendations,
  getHealthLabel,
} from './guardrailCardHelpers';

type Props = {
  notification: PromptNotification;
  onDismiss: (id: string) => void;
  onClick: (id: string) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
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


// Evidence status labels & sort order for notification
const EVIDENCE_LABELS: Record<EvidenceStatus, string> = { confirmed: 'C', likely: 'L', unverified: 'U' };
const EVIDENCE_ORDER: Record<EvidenceStatus, number> = { confirmed: 0, likely: 1, unverified: 2 };

// ── 1. Context Files Section ──

const ContextFilesSection = ({ scan, createdAt }: {
  scan: PromptScan;
  createdAt: number;
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const files = scan.injected_files ?? [];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [files.length]);

  // Pending window: once the notification is older than PENDING_WINDOW_MS and
  // no evidence_report has arrived (neither attached nor via evidence-scored
  // IPC), fall through to the legacy buildInjectedEvidence output. Re-render
  // at the window boundary so the skeleton flips to the legacy bucket UI
  // without requiring a later IPC to unblock.
  const [pendingTimedOut, setPendingTimedOut] = useState(
    Date.now() - createdAt >= PENDING_WINDOW_MS,
  );
  useEffect(() => {
    if (pendingTimedOut || scan.evidence_report) return;
    const elapsed = Date.now() - createdAt;
    const remaining = PENDING_WINDOW_MS - elapsed;
    if (remaining <= 0) {
      setPendingTimedOut(true);
      return;
    }
    const t = setTimeout(() => setPendingTimedOut(true), remaining);
    return () => clearTimeout(t);
  }, [pendingTimedOut, scan.evidence_report, createdAt]);

  const view = useMemo(
    () =>
      resolveEvidenceView({
        scan,
        pendingTimedOut,
        ageMs: Date.now() - createdAt,
      }),
    [scan, pendingTimedOut, createdAt],
  );

  const totalTokens = files.reduce((sum, f) => sum + f.estimated_tokens, 0);

  // G2-C.1 contract: do NOT call buildInjectedEvidence in the pending branch,
  // so a missing report cannot silently render as the legacy `U` bucket.
  if (view.kind === 'pending') {
    return (
      <div className="notif-section">
        <div className="notif-section-header">
          <span className="notif-section-icon">📎</span>
          <span className="notif-section-title">Context Files</span>
          <span className="notif-section-badge">{files.length}</span>
          {totalTokens > 0 && (
            <span className="notif-section-tokens">{formatTokens(totalTokens)} tok</span>
          )}
          <span className="notif-evidence-pending" title="Scoring in progress">scoring…</span>
        </div>
        <div className="notif-injected-scroll" ref={scrollRef}>
          {files.length === 0 ? (
            <div className="notif-section-empty">No context files</div>
          ) : (
            files.map((f, i) => {
              const fileName = f.path.split('/').pop() ?? f.path;
              return (
                <div key={`${f.path}-${i}`} className="notif-injected-item notif-injected-item--pending">
                  <span className="notif-evidence-dot notif-evidence-dot--pending" title="Scoring in progress">·</span>
                  <span className="notif-injected-name" title={f.path}>{truncate(fileName, 26)}</span>
                  <span className="notif-injected-tokens">{formatTokens(f.estimated_tokens)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  // Scored or legacy: both go through buildInjectedEvidence. When no report
  // is attached, buildInjectedEvidence falls through to buildLegacyEvidence
  // internally. The user-visible distinction is the title/tooltip on U items.
  const evidence = buildInjectedEvidence(scan);
  const allItems = [
    ...evidence.confirmed,
    ...evidence.likely,
    ...evidence.unverified,
  ].sort((a, b) => {
    const statusDiff = EVIDENCE_ORDER[a.status] - EVIDENCE_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return b.estimated_tokens - a.estimated_tokens;
  });
  const isLegacy = view.kind === 'legacy';

  return (
    <div className="notif-section">
      <div className="notif-section-header">
        <span className="notif-section-icon">📎</span>
        <span className="notif-section-title">Context Files</span>
        <span className="notif-section-badge">{files.length}</span>
        {totalTokens > 0 && (
          <span className="notif-section-tokens">{formatTokens(totalTokens)} tok</span>
        )}
        {allItems.length > 0 && (
          <span className="notif-evidence-summary">
            <span className="notif-evidence-count" style={{ color: EVIDENCE_STATUS_COLORS.confirmed }}>C {evidence.confirmed.length}</span>
            <span className="notif-evidence-count" style={{ color: EVIDENCE_STATUS_COLORS.likely }}>L {evidence.likely.length}</span>
            <span className="notif-evidence-count" style={{ color: EVIDENCE_STATUS_COLORS.unverified }}>U {evidence.unverified.length}</span>
          </span>
        )}
      </div>
      <div className="notif-injected-scroll" ref={scrollRef}>
        {allItems.length === 0 ? (
          <div className="notif-section-empty">No context files</div>
        ) : (
          allItems.map((item, i) => {
            const fileName = item.path.split('/').pop() ?? item.path;
            const statusColor = EVIDENCE_STATUS_COLORS[item.status];
            const title = isLegacy && item.status === 'unverified'
              ? `no score available — ${item.reason}`
              : `${item.status}: ${item.reason}`;
            return (
              <div key={`${item.path}-${i}`} className="notif-injected-item">
                <span
                  className="notif-evidence-dot"
                  style={{ color: statusColor }}
                  title={title}
                >
                  {EVIDENCE_LABELS[item.status]}
                </span>
                <span className="notif-injected-name" title={item.path}>{truncate(fileName, 26)}</span>
                <span className="notif-injected-tokens">{formatTokens(item.estimated_tokens)}</span>
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

// ── 3. Response Section (real-time streaming + scrollable) ──

const ResponseSection = ({ text, streamingTexts, isStreaming }: {
  text?: string;
  streamingTexts: string[];
  isStreaming: boolean;
}) => {
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [userScrolled, setUserScrolled] = useState(false);

  // Auto-scroll to bottom on new streaming text (unless user scrolled up)
  useEffect(() => {
    if (scrollRef.current && isStreaming && !userScrolled) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [streamingTexts.length, isStreaming, userScrolled]);

  // Reset user-scrolled flag when new streaming session starts
  useEffect(() => {
    if (isStreaming && streamingTexts.length <= 1) {
      setUserScrolled(false);
    }
  }, [isStreaming, streamingTexts.length]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    setUserScrolled(!isAtBottom);
  };

  // Combine: final response text takes priority, else show streaming fragments
  const finalText = text?.trim();
  // Merge consecutive streaming texts, deduplicate overlapping fragments
  const liveText = useMemo(() => {
    if (streamingTexts.length === 0) return '';
    return streamingTexts.join('\n\n');
  }, [streamingTexts]);
  const displayText = finalText || liveText;
  const hasText = displayText.length > 0;
  const needsExpand = hasText && displayText.length > 150;

  return (
    <div className="notif-section">
      <div
        className={`notif-section-header ${needsExpand ? 'notif-section-header--clickable' : ''}`}
        onClick={(e) => { if (needsExpand) { e.stopPropagation(); setExpanded(!expanded); } }}
      >
        <span className="notif-section-icon">💬</span>
        <span className="notif-section-title">Response</span>
        {streamingTexts.length > 0 && isStreaming && (
          <span className="notif-section-badge">{streamingTexts.length}</span>
        )}
        {needsExpand && (
          <span className="notif-expand-toggle">{expanded ? '▾' : '▸'}</span>
        )}
      </div>
      <div
        ref={scrollRef}
        className={`notif-response-body ${expanded ? 'notif-response-body--expanded' : ''}`}
        onScroll={handleScroll}
      >
        {hasText ? (
          expanded ? displayText : truncate(displayText, 150)
        ) : (
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
  const observedMax = useMemo(
    () => Math.max(...turnMetrics.map((t) => t.total_context_tokens), 0),
    [turnMetrics],
  );
  const contextLimit = getContextLimit(model, observedMax);

  const sparkData = useMemo(() => {
    if (turnMetrics.length < 2) return null;
    const data = turnMetrics.map((t) => t.total_context_tokens);
    const prev = turnMetrics[turnMetrics.length - 2];
    const curr = turnMetrics[turnMetrics.length - 1];
    const prevPct = contextLimit > 0 ? (prev.total_context_tokens / contextLimit) * 100 : 0;
    const currPct = contextLimit > 0 ? (curr.total_context_tokens / contextLimit) * 100 : 0;
    const delta = currPct - prevPct;
    const color = delta > 10 ? '#FF3B30' : delta > 3 ? '#FF9500' : '#30D158';

    // Per-turn cost data
    const costData = turnMetrics.map((t) => t.cost_usd);
    const totalSessionCost = costData.reduce((s, c) => s + c, 0);
    const currTurnCost = curr.cost_usd;

    // Output token trend
    const outputData = turnMetrics.map((t) => t.output_tokens);
    const currOutput = curr.output_tokens;

    // Cache efficiency (cache_read / total_input)
    const currCacheRead = curr.cache_read_tokens;
    const currTotalInput = curr.input_tokens + curr.cache_read_tokens + curr.cache_create_tokens;
    const cacheHitPct = currTotalInput > 0 ? (currCacheRead / currTotalInput) * 100 : 0;

    return {
      data, prevPct, currPct, delta, color,
      costData, totalSessionCost, currTurnCost,
      outputData, currOutput,
      cacheHitPct,
      currTokens: curr.total_context_tokens,
    };
  }, [turnMetrics, contextLimit]);

  if (!sparkData) return null;

  const formatTokensShort = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
  };

  return (
    <div className="notif-sparkline-section">
      {/* Context growth chart */}
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
          <span className="notif-ctx-abs">{formatTokensShort(sparkData.currTokens)}</span>
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
        height={32}
        highlightLastTwo
        threshold={contextLimit > 0 ? contextLimit * 0.8 : undefined}
        thresholdLabel={contextLimit > 0 ? `compact ${formatTokensShort(contextLimit * 0.8)}` : undefined}
        showCurrentValue
        formatValue={formatTokensShort}
      />

      {/* Cost trend chart */}
      {sparkData.costData.length >= 2 && (
        <>
          <div className="notif-sparkline-header notif-sparkline-header--sub">
            <span className="notif-sparkline-title">Cost / Turn</span>
            <span className="notif-sparkline-compare">
              <span className="notif-ctx-abs">${sparkData.currTurnCost.toFixed(3)}</span>
              <span className="notif-ctx-total">session ${sparkData.totalSessionCost.toFixed(3)}</span>
            </span>
          </div>
          <MiniSparkline
            data={sparkData.costData}
            color="#FFD60A"
            fillColor="rgba(255, 214, 10, 0.1)"
            width={272}
            height={24}
            showCurrentValue
            formatValue={(v) => `$${v.toFixed(3)}`}
          />
        </>
      )}

      {/* Output tokens trend chart */}
      {sparkData.outputData.length >= 2 && (
        <>
          <div className="notif-sparkline-header notif-sparkline-header--sub">
            <span className="notif-sparkline-title">Output Tokens</span>
            <span className="notif-sparkline-compare">
              <span className="notif-ctx-abs">{formatTokensShort(sparkData.currOutput)}</span>
            </span>
          </div>
          <MiniSparkline
            data={sparkData.outputData}
            color="#64D2FF"
            fillColor="rgba(100, 210, 255, 0.1)"
            width={272}
            height={24}
            showCurrentValue
            formatValue={formatTokensShort}
          />
        </>
      )}

      {/* Cache hit rate badge */}
      <div className="notif-sparkline-stats">
        <span className="notif-spark-stat">
          <span className="notif-spark-stat-label">Cache Hit</span>
          <span className={`notif-spark-stat-value ${sparkData.cacheHitPct >= 70 ? 'notif-spark-stat--good' : sparkData.cacheHitPct >= 40 ? 'notif-spark-stat--mid' : 'notif-spark-stat--low'}`}>
            {sparkData.cacheHitPct.toFixed(0)}%
          </span>
        </span>
        {contextLimit > 0 && (
          <span className="notif-spark-stat">
            <span className="notif-spark-stat-label">Limit</span>
            <span className="notif-spark-stat-value">{formatTokensShort(contextLimit)}</span>
          </span>
        )}
        <span className="notif-spark-stat">
          <span className="notif-spark-stat-label">Avg Cost</span>
          <span className="notif-spark-stat-value">
            ${(sparkData.totalSessionCost / turnMetrics.length).toFixed(3)}
          </span>
        </span>
      </div>
    </div>
  );
};

// ── Guardrail Recommendations Section ──

const GuardrailSection = ({ notification }: { notification: PromptNotification }) => {
  const { guardrailAssessment } = notification;
  const { primary, secondary } = getVisibleRecommendations(guardrailAssessment);
  const healthLabel = getHealthLabel(guardrailAssessment);

  if (!primary && secondary.length === 0) return null;

  return (
    <div className="notif-guardrail-section">
      {/* Session health badge */}
      {healthLabel && healthLabel !== 'Healthy' && (
        <div className={`notif-guardrail-health notif-guardrail-health--${guardrailAssessment!.summary.sessionHealth}`}>
          {healthLabel}
        </div>
      )}

      {/* Primary recommendation banner */}
      {primary && (
        <div
          className="notif-guardrail-primary"
          style={{ borderLeftColor: getSeverityColor(primary.severity) }}
        >
          <div className="notif-guardrail-primary-header">
            <span className="notif-guardrail-icon">{getSeverityIcon(primary.severity)}</span>
            <span className="notif-guardrail-title">{primary.title}</span>
          </div>
          <div className="notif-guardrail-reason">{primary.reason}</div>
          <div className="notif-guardrail-action">{primary.action}</div>
          {primary.estimatedSavings && (
            <div className="notif-guardrail-savings">
              {formatSavings(primary.estimatedSavings)}
            </div>
          )}
        </div>
      )}

      {/* Secondary recommendation chips */}
      {secondary.length > 0 && (
        <div className="notif-guardrail-chips">
          {secondary.map((rec) => (
            <div
              key={rec.id}
              className="notif-guardrail-chip"
              style={{ borderColor: getSeverityColor(rec.severity) }}
              title={`${rec.reason}\n${rec.action}`}
            >
              <span className="notif-guardrail-chip-icon">{getSeverityIcon(rec.severity)}</span>
              <span className="notif-guardrail-chip-text">{rec.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ── Workflow Insights Section ──

const CANDIDATE_LABELS: Record<HarnessCandidateKind, string> = {
  script: 'Reusable Script',
  cdp: 'Browser Automation',
  prompt_template: 'Reusable Command',
  checklist: 'Reusable Checklist',
  unknown: 'Pattern Detected',
};

const CANDIDATE_COLORS: Record<HarnessCandidateKind, string> = {
  script: '#5856d6',
  cdp: '#af52de',
  prompt_template: '#007aff',
  checklist: '#34c759',
  unknown: '#8e8e93',
};

const MAX_WORKFLOW_CANDIDATES = 3;

const FRIENDLY_TOOL_NAMES: Record<string, string> = {
  exec_command: 'Shell',
};

function friendlyTool(name: string): string {
  if (FRIENDLY_TOOL_NAMES[name]) return FRIENDLY_TOOL_NAMES[name];
  if (name.startsWith('mcp__playwright__')) return name.replace('mcp__playwright__', '').replace(/_/g, ' ');
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    return parts.length >= 3 ? `${parts[1]}: ${parts[2]}` : parts[1] ?? name;
  }
  return name;
}

const ConfidenceBar = ({ value }: { value: number }) => {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? '#34c759' : pct >= 40 ? '#ff9f0a' : '#8e8e93';
  return (
    <div className="notif-wf-conf-bar" title={`Confidence: ${pct}%`}>
      <div className="notif-wf-conf-fill" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
};

const WorkflowInsightsSection = ({ candidates }: { candidates?: HarnessCandidate[] }) => {
  const visible = useMemo(() => {
    if (!candidates || candidates.length === 0) return [];
    return candidates
      .filter((c) => c.candidateKind !== 'unknown')
      .slice(0, MAX_WORKFLOW_CANDIDATES);
  }, [candidates]);

  if (visible.length === 0) return null;

  return (
    <div className="notif-workflow-section">
      <div className="notif-workflow-header">
        <span className="notif-workflow-header-icon">&#9670;</span>
        <span className="notif-workflow-header-title">Workflow Change Candidates</span>
        <span className="notif-workflow-header-count">{visible.length}</span>
      </div>
      <div className="notif-workflow-list">
        {visible.map((c) => {
          const label = CANDIDATE_LABELS[c.candidateKind] ?? 'Pattern';
          const color = CANDIDATE_COLORS[c.candidateKind] ?? '#8e8e93';
          const inputShort = c.inputSummary.length > 60
            ? c.inputSummary.slice(0, 57) + '...'
            : c.inputSummary;
          return (
            <div key={c.signature} className="notif-wf-item">
              <div className="notif-wf-item-row">
                <span className="notif-wf-kind-badge" style={{ background: color }}>
                  {label}
                </span>
                <span className="notif-wf-repeat">{c.repeatCount}x</span>
                <span className="notif-wf-sessions">{c.sessionCount} sessions</span>
              </div>
              <div className="notif-wf-signature" title={`${c.toolName}: ${c.inputSummary}`}>
                <span className="notif-wf-tool-name">{friendlyTool(c.toolName)}</span>
                <span className="notif-wf-input">{inputShort}</span>
              </div>
              <ConfidenceBar value={c.confidence} />
              <div className="notif-wf-reason">{c.reason}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── Main Component ──

const AUTO_DISMISS_MS = 120_000;

export const NotificationCard = ({ notification, onDismiss, onClick, onMouseEnter, onMouseLeave }: Props) => {
  const { scan, usage, status, alerts, turnMetrics, activityLog } = notification;
  const provider = scan.provider ?? 'claude';
  const providerColor = PROVIDER_COLORS[provider] ?? '#8e8e93';
  const isStreaming = status === 'streaming';
  const isCompleted = status === 'completed';
  const [seen, setSeen] = useState(false);

  // Dismiss countdown progress (0 → 1 over AUTO_DISMISS_MS)
  const [dismissProgress, setDismissProgress] = useState(0);
  useEffect(() => {
    if (!isCompleted || !notification.completedAt) {
      setDismissProgress(0);
      return;
    }
    const tick = () => {
      const elapsed = Date.now() - notification.completedAt!;
      setDismissProgress(Math.min(1, elapsed / AUTO_DISMISS_MS));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isCompleted, notification.completedAt]);

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
      className={`notif-card ${isCompleted && !seen ? 'notif-card--completed' : ''} ${isCompleted && dismissProgress > 0.6 ? 'notif-card--fading' : ''}`}
      onMouseEnter={() => { onMouseEnter?.(); if (isCompleted) setSeen(true); }}
      onMouseLeave={onMouseLeave}
      layout="position"
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{
        opacity: isCompleted ? 1 - dismissProgress * 0.5 : 1,
        y: 0,
        scale: 1,
      }}
      exit={{ opacity: 0, y: -6, scale: 0.98 }}
      transition={{
        layout: { type: 'tween', ease: [0.25, 0.1, 0.25, 1], duration: 0.35 },
        opacity: { type: 'tween', ease: 'easeOut', duration: 0.25 },
        y: { type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.4 },
        scale: { type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.4 },
      }}
      style={{ willChange: 'transform, opacity' }}
      onClick={() => onClick(notification.id)}
    >
      {/* ── Project folder label ── */}
      {notification.projectFolder && (
        <div className="notif-project-label">
          <span className="notif-project-icon">📁</span>
          <span className="notif-project-name">{notification.projectFolder}</span>
        </div>
      )}

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

      {/* ── Guardrail Recommendations (shown when available) ── */}
      <GuardrailSection notification={notification} />

      {/* ── Workflow Change Candidates (30d analysis) ── */}
      <WorkflowInsightsSection candidates={notification.harnessCandidates} />

      {/* ── 1. Context Files with evidence status (always visible) ── */}
      <ContextFilesSection scan={scan} createdAt={notification.createdAt} />

      {/* ── 2. Actions Timeline (always visible) ── */}
      <ActionsTimeline lines={activityLog} isStreaming={isStreaming} />

      {/* ── 3. Response (always visible, real-time streaming) ── */}
      <ResponseSection
        text={scan.assistant_response}
        streamingTexts={activityLog.filter((l) => l.kind === 'text').map((l) => l.detail)}
        isStreaming={isStreaming}
      />

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

      {/* ── Status footer: streaming progress or completion summary ── */}
      {isStreaming && (
        <div className="notif-progress-bar">
          <div className="notif-progress-bar-fill" />
        </div>
      )}
      {!isStreaming && (
        <div className="notif-completion-row">
          <span className="notif-completion-check">✓</span>
          <span className="notif-completion-label">Done</span>
          {usage?.duration_ms != null && usage.duration_ms > 0 && (
            <span className="notif-completion-stat">
              {(usage.duration_ms / 1000).toFixed(1)}s
            </span>
          )}
          {cost > 0 && (
            <span className="notif-completion-stat">${cost.toFixed(3)}</span>
          )}
          {output > 0 && (
            <span className="notif-completion-stat">{formatTokens(output)} out</span>
          )}
          {/* Dismiss countdown bar */}
          <div className="notif-dismiss-track">
            <div
              className="notif-dismiss-fill"
              style={{ width: `${(1 - dismissProgress) * 100}%` }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
};
