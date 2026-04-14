import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
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
