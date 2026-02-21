import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import type { ScanStats } from '../../types';
import { formatCost, formatTokens } from '../../utils/format';

type StatsDetailViewProps = {
  stats: ScanStats;
  onBack: () => void;
};

const formatShortDate = (period: string): string => {
  const d = new Date(period + 'T00:00:00');
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

// Fill missing days in range so every day has a bar
const fillDailyData = (
  costByPeriod: ScanStats['cost_by_period'],
): Array<{ period: string; cost_usd: number; request_count: number; label: string }> => {
  if (costByPeriod.length === 0) return [];

  const map = new Map(costByPeriod.map((d) => [d.period, d]));
  const result: Array<{ period: string; cost_usd: number; request_count: number; label: string }> = [];

  // Last 30 days
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const existing = map.get(key);
    result.push({
      period: key,
      cost_usd: existing?.cost_usd ?? 0,
      request_count: existing?.request_count ?? 0,
      label: formatShortDate(key),
    });
  }
  return result;
};

// Custom tooltip for bar chart
const CostTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.[0]) return null;
  const data = payload[0].payload;
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip-date">{data.period}</div>
      <div className="stats-tooltip-row">
        <span>Cost:</span> <span>{formatCost(data.cost_usd)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Requests:</span> <span>{data.request_count}</span>
      </div>
    </div>
  );
};

const SummaryCard = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="stats-summary-card">
    <div className="stats-summary-value">{value}</div>
    <div className="stats-summary-label">{label}</div>
    {sub && <div className="stats-summary-sub">{sub}</div>}
  </div>
);

export const StatsDetailView = ({ stats, onBack }: StatsDetailViewProps) => {
  const dailyData = useMemo(() => fillDailyData(stats.cost_by_period), [stats.cost_by_period]);
  const maxCost = useMemo(() => Math.max(...dailyData.map((d) => d.cost_usd), 0.01), [dailyData]);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="stats-detail">
      {/* Header with back button */}
      <div className="stats-detail-header">
        <button className="stats-back-btn" onClick={onBack}>‹ Back</button>
        <span className="stats-detail-title">Statistics</span>
      </div>

      {/* Summary Cards */}
      <div className="stats-summary-grid">
        <SummaryCard
          label="Total Cost"
          value={formatCost(stats.summary.total_cost_usd)}
        />
        <SummaryCard
          label="Requests"
          value={String(stats.summary.total_requests)}
        />
        <SummaryCard
          label="Avg Context"
          value={formatTokens(stats.summary.avg_context_tokens)}
        />
        <SummaryCard
          label="Cache Hit"
          value={`${Math.round(stats.summary.cache_hit_rate)}%`}
        />
      </div>

      {/* Daily Cost Bar Chart */}
      <div className="stats-section">
        <div className="stats-section-title">Daily Cost (30d)</div>
        <div className="stats-chart-container">
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: '#9B9C9E' }}
                tickLine={false}
                axisLine={false}
                interval={Math.floor(dailyData.length / 6)}
              />
              <YAxis
                tick={{ fontSize: 9, fill: '#9B9C9E' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(1)}`}
                width={40}
              />
              <Tooltip content={<CostTooltip />} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
              <Bar dataKey="cost_usd" radius={[2, 2, 0, 0]} isAnimationActive={false}>
                {dailyData.map((entry) => {
                  const isToday = entry.period === todayStr;
                  const opacity = entry.cost_usd > 0 ? 0.5 + (entry.cost_usd / maxCost) * 0.5 : 0.1;
                  return (
                    <Cell
                      key={entry.period}
                      fill="#F59E0B"
                      fillOpacity={isToday && entry.cost_usd > 0 ? 1 : opacity}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top Tools */}
      {Object.keys(stats.tool_frequency).length > 0 && (
        <div className="stats-section">
          <div className="stats-section-title">Top Tools</div>
          <div className="stats-tool-list">
            {Object.entries(stats.tool_frequency)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 8)
              .map(([tool, count]) => {
                const maxCount = Object.values(stats.tool_frequency).reduce((a, b) => Math.max(a, b), 1);
                return (
                  <div key={tool} className="stats-tool-row">
                    <span className="stats-tool-name">{tool}</span>
                    <div className="stats-tool-bar-track">
                      <div
                        className="stats-tool-bar-fill"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="stats-tool-count">{count}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
};
