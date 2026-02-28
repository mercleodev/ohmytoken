import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatTokens } from '../../utils/format';
import type { OutputProductivityResult } from '../../types/electron';

type OutputProductivityCardProps = {
  scanRevision?: number;
  provider?: string;
};

const OUTPUT_BAR_MIN_WIDTH_PCT = 2;

export const OutputProductivityCard = ({ scanRevision, provider }: OutputProductivityCardProps) => {
  const [expanded, setExpanded] = useState(true);
  const [data, setData] = useState<OutputProductivityResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getOutputProductivity(provider)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((err) => console.error('getOutputProductivity failed:', err));
    return () => { cancelled = true; };
  }, [scanRevision, provider]);

  if (!data || data.todayTotalTokens === 0) return null;

  const ratioPct = data.todayOutputRatio * 100;
  const barWidth = Math.max(ratioPct, OUTPUT_BAR_MIN_WIDTH_PCT);
  const avg7dOutput = data.last7DaysTotalTokens > 0
    ? Math.round(data.last7DaysOutputTokens / 7)
    : 0;

  return (
    <div className="output-card">
      <button
        className="cost-header"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label="Toggle Output Productivity details"
      >
        <span className="cost-title">Output Productivity</span>
        <span className={`cost-chevron ${expanded ? 'expanded' : ''}`}>›</span>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="output-card-headline">
              <span className="output-card-value">{formatTokens(data.todayOutputTokens)}</span>
              <span className="output-card-unit"> tokens produced</span>
            </div>
            <div className="output-card-sub">
              out of {formatTokens(data.todayTotalTokens)} total ({ratioPct.toFixed(2)}%)
            </div>
            <div className="output-card-bar-track">
              <div
                className="output-card-bar-fill"
                style={{ width: `${barWidth}%` }}
              />
            </div>
            {avg7dOutput > 0 && (
              <div className="output-card-trend">
                7d avg: {formatTokens(avg7dOutput)} output/day
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
