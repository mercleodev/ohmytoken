import { motion } from 'framer-motion';
import { ProviderConnectionStatus, AccountInsightsState } from '../../types';

type AccountInsightsCardProps = {
  status: ProviderConnectionStatus;
  onConnect?: (status: ProviderConnectionStatus) => void;
};

const TITLE_BY_STATE: Partial<Record<AccountInsightsState, (name: string) => string>> = {
  not_connected: (name) => `${name} account insights not connected`,
  expired: (name) => `${name} account session expired`,
  access_denied: (name) => `${name} account access denied`,
  unavailable: (name) => `${name} account insights unavailable`,
};

const BODY_BY_STATE: Partial<Record<AccountInsightsState, string>> = {
  not_connected:
    'You can still browse sessions, prompts, and cost trends for this provider. Connect account insights to see quota windows, plan details, and reset timing.',
  expired:
    'Tracking is still active. Reconnect provider account insights to restore usage windows and plan information.',
  access_denied:
    'OhMyToken could not read local provider credentials. You can keep using tracking-only mode and reconnect later.',
  unavailable:
    'Tracking is still active. Provider account metadata could not be refreshed right now.',
};

const PRIMARY_CTA_BY_STATE: Partial<Record<AccountInsightsState, string>> = {
  not_connected: 'Connect Account Insights',
  expired: 'Reconnect',
  access_denied: 'Try Again',
  unavailable: 'Retry',
};

export const AccountInsightsCard = ({ status, onConnect }: AccountInsightsCardProps) => {
  const state = status.accountInsights;
  if (state === 'connected') return null;

  const title = TITLE_BY_STATE[state]?.(status.displayName) ?? '';
  const body = BODY_BY_STATE[state] ?? '';
  const primaryLabel = PRIMARY_CTA_BY_STATE[state] ?? 'Connect Account Insights';

  return (
    <motion.div
      className="account-insights-card"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="status"
      aria-live="polite"
    >
      <div className="account-insights-card-title">{title}</div>
      <div className="account-insights-card-body">{body}</div>
      <div className="account-insights-card-actions">
        <button
          type="button"
          className="account-insights-card-primary"
          onClick={() => onConnect?.(status)}
        >
          {primaryLabel}
        </button>
        <span className="account-insights-card-secondary-hint">
          Tracking stays active even if account connection fails.
        </span>
      </div>
    </motion.div>
  );
};
