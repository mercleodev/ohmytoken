import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ProviderUsageSnapshot, ProviderTokenStatus, CreditBalance } from '../../types';
import type { ScanStats } from '../../types';
import { UsageGaugeCard } from './UsageGaugeCard';
import { formatTimeAgo } from '../../utils/format';
import { CostCard } from './CostCard';
import { StatsCard } from './StatsCard';
import { SetupGuide } from './SetupGuide';
import { RecentSessions } from './RecentSessions';
import { OutputProductivityCard } from './OutputProductivityCard';
import { McpInsightsCard } from './McpInsightsCard';

type UsageViewProps = {
  snapshot: ProviderUsageSnapshot | null;
  tokenStatus: ProviderTokenStatus | null;
  loading: boolean;
  onSelectSession?: (sessionId: string) => void;
  onSelectStats?: (stats: ScanStats) => void;
  scanRevision?: number;
  provider?: string;
  isAllView?: boolean;
};

const CreditBalanceCard = ({ creditBalance }: { creditBalance: CreditBalance }) => {
  const formatUSD = (n: number): string => `$${n.toFixed(2)}`;
  const formatExpiry = (iso: string): string => {
    const d = new Date(iso);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="credit-balance-card">
      <div className="credit-balance-header">API Credit Balance</div>
      <div className="credit-balance-amount">{formatUSD(creditBalance.balanceUSD)}</div>
      {(creditBalance.grantedUSD !== undefined || creditBalance.usedUSD !== undefined) && (
        <div className="credit-balance-detail">
          {creditBalance.grantedUSD !== undefined && (
            <div className="credit-balance-row">
              <span>Granted</span>
              <span>{formatUSD(creditBalance.grantedUSD)}</span>
            </div>
          )}
          {creditBalance.usedUSD !== undefined && (
            <div className="credit-balance-row">
              <span>Used</span>
              <span>{formatUSD(creditBalance.usedUSD)}</span>
            </div>
          )}
          {creditBalance.expiresAt && (
            <div className="credit-balance-row">
              <span>Expires</span>
              <span>{formatExpiry(creditBalance.expiresAt)}</span>
            </div>
          )}
        </div>
      )}
      {creditBalance.grantedUSD !== undefined && creditBalance.grantedUSD > 0 && (
        <div className="credit-balance-bar-track">
          <div
            className="credit-balance-bar-fill"
            style={{
              width: `${Math.min(100, (creditBalance.balanceUSD / creditBalance.grantedUSD) * 100)}%`,
            }}
          />
        </div>
      )}
    </div>
  );
};

const LastUpdatedLabel = ({ updatedAt }: { updatedAt: string }) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="usage-last-updated">
      Last updated: {formatTimeAgo(updatedAt)}
    </div>
  );
};

export const UsageView = ({ snapshot, tokenStatus, loading, onSelectSession, onSelectStats, scanRevision, provider, isAllView }: UsageViewProps) => {
  // "All" view: skip gauge/cost, show data cards with no provider filter
  if (isAllView) {
    return (
      <div>
        {/* Output Productivity (all providers) */}
        <OutputProductivityCard scanRevision={scanRevision} provider={provider} />
        <McpInsightsCard scanRevision={scanRevision} />

        {/* Stats */}
        {onSelectStats && (
          <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} provider={provider} />
        )}

        {/* Recent Sessions (all providers) */}
        {onSelectSession && (
          <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} provider={provider} />
        )}
      </div>
    );
  }

  // Show SetupGuide when token is missing or expired
  // Note: skip `installed` check — packaged apps cannot reliably resolve CLI PATH,
  // and having a valid token already implies the CLI was installed.
  if (tokenStatus && (!tokenStatus.hasToken || tokenStatus.tokenExpired)) {
    return <SetupGuide status={tokenStatus} />;
  }

  // Loading data
  if (loading && !snapshot) {
    return (
      <motion.div
        className="setup-guide"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <div className="setup-guide-icon" style={{ animation: 'spin 1s linear infinite' }}>↻</div>
        <div className="setup-guide-title">Loading usage data...</div>
      </motion.div>
    );
  }

  // No snapshot — skip gauge/cost but still show data cards (prompts from DB)
  if (!snapshot) {
    return (
      <div>
        <OutputProductivityCard scanRevision={scanRevision} provider={provider} />
        <McpInsightsCard scanRevision={scanRevision} />
        {onSelectStats && (
          <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} provider={provider} />
        )}
        {onSelectSession && (
          <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} provider={provider} />
        )}
      </div>
    );
  }

  // Prepaid account: when notice exists and windows are empty
  if (snapshot.notice && snapshot.windows.length === 0) {
    return (
      <div>
        {/* Provider Header */}
        <div className="provider-header">
          <div className="provider-header-left">
            <div className="provider-header-name">{snapshot.displayName}</div>
            <div className="provider-header-updated">{formatTimeAgo(snapshot.updatedAt)}</div>
          </div>
          {snapshot.identity?.plan && (
            <div className="provider-header-plan">{snapshot.identity.plan}</div>
          )}
        </div>

        {/* Credit Balance */}
        {snapshot.creditBalance && (
          <CreditBalanceCard creditBalance={snapshot.creditBalance} />
        )}

        {/* Notice */}
        <div className="prepaid-notice">
          <div className="prepaid-notice-icon">i</div>
          <div className="prepaid-notice-text">
            {snapshot.notice.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>

        {/* Output Productivity */}
        <OutputProductivityCard scanRevision={scanRevision} provider={provider} />
        <McpInsightsCard scanRevision={scanRevision} />

        {/* Stats */}
        {onSelectStats && (
          <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} provider={provider} />
        )}

        {/* Recent Sessions (CT Scan) */}
        {onSelectSession && (
          <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} provider={provider} />
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Provider Header */}
      <div className="provider-header">
        <div className="provider-header-left">
          <div className="provider-header-name">{snapshot.displayName}</div>
          <div className="provider-header-updated">{formatTimeAgo(snapshot.updatedAt)}</div>
        </div>
        {snapshot.identity?.plan && (
          <div className="provider-header-plan">{snapshot.identity.plan}</div>
        )}
      </div>

      {/* Usage Gauges */}
      <UsageGaugeCard windows={snapshot.windows} />

      {/* Last Updated Time */}
      <LastUpdatedLabel updatedAt={snapshot.updatedAt} />

      {/* Cost */}
      <CostCard cost={snapshot.cost} />

      {/* Output Productivity */}
      <OutputProductivityCard scanRevision={scanRevision} provider={provider} />
      <McpInsightsCard scanRevision={scanRevision} />

      {/* Stats */}
      {onSelectStats && (
        <StatsCard onSelectStats={onSelectStats} scanRevision={scanRevision} provider={provider} />
      )}

      {/* Recent Sessions */}
      {onSelectSession && (
        <RecentSessions onSelectSession={onSelectSession} scanRevision={scanRevision} provider={provider} />
      )}
    </div>
  );
};
