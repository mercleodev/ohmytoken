import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatTokens } from '../scan/shared';

type CategoryBreakdown = {
  category: string;
  totalTokens: number;
  percentage: number;
  color: string;
};

type CategoryDonutChartProps = {
  data: CategoryBreakdown[];
  totalTokens: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  global: 'Global',
  project: 'Project',
  rules: 'Rules',
  memory: 'Memory',
  skill: 'Skill',
};

export const CategoryDonutChart = ({ data, totalTokens }: CategoryDonutChartProps) => {
  const chartData = data.filter((d) => d.totalTokens > 0);

  if (chartData.length === 0) {
    return (
      <div style={{ padding: '16px 0', textAlign: 'center', color: '#8e8e93', fontSize: 12 }}>
        No injected files
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 0' }}>
      {/* Donut chart */}
      <div style={{ position: 'relative', width: 120, height: 120, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="totalTokens"
              cx="50%"
              cy="50%"
              innerRadius={32}
              outerRadius={52}
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((entry) => (
                <Cell key={entry.category} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label */}
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>
            {formatTokens(totalTokens)}
          </span>
          <span style={{ fontSize: 9, color: '#8e8e93' }}>tokens</span>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
        {chartData.map((entry) => (
          <div
            key={entry.category}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}
          >
            <span
              className="legend-dot"
              style={{ background: entry.color }}
            />
            <span style={{ color: '#3c3c43', flex: 1 }}>
              {CATEGORY_LABELS[entry.category] ?? entry.category}
            </span>
            <span style={{ color: '#8e8e93', fontWeight: 500, minWidth: 36, textAlign: 'right' }}>
              {formatTokens(entry.totalTokens)}
            </span>
            <span style={{ color: '#c7c7cc', fontSize: 11, minWidth: 32, textAlign: 'right' }}>
              {entry.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
