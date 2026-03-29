import { useMemo } from 'react';

type Props = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
  /** Highlight the last 2 data points (prev turn vs current turn) with dots */
  highlightLastTwo?: boolean;
  /** Absolute value for a horizontal threshold line (e.g. compact recommendation) */
  threshold?: number;
  /** Label for the threshold line */
  thresholdLabel?: string;
  /** Show the current (last) value label on the chart */
  showCurrentValue?: boolean;
  /** Format function for the current value label */
  formatValue?: (v: number) => string;
};

const THRESHOLD_COLOR = '#FF9500';

export const MiniSparkline = ({
  data,
  width = 120,
  height = 32,
  color = '#FF9500',
  fillColor = 'rgba(255, 149, 0, 0.1)',
  highlightLastTwo = false,
  threshold,
  thresholdLabel,
  showCurrentValue = false,
  formatValue,
}: Props) => {
  const computed = useMemo(() => {
    if (data.length < 2) return null;

    // Scale must include threshold so the line is always visible
    const max = Math.max(...data, threshold ?? 0, 1);
    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const points = data.map((v, i) => ({
      x: padding + (i / (data.length - 1)) * w,
      y: padding + h - (v / max) * h,
    }));

    const line = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
    const fill = `${line} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;

    const thresholdY = threshold != null && threshold > 0
      ? padding + h - (threshold / max) * h
      : null;

    return { line, fill, points, thresholdY };
  }, [data, width, height, threshold]);

  if (!computed || data.length < 2) {
    return (
      <svg width={width} height={height} className="mini-sparkline">
        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle"
          fill="#8e8e93" fontSize={9}>No data</text>
      </svg>
    );
  }

  const { points, thresholdY } = computed;
  const lastIdx = points.length - 1;
  const prevIdx = points.length - 2;
  const padding = 2;

  return (
    <svg width={width} height={height} className="mini-sparkline">
      <path d={computed.fill} fill={fillColor} />

      {/* Compact recommendation threshold line */}
      {thresholdY != null && (
        <>
          <line
            x1={padding}
            y1={thresholdY}
            x2={width - padding}
            y2={thresholdY}
            stroke={THRESHOLD_COLOR}
            strokeWidth={0.8}
            strokeDasharray="3,3"
            opacity={0.6}
          />
          {thresholdLabel && (
            <text
              x={width - padding - 1}
              y={thresholdY - 2}
              textAnchor="end"
              fill={THRESHOLD_COLOR}
              fontSize={7}
              opacity={0.7}
            >
              {thresholdLabel}
            </text>
          )}
        </>
      )}

      <path d={computed.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {highlightLastTwo && points.length >= 2 ? (
        <>
          {/* Previous turn dot (static, dimmed) */}
          <circle
            cx={points[prevIdx].x}
            cy={points[prevIdx].y}
            r={3}
            fill={color}
            opacity={0.4}
          />
          {/* Current turn dot (pulsing / blinking) */}
          <circle
            cx={points[lastIdx].x}
            cy={points[lastIdx].y}
            r={3}
            fill={color}
          >
            <animate attributeName="r" values="3;5;3" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
          </circle>
        </>
      ) : (
        /* Default: just latest point dot */
        <circle cx={points[lastIdx].x} cy={points[lastIdx].y} r={2.5} fill={color} />
      )}

      {/* Current value label near the last data point */}
      {showCurrentValue && data.length > 0 && (
        <text
          x={Math.min(points[lastIdx].x, width - padding - 2)}
          y={Math.max(points[lastIdx].y - 5, 9)}
          textAnchor="end"
          fill={color}
          fontSize={8}
          fontWeight={600}
        >
          {formatValue ? formatValue(data[data.length - 1]) : data[data.length - 1].toLocaleString()}
        </text>
      )}
    </svg>
  );
};
