import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, ResponsiveContainer, Cell } from 'recharts';
import type { ScanStats } from '../../types';
import { formatCost, toLocalDateKey } from '../../utils/format';

type StatsCardProps = {
  onSelectStats: (stats: ScanStats) => void;
  scanRevision?: number;
  provider?: string;
};

// Build last 7 days of data (fill empty days with minimum visible bar)
// Uses local dates so "today" always matches the user's timezone
export const buildLast7Days = (costByPeriod: ScanStats['cost_by_period']): Array<{ day: string; cost: number; actual: number }> => {
  const map = new Map(costByPeriod.map((d) => [d.period, d.cost_usd]));
  const raw: Array<{ day: string; actual: number }> = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    raw.push({ day: toLocalDateKey(d), actual: map.get(toLocalDateKey(d)) ?? 0 });
  }

  // 5% of max so empty days still show a small placeholder bar
  const maxCost = Math.max(...raw.map((d) => d.actual), 0.01);
  const minBar = maxCost * 0.05;

  return raw.map((d) => ({
    day: d.day,
    cost: d.actual > 0 ? d.actual : minBar,
    actual: d.actual,
  }));
};

export const StatsCard = ({ onSelectStats, scanRevision, provider }: StatsCardProps) => {
  const [stats, setStats] = useState<ScanStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await window.api.getScanStats(provider);
      if (data) setStats(data);
    } catch {
      // Stats loading is best-effort
    }
  }, [provider]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    if (scanRevision && scanRevision > 0) {
      loadStats();
    }
  }, [scanRevision, loadStats]);

  if (!stats || stats.summary.total_requests === 0) return null;

  const last7 = buildLast7Days(stats.cost_by_period);
  const maxCost = Math.max(...last7.map((d) => d.actual), 0.01);

  return (
    <button className="stats-card" onClick={() => onSelectStats(stats)}>
      <div className="stats-card-header">
        <span className="stats-card-title">Stats</span>
        <span className="stats-card-chevron">›</span>
      </div>
      <div className="stats-card-chart">
        <ResponsiveContainer width="100%" height={36}>
          <BarChart data={last7} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey="cost" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {last7.map((entry, i) => {
                const isToday = i === last7.length - 1;
                const hasData = entry.actual > 0;
                const opacity = hasData ? 0.5 + (entry.actual / maxCost) * 0.5 : 0.15;
                return (
                  <Cell
                    key={entry.day}
                    fill="#F59E0B"
                    fillOpacity={isToday && hasData ? 1 : opacity}
                  />
                );
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="stats-card-summary">
        <span>{formatCost(stats.summary.total_cost_usd)} total</span>
        <span className="stats-card-dot">&middot;</span>
        <span>{stats.summary.total_requests} requests</span>
        <span className="stats-card-dot">&middot;</span>
        <span>Cache {Math.round(stats.summary.cache_hit_rate)}%</span>
      </div>
    </button>
  );
};
