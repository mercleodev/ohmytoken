import { motion } from 'framer-motion';
import { UsageProviderType, ProviderTokenStatus } from '../../types';

export type ProviderFilter = UsageProviderType | 'all';

type ProviderTabInfo = {
  id: ProviderFilter;
  name: string;
  icon: string;
  connected: boolean;
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
            <span className={`provider-tab-dot ${p.connected ? '' : 'disconnected'}`} />
          )}
        </button>
      ))}
    </div>
  );
};

export const buildProviderTabInfo = (statuses: ProviderTokenStatus[]): ProviderTabInfo[] => {
  const allProviders: UsageProviderType[] = ['claude', 'codex', 'gemini'];

  const providerTabs: ProviderTabInfo[] = allProviders.map((id) => {
    const status = statuses.find((s) => s.provider === id);
    return {
      id,
      name: status?.displayName ?? id.charAt(0).toUpperCase() + id.slice(1),
      icon: PROVIDER_ICONS[id],
      connected: status ? status.hasToken && !status.tokenExpired : false,
    };
  });

  // Prepend the "All" tab
  return [
    { id: 'all' as ProviderFilter, name: 'All', icon: PROVIDER_ICONS.all, connected: true },
    ...providerTabs,
  ];
};
