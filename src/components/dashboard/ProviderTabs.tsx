import { motion } from 'framer-motion';
import { UsageProviderType, ProviderTokenStatus } from '../../types';

type ProviderTabInfo = {
  id: UsageProviderType;
  name: string;
  icon: string;
  connected: boolean;
};

type ProviderTabsProps = {
  providers: ProviderTabInfo[];
  selected: UsageProviderType;
  onSelect: (provider: UsageProviderType) => void;
};

const PROVIDER_COLORS: Record<UsageProviderType, string> = {
  claude: '#d97757',
  codex: '#10a37f',
  gemini: '#4285f4',
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
          <span className={`provider-tab-dot ${p.connected ? '' : 'disconnected'}`} />
        </button>
      ))}
    </div>
  );
};

export const buildProviderTabInfo = (statuses: ProviderTokenStatus[]): ProviderTabInfo[] => {
  const ICONS: Record<UsageProviderType, string> = {
    claude: '✺',
    codex: '◎',
    gemini: '◆',
  };

  const allProviders: UsageProviderType[] = ['claude', 'codex', 'gemini'];

  return allProviders.map((id) => {
    const status = statuses.find((s) => s.provider === id);
    return {
      id,
      name: status?.displayName ?? id.charAt(0).toUpperCase() + id.slice(1),
      icon: ICONS[id],
      connected: status ? status.hasToken && !status.tokenExpired : false,
    };
  });
};
