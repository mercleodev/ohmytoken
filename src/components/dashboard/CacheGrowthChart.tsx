import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { formatTokens } from '../../utils/format';
import type { TurnMetric } from '../../types/electron';

type CacheGrowthChartProps = {
  sessionId: string;
  onTurnClick?: (turnIndex: number, timestamp: string) => void;
};

type CumulativeRow = {
  turn: number;
  timestamp: string;
  cumCacheRead: number;
  cumOutput: number;
  cacheReadThisTurn: number;
  outputThisTurn: number;
};

type GrowthTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: CumulativeRow }>;
  clickable?: boolean;
};

const GrowthTooltip = ({ active, payload, clickable }: GrowthTooltipProps) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip-date">Turn #{d.turn}</div>
      <div className="stats-tooltip-row">
        <span>Cache Read:</span> <span>{formatTokens(d.cacheReadThisTurn)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Output:</span> <span>{formatTokens(d.outputThisTurn)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Cum. Cache:</span> <span>{formatTokens(d.cumCacheRead)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Cum. Output:</span> <span>{formatTokens(d.cumOutput)}</span>
      </div>
      {clickable && (
        <div className="stats-tooltip-hint">Click to view details</div>
      )}
    </div>
  );
};

const MIN_TURNS_TO_SHOW = 3;

export const CacheGrowthChart = ({ sessionId, onTurnClick }: CacheGrowthChartProps) => {
  const [turns, setTurns] = useState<TurnMetric[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.api.getSessionTurnMetrics(sessionId)
      .then((result) => { if (!cancelled) setTurns(result); })
      .catch((err) => console.error('getSessionTurnMetrics failed:', err));
    return () => { cancelled = true; };
  }, [sessionId]);

  const cumulative = useMemo<CumulativeRow[]>(() => {
    return turns.reduce<CumulativeRow[]>((acc, turn, i) => {
      const prev = acc[i - 1];
      acc.push({
        turn: turn.turnIndex,
        timestamp: turn.timestamp,
        cumCacheRead: (prev?.cumCacheRead ?? 0) + turn.cache_read_tokens,
        cumOutput: (prev?.cumOutput ?? 0) + turn.output_tokens,
        cacheReadThisTurn: turn.cache_read_tokens,
        outputThisTurn: turn.output_tokens,
      });
      return acc;
    }, []);
  }, [turns]);

  const handleChartClick = (state: { activeTooltipIndex?: number | unknown }) => {
    if (!onTurnClick) return;
    const idx = typeof state.activeTooltipIndex === 'number' ? state.activeTooltipIndex : -1;
    const row = cumulative[idx];
    if (row) {
      onTurnClick(row.turn, row.timestamp);
    }
  };

  if (cumulative.length < MIN_TURNS_TO_SHOW) return null;

  const clickable = Boolean(onTurnClick);

  return (
    <div className="cache-growth-section">
      <div className="cache-growth-label">
        Cache Read grows O(N²) — Output stays linear
      </div>
      <div className={`cache-growth-chart${clickable ? ' cache-growth-chart--clickable' : ''}`}>
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart
            data={cumulative}
            margin={{ top: 4, right: 4, bottom: 0, left: -20 }}
            onClick={clickable ? handleChartClick : undefined}
          >
            <XAxis
              dataKey="turn"
              tick={{ fontSize: 9, fill: '#9B9C9E' }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'Turn', position: 'insideBottomRight', offset: -2, fontSize: 9, fill: '#9B9C9E' }}
            />
            <YAxis
              tick={{ fontSize: 9, fill: '#9B9C9E' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => formatTokens(v)}
              width={44}
            />
            <Tooltip content={<GrowthTooltip clickable={clickable} />} />
            <Area
              type="monotone"
              dataKey="cumCacheRead"
              fill="#9CA3AF"
              fillOpacity={0.2}
              stroke="#9CA3AF"
              strokeWidth={1.5}
              isAnimationActive={false}
              activeDot={clickable ? { r: 4, strokeWidth: 2, stroke: '#9CA3AF', fill: '#fff' } : undefined}
            />
            <Line
              type="monotone"
              dataKey="cumOutput"
              stroke="#34D399"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              activeDot={clickable ? { r: 4, strokeWidth: 2, stroke: '#34D399', fill: '#fff' } : undefined}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
