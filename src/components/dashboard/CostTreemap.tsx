import { Treemap, ResponsiveContainer } from 'recharts';
import { formatCost } from '../scan/shared';
import type { PromptScan, UsageLogEntry } from '../../types';

type PromptWithCost = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

type CostTreemapProps = {
  prompts: PromptWithCost[];
};

type TreemapNode = {
  name: string;
  size: number;
  cost: number;
  color: string;
};

const PROMPT_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#ef4444', '#6366f1', '#14b8a6',
  '#f97316', '#a855f7', '#06b6d4', '#84cc16',
];

const buildCostData = (prompts: PromptWithCost[]): TreemapNode[] => {
  return prompts
    .filter((p) => p.usage && p.usage.cost_usd > 0)
    .map((p, i) => {
      const text = p.scan.user_prompt || '(system)';
      const shortText = text.length > 30 ? text.slice(0, 30) + '…' : text;
      return {
        name: shortText,
        size: Math.max(p.usage!.cost_usd * 10000, 1), // Treemap requires positive values
        cost: p.usage!.cost_usd,
        color: PROMPT_COLORS[i % PROMPT_COLORS.length],
      };
    });
};

type CostTreemapCellProps = {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  cost?: number;
  color?: string;
};

const CustomContent = (props: CostTreemapCellProps) => {
  const { x, y, width, height, name, cost, color } = props;
  if (!width || !height || width < 20 || height < 20) return null;

  const showLabel = width > 45 && height > 28;
  const showCost = width > 50 && height > 40;

  return (
    <g>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        rx={4}
        ry={4}
        fill={color}
        fillOpacity={0.8}
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={0.5}
      />
      {showLabel && (
        <text
          x={x + 6}
          y={y + 16}
          fill="#fff"
          fontSize={10}
          fontWeight={500}
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        >
          {(name?.length ?? 0) > width / 6 ? (name ?? '').slice(0, Math.floor(width / 6)) + '…' : name}
        </text>
      )}
      {showCost && (
        <text
          x={x + 6}
          y={y + 30}
          fill="rgba(255,255,255,0.85)"
          fontSize={12}
          fontWeight={700}
          fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
        >
          {formatCost(cost)}
        </text>
      )}
    </g>
  );
};

export const CostTreemap = ({ prompts }: CostTreemapProps) => {
  const data = buildCostData(prompts);
  if (data.length === 0) return null;

  const totalCost = data.reduce((sum, d) => sum + d.cost, 0);

  return (
    <div className="cost-treemap">
      <div className="cost-treemap-header">
        <span className="cost-treemap-title">Session Cost</span>
        <span className="cost-treemap-total">{formatCost(totalCost)}</span>
      </div>
      <div className="cost-treemap-chart">
        <ResponsiveContainer width="100%" height={120}>
          <Treemap
            data={data}
            dataKey="size"
            stroke="none"
            content={((props: Record<string, unknown>) => <CustomContent {...(props as CostTreemapCellProps)} />) as unknown as React.ReactElement}
            isAnimationActive={false}
          />
        </ResponsiveContainer>
      </div>
    </div>
  );
};
