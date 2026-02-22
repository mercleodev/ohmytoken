import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';
import { formatTokens } from '../scan/shared';
import './context.css';

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
      <div className="ctx-donut__empty">
        No injected files
      </div>
    );
  }

  return (
    <div className="ctx-donut__root">
      {/* Donut chart */}
      <div className="ctx-donut__chart-wrap">
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
        <div className="ctx-donut__center-label">
          <span className="ctx-donut__center-value">
            {formatTokens(totalTokens)}
          </span>
          <span className="ctx-donut__center-unit">tokens</span>
        </div>
      </div>

      {/* Legend */}
      <div className="ctx-donut__legend">
        {chartData.map((entry) => (
          <div key={entry.category} className="ctx-donut__legend-row">
            {/* background is data-driven — kept as inline style */}
            <span
              className="legend-dot"
              style={{ background: entry.color }}
            />
            <span className="ctx-donut__legend-label">
              {CATEGORY_LABELS[entry.category] ?? entry.category}
            </span>
            <span className="ctx-donut__legend-tokens">
              {formatTokens(entry.totalTokens)}
            </span>
            <span className="ctx-donut__legend-pct">
              {entry.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
