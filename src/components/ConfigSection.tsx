import { useState, useEffect } from 'react';
import { ProviderConfig } from '../types';

type ConfigSectionProps = {
  provider: ProviderConfig | null;
  onSave: (provider: ProviderConfig) => void;
  onCancel: () => void;
  showCancel: boolean;
  error: string | null;
  loading: boolean;
};

export const ConfigSection = ({
  provider,
  onSave,
  onCancel,
  showCancel,
  error,
  loading
}: ConfigSectionProps) => {
  const [orgId, setOrgId] = useState('');
  const [sessionKey, setSessionKey] = useState('');
  const [name, setName] = useState('Claude');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (provider) {
      setOrgId(provider.organizationId || '');
      setSessionKey(provider.sessionKey || '');
      setName(provider.name || 'Claude');
    }
  }, [provider]);

  const handleSubmit = () => {
    setLocalError(null);

    if (!orgId.trim()) {
      setLocalError('Please enter an Organization ID.');
      return;
    }

    if (orgId.trim().length < 30) {
      setLocalError('Invalid Organization ID format.');
      return;
    }

    if (!sessionKey.trim()) {
      setLocalError('Please enter a Session Key.');
      return;
    }

    onSave({
      id: provider?.id || `claude-${Date.now()}`,
      type: 'claude',
      name: name.trim() || 'Claude',
      organizationId: orgId.trim(),
      sessionKey: sessionKey.trim()
    });
  };

  const displayError = localError || error;

  return (
    <section className="config-section">
      <div className="config-form">
        <h2>Claude Configuration</h2>

        <div className="form-group">
          <label htmlFor="orgId">Organization ID</label>
          <input
            type="text"
            id="orgId"
            value={orgId}
            onChange={(e) => setOrgId(e.target.value)}
            placeholder="UUID format (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
          />
          <p className="hint">
            claude.ai → DevTools → Network → find in usage request
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="sessionKey">Session Key</label>
          <input
            type="password"
            id="sessionKey"
            value={sessionKey}
            onChange={(e) => setSessionKey(e.target.value)}
            placeholder="sk-ant-sid..."
          />
          <p className="hint">Copy sessionKey value from claude.ai cookies</p>
        </div>

        <div className="form-group">
          <label htmlFor="providerName">Display Name (optional)</label>
          <input
            type="text"
            id="providerName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Claude Pro"
          />
        </div>

        {displayError && <div className="error-msg">{displayError}</div>}

        <div className="btn-group">
          <button
            className="primary-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Saving...' : 'Save'}
          </button>
          {showCancel && (
            <button
              className="secondary-btn"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </section>
  );
};
