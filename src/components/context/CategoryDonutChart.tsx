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
      <div className="category-donut-empty">
        No injected files
      </div>
    );
  }

  return (
    <div className="category-donut">
      {/* Donut chart */}
      <div className="category-donut-chart">
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
        <div className="category-donut-center">
          <span className="category-donut-total">
            {formatTokens(totalTokens)}
          </span>
          <span className="category-donut-unit">tokens</span>
        </div>
      </div>

      {/* Legend */}
      <div className="category-donut-legend">
        {chartData.map((entry) => (
          <div
            key={entry.category}
            className="category-donut-legend-item"
          >
            <span
              className="legend-dot"
              style={{ background: entry.color }}
            />
            <span className="category-donut-legend-label">
              {CATEGORY_LABELS[entry.category] ?? entry.category}
            </span>
            <span className="category-donut-legend-tokens">
              {formatTokens(entry.totalTokens)}
            </span>
            <span className="category-donut-legend-pct">
              {entry.percentage.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
