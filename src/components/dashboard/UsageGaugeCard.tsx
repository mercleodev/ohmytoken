import { motion } from 'framer-motion';
import { UsageWindow } from '../../types';

type UsageGaugeCardProps = {
  windows: UsageWindow[];
};

const GAUGE_COLORS = [
  '#e8453c', // Session - red
  '#e67e22', // Weekly - orange
  '#c47832', // Model - brown
  '#8b5cf6', // extra - purple
];

const getGaugeColor = (index: number, usedPercent: number): string => {
  if (usedPercent >= 90) return '#e8453c';
  if (usedPercent >= 70) return '#e67e22';
  return GAUGE_COLORS[index] ?? GAUGE_COLORS[0];
};

export const UsageGaugeCard = ({ windows }: UsageGaugeCardProps) => {
  return (
    <div className="usage-gauges">
      {windows.map((w, i) => (
        <motion.div
          key={w.label}
          className="gauge-item"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: i * 0.04, type: 'spring', stiffness: 350, damping: 30 }}
        >
          <div className="gauge-label">{w.label}</div>
          <div className="gauge-bar-track">
            <motion.div
              className="gauge-bar-fill"
              style={{ background: getGaugeColor(i, w.usedPercent) }}
              initial={{ width: 0 }}
              animate={{ width: `${w.usedPercent}%` }}
              transition={{ type: 'spring', stiffness: 300, damping: 30, delay: i * 0.08 }}
            />
          </div>
          <div className="gauge-info">
            <span className="gauge-used">{w.usedPercent}% used</span>
            <span className="gauge-reset">{w.resetDescription}</span>
          </div>
          {w.paceDescription && (
            <div className="gauge-pace">{w.paceDescription}</div>
          )}
        </motion.div>
      ))}
    </div>
  );
};
