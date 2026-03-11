import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';
import { formatTokens } from '../../utils/format';
import type { TurnMetric } from '../../types/electron';

type CacheGrowthChartProps = {
  sessionId: string;
  onTurnClick?: (turnIndex: number, timestamp: string, requestId: string) => void;
};

type TurnRow = {
  turn: number;
  timestamp: string;
  requestId: string;
  cacheRead: number;
  output: number;
  compacted: boolean;
};

type GrowthTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: TurnRow }>;
  clickable?: boolean;
};

const GrowthTooltip = ({ active, payload, clickable }: GrowthTooltipProps) => {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="stats-tooltip">
      <div className="stats-tooltip-date">
        Turn #{d.turn}
        {d.compacted && (
          <span className="stats-tooltip-compacted"> Compacted</span>
        )}
      </div>
      <div className="stats-tooltip-row">
        <span>Cache Read:</span> <span>{formatTokens(d.cacheRead)}</span>
      </div>
      <div className="stats-tooltip-row">
        <span>Output:</span> <span>{formatTokens(d.output)}</span>
      </div>
      {clickable && (
        <div className="stats-tooltip-hint">Click anywhere to view prompt</div>
      )}
    </div>
  );
};

/* Small visual marker dot — compacted turns get orange highlight */
const MarkerDot = ({ cx, cy, payload }: {
  cx?: number; cy?: number; index?: number; payload?: TurnRow;
  fill?: string; stroke?: string;
}) => {
  if (cx == null || cy == null || !payload) return null;
  if (payload.compacted) {
    return <circle cx={cx} cy={cy} r={3.5} fill="#ff9500" stroke="#fff" strokeWidth={1.5} />;
  }
  return null;
};

/* Compact axis formatter — drops trailing ".0" to save horizontal space */
const formatAxisTokens = (v: number): string => {
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (v >= 1_000) {
    const k = v / 1_000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(v);
};

// Chart margins matching ComposedChart config
const YAXIS_WIDTH = 50;
const MARGIN_LEFT = -16;
const MARGIN_RIGHT = 4;
const PLOT_LEFT = YAXIS_WIDTH + MARGIN_LEFT; // 34px

const MIN_TURNS_TO_SHOW = 3;

export const CacheGrowthChart = ({ sessionId, onTurnClick }: CacheGrowthChartProps) => {
  const [turns, setTurns] = useState<TurnMetric[]>([]);
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getSessionTurnMetrics(sessionId)
      .then((result) => { if (!cancelled) setTurns(result); })
      .catch((err) => console.error('getSessionTurnMetrics failed:', err));
    return () => { cancelled = true; };
  }, [sessionId]);

  const turnRows = useMemo<TurnRow[]>(() => {
    return turns.map((turn, i) => {
      const prevCtx = i > 0 ? turns[i - 1].total_context_tokens : 0;
      const compacted =
        i > 0 && prevCtx > 0 && turn.total_context_tokens < prevCtx * 0.8;
      return {
        turn: turn.turnIndex,
        timestamp: turn.timestamp,
        requestId: turn.request_id,
        cacheRead: Math.max(0, turn.cache_read_tokens),
        output: Math.max(0, turn.output_tokens),
        compacted,
      };
    });
  }, [turns]);

  // Click anywhere in chart → map X coordinate to nearest data point
  const handleChartAreaClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!onTurnClick || turnRows.length === 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const plotWidth = rect.width - PLOT_LEFT - MARGIN_RIGHT;
      if (plotWidth <= 0) return;
      const ratio = Math.max(0, Math.min(1, (x - PLOT_LEFT) / plotWidth));
      const idx = Math.round(ratio * (turnRows.length - 1));
      const row = turnRows[Math.max(0, Math.min(idx, turnRows.length - 1))];
      if (row) {
        onTurnClick(row.turn, row.timestamp, row.requestId);
      }
    },
    [onTurnClick, turnRows],
  );

  const compactedTurns = useMemo(
    () => turnRows.filter((r) => r.compacted),
    [turnRows],
  );

  const hasCacheData = useMemo(
    () => turnRows.some((r) => r.cacheRead > 0),
    [turnRows],
  );

  if (turnRows.length < MIN_TURNS_TO_SHOW) return null;

  const clickable = Boolean(onTurnClick);

  return (
    <div className="cache-growth-section">
      <div className="cache-growth-label">
        {hasCacheData
          ? 'Cache Read per Turn — Output per Turn'
          : 'Output per Turn'}
        {compactedTurns.length > 0 && (
          <span className="cache-growth-compacted-count">
            {compactedTurns.length} compacted
          </span>
        )}
      </div>
      <div
        ref={chartRef}
        className={`cache-growth-chart${clickable ? ' cache-growth-chart--clickable' : ''}`}
        onClick={clickable ? handleChartAreaClick : undefined}
      >
        <ResponsiveContainer width="100%" height={140}>
          <ComposedChart
            data={turnRows}
            margin={{ top: 4, right: MARGIN_RIGHT, bottom: 0, left: MARGIN_LEFT }}
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
              tickFormatter={formatAxisTokens}
              width={YAXIS_WIDTH}
              domain={[0, 'auto']}
            />
            <Tooltip content={<GrowthTooltip clickable={clickable} />} />
            {compactedTurns.map((r) => (
              <ReferenceLine
                key={`compact-${r.turn}`}
                x={r.turn}
                stroke="#ff9500"
                strokeDasharray="4 2"
                strokeWidth={1.5}
                label={{
                  value: 'C',
                  position: 'top',
                  fontSize: 8,
                  fontWeight: 600,
                  fill: '#ff9500',
                }}
              />
            ))}
            <Area
              type="monotone"
              dataKey="cacheRead"
              fill="#9CA3AF"
              fillOpacity={0.15}
              stroke="#9CA3AF"
              strokeWidth={1.5}
              isAnimationActive={false}
              dot={<MarkerDot />}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#9CA3AF', fill: '#fff' }}
            />
            <Line
              type="monotone"
              dataKey="output"
              stroke="#34D399"
              strokeWidth={2}
              isAnimationActive={false}
              dot={<MarkerDot />}
              activeDot={{ r: 5, strokeWidth: 2, stroke: '#34D399', fill: '#fff' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
