import { motion } from 'framer-motion';
import { ProviderTokenStatus } from '../../types';

export type AccountInsightsIntent = 'not_connected' | 'expired';

type AccountInsightsCardProps = {
  status: ProviderTokenStatus;
  onConnect?: (status: ProviderTokenStatus) => void;
};

export const resolveAccountInsightsIntent = (
  status: ProviderTokenStatus | null,
): AccountInsightsIntent | null => {
  if (!status) return null;
  if (status.tokenExpired) return 'expired';
  if (!status.hasToken) return 'not_connected';
  return null;
};

const TITLE_BY_INTENT: Record<AccountInsightsIntent, (name: string) => string> = {
  not_connected: (name) => `${name} account insights not connected`,
  expired: (name) => `${name} account session expired`,
};

const BODY_BY_INTENT: Record<AccountInsightsIntent, string> = {
  not_connected:
    'You can still browse sessions, prompts, and cost trends for this provider. Connect account insights to see quota windows, plan details, and reset timing.',
  expired:
    'Tracking is still active. Reconnect provider account insights to restore usage windows and plan information.',
};

const PRIMARY_CTA_BY_INTENT: Record<AccountInsightsIntent, string> = {
  not_connected: 'Connect Account Insights',
  expired: 'Reconnect',
};

export const AccountInsightsCard = ({ status, onConnect }: AccountInsightsCardProps) => {
  const intent = resolveAccountInsightsIntent(status);
  if (!intent) return null;

  const title = TITLE_BY_INTENT[intent](status.displayName);
  const body = BODY_BY_INTENT[intent];
  const primaryLabel = PRIMARY_CTA_BY_INTENT[intent];

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
