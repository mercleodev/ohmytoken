import { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, ResponsiveContainer, Cell } from 'recharts';
import type { ScanStats } from '../../types';

type StatsCardProps = {
  onSelectStats: (stats: ScanStats) => void;
  scanRevision?: number;
};

const formatCost = (usd: number): string => {
  if (usd < 0.01) return '< $0.01';
  return `$${usd.toFixed(2)}`;
};

// Build last 7 days of data (fill empty days with 0)
const buildLast7Days = (costByPeriod: ScanStats['cost_by_period']): Array<{ day: string; cost: number }> => {
  const map = new Map(costByPeriod.map((d) => [d.period, d.cost_usd]));
  const result: Array<{ day: string; cost: number }> = [];
  const now = new Date();

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    result.push({ day: key, cost: map.get(key) ?? 0 });
  }
  return result;
};

export const StatsCard = ({ onSelectStats, scanRevision }: StatsCardProps) => {
  const [stats, setStats] = useState<ScanStats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await window.api.getScanStats();
      if (data) setStats(data);
    } catch {
      // Stats loading is best-effort
    }
  }, []);

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
  const maxCost = Math.max(...last7.map((d) => d.cost), 0.01);

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
                const opacity = entry.cost > 0 ? 0.5 + (entry.cost / maxCost) * 0.5 : 0.15;
                return (
                  <Cell
                    key={entry.day}
                    fill={isToday ? '#F59E0B' : '#F59E0B'}
                    fillOpacity={isToday && entry.cost > 0 ? 1 : opacity}
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
