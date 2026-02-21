import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type CostData = {
  todayCostUSD: number;
  todayTokens: number;
  last30DaysCostUSD: number;
  last30DaysTokens: number;
};

type CostCardProps = {
  cost: CostData | null;
};

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
};

const formatCost = (usd: number): string => {
  if (usd < 0.01) return '< $0.01';
  return `$ ${usd.toFixed(2)}`;
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
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="cost-row">
              Today: {formatCost(cost.todayCostUSD)} <span>· {formatTokens(cost.todayTokens)} tokens</span>
            </div>
            <div className="cost-row">
              Last 30 days: {formatCost(cost.last30DaysCostUSD)} <span>· {formatTokens(cost.last30DaysTokens)} tokens</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
