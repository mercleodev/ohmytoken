/**
 * Shared formatting utilities for token counts, costs, and timestamps.
 * Single source of truth — all components import from here.
 */

export const formatCost = (cost: number | undefined | null): string => {
  if (cost == null || isNaN(cost) || cost <= 0) return '$0.00';
  if (cost < 0.001) return `$${(cost * 1000).toFixed(2)}m`;
  return `$${cost.toFixed(4)}`;
};

export const formatTokens = (n: number | undefined | null): string => {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export const formatTimeAgo = (ts: string): string => {
  const diff = Date.now() - new Date(ts).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};
