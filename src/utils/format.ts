/** Format USD cost for display. Sub-milli values shown as milli-dollars. */
export const formatCost = (cost: number | undefined | null): string => {
  if (cost == null || isNaN(cost) || cost <= 0) return '$0.00';
  if (cost < 0.001) return `$${(cost * 1000).toFixed(2)}m`;
  return `$${cost.toFixed(4)}`;
};

/** Format token count with K/M suffixes. */
export const formatTokens = (n: number | undefined | null): string => {
  if (n == null || isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

/** Format timestamp as relative time (e.g., "5m ago", "2h ago"). */
export const formatTimeAgo = (ts: string): string => {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};
