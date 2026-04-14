import { motion, AnimatePresence } from 'framer-motion';
import { CurrentUsageData, AppSettings } from '../types';
import { ProgressBar } from './ProgressBar';

type UsageSectionProps = {
  usageData: CurrentUsageData;
  settings: AppSettings;
  onEdit: () => void;
  onSettings: () => void;
  onAnalyzer: () => void;
  onScan?: () => void;
  onDashboard?: () => void;
  error: string | null;
};

const formatDate = (dateStr: string | null): string => {
  if (!dateStr) return '--';

  const date = new Date(dateStr);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export const UsageSection = ({ usageData, settings, onEdit, onSettings, onAnalyzer, onScan, onDashboard, error }: UsageSectionProps) => {
  const { usage, resetTime, sevenDay, providerName } = usageData;
  const usage5h = Math.round(usage || 0);
  const usage7d = sevenDay ? Math.round(sevenDay.utilization || 0) : 0;

  const isWarning = usage5h >= 80;

  return (
    <section className="usage-section">
      <AnimatePresence>
        {error && (
          <motion.div
            className="error-msg"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 350, damping: 30 }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="usage-card">
        <div className="card-header">
          <span className="provider-name">{providerName || 'Claude'}</span>
          <span className={`badge ${isWarning ? 'error' : ''}`}>
            {isWarning ? 'Warning' : 'Normal'}
          </span>
        </div>

        <div className="usage-item">
          <div className="usage-label">
            <span>5-Hour Usage</span>
            <span>{usage5h}%</span>
          </div>
          <ProgressBar value={usage5h} colors={settings.colors} />
          <div className="reset-time">Reset: {formatDate(resetTime)}</div>
        </div>

        <div className="usage-item">
          <div className="usage-label">
            <span>7-Day Usage</span>
            <span>{usage7d}%</span>
          </div>
          <ProgressBar value={usage7d} colors={settings.colors} />
          <div className="reset-time">
            Reset: {formatDate(sevenDay?.resetsAt ?? null)}
          </div>
        </div>
      </div>

      <div className="btn-group">
        {onDashboard && (
          <button className="primary-btn" onClick={onDashboard}>
            Usage Dashboard
          </button>
        )}
        {onScan && (
          <button className="primary-btn" onClick={onScan}>
            CT Scan
          </button>
        )}
        <button className="secondary-btn" onClick={onAnalyzer}>
          Token Analysis
        </button>
        <button className="secondary-btn" onClick={onSettings}>
          Settings
        </button>
        <button className="secondary-btn" onClick={onEdit}>
          Provider
        </button>
      </div>
    </section>
  );
};
