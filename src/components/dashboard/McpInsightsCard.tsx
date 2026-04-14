import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTokens } from '../../utils/format';
import type { McpInsightsResult } from '../../types/electron';
import { getMcpServerName } from '../../utils/mcpTools';

type Period = 'today' | '7d' | '30d';

type McpInsightsCardProps = {
  scanRevision?: number;
  provider?: string;
};

const MCP_BAR_MIN_WIDTH_PCT = 2;
const TOP_TOOLS_LIMIT = 5;

/** Always-visible token saving tips about MCP */
const MCP_GENERAL_TIPS = [
  'MCP resends the full context every turn — use CDP (Chrome DevTools Protocol) or Bash scripts for repetitive browser tasks to cut token usage by up to 80%.',
  'Pre-write automation scripts with CDP instead of MCP for browser actions — LLM generates the code once, then it runs without per-call token overhead.',
  'MCP tools add ~2K+ tokens per call for tool definitions alone. Batch multiple operations into a single script to avoid this overhead.',
  'Cache MCP results locally (e.g., Figma node data, screenshots) — re-fetching the same data wastes tokens on duplicate context.',
];

/** Pick a contextual tip based on MCP usage patterns, or a general tip */
const getMcpTip = (data: McpInsightsResult): string => {
  if (data.totalMcpCalls === 0) {
    // Rotate general tips based on current date
    const dayIndex = new Date().getDate() % MCP_GENERAL_TIPS.length;
    return MCP_GENERAL_TIPS[dayIndex];
  }

  // Check for specific tool patterns
  const screenshotCalls = data.mcpToolStats.filter(
    (t) => t.name.includes('screenshot'),
  );
  const screenshotCount = screenshotCalls.reduce((s, t) => s + t.callCount, 0);
  if (screenshotCount > 5) {
    return 'Take one full-page screenshot instead of multiple element captures — each screenshot call resends full context.';
  }

  const figmaCalls = data.mcpToolStats.filter(
    (t) => getMcpServerName(t.name) === 'figma',
  );
  const figmaCount = figmaCalls.reduce((s, t) => s + t.callCount, 0);
  if (figmaCount > 3) {
    return 'Cache Figma node data locally — re-fetching adds ~2K tokens each time due to MCP context resend.';
  }

  if (data.redundantCallCount > 0) {
    return 'Same MCP tool called with identical input — store results in a variable to avoid duplicate context overhead.';
  }

  if (data.mcpCallRatio > 0.6) {
    return 'Over 60% of actions are MCP calls. Use CDP or Bash scripts for repetitive tasks — can reduce token usage by up to 80%.';
  }

  if (data.mcpCallRatio > 0.4) {
    return 'MCP resends full context every turn. Batch operations or pre-write scripts with CDP to cut per-call token overhead.';
  }

  return 'MCP tools detected. Each call resends full context — consider CDP or built-in alternatives for repetitive tasks.';
};

/** Shorten tool name for display: mcp__figma__get_figma_data → get_figma_data */
const shortToolName = (name: string): string => {
  const parts = name.split('__');
  return parts.length >= 3 ? parts.slice(2).join('__') : name;
};

export const McpInsightsCard = ({ scanRevision, provider }: McpInsightsCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<McpInsightsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getMcpInsights(period, provider)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => console.error('getMcpInsights failed:', err));
    return () => { cancelled = true; };
  }, [period, scanRevision, provider]);

  const topTools = useMemo(() => {
    if (!data) return [];
    return data.mcpToolStats.slice(0, TOP_TOOLS_LIMIT);
  }, [data]);

  const tip = useMemo(() => data ? getMcpTip(data) : MCP_GENERAL_TIPS[0], [data]);

  if (!data) return null;

  const ratioPct = data.mcpCallRatio * 100;
  const barWidth = Math.max(ratioPct, MCP_BAR_MIN_WIDTH_PCT);

  return (
    <div className="mcp-card">
      <div className="mcp-card-header">
        <button
          className="cost-header"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-label="Toggle MCP Tool Usage details"
        >
          <span className="cost-title">MCP Tool Usage</span>
          <span className={`cost-chevron ${expanded ? 'expanded' : ''}`}>›</span>
        </button>
        <div className="mcp-card-toggle">
          {(['today', '7d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              className={`token-composition-toggle-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              aria-label={`Show ${p === 'today' ? 'today' : p} MCP usage`}
            >
              {p === 'today' ? 'Today' : p === '7d' ? '7D' : '30D'}
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            style={{ overflow: 'hidden' }}
          >
            {data.totalMcpCalls > 0 ? (
              <>
                <div className="mcp-card-headline">
                  <span className="mcp-card-value">{data.totalMcpCalls}</span>
                  <span className="mcp-card-unit"> MCP calls</span>
                  <span className="mcp-card-ratio">
                    ({ratioPct.toFixed(0)}% of all tool actions)
                  </span>
                </div>
                <div className="mcp-card-bar-track">
                  <div
                    className="mcp-card-bar-fill"
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                {topTools.length > 0 && (
                  <div className="mcp-card-tools">
                    <div className="mcp-card-tools-title">Top MCP Tools</div>
                    {topTools.map((tool) => (
                      <div key={tool.name} className="mcp-card-tool-row">
                        <span className="mcp-card-tool-dot" />
                        <span className="mcp-card-tool-name">
                          {shortToolName(tool.name)}
                        </span>
                        <span className="mcp-card-tool-count">
                          {tool.callCount} call{tool.callCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {data.totalToolResultTokens > 0 && (
                  <div className="mcp-card-tokens">
                    Tool Result Tokens: {formatTokens(data.totalToolResultTokens)}
                  </div>
                )}

                {data.redundantCallCount > 0 && (
                  <div className="mcp-card-redundant">
                    {data.redundantCallCount} redundant call{data.redundantCallCount > 1 ? 's' : ''} detected
                  </div>
                )}

                {tip && (
                  <div className="mcp-card-tip">
                    <span className="mcp-card-tip-icon">💡</span>
                    <span className="mcp-card-tip-text">{tip}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="mcp-card-empty">
                  No MCP tool usage detected in this period.
                </div>
                <div className="mcp-card-tip">
                  <span className="mcp-card-tip-icon">💡</span>
                  <span className="mcp-card-tip-text">{tip}</span>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
