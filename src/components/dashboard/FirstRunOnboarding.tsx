import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { ProviderConnectionStatus, UsageProviderType } from '../../types';
import { SetupGuide } from './SetupGuide';

const PROVIDER_ICONS: Record<UsageProviderType, string> = {
  claude: '✺',
  codex: '◎',
  gemini: '◆',
};

const POLL_INTERVAL_MS = 3000;

type FirstRunOnboardingProps = {
  statuses: ProviderConnectionStatus[];
  onComplete: () => void;
  onSkip: () => void;
};

type Stage = 'choose' | 'walkthrough' | 'done';

export const FirstRunOnboarding = ({
  statuses,
  onComplete,
  onSkip,
}: FirstRunOnboardingProps) => {
  const [stage, setStage] = useState<Stage>('choose');
  const [selected, setSelected] = useState<UsageProviderType | null>(null);
  const [liveStatuses, setLiveStatuses] = useState<ProviderConnectionStatus[]>(statuses);

  useEffect(() => {
    setLiveStatuses(statuses);
  }, [statuses]);

  const selectedStatus = useMemo(
    () => liveStatuses.find((s) => s.provider === selected) ?? null,
    [liveStatuses, selected],
  );

  useEffect(() => {
    if (stage !== 'walkthrough' || !selectedStatus) return undefined;

    if (selectedStatus.tracking === 'active') {
      setStage('done');
      return undefined;
    }

    const timer = setInterval(async () => {
      try {
        const next = await window.api.getAllProviderConnectionStatus();
        setLiveStatuses(next);
        const updated = next.find((s) => s.provider === selected);
        if (updated?.tracking === 'active') {
          setStage('done');
        }
      } catch (err) {
        console.error('[FirstRunOnboarding] Failed to poll status:', err);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [stage, selected, selectedStatus]);

  const handleEnable = useCallback((provider: UsageProviderType) => {
    setSelected(provider);
    setStage('walkthrough');
  }, []);

  const handleViewDashboard = useCallback(() => {
    onComplete();
  }, [onComplete]);

  if (stage === 'choose') {
    return (
      <motion.section
        className="first-run-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <header className="first-run-header">
          <h1 className="first-run-title">Track your agent work before you connect any account.</h1>
          <p className="first-run-subtitle">
            OhMyToken can start tracking sessions, prompts, tool activity, and cost trends without provider account access.
          </p>
        </header>

        <div className="first-run-providers">
          {liveStatuses.map((status) => (
            <article key={status.provider} className="first-run-provider-card">
              <div className="first-run-provider-head">
                <span className="first-run-provider-icon" aria-hidden>
                  {PROVIDER_ICONS[status.provider]}
                </span>
                <div>
                  <div className="first-run-provider-name">{status.displayName}</div>
                  <div className="first-run-provider-state">
                    {status.installed ? 'CLI detected' : 'CLI not detected'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                className="first-run-primary-btn"
                onClick={() => handleEnable(status.provider)}
              >
                Enable {status.displayName} Tracking
              </button>
            </article>
          ))}
        </div>

        <div className="first-run-secondary">
          <button type="button" className="first-run-secondary-btn" onClick={onSkip}>
            Set up later
          </button>
        </div>
      </motion.section>
    );
  }

  if (stage === 'walkthrough' && selectedStatus) {
    const tokenStatus = {
      provider: selectedStatus.provider,
      displayName: selectedStatus.displayName,
      installed: selectedStatus.installed,
      hasToken: selectedStatus.hasLocalCredential,
      tokenExpired: selectedStatus.tokenExpired,
      setupCommands: selectedStatus.setupCommands,
    };

    return (
      <motion.section
        className="first-run-screen"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
      >
        <header className="first-run-header">
          <h1 className="first-run-title">Enable {selectedStatus.displayName} Tracking</h1>
          <p className="first-run-subtitle">
            Run one normal session in the {selectedStatus.displayName} CLI. Your first tracked activity will appear automatically.
          </p>
        </header>

        <div className="first-run-walkthrough">
          <SetupGuide status={tokenStatus} />
          <div className="first-run-waiting">
            <span className="first-run-spinner" aria-hidden />
            <span>Waiting for your next {selectedStatus.displayName} session…</span>
          </div>
        </div>

        <div className="first-run-secondary">
          <button
            type="button"
            className="first-run-secondary-btn"
            onClick={() => setStage('choose')}
          >
            Choose a different provider
          </button>
          <button type="button" className="first-run-secondary-btn" onClick={onSkip}>
            Set up later
          </button>
        </div>
      </motion.section>
    );
  }

  return (
    <motion.section
      className="first-run-screen"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <header className="first-run-header">
        <h1 className="first-run-title">You are now tracked.</h1>
        <p className="first-run-subtitle">
          OhMyToken captured activity for {selectedStatus?.displayName ?? 'your provider'}. You can connect account insights anytime from Settings.
        </p>
      </header>

      <div className="first-run-secondary">
        <button type="button" className="first-run-primary-btn" onClick={handleViewDashboard}>
          View Dashboard
        </button>
      </div>
    </motion.section>
  );
};
