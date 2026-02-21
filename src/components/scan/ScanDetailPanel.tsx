import { useState } from 'react';
import { formatCost, formatTokens, CATEGORY_COLORS, ACTION_COLORS, formatActionDetail, formatActionTime } from './shared';
import type { PromptScanData, UsageData } from './PromptTimeline';

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
    <div style={{
      background: 'rgba(255,255,255,0.05)',
      borderRadius: 10,
      padding: 14,
    }}>
      {/* Prompt */}
      <div style={{
        fontSize: 13,
        color: '#e2e8f0',
        marginBottom: 12,
        padding: '8px 10px',
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 6,
        borderLeft: '3px solid #667eea',
        lineHeight: 1.5,
        maxHeight: 80,
        overflow: 'hidden',
      }}>
        {scan.user_prompt || '(system request)'}
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 8,
        marginBottom: 12,
      }}>
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
          <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{ width: `${systemPct}%`, background: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {systemPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{systemPct.toFixed(0)}%</span>}
            </div>
            {hasBd ? (
              <>
                {userTextPct > 0 && (
                  <div style={{ width: `${userTextPct}%`, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {userTextPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{userTextPct.toFixed(0)}%</span>}
                  </div>
                )}
                {assistantPct > 0 && (
                  <div style={{ width: `${assistantPct}%`, background: '#60a5fa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {assistantPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{assistantPct.toFixed(0)}%</span>}
                  </div>
                )}
                {toolResultPct > 0 && (
                  <div style={{ width: `${toolResultPct}%`, background: '#06b6d4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {toolResultPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{toolResultPct.toFixed(0)}%</span>}
                  </div>
                )}
              </>
            ) : (
              <div style={{ width: `${messagesPct}%`, background: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {messagesPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{messagesPct.toFixed(0)}%</span>}
              </div>
            )}
            <div style={{ width: `${toolsPct}%`, background: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {toolsPct > 15 && <span style={{ fontSize: 9, color: '#fff' }}>{toolsPct.toFixed(0)}%</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, flexWrap: 'wrap' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {scan.injected_files.map((f, i) => (
              <div
                key={i}
                onClick={(e) => onFileClick(f.path, e)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(139, 92, 246, 0.15)';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{
                    display: 'inline-block',
                    width: 8, height: 8, borderRadius: '50%',
                    background: CATEGORY_COLORS[f.category] || '#6b7280',
                    flexShrink: 0,
                  }} />
                  <span style={{ color: '#cbd5e1' }}>
                    {f.path.split('/').slice(-2).join('/')}
                  </span>
                  <span style={{
                    fontSize: 9, color: '#64748b',
                    padding: '1px 5px',
                    background: 'rgba(255,255,255,0.06)',
                    borderRadius: 3,
                  }}>
                    click to preview
                  </span>
                </div>
                <span style={{ color: '#94a3b8', fontSize: 11 }}>
                  {formatTokens(f.estimated_tokens)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: 11 }}>No injected files</div>
        )}
      </CollapsibleSection>

      {/* Actions */}
      <CollapsibleSection
        title={`Actions (${scan.tool_calls.length})`}
        expanded={expandedSection === 'tools'}
        onToggle={() => toggle('tools')}
      >
        {scan.tool_calls.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
              <div style={{ color: '#64748b', fontSize: 11, textAlign: 'center' }}>
                +{scan.tool_calls.length - 30} more
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: 11 }}>No actions</div>
        )}
      </CollapsibleSection>

      {/* Token Breakdown */}
      {usage && (
        <CollapsibleSection
          title="Token Breakdown"
          expanded={expandedSection === 'tokens'}
          onToggle={() => toggle('tokens')}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            <TokenRow label="Input" value={usage.response.input_tokens} />
            <TokenRow label="Output" value={usage.response.output_tokens} />
            <TokenRow label="Cache Read" value={usage.response.cache_read_input_tokens} />
            <TokenRow label="Cache Create" value={usage.response.cache_creation_input_tokens} />
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 4, marginTop: 2 }}>
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
  <div style={{
    textAlign: 'center',
    padding: '8px 4px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: 6,
  }}>
    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{value}</div>
    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{label}</div>
  </div>
);

type CollapsibleSectionProps = {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

const CollapsibleSection = ({ title, expanded, onToggle, children }: CollapsibleSectionProps) => (
  <div style={{ marginTop: 8 }}>
    <button
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 8px',
        border: 'none',
        borderRadius: 4,
        cursor: 'pointer',
        background: 'rgba(255,255,255,0.05)',
        color: '#cbd5e1',
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      {title}
      <span style={{ fontSize: 10, color: '#64748b' }}>{expanded ? '[-]' : '[+]'}</span>
    </button>
    {expanded && (
      <div style={{ padding: '8px 4px' }}>
        {children}
      </div>
    )}
  </div>
);

const LegendItem = ({ color, label, tokens, pct }: { color: string; label: string; tokens: number; pct: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
    <span style={{ color: '#cbd5e1' }}>{label} {formatTokens(tokens)} ({pct.toFixed(1)}%)</span>
  </div>
);

const TokenRow = ({ label, value, suffix }: { label: string; value: number; suffix?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
    <span style={{ color: '#94a3b8' }}>{label}</span>
    <span>{value.toLocaleString()}{suffix ? ` ${suffix}` : ''}</span>
  </div>
);
