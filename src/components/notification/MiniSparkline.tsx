import { useMemo } from 'react';

type Props = {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  fillColor?: string;
};

export const MiniSparkline = ({
  data,
  width = 120,
  height = 32,
  color = '#FF9500',
  fillColor = 'rgba(255, 149, 0, 0.1)',
}: Props) => {
  const pathD = useMemo(() => {
    if (data.length < 2) return '';

    const max = Math.max(...data, 1);
    const padding = 2;
    const w = width - padding * 2;
    const h = height - padding * 2;

    const points = data.map((v, i) => ({
      x: padding + (i / (data.length - 1)) * w,
      y: padding + h - (v / max) * h,
    }));

    const line = points.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ');
    const fill = `${line} L${points[points.length - 1].x},${height} L${points[0].x},${height} Z`;

    return { line, fill };
  }, [data, width, height]);

  if (!pathD || data.length < 2) {
    return (
      <svg width={width} height={height} className="mini-sparkline">
        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="middle"
          fill="#8e8e93" fontSize={9}>No data</text>
      </svg>
    );
  }

  return (
    <svg width={width} height={height} className="mini-sparkline">
      <path d={pathD.fill} fill={fillColor} />
      <path d={pathD.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Latest point dot */}
      {data.length > 0 && (() => {
        const max = Math.max(...data, 1);
        const padding = 2;
        const w = width - padding * 2;
        const h = height - padding * 2;
        const lastIdx = data.length - 1;
        const cx = padding + (lastIdx / (data.length - 1)) * w;
        const cy = padding + h - (data[lastIdx] / max) * h;
        return <circle cx={cx} cy={cy} r={2.5} fill={color} />;
      })()}
    </svg>
  );
};
