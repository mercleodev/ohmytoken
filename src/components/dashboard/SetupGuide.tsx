import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { UsageProviderType, ProviderTokenStatus } from '../../types';

type SetupGuideProps = {
  status: ProviderTokenStatus;
};

const PROVIDER_ICONS: Record<UsageProviderType, string> = {
  claude: '✺',
  codex: '◎',
  gemini: '◆',
};

export const SetupGuide = ({ status }: SetupGuideProps) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const handleCopy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  }, []);

  const isNotInstalled = !status.installed;
  const isNotLoggedIn = status.installed && !status.hasToken;
  const isExpired = status.installed && status.hasToken && status.tokenExpired;

  const title = isNotInstalled
    ? `${status.displayName} CLI not installed`
    : isNotLoggedIn
      ? `${status.displayName} login required`
      : isExpired
        ? `${status.displayName} token expired`
        : `${status.displayName} connection needed`;

  const description = isNotInstalled
    ? 'Install the CLI and log in to connect automatically.'
    : isNotLoggedIn
      ? 'Paste the command below in your terminal. It will connect automatically after browser login.'
      : isExpired
        ? 'Your token has expired. Run the command below to refresh.'
        : 'Run the command below.';

  const commands: { label: string; command: string; field: string }[] = [];

  if (isNotInstalled) {
    commands.push({ label: '1. Install', command: status.setupCommands.install, field: 'install' });
    commands.push({ label: '2. Login', command: status.setupCommands.login, field: 'login' });
  } else if (isNotLoggedIn) {
    commands.push({ label: 'Login', command: status.setupCommands.login, field: 'login' });
  } else if (isExpired) {
    commands.push({ label: 'Refresh token', command: status.setupCommands.refresh, field: 'refresh' });
  }

  return (
    <motion.div
      className="setup-guide"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
    >
      <div className="setup-guide-icon">{PROVIDER_ICONS[status.provider]}</div>
      <div className="setup-guide-title">{title}</div>
      <div className="setup-guide-desc">{description}</div>

      {commands.map((cmd) => (
        <div key={cmd.field}>
          {commands.length > 1 && (
            <div style={{ fontSize: 12, color: '#8e8e93', textAlign: 'left', marginBottom: 4 }}>
              {cmd.label}
            </div>
          )}
          <div className="setup-command-block">
            <code className="setup-command-text">{cmd.command}</code>
            <button
              className={`setup-copy-btn ${copiedField === cmd.field ? 'copied' : ''}`}
              onClick={() => handleCopy(cmd.command, cmd.field)}
            >
              {copiedField === cmd.field ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ))}

      <div className="setup-guide-hint">
        Auto-detected when login is complete.
      </div>
    </motion.div>
  );
};
