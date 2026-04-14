import { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { UsageProviderType, ProviderUsageSnapshot, ProviderTokenStatus } from '../../types';
import type { PromptScan, UsageLogEntry } from '../../types';
import { setContextLimitOverride } from '../scan/shared';

type PendingPromptNav = {
  scan: PromptScan;
  usage: UsageLogEntry | null;
};

// Error boundary: displays error message on crash
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 16, color: '#ff3b30', fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Error:</div>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#8e8e93', marginTop: 4 }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 8, padding: '4px 12px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { ProviderTabs, buildProviderTabInfo } from './ProviderTabs';
import type { ProviderFilter } from './ProviderTabs';
import { UsageView } from './UsageView';
import { SessionDetailView } from './SessionDetailView';
import { PromptDetailView } from './PromptDetailView';
import { StatsDetailView } from './StatsDetailView';
import { ContextLimitSettings } from './ContextLimitSettings';
import { BackfillDialog } from './BackfillDialog';
import './dashboard.css';

// Navigation stack: usage → session → prompt | stats
type NavState =
  | { screen: 'main' }
  | { screen: 'session'; sessionId: string }
  | { screen: 'prompt'; scan: PromptScan; usage: UsageLogEntry | null; sessionId: string }
  | { screen: 'stats' };

const TAB_ORDER: ProviderFilter[] = ['all', 'claude', 'codex', 'gemini'];

type DashboardProps = {
  pendingPromptNav?: PendingPromptNav | null;
  onPromptNavConsumed?: () => void;
};

export const UsageDashboard = ({ pendingPromptNav, onPromptNavConsumed }: DashboardProps = {}) => {
  const [selectedProvider, setSelectedProvider] = useState<ProviderFilter>('all');
  const [providerStatuses, setProviderStatuses] = useState<ProviderTokenStatus[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, ProviderUsageSnapshot | null>>({});
  const [loading, setLoading] = useState(false);
  const [showContextSettings, setShowContextSettings] = useState(false);
  const [showBackfill, setShowBackfill] = useState(false);

  // Check backfill status on mount
  useEffect(() => {
    const checkBackfill = async () => {
      try {
        const status = await window.api.backfillStatus();
        if (!status.completed) {
          const count = await window.api.backfillCount();
          if (count > 0) {
            setShowBackfill(true);
          }
        }
      } catch { /* backfill check is best-effort */ }
    };
    checkBackfill();
  }, []);

  // Listen for new scan events (always active — no data loss regardless of tab)
  const [scanRevision, setScanRevision] = useState(0);
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(() => {
      setScanRevision((r) => r + 1);
    });
    return cleanup;
  }, []);

  // Listen for periodic backfill completions → refresh dashboard
  useEffect(() => {
    const cleanup = window.api.onBackfillComplete(() => {
      setScanRevision((r) => r + 1);
    });
    return cleanup;
  }, []);

  // Navigation
  const [nav, setNav] = useState<NavState>({ screen: 'main' });
  const [navDirection, setNavDirection] = useState(1);

  // Provider tab animation direction
  const [providerDirection, setProviderDirection] = useState(0);

  const loadStatuses = useCallback(async () => {
    try {
      const statuses = await window.api.getAllProviderStatus();
      setProviderStatuses(statuses);
    } catch (err) {
      console.error('Failed to load provider statuses:', err);
    }
  }, []);

  const loadUsage = useCallback(async (provider: UsageProviderType) => {
    setLoading(true);
    try {
      const data = await window.api.getProviderUsage(provider);
      setSnapshots((prev) => ({ ...prev, [provider]: data }));
    } catch (err) {
      console.error(`Failed to load ${provider} usage:`, err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load settings on mount → apply context limit override
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const data = await window.api.getUsageData();
        if (data?.settings?.contextLimitOverride) {
          setContextLimitOverride(data.settings.contextLimitOverride);
        }
      } catch { /* settings load is best-effort */ }
    };
    loadSettings();
  }, []);

  useEffect(() => {
    loadStatuses();
    // Pre-load claude snapshot on mount (default provider for gauge)
    loadUsage('claude');
  }, [loadStatuses, loadUsage]);

  const handleProviderChange = useCallback((provider: ProviderFilter) => {
    const prevIdx = TAB_ORDER.indexOf(selectedProvider);
    const nextIdx = TAB_ORDER.indexOf(provider);
    setProviderDirection(nextIdx > prevIdx ? 1 : -1);
    setSelectedProvider(provider);
    setNav({ screen: 'main' });
    // Load usage snapshot for specific providers
    if (provider !== 'all' && !snapshots[provider]) {
      loadUsage(provider);
    }
  }, [selectedProvider, snapshots, loadUsage]);

  const handleRefresh = useCallback(async () => {
    if (selectedProvider === 'all') return;
    setLoading(true);
    try {
      await window.api.refreshProviderUsage(selectedProvider);
    } catch (err) {
      console.error('Refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedProvider]);

  useEffect(() => {
    const cleanup = window.api.onProviderTokenChanged((provider) => {
      loadStatuses();
      loadUsage(provider);
    });
    return cleanup;
  }, [loadStatuses, loadUsage]);

  // usageStore push: real-time snapshot sync
  useEffect(() => {
    const cleanup = window.api.onProviderUsageUpdated(({ provider, snapshot }) => {
      setSnapshots((prev) => ({ ...prev, [provider]: snapshot }));
    });
    return cleanup;
  }, []);

  // Select stats → stats detail view
  const handleSelectStats = useCallback(() => {
    setNavDirection(1);
    setNav({ screen: 'stats' });
  }, []);

  // Select session → session detail view
  const handleSelectSession = useCallback((sessionId: string) => {
    setNavDirection(1);
    setNav({ screen: 'session', sessionId });
  }, []);

  // Select prompt → prompt detail view
  const handleSelectPrompt = useCallback((scan: PromptScan, usage: UsageLogEntry | null) => {
    if (nav.screen === 'session') {
      setNavDirection(1);
      setNav({ screen: 'prompt', scan, usage, sessionId: nav.sessionId });
    }
  }, [nav]);

  // Go back
  const handleBackFromStats = useCallback(() => {
    setNavDirection(-1);
    setNav({ screen: 'main' });
  }, []);

  const handleBackFromSession = useCallback(() => {
    setNavDirection(-1);
    setNav({ screen: 'main' });
  }, []);

  const handleBackFromPrompt = useCallback(() => {
    if (nav.screen === 'prompt') {
      setNavDirection(-1);
      setNav({ screen: 'session', sessionId: nav.sessionId });
    }
  }, [nav]);

  // Handle notification click → navigate to prompt detail
  useEffect(() => {
    if (!pendingPromptNav) return;
    const { scan, usage } = pendingPromptNav;
    setNavDirection(1);
    setNav({ screen: 'prompt', scan, usage, sessionId: scan.session_id });
    onPromptNavConsumed?.();
  }, [pendingPromptNav, onPromptNavConsumed]);

  const tabInfo = buildProviderTabInfo(providerStatuses);
  const isAllView = selectedProvider === 'all';
  const currentSnapshot = isAllView ? null : (snapshots[selectedProvider] ?? null);
  const currentStatus = isAllView
    ? null
    : (providerStatuses.find((s) => s.provider === selectedProvider) ?? null);

  // Provider filter for data queries: undefined = all providers
  const providerQueryParam = isAllView ? undefined : selectedProvider;

  // Animation key for main content
  const contentKey = nav.screen === 'main'
    ? `usage-${selectedProvider}`
    : nav.screen === 'stats'
      ? 'stats'
      : nav.screen === 'session'
        ? `session-${nav.sessionId}`
        : nav.screen === 'prompt'
          ? `prompt-${nav.scan.request_id}`
          : 'unknown';

  const contentDirection = nav.screen !== 'main'
    ? navDirection
    : providerDirection;

  return (
    <LayoutGroup>
      <div className="dashboard">
        {/* Provider tabs - hidden in session/prompt detail views */}
        {nav.screen === 'main' && (
          <ProviderTabs
            providers={tabInfo}
            selected={selectedProvider}
            onSelect={handleProviderChange}
          />
        )}

        {/* Header row with title and action buttons */}
        {nav.screen === 'main' && (
          <div className="sub-tabs-row">
            <div className="sub-tab-header-title">Usage Overview</div>
            {!isAllView && (
              <button
                className={`dashboard-refresh-btn ${loading ? 'loading' : ''}`}
                onClick={handleRefresh}
                disabled={loading}
                title="Refresh"
              >
                ↻
              </button>
            )}
            <button
              className="dashboard-settings-btn"
              onClick={() => setShowContextSettings(true)}
              title="Context Limit Settings"
            >
              ⚙
            </button>
          </div>
        )}
        {nav.screen === 'main' && (
          <div className="sub-tab-helper">
            <div className="sub-tab-helper-desc">Track spend trends and browse recent sessions from a usage-first view.</div>
          </div>
        )}

        {/* Content Area */}
        <div className="dashboard-content">
          <ErrorBoundary>
            <AnimatePresence mode="wait" initial={false} custom={contentDirection}>
              <motion.div
                key={contentKey}
                custom={contentDirection}
                initial="enter"
                animate="center"
                exit="exit"
                variants={{
                  enter: (dir: number) => ({ opacity: 0, x: dir * 40 }),
                  center: { opacity: 1, x: 0 },
                  exit: (dir: number) => ({ opacity: 0, x: dir * -40 }),
                }}
                transition={{ type: 'spring', stiffness: 400, damping: 40, mass: 1 }}
              >
                {/* Main: usage view */}
                {nav.screen === 'main' && (
                  <UsageView
                    snapshot={currentSnapshot}
                    tokenStatus={currentStatus}
                    loading={loading}
                    onSelectSession={handleSelectSession}
                    onSelectStats={handleSelectStats}
                    scanRevision={scanRevision}
                    provider={providerQueryParam}
                    isAllView={isAllView}
                  />
                )}

                {/* Stats Detail */}
                {nav.screen === 'stats' && (
                  <StatsDetailView
                    onBack={handleBackFromStats}
                    provider={providerQueryParam}
                    scanRevision={scanRevision}
                  />
                )}

                {/* Session Detail */}
                {nav.screen === 'session' && (
                  <SessionDetailView
                    sessionId={nav.sessionId}
                    onBack={handleBackFromSession}
                    onSelectPrompt={handleSelectPrompt}
                  />
                )}

                {/* Prompt Detail */}
                {nav.screen === 'prompt' && (
                  <PromptDetailView
                    scan={nav.scan}
                    usage={nav.usage}
                    onBack={handleBackFromPrompt}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </ErrorBoundary>
        </div>

        {/* Context Limit Settings Popup */}
        <AnimatePresence>
          {showContextSettings && (
            <ContextLimitSettings
              detectedPlan={snapshots.claude?.identity?.plan ?? null}
              onClose={() => setShowContextSettings(false)}
            />
          )}
        </AnimatePresence>

        {/* Backfill Onboarding Dialog */}
        {showBackfill && (
          <BackfillDialog
            onComplete={() => {
              setShowBackfill(false);
              setScanRevision((r) => r + 1);
            }}
            onDismiss={() => setShowBackfill(false)}
          />
        )}
      </div>
    </LayoutGroup>
  );
};
