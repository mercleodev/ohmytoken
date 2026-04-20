import { motion } from 'framer-motion';
import {
  UsageProviderType,
  ProviderConnectionStatus,
  TrackingState,
  AccountInsightsState,
} from '../../types';

export type ProviderFilter = UsageProviderType | 'all';

type ProviderTabInfo = {
  id: ProviderFilter;
  name: string;
  icon: string;
  tracking: TrackingState | null;
  accountInsights: AccountInsightsState | null;
};

type ProviderTabsProps = {
  providers: ProviderTabInfo[];
  selected: ProviderFilter;
  onSelect: (provider: ProviderFilter) => void;
};

export const PROVIDER_COLORS: Record<ProviderFilter, string> = {
  all: '#8e8e93',
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4285f4',
};

export const PROVIDER_ICONS: Record<ProviderFilter, string> = {
  all: '⊕',
  claude: '✺',
  codex: '◎',
  gemini: '◆',
};

const trackingDotClass = (tracking: TrackingState | null): string => {
  switch (tracking) {
    case 'active':
      return 'provider-tab-dot tracking-active';
    case 'waiting_for_activity':
      return 'provider-tab-dot tracking-waiting';
    case 'not_enabled':
      return 'provider-tab-dot tracking-not-enabled';
    default:
      return 'provider-tab-dot tracking-unknown';
  }
};

const accountBadgeTitle = (state: AccountInsightsState | null): string => {
  switch (state) {
    case 'connected':
      return 'Account insights connected';
    case 'expired':
      return 'Account session expired';
    case 'not_connected':
      return 'Account insights not connected';
    case 'access_denied':
      return 'Account access denied';
    case 'unavailable':
      return 'Account insights unavailable';
    default:
      return '';
  }
};

const accountBadgeClass = (state: AccountInsightsState | null): string => {
  const base = 'provider-tab-account-badge';
  if (state === 'connected') return `${base} account-connected`;
  if (state === 'expired' || state === 'access_denied') return `${base} account-attention`;
  if (state === 'not_connected') return `${base} account-optional`;
  return '';
};

export const ProviderTabs = ({ providers, selected, onSelect }: ProviderTabsProps) => {
  return (
    <div className="provider-tabs">
      {providers.map((p) => (
        <button
          key={p.id}
          className={`provider-tab ${selected === p.id ? 'active' : ''}`}
          onClick={() => onSelect(p.id)}
        >
          {selected === p.id && (
            <motion.div
              layoutId="provider-indicator"
              className="provider-tab-indicator"
              style={{ background: PROVIDER_COLORS[p.id] }}
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          <span className="provider-tab-icon">{p.icon}</span>
          <span className="provider-tab-name">{p.name}</span>
          {p.id !== 'all' && (
            <span className="provider-tab-indicators" aria-hidden="false">
              <span
                className={trackingDotClass(p.tracking)}
                title={p.tracking ? `Tracking: ${p.tracking.replace('_', ' ')}` : ''}
              />
              {p.accountInsights && p.accountInsights !== 'not_connected' && (
                <span
                  className={accountBadgeClass(p.accountInsights)}
                  title={accountBadgeTitle(p.accountInsights)}
                />
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

export const buildProviderTabInfo = (
  statuses: ProviderConnectionStatus[],
): ProviderTabInfo[] => {
  const allProviders: UsageProviderType[] = ['claude', 'codex', 'gemini'];

  const providerTabs: ProviderTabInfo[] = allProviders.map((id) => {
    const status = statuses.find((s) => s.provider === id);
    return {
      id,
      name: status?.displayName ?? id.charAt(0).toUpperCase() + id.slice(1),
      icon: PROVIDER_ICONS[id],
      tracking: status?.tracking ?? null,
      accountInsights: status?.accountInsights ?? null,
    };
  });

  return [
    { id: 'all' as ProviderFilter, name: 'All', icon: PROVIDER_ICONS.all, tracking: null, accountInsights: null },
    ...providerTabs,
  ];
};
