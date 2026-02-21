import { useState } from 'react';
import { formatCost, formatTokens, CATEGORY_COLORS, ACTION_COLORS, formatActionDetail, formatActionTime } from './shared';
import type { PromptScanData, UsageData } from './PromptTimeline';
import './scan.css';

type ScanDetailPanelProps = {
  scan: PromptScanData;
  usage: UsageData | null;
  onFileClick: (filePath: string, e: React.MouseEvent) => void;
};

export const ScanDetailPanel = ({ scan, usage, onFileClick }: ScanDetailPanelProps) => {
  const [expandedSection, setExpandedSection] = useState<string | null>('context');
  const [expandedActions, setExpandedActions] = useState<Set<number>>(() => new Set());
  const toggleAction = (idx: number) => setExpandedActions((prev) => {
    const next = new Set(prev);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    return next;
  });

  const toggle = (section: string) => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  const ctx = scan.context_estimate;
  const total = ctx.total_tokens || 1;
  const systemPct = (ctx.system_tokens / total) * 100;
  const bd = ctx.messages_tokens_breakdown;
  const hasBd = bd && (bd.user_text_tokens > 0 || bd.assistant_tokens > 0 || bd.tool_result_tokens > 0);
  const userTextPct = hasBd ? (bd.user_text_tokens / total) * 100 : 0;
  const assistantPct = hasBd ? (bd.assistant_tokens / total) * 100 : 0;
  const toolResultPct = hasBd ? (bd.tool_result_tokens / total) * 100 : 0;
  const messagesPct = (ctx.messages_tokens / total) * 100;
  const toolsPct = (ctx.tools_definition_tokens / total) * 100;

  return (
    <div className="scan-detail-panel">
      {/* Prompt */}
      <div className="scan-detail-prompt">
        {scan.user_prompt || '(system request)'}
      </div>

      {/* Quick Stats */}
      <div className="scan-detail-stats">
        <StatCard label="Cost" value={usage ? formatCost(usage.cost_usd) : 'N/A'} />
        <StatCard label="Context" value={formatTokens(ctx.total_tokens)} />
        <StatCard label="Tools" value={String(scan.tool_calls.length)} />
        <StatCard label="Turns" value={String(scan.conversation_turns)} />
      </div>

      {/* Context Breakdown */}
      <CollapsibleSection
        title="Context Breakdown"
        expanded={expandedSection === 'context'}
        onToggle={() => toggle('context')}
      >
        <div style={{ marginBottom: 8 }}>
          <div className="scan-ctx-bar">
            <div className="scan-ctx-segment" style={{ width: `${systemPct}%`, background: '#8b5cf6' }}>
              {systemPct > 15 && <span className="scan-ctx-segment-label">{systemPct.toFixed(0)}%</span>}
            </div>
            {hasBd ? (
              <>
                {userTextPct > 0 && (
                  <div className="scan-ctx-segment" style={{ width: `${userTextPct}%`, background: '#3b82f6' }}>
                    {userTextPct > 15 && <span className="scan-ctx-segment-label">{userTextPct.toFixed(0)}%</span>}
                  </div>
                )}
                {assistantPct > 0 && (
                  <div className="scan-ctx-segment" style={{ width: `${assistantPct}%`, background: '#60a5fa' }}>
                    {assistantPct > 15 && <span className="scan-ctx-segment-label">{assistantPct.toFixed(0)}%</span>}
                  </div>
                )}
                {toolResultPct > 0 && (
                  <div className="scan-ctx-segment" style={{ width: `${toolResultPct}%`, background: '#06b6d4' }}>
                    {toolResultPct > 15 && <span className="scan-ctx-segment-label">{toolResultPct.toFixed(0)}%</span>}
                  </div>
                )}
              </>
            ) : (
              <div className="scan-ctx-segment" style={{ width: `${messagesPct}%`, background: '#3b82f6' }}>
                {messagesPct > 15 && <span className="scan-ctx-segment-label">{messagesPct.toFixed(0)}%</span>}
              </div>
            )}
            <div className="scan-ctx-segment" style={{ width: `${toolsPct}%`, background: '#f59e0b' }}>
              {toolsPct > 15 && <span className="scan-ctx-segment-label">{toolsPct.toFixed(0)}%</span>}
            </div>
          </div>
          <div className="scan-ctx-legend">
            <LegendItem color="#8b5cf6" label="System" tokens={ctx.system_tokens} pct={systemPct} />
            {hasBd ? (
              <>
                <LegendItem color="#3b82f6" label="Your Prompts" tokens={bd.user_text_tokens} pct={userTextPct} />
                <LegendItem color="#60a5fa" label="Responses" tokens={bd.assistant_tokens} pct={assistantPct} />
                {bd.tool_result_tokens > 0 && <LegendItem color="#06b6d4" label="Action Results" tokens={bd.tool_result_tokens} pct={toolResultPct} />}
              </>
            ) : (
              <LegendItem color="#3b82f6" label="Messages" tokens={ctx.messages_tokens} pct={messagesPct} />
            )}
            <LegendItem color="#f59e0b" label="Tools Def" tokens={ctx.tools_definition_tokens} pct={toolsPct} />
          </div>
        </div>
      </CollapsibleSection>

      {/* Injected Files */}
      <CollapsibleSection
        title={`Injected Files (${scan.injected_files.length})`}
        expanded={expandedSection === 'files'}
        onToggle={() => toggle('files')}
      >
        {scan.injected_files.length > 0 ? (
          <div className="scan-file-list">
            {scan.injected_files.map((f, i) => (
              <div
                key={i}
                onClick={(e) => onFileClick(f.path, e)}
                className="scan-file-item"
              >
                <div className="scan-file-item-left">
                  <span className="scan-file-dot" style={{ background: CATEGORY_COLORS[f.category] || '#6b7280' }} />
                  <span className="scan-file-name">
                    {f.path.split('/').slice(-2).join('/')}
                  </span>
                  <span className="scan-file-hint">
                    click to preview
                  </span>
                </div>
                <span className="scan-file-tokens">
                  {formatTokens(f.estimated_tokens)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="scan-empty-text">No injected files</div>
        )}
      </CollapsibleSection>

      {/* Actions */}
      <CollapsibleSection
        title={`Actions (${scan.tool_calls.length})`}
        expanded={expandedSection === 'tools'}
        onToggle={() => toggle('tools')}
      >
        {scan.tool_calls.length > 0 ? (
          <div className="scan-action-list">
            {scan.tool_calls.slice(0, 30).map((t) => {
              const isExpanded = expandedActions.has(t.index);
              const truncated = formatActionDetail(t);
              const full = t.input_summary || '';
              const isTruncated = truncated !== full && truncated.endsWith('...');
              return (
                <button
                  key={t.index}
                  className={`action-item${isTruncated ? ' action-expandable' : ''}`}
                  onClick={() => isTruncated && toggleAction(t.index)}
                >
                  <span className="action-dot" style={{ background: ACTION_COLORS[t.name] || '#8e8e93' }} />
                  {t.timestamp && <span className="action-time">{formatActionTime(t.timestamp)}</span>}
                  <span className="action-badge">{t.name}</span>
                  <span className={`action-detail${isExpanded ? ' expanded' : ''}`}>
                    {isExpanded ? full : truncated}
                  </span>
                </button>
              );
            })}
            {scan.tool_calls.length > 30 && (
              <div className="scan-action-more">
                +{scan.tool_calls.length - 30} more
              </div>
            )}
          </div>
        ) : (
          <div className="scan-empty-text">No actions</div>
        )}
      </CollapsibleSection>

      {/* Token Breakdown */}
      {usage && (
        <CollapsibleSection
          title="Token Breakdown"
          expanded={expandedSection === 'tokens'}
          onToggle={() => toggle('tokens')}
        >
          <div className="scan-token-breakdown">
            <TokenRow label="Input" value={usage.response.input_tokens} />
            <TokenRow label="Output" value={usage.response.output_tokens} />
            <TokenRow label="Cache Read" value={usage.response.cache_read_input_tokens} />
            <TokenRow label="Cache Create" value={usage.response.cache_creation_input_tokens} />
            <div className="scan-token-separator">
              <TokenRow label="Duration" value={usage.duration_ms} suffix="ms" />
            </div>
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
};

// -- Sub Components --

const StatCard = ({ label, value }: { label: string; value: string }) => (
  <div className="scan-stat-card">
    <div className="scan-stat-value">{value}</div>
    <div className="scan-stat-label">{label}</div>
  </div>
);

type CollapsibleSectionProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

const CollapsibleSection = ({ title, expanded, onToggle, children }: CollapsibleSectionProps) => (
  <div className="scan-collapsible">
    <button onClick={onToggle} className="scan-collapsible-btn">
      {title}
      <span className="scan-collapsible-indicator">{expanded ? '[-]' : '[+]'}</span>
    </button>
    {expanded && (
      <div className="scan-collapsible-body">
        {children}
      </div>
    )}
  </div>
);

const LegendItem = ({ color, label, tokens, pct }: { color: string; label: string; tokens: number; pct: number }) => (
  <div className="scan-legend-item">
    <span className="scan-legend-dot" style={{ background: color }} />
    <span className="scan-legend-text">{label} {formatTokens(tokens)} ({pct.toFixed(1)}%)</span>
  </div>
);

const TokenRow = ({ label, value, suffix }: { label: string; value: number; suffix?: string }) => (
  <div className="scan-token-row">
    <span className="scan-token-label">{label}</span>
    <span>{value.toLocaleString()}{suffix ? ` ${suffix}` : ''}</span>
  </div>
);
