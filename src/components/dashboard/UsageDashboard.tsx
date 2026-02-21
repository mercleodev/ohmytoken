import { useState, useEffect, useCallback, Component, ReactNode } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { UsageProviderType, ProviderUsageSnapshot, ProviderTokenStatus } from '../../types';
import type { PromptScan, UsageLogEntry } from '../../types';
import { setContextLimitOverride } from '../scan/shared';

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
import { SubTabs, SubTabType } from './SubTabs';
import { UsageView } from './UsageView';
import { LiveSessionView } from './LiveSessionView';
import { SessionDetailView } from './SessionDetailView';
import { PromptDetailView } from './PromptDetailView';
import { ContextAnalysisView } from '../context/ContextAnalysisView';
import { StatsDetailView } from './StatsDetailView';
import { ContextLimitSettings } from './ContextLimitSettings';
import './dashboard.css';

type UsageDashboardProps = {
  onOpenAnalyzer?: () => void;
  onOpenScan?: () => void;
};

// Navigation stack: usage → session → prompt | stats
type NavState =
  | { screen: 'main' }
  | { screen: 'session'; sessionId: string }
  | { screen: 'prompt'; scan: PromptScan; usage: UsageLogEntry | null; sessionId: string }
  | { screen: 'stats'; stats: import('../../types').ScanStats };

export const UsageDashboard = ({ onOpenAnalyzer, onOpenScan }: UsageDashboardProps) => {
  const [selectedProvider, setSelectedProvider] = useState<UsageProviderType>('claude');
  const [activeSubTab, setActiveSubTab] = useState<SubTabType>('usage');
  const [providerStatuses, setProviderStatuses] = useState<ProviderTokenStatus[]>([]);
  const [snapshots, setSnapshots] = useState<Record<string, ProviderUsageSnapshot | null>>({});
  const [loading, setLoading] = useState(false);
  const [showContextSettings, setShowContextSettings] = useState(false);

  // Listen for new scan events (always active — no data loss regardless of tab)
  const [scanRevision, setScanRevision] = useState(0);
  useEffect(() => {
    const cleanup = window.api.onNewPromptScan(() => {
      setScanRevision((r) => r + 1);
    });
    return cleanup;
  }, []);

  // Navigation
  const [nav, setNav] = useState<NavState>({ screen: 'main' });
  const [navDirection, setNavDirection] = useState(1);

  // Tab switch animation direction
  const PROVIDER_ORDER: UsageProviderType[] = ['claude', 'codex', 'gemini'];
  const SUB_TAB_ORDER: SubTabType[] = ['usage', 'live-session', 'context-analysis'];
  const SUB_TAB_TITLES: Record<SubTabType, string> = {
    usage: 'Usage Overview',
    'live-session': 'Live Session Flow',
    'context-analysis': 'Context Waste Analysis',
  };
  const SUB_TAB_DESCRIPTIONS: Record<SubTabType, string> = {
    usage:
      'Track spend trends and browse recent sessions from a usage-first view.',
    'live-session':
      'Inspect the current session turn-by-turn with context growth and action flow.',
    'context-analysis':
      'Inspect injected context distribution and file-level token impact.',
  };
  const [providerDirection, setProviderDirection] = useState(0);
  const [subTabDirection, setSubTabDirection] = useState(0);

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
    loadUsage(selectedProvider);
  }, []);

  const handleProviderChange = useCallback((provider: UsageProviderType) => {
    const prevIdx = PROVIDER_ORDER.indexOf(selectedProvider);
    const nextIdx = PROVIDER_ORDER.indexOf(provider);
    setProviderDirection(nextIdx > prevIdx ? 1 : -1);
    setSelectedProvider(provider);
    setActiveSubTab('usage');
    setNav({ screen: 'main' });
    if (!snapshots[provider]) {
      loadUsage(provider);
    }
  }, [selectedProvider, snapshots, loadUsage]);

  const handleSubTabChange = useCallback((tab: SubTabType) => {
    const prevIdx = SUB_TAB_ORDER.indexOf(activeSubTab);
    const nextIdx = SUB_TAB_ORDER.indexOf(tab);
    setSubTabDirection(nextIdx > prevIdx ? 1 : -1);
    setActiveSubTab(tab);
    setNav({ screen: 'main' });
  }, [activeSubTab]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await window.api.refreshProviderUsage(selectedProvider);
      // Snapshot is auto-updated via onProviderUsageUpdated push
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
  const handleSelectStats = useCallback((stats: import('../../types').ScanStats) => {
    setNavDirection(1);
    setNav({ screen: 'stats', stats });
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

  const tabInfo = buildProviderTabInfo(providerStatuses);
  const currentSnapshot = snapshots[selectedProvider] ?? null;
  const currentStatus = providerStatuses.find((s) => s.provider === selectedProvider) ?? null;

  // Animation key for main content
  const contentKey = nav.screen === 'main'
    ? `${activeSubTab}-${selectedProvider}`
    : nav.screen === 'stats'
      ? 'stats'
      : nav.screen === 'session'
        ? `session-${nav.sessionId}`
        : `prompt-${nav.screen === 'prompt' ? nav.scan.request_id : ''}`;

  const contentDirection = nav.screen !== 'main'
    ? navDirection
    : (subTabDirection || providerDirection);

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

        {/* Sub tabs - shown only on main screen */}
        {nav.screen === 'main' && (
          <div className="sub-tabs-row">
            <SubTabs active={activeSubTab} onChange={handleSubTabChange} />
            <button
              className={`dashboard-refresh-btn ${loading ? 'loading' : ''}`}
              onClick={handleRefresh}
              disabled={loading}
              title="Refresh"
            >
              ↻
            </button>
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
            <div className="sub-tab-helper-title">{SUB_TAB_TITLES[activeSubTab]}</div>
            <div className="sub-tab-helper-desc">{SUB_TAB_DESCRIPTIONS[activeSubTab]}</div>
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
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              >
                {/* Main: usage or live session */}
                {nav.screen === 'main' && activeSubTab === 'usage' && (
                  <UsageView
                    snapshot={currentSnapshot}
                    tokenStatus={currentStatus}
                    loading={loading}
                    onSelectSession={handleSelectSession}
                    onSelectStats={handleSelectStats}
                    scanRevision={scanRevision}
                  />
                )}

                {nav.screen === 'main' && activeSubTab === 'live-session' && (
                  <LiveSessionView />
                )}

                {nav.screen === 'main' && activeSubTab === 'context-analysis' && (
                  <ContextAnalysisView />
                )}

                {/* Stats Detail */}
                {nav.screen === 'stats' && (
                  <StatsDetailView
                    stats={nav.stats}
                    onBack={handleBackFromStats}
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

        {/* Bottom legacy buttons - main only */}
        {nav.screen === 'main' && (onOpenAnalyzer || onOpenScan) && (
          <div className="dashboard-footer">
            {onOpenAnalyzer && (
              <button className="footer-tool-btn" onClick={onOpenAnalyzer}>Token Analysis</button>
            )}
            {onOpenScan && (
              <button className="footer-tool-btn" onClick={onOpenScan}>CT Scan</button>
            )}
          </div>
        )}
      </div>
    </LayoutGroup>
  );
};
