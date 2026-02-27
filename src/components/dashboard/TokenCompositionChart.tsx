import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { formatTokens } from '../../utils/format';
import type { TokenCompositionResult } from '../../types/electron';

type Period = 'today' | '7d' | '30d';

const SEGMENTS = [
  { key: 'cache_read', label: 'Cache Read', color: '#9CA3AF' },
  { key: 'cache_create', label: 'Cache Create', color: '#FBBF24' },
  { key: 'input', label: 'Input', color: '#60A5FA' },
  { key: 'output', label: 'Output', color: '#34D399' },
] as const;

type SegmentKey = typeof SEGMENTS[number]['key'];

type CompositionTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: { name: string; value: number; total: number } }>;
};

const CompositionTooltip = ({ active, payload }: CompositionTooltipProps) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  const pct = d.total > 0 ? ((d.value / d.total) * 100).toFixed(1) : '0';
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip-date">{d.name}</div>
      <div className="stats-tooltip-row">
        <span>Tokens:</span> <span>{formatTokens(d.value)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Share:</span> <span>{pct}%</span>
      </div>
    </div>
  );
};

export const TokenCompositionChart = () => {
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<TokenCompositionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getTokenComposition(period)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => console.error('getTokenComposition failed:', err));
    return () => { cancelled = true; };
  }, [period]);

  const chartData = useMemo(() => {
    if (!data || data.total === 0) return null;
    return SEGMENTS.map((seg) => ({
      name: seg.label,
      value: data[seg.key as SegmentKey],
      total: data.total,
    }));
  }, [data]);

  if (!data || data.total === 0 || !chartData) return null;

  const outputPct = ((data.output / data.total) * 100).toFixed(1);

  return (
    <div className="stats-section">
      <div className="token-composition-header">
        <div className="stats-section-title">Token Composition</div>
        <div className="token-composition-toggle">
          {(['today', '7d', '30d'] as Period[]).map((p) => (
            <button
              key={p}
              className={`token-composition-toggle-btn ${period === p ? 'active' : ''}`}
              onClick={() => setPeriod(p)}
              aria-pressed={period === p}
              aria-label={`Show ${p === 'today' ? 'today' : p} token composition`}
            >
              {p === 'today' ? 'Today' : p === '7d' ? '7D' : '30D'}
            </button>
          ))}
        </div>
      </div>
      <div className="token-composition-chart">
        <ResponsiveContainer width="100%" height={120}>
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={55}
              paddingAngle={1}
              isAnimationActive={false}
            >
              {chartData.map((entry, i) => (
                <Cell key={entry.name} fill={SEGMENTS[i].color} />
              ))}
            </Pie>
            <Tooltip content={<CompositionTooltip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="token-composition-center-label">
          <span className="token-composition-center-pct">{outputPct}%</span>
          <span className="token-composition-center-sub">Output</span>
        </div>
      </div>
      <div className="token-composition-legend">
        {SEGMENTS.map((seg) => {
          const val = data[seg.key as SegmentKey];
          const pct = data.total > 0 ? ((val / data.total) * 100).toFixed(1) : '0';
          return (
            <div key={seg.key} className="token-composition-legend-row">
              <span
                className="token-composition-legend-dot"
                style={{ background: seg.color }}
              />
              <span className="token-composition-legend-label">{seg.label}</span>
              <span className="token-composition-legend-value">
                {formatTokens(val)} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
