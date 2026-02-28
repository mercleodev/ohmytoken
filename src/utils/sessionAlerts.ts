import type { SessionMcpAnalysis } from '../types/electron';

export type SessionAlert = {
  id: string;
  type: 'cache_explosion' | 'low_efficiency' | 'long_session'
    | 'mcp_overuse' | 'mcp_redundant_calls' | 'mcp_large_results';
  severity: 'info' | 'warning';
  message: string;
  tip: string;
};

export type SessionAlertInput = {
  turnCount: number;
  totalOutput: number;
  totalCacheRead: number;
  totalAll: number;
  mcpAnalysis?: SessionMcpAnalysis;
};

const LONG_SESSION_INFO_THRESHOLD = 20;
const LONG_SESSION_WARNING_THRESHOLD = 40;
const CACHE_READ_WARNING_RATIO = 0.95;
const LOW_OUTPUT_INFO_RATIO = 0.01;

const MCP_OVERUSE_WARNING_CALLS = 10;
const MCP_OVERUSE_WARNING_RATIO = 0.6;
const MCP_OVERUSE_INFO_CALLS = 5;
const MCP_OVERUSE_INFO_RATIO = 0.4;
const MCP_LARGE_RESULT_AVG_TOKENS = 2000;
const MCP_LARGE_RESULT_MIN_CALLS = 3;

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

  // --- MCP alerts (skip if no analysis data) ---
  const mcp = input.mcpAnalysis;
  if (!mcp || mcp.mcpCalls === 0) return alerts;

  const mcpRatio = mcp.totalToolCalls > 0 ? mcp.mcpCalls / mcp.totalToolCalls : 0;

  // MCP overuse
  if (mcp.mcpCalls > MCP_OVERUSE_WARNING_CALLS && mcpRatio > MCP_OVERUSE_WARNING_RATIO) {
    alerts.push({
      id: 'mcp-overuse-warning',
      type: 'mcp_overuse',
      severity: 'warning',
      message: `${mcp.mcpCalls} MCP calls (${(mcpRatio * 100).toFixed(0)}% of all actions)`,
      tip: 'Consider CDP or Bash for repetitive browser/external tasks — avoids MCP per-call token overhead.',
    });
  } else if (mcp.mcpCalls > MCP_OVERUSE_INFO_CALLS && mcpRatio > MCP_OVERUSE_INFO_RATIO) {
    alerts.push({
      id: 'mcp-overuse-info',
      type: 'mcp_overuse',
      severity: 'info',
      message: `${mcp.mcpCalls} MCP calls (${(mcpRatio * 100).toFixed(0)}% of all actions)`,
      tip: 'MCP tools add token overhead per call. Batch operations when possible.',
    });
  }

  // MCP redundant calls
  if (mcp.redundantPatterns.length > 0) {
    const totalRedundant = mcp.redundantPatterns.reduce((s, p) => s + p.count - 1, 0);
    alerts.push({
      id: 'mcp-redundant',
      type: 'mcp_redundant_calls',
      severity: 'warning',
      message: `${totalRedundant} redundant MCP call${totalRedundant > 1 ? 's' : ''} with identical input detected`,
      tip: 'Same MCP tool called multiple times with identical input. Cache results to save tokens.',
    });
  }

  // MCP large results
  if (mcp.mcpCalls >= MCP_LARGE_RESULT_MIN_CALLS && mcp.toolResultTokens > 0) {
    const avgTokensPerMcpCall = mcp.toolResultTokens / mcp.mcpCalls;
    if (avgTokensPerMcpCall > MCP_LARGE_RESULT_AVG_TOKENS) {
      alerts.push({
        id: 'mcp-large-results',
        type: 'mcp_large_results',
        severity: 'info',
        message: `MCP responses average ${Math.round(avgTokensPerMcpCall).toLocaleString()} tokens/call`,
        tip: 'Large MCP responses grow context fast. Use selectors to request only needed data.',
      });
    }
  }

  return alerts;
};
