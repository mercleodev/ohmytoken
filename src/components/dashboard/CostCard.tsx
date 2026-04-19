import { useState } from 'react';
import { formatCost, formatTokens } from '../../utils/format';

type CostData = {
  todayCostUSD: number;
  todayTokens: number;
  last30DaysCostUSD: number;
  last30DaysTokens: number;
};

type CostCardProps = {
  cost: CostData | null;
};

export const CostCard = ({ cost }: CostCardProps) => {
  const [expanded, setExpanded] = useState(true);

  if (!cost) return null;

  return (
    <div className="cost-card">
      <div className="cost-header" onClick={() => setExpanded(!expanded)}>
        <span className="cost-title">Cost</span>
        <span className={`cost-chevron ${expanded ? 'expanded' : ''}`}>›</span>
      </div>
      <div className={`collapsible ${expanded ? 'open' : ''}`} aria-hidden={!expanded}>
        <div className="collapsible-inner">
          <div className="cost-row">
            Today: {formatCost(cost.todayCostUSD)} <span>· {formatTokens(cost.todayTokens)} tokens</span>
          </div>
          <div className="cost-row">
            Last 30 days: {formatCost(cost.last30DaysCostUSD)} <span>· {formatTokens(cost.last30DaysTokens)} tokens</span>
          </div>
        </div>
      </div>
    </div>
  );
};
